import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Outbox } from "../src/outbox.ts";

test("failed delivery survives restart and retains dedupe after success", () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-outbox-"));
  const path = join(dir, "outbox.sqlite");
  const event = { repo: "example/app", item: "issue #42", target: "101", targetKind: "channel" as const, summary: "test", url: "https://example.com" };
  try {
    const first = new Outbox(path);
    expect(first.enqueue("delivery-42", event)).toBe(true);
    expect(first.enqueue("delivery-42", event)).toBe(false);
    expect(first.due()?.event).toEqual(event);
    first.retry("delivery-42", 1);
    first.close();

    const restarted = new Outbox(path);
    expect(restarted.has("delivery-42")).toBe(true);
    restarted.delivered("delivery-42");
    expect(restarted.due()).toBeNull();
    expect(restarted.enqueue("delivery-42", event)).toBe(false);
    restarted.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dedupe retention begins when a delayed delivery succeeds", () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-outbox-retention-"));
  const path = join(dir, "outbox.sqlite");
  const event = { repo: "example/app", item: "issue #42", target: "101", targetKind: "channel" as const, summary: "test", url: "https://example.com" };
  try {
    const first = new Outbox(path);
    expect(first.enqueue("late-delivery", event)).toBe(true);
    first.close();

    const db = new Database(path);
    db.query("UPDATE outbox SET received_at = ? WHERE id = ?")
      .run(Date.now() - 8 * 24 * 60 * 60 * 1000, "late-delivery");
    db.close();

    const resumed = new Outbox(path);
    resumed.delivered("late-delivery");
    resumed.close();

    const deliveredDb = new Database(path);
    const row = deliveredDb.query("SELECT received_at, delivered_at FROM outbox WHERE id = ?")
      .get("late-delivery") as { received_at: number; delivered_at: number };
    expect(row.delivered_at).toBeGreaterThan(row.received_at + 7 * 24 * 60 * 60 * 1000);
    deliveredDb.close();

    const restarted = new Outbox(path);
    expect(restarted.has("late-delivery")).toBe(true);
    restarted.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("existing outbox schema gains delivery timestamp without losing pending events", () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-outbox-upgrade-"));
  const path = join(dir, "outbox.sqlite");
  try {
    const db = new Database(path);
    db.run(`CREATE TABLE outbox (
      id TEXT PRIMARY KEY, event TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL,
      received_at INTEGER NOT NULL
    )`);
    db.query("INSERT INTO outbox (id, event, next_attempt_at, received_at) VALUES (?, ?, ?, ?)")
      .run("legacy-pending", JSON.stringify({ repo: "example/app", item: "issue #1", target: "101", targetKind: "channel", summary: "test", url: "https://example.com" }), Date.now(), Date.now());
    db.close();

    const upgraded = new Outbox(path);
    expect(upgraded.due()?.id).toBe("legacy-pending");
    upgraded.delivered("legacy-pending");
    upgraded.close();

    const migratedDb = new Database(path);
    expect((migratedDb.query("SELECT delivered_at FROM outbox WHERE id = ?")
      .get("legacy-pending") as { delivered_at: number }).delivered_at).toBeGreaterThan(0);
    migratedDb.close();

    const restarted = new Outbox(path);
    expect(restarted.has("legacy-pending")).toBe(true);
    restarted.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
