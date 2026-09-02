/**
 * GitHub webhook signature verification and delivery dedupe.
 *
 * HMAC is verified with timing-safe comparison against X-Hub-Signature-256.
 * Dedupe stores X-GitHub-Delivery IDs in a SQLite table with a TTL, so
 * GitHub's at-least-once redelivery never triggers a second run.
 */
import { Database } from "bun:sqlite";

const DEDUPE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, matching GitHub's redelivery window

export function verifySignature(secret: string, body: Uint8Array, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = header.slice("sha256=".length);
  const mac = new Bun.CryptoHasher("sha256", secret);
  mac.update(body);
  const digest = mac.digest("hex");
  return timingSafeEqual(digest, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export class Dedupe {
  private db: Database;
  private stmtInsert;
  private stmtSeen;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS deliveries (
        id TEXT PRIMARY KEY,
        received_at INTEGER NOT NULL
      )
    `);
    this.db.run(`DELETE FROM deliveries WHERE received_at < ?`, [Date.now() - DEDUPE_TTL_MS]);
    this.stmtInsert = this.db.prepare("INSERT OR IGNORE INTO deliveries (id, received_at) VALUES (?, ?)");
    this.stmtSeen = this.db.prepare("SELECT changes() AS c");
  }

  /** Returns true on first sight of the delivery ID; false on duplicate. */
  first(id: string): boolean {
    if (!id) return true; // no delivery header — cannot dedupe, let it through
    this.stmtInsert.run(id, Date.now());
    const c = this.stmtSeen.get() as { c: number };
    return c.c > 0;
  }

  close(): void {
    this.db.close();
  }
}
