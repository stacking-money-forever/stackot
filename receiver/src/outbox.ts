import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { NormalizedEvent } from "./normalize.ts";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_DELIVERY_ATTEMPTS = 5;

export class Outbox {
  private db: Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.run("PRAGMA journal_mode = WAL");
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

  has(id: string): boolean {
    return !!this.db.query("SELECT 1 FROM outbox WHERE id = ?").get(id);
  }

  ready(): void {
    this.db.query("SELECT 1").get();
  }

  enqueue(id: string, event: NormalizedEvent): boolean {
    const now = Date.now();
    const result = this.db.query("INSERT OR IGNORE INTO outbox (id, event, next_attempt_at, received_at) VALUES (?, ?, ?, ?)")
      .run(id, JSON.stringify(event), now, now);
    return result.changes > 0;
  }

  due(): { id: string; event: NormalizedEvent; attempts: number } | null {
    const row = this.db.query("SELECT id, event, attempts FROM outbox WHERE state = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 1")
      .get(Date.now()) as { id: string; event: string; attempts: number } | null;
    return row ? { id: row.id, event: JSON.parse(row.event) as NormalizedEvent, attempts: row.attempts } : null;
  }

  delivered(id: string): void {
    this.db.query("UPDATE outbox SET state = 'delivered', delivered_at = ? WHERE id = ?").run(Date.now(), id);
  }

  retry(id: string, attempts: number): void {
    const delay = Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6));
    this.db.query("UPDATE outbox SET attempts = ?, next_attempt_at = ? WHERE id = ?")
      .run(attempts, Date.now() + delay, id);
  }

  fail(id: string, attempts: number, error: string): void {
    if (attempts >= MAX_DELIVERY_ATTEMPTS) {
      this.db.query("UPDATE outbox SET state = 'dead_letter', attempts = ?, last_error = ? WHERE id = ?")
        .run(attempts, error, id);
      return;
    }
    this.retry(id, attempts);
  }

  requeue(id: string): boolean {
    const result = this.db.query("UPDATE outbox SET state = 'pending', next_attempt_at = ?, last_error = NULL WHERE id = ? AND state = 'dead_letter'")
      .run(Date.now(), id);
    return result.changes > 0;
  }

  close(): void { this.db.close(); }
}
