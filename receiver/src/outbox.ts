import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { NormalizedEvent } from "./normalize.ts";
import { redact } from "./redact.ts";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_DELIVERY_ATTEMPTS = 5;

/** Single owner of the retry backoff schedule: delay after `attempts` failures, capped at one minute. */
export function retryDelayMs(attempts: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6));
}
// Concurrency policy: a writer waits up to this long for the SQLite write lock
// before SQLITE_BUSY surfaces. Finite so a stuck peer can never block forever;
// nonzero so short WAL write-lock overlap (e.g. two deliveries arriving
// together) resolves by waiting instead of throwing into the webhook path.
export const BUSY_TIMEOUT_MS = 5000;

export type OutboxStats = {
  pending: number;
  deadLetter: number;
  delivered: number;
  oldestPendingAgeMs: number | null;
};

export type OutboxHealth = {
  /** false after a write attempt fails; true again after the next successful write or recover(). */
  ok: boolean;
  /** Masked message of the failure that marked the outbox unhealthy. */
  lastError: string | null;
};

export class Outbox {
  // Assigned by open(), which the constructor runs — `!` because tsc cannot
  // see through the method call, and recover() re-assigns it the same way.
  private db!: Database;
  private readonly path: string;
  private readonly secrets: readonly string[];
  private state: OutboxHealth = { ok: true, lastError: null };

  constructor(path: string, secrets: readonly string[] = []) {
    this.path = path;
    this.secrets = secrets;
    this.open();
  }

  /** Connection setup shared by the constructor and recover(). */
  private open(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    this.db = new Database(this.path, { create: true });
    // busy_timeout comes first so the journal_mode switch itself can wait out a
    // lock held by another connection instead of failing with SQLITE_BUSY.
    this.db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    this.db.run("PRAGMA journal_mode = WAL");
    // Durability policy: synchronous=FULL fsyncs the WAL on every commit, so a
    // pending row written before the webhook ACK — and delivered/dead_letter
    // updates that gate dedupe — survive a process crash and even power loss.
    // NORMAL would only survive a process crash (WAL frames sit in the OS page
    // cache until the next checkpoint fsync), and OFF can lose committed rows.
    this.db.run("PRAGMA synchronous = FULL");
    this.db.run(`CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL,
      received_at INTEGER NOT NULL,
      delivered_at INTEGER,
      last_error TEXT
    )`);
    const columns = this.db.query("PRAGMA table_info(outbox)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "delivered_at")) {
      this.db.run("ALTER TABLE outbox ADD COLUMN delivered_at INTEGER");
    }
    if (!columns.some((column) => column.name === "last_error")) {
      this.db.run("ALTER TABLE outbox ADD COLUMN last_error TEXT");
    }
    this.db.run("DELETE FROM outbox WHERE state = 'delivered' AND COALESCE(delivered_at, received_at) < ?", [Date.now() - TTL_MS]);
  }

  /** Last observed writability; returns a copy so callers cannot mutate the tracker. */
  health(): OutboxHealth {
    return { ok: this.state.ok, lastError: this.state.lastError };
  }

  private markHealthy(): void {
    this.state = { ok: true, lastError: null };
  }

  private markUnhealthy(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.state = { ok: false, lastError: redact(message, this.secrets) };
  }

  /** Every mutation runs through here so the health flag mirrors the last write outcome. */
  private write<T>(fn: () => T): T {
    try {
      const result = fn();
      this.markHealthy();
      return result;
    } catch (error) {
      this.markUnhealthy(error);
      throw error;
    }
  }

  /** BEGIN IMMEDIATE + ROLLBACK is the cheapest proof the write lock is acquirable. */
  private probe(): boolean {
    try {
      this.db.run("BEGIN IMMEDIATE");
      this.db.run("ROLLBACK");
      this.markHealthy();
      return true;
    } catch (error) {
      // If BEGIN landed and ROLLBACK threw, retry the rollback so a dangling
      // transaction cannot hold the write lock across later calls.
      try { this.db.run("ROLLBACK"); } catch { /* no transaction open */ }
      this.markUnhealthy(error);
      return false;
    }
  }

  has(id: string): boolean {
    return !!this.db.query("SELECT 1 FROM outbox WHERE id = ?").get(id);
  }

  /**
   * Write capability, not liveness: false while the tracker is unhealthy
   * (until a write or recover() clears it), otherwise a real write probe
   * proves the lock is acquirable right now. A failed probe flips the
   * tracker so later calls answer cheaply instead of re-waiting out
   * busy_timeout on every readiness check.
   */
  ready(): boolean {
    return this.state.ok ? this.probe() : false;
  }

  /**
   * Self-repair: drop the possibly broken connection, reopen it, and verify
   * with the same probe ready() uses. Never throws — the caller is a request
   * handler — and is safe to repeat; the failure reason stays in
   * health().lastError.
   */
  recover(): boolean {
    try { this.db.close(); } catch { /* already closed */ }
    try {
      this.open();
    } catch (error) {
      this.markUnhealthy(error);
      return false;
    }
    return this.probe();
  }

  enqueue(id: string, event: NormalizedEvent): boolean {
    return this.write(() => {
      const now = Date.now();
      const result = this.db.query("INSERT OR IGNORE INTO outbox (id, event, next_attempt_at, received_at) VALUES (?, ?, ?, ?)")
        .run(id, JSON.stringify(event), now, now);
      return result.changes > 0;
    });
  }

  due(): { id: string; event: NormalizedEvent; attempts: number } | null {
    const row = this.db.query("SELECT id, event, attempts FROM outbox WHERE state = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 1")
      .get(Date.now()) as { id: string; event: string; attempts: number } | null;
    return row ? { id: row.id, event: JSON.parse(row.event) as NormalizedEvent, attempts: row.attempts } : null;
  }

  /** Batch form of due(): same due condition and ordering, up to `limit` rows. */
  dueBatch(limit: number): { id: string; event: NormalizedEvent; attempts: number }[] {
    const rows = this.db.query("SELECT id, event, attempts FROM outbox WHERE state = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?")
      .all(Date.now(), Math.max(0, Math.floor(limit))) as { id: string; event: string; attempts: number }[];
    return rows.map((row) => ({ id: row.id, event: JSON.parse(row.event) as NormalizedEvent, attempts: row.attempts }));
  }

  delivered(id: string): void {
    this.write(() => this.db.query("UPDATE outbox SET state = 'delivered', delivered_at = ? WHERE id = ?").run(Date.now(), id));
  }

  retry(id: string, attempts: number): void {
    this.write(() => {
      const delay = retryDelayMs(attempts);
      this.db.query("UPDATE outbox SET attempts = ?, next_attempt_at = ? WHERE id = ?")
        .run(attempts, Date.now() + delay, id);
    });
  }

  fail(id: string, attempts: number, error: string): void {
    if (attempts >= MAX_DELIVERY_ATTEMPTS) {
      this.write(() => this.db.query("UPDATE outbox SET state = 'dead_letter', attempts = ?, last_error = ? WHERE id = ?")
        .run(attempts, error, id));
      return;
    }
    this.retry(id, attempts);
  }

  requeue(id: string): boolean {
    return this.write(() => {
      const result = this.db.query("UPDATE outbox SET state = 'pending', next_attempt_at = ?, last_error = NULL WHERE id = ? AND state = 'dead_letter'")
        .run(Date.now(), id);
      return result.changes > 0;
    });
  }

  /**
   * Backlog snapshot in one aggregate query — no rows are pulled into JS.
   * `oldestPendingAgeMs` is null when nothing is pending, and clamped at 0 so
   * a received_at in the future (clock skew) never reports a negative age.
   */
  stats(): OutboxStats {
    const row = this.db.query(`SELECT
        COUNT(CASE WHEN state = 'pending' THEN 1 END) AS pending,
        COUNT(CASE WHEN state = 'dead_letter' THEN 1 END) AS deadLetter,
        COUNT(CASE WHEN state = 'delivered' THEN 1 END) AS delivered,
        MIN(CASE WHEN state = 'pending' THEN received_at END) AS oldestPendingAt
      FROM outbox`).get() as { pending: number; deadLetter: number; delivered: number; oldestPendingAt: number | null };
    return {
      pending: row.pending,
      deadLetter: row.deadLetter,
      delivered: row.delivered,
      oldestPendingAgeMs: row.oldestPendingAt === null ? null : Math.max(0, Date.now() - row.oldestPendingAt),
    };
  }

  close(): void { this.db.close(); }
}
