import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BUSY_TIMEOUT_MS, MAX_DELIVERY_ATTEMPTS, Outbox } from "../src/outbox.ts";
import { DeliveryDrainer } from "../src/delivery.ts";

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

test("constructor creates missing nested parent directories for the database path", () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-outbox-mkdir-"));
  const path = join(dir, "deep", "nested", "dir", "outbox.sqlite");
  try {
    expect(existsSync(dirname(path))).toBe(false);
    const outbox = new Outbox(path);
    expect(existsSync(dirname(path))).toBe(true);
    outbox.close();

    const reopened = new Outbox(path);
    expect(reopened.has("anything")).toBe(false);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fifth failure becomes dead_letter with last_error and is no longer due", () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-outbox-dead-"));
  const path = join(dir, "outbox.sqlite");
  try {
    const outbox = new Outbox(path);
    expect(outbox.enqueue("dead-1", { repo: "example/app", item: "issue #1", target: "1", targetKind: "channel", summary: "x", url: "https://example.test" })).toBe(true);
    outbox.fail("dead-1", MAX_DELIVERY_ATTEMPTS, "gateway 502");
    expect(outbox.due()).toBeNull();
    outbox.close();
    const db = new Database(path, { readonly: true });
    const row = db.query("SELECT state, attempts, last_error FROM outbox WHERE id = ?").get("dead-1") as { state: string; attempts: number; last_error: string };
    expect(row).toEqual({ state: "dead_letter", attempts: MAX_DELIVERY_ATTEMPTS, last_error: "gateway 502" });
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("last_error migration preserves a pending legacy outbox row", () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-outbox-last-error-"));
  const path = join(dir, "outbox.sqlite");
  try {
    const db = new Database(path);
    db.run("CREATE TABLE outbox (id TEXT PRIMARY KEY, event TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL, received_at INTEGER NOT NULL, delivered_at INTEGER)");
    db.query("INSERT INTO outbox (id, event, next_attempt_at, received_at) VALUES (?, ?, ?, ?)").run("legacy", JSON.stringify({ repo: "example/app", item: "issue #1", target: "1", targetKind: "channel", summary: "x", url: "https://example.test" }), Date.now(), Date.now());
    db.close();
    const outbox = new Outbox(path);
    expect(outbox.due()?.id).toBe("legacy");
    outbox.close();
    const migrated = new Database(path, { readonly: true });
    expect((migrated.query("PRAGMA table_info(outbox)").all() as { name: string }[]).some((column) => column.name === "last_error")).toBe(true);
    migrated.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("drainer dead-letters a permanently failing job and due() stays empty", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-outbox-drain-dead-"));
  const path = join(dir, "outbox.sqlite");
  try {
    const outbox = new Outbox(path);
    expect(outbox.enqueue("flakey", { repo: "example/app", item: "issue #1", target: "1", targetKind: "channel", summary: "x", url: "https://example.test" })).toBe(true);
    const drainer = new DeliveryDrainer(outbox, async () => ({ ok: false, status: 502 }));
    const db = new Database(path);
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i++) {
      await drainer.drain();
      db.query("UPDATE outbox SET next_attempt_at = 0 WHERE id = ?").run("flakey");
    }
    const row = db.query("SELECT state, attempts, last_error FROM outbox WHERE id = ?").get("flakey") as { state: string; attempts: number; last_error: string | null };
    expect(row.state).toBe("dead_letter");
    expect(row.attempts).toBe(MAX_DELIVERY_ATTEMPTS);
    expect(row.last_error).toBeTruthy();
    db.close();
    expect(outbox.due()).toBeNull();
    outbox.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("below-limit fail keeps the row pending, backs off, and returns to due()", () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-outbox-fail-retry-"));
  const path = join(dir, "outbox.sqlite");
  try {
    const outbox = new Outbox(path);
    const event = { repo: "example/app", item: "issue #1", target: "1", targetKind: "channel" as const, summary: "x", url: "https://example.test" };
    expect(outbox.enqueue("flap-1", event)).toBe(true);
    outbox.fail("flap-1", 1, "boom");
    const db = new Database(path);
    const row = db.query("SELECT state, attempts FROM outbox WHERE id = ?").get("flap-1") as { state: string; attempts: number };
    expect(row).toEqual({ state: "pending", attempts: 1 });
    expect(outbox.due()).toBeNull();
    db.query("UPDATE outbox SET next_attempt_at = 0 WHERE id = ?").run("flap-1");
    expect(outbox.due()?.id).toBe("flap-1");
    db.close();
    outbox.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("requeue moves only a dead_letter row back to pending", () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-outbox-requeue-"));
  const path = join(dir, "outbox.sqlite");
  try {
    const outbox = new Outbox(path);
    const event = { repo: "example/app", item: "issue #1", target: "1", targetKind: "channel" as const, summary: "x", url: "https://example.test" };
    expect(outbox.enqueue("retry-me", event)).toBe(true);
    outbox.fail("retry-me", MAX_DELIVERY_ATTEMPTS, "gateway 502");
    expect(outbox.requeue("retry-me")).toBe(true);
    expect(outbox.due()?.id).toBe("retry-me");
    expect(outbox.requeue("retry-me")).toBe(false);
    outbox.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("two connections racing the same delivery id produce exactly one row", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-outbox-race-"));
  const path = join(dir, "outbox.sqlite");
  const event = { repo: "example/app", item: "issue #1", target: "1", targetKind: "channel" as const, summary: "x", url: "https://example.test" };
  try {
    const a = new Outbox(path);
    const b = new Outbox(path);
    const results = await Promise.all([a.enqueue("race-1", event), b.enqueue("race-1", event)]);
    expect([...results].sort()).toEqual([false, true]);
    const db = new Database(path, { readonly: true });
    const row = db.query("SELECT COUNT(*) AS n FROM outbox WHERE id = ?").get("race-1") as { n: number };
    expect(row.n).toBe(1);
    db.close();
    a.close();
    b.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("enqueue waits out a briefly held write lock instead of throwing SQLITE_BUSY", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-outbox-busy-"));
  const path = join(dir, "outbox.sqlite");
  const event = { repo: "example/app", item: "issue #1", target: "1", targetKind: "channel" as const, summary: "x", url: "https://example.test" };
  expect(Number.isFinite(BUSY_TIMEOUT_MS)).toBe(true);
  expect(BUSY_TIMEOUT_MS).toBeGreaterThan(0);
  const outbox = new Outbox(path);
  // A separate process holds BEGIN IMMEDIATE for ~100ms so the write lock is
  // really contended while the test connection tries to enqueue.
  const holder = Bun.spawn([process.execPath, "-e",
    `import { Database } from "bun:sqlite";
     const db = new Database(${JSON.stringify(path)});
     db.run("PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}");
     db.run("BEGIN IMMEDIATE");
     console.log("locked");
     setTimeout(() => { db.run("COMMIT"); db.close(); }, 100);`,
  ], { stdout: "pipe", stderr: "inherit" });
  try {
    const reader = holder.stdout.getReader();
    const decoder = new TextDecoder();
    let handshake = "";
    while (!handshake.includes("locked")) {
      const { done, value } = await reader.read();
      if (done) break;
      handshake += decoder.decode(value);
    }
    reader.releaseLock();
    expect(handshake).toContain("locked");
    const start = Date.now();
    expect(outbox.enqueue("contended-1", event)).toBe(true);
    const waited = Date.now() - start;
    expect(waited).toBeGreaterThan(0);
    expect(waited).toBeLessThan(BUSY_TIMEOUT_MS);
    await holder.exited;
    const db = new Database(path, { readonly: true });
    const row = db.query("SELECT COUNT(*) AS n FROM outbox WHERE id = ?").get("contended-1") as { n: number };
    expect(row.n).toBe(1);
    db.close();
  } finally {
    outbox.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a contended write failure marks the outbox unhealthy until a successful write clears it", () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-outbox-unhealthy-"));
  const path = join(dir, "outbox.sqlite");
  const event = { repo: "example/app", item: "issue #1", target: "1", targetKind: "channel" as const, summary: "x", url: "https://example.test" };
  const outbox = new Outbox(path);
  const holder = new Database(path);
  try {
    expect(outbox.health()).toEqual({ ok: true, lastError: null });
    expect(outbox.ready()).toBe(true);

    // The lock holder forces enqueue to exhaust busy_timeout and fail — the
    // same deterministic induction the S09B integration test uses.
    holder.run("PRAGMA busy_timeout = 5000");
    holder.run("BEGIN IMMEDIATE");
    expect(() => outbox.enqueue("blocked-1", event)).toThrow();
    expect(outbox.health().ok).toBe(false);
    expect(outbox.health().lastError).toBeTruthy();
    // Unhealthy state short-circuits ready() without touching the database.
    expect(outbox.ready()).toBe(false);
    holder.run("ROLLBACK");

    // The next successful write flips the tracker back without a recover().
    expect(outbox.enqueue("blocked-1", event)).toBe(true);
    expect(outbox.health()).toEqual({ ok: true, lastError: null });
    expect(outbox.ready()).toBe(true);
  } finally {
    holder.close();
    outbox.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

test("recover() reopens the connection and restores readiness, and is safe to repeat", () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-outbox-recover-"));
  const path = join(dir, "outbox.sqlite");
  const event = { repo: "example/app", item: "issue #1", target: "1", targetKind: "channel" as const, summary: "x", url: "https://example.test" };
  const outbox = new Outbox(path);
  const holder = new Database(path);
  try {
    holder.run("PRAGMA busy_timeout = 5000");
    holder.run("BEGIN IMMEDIATE");
    expect(() => outbox.enqueue("blocked-2", event)).toThrow();
    expect(outbox.health().ok).toBe(false);

    // The fault persists, so recovery must fail honestly — it never throws
    // and never flips the flag without a proven write.
    expect(outbox.recover()).toBe(false);
    expect(outbox.health().ok).toBe(false);
    expect(outbox.health().lastError).toBeTruthy();
    expect(outbox.ready()).toBe(false);
    holder.run("ROLLBACK");

    // Fault cleared: reopen + probe heals the tracker and ready() follows.
    expect(outbox.recover()).toBe(true);
    expect(outbox.health()).toEqual({ ok: true, lastError: null });
    expect(outbox.ready()).toBe(true);
    expect(outbox.enqueue("blocked-2", event)).toBe(true);

    // Idempotent: a second recover() reconnects and stays healthy.
    expect(outbox.recover()).toBe(true);
    expect(outbox.health().ok).toBe(true);
    expect(outbox.has("blocked-2")).toBe(true);
  } finally {
    holder.close();
    outbox.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

test("a pending row is still due after close and reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-outbox-durable-"));
  const path = join(dir, "outbox.sqlite");
  const event = { repo: "example/app", item: "issue #1", target: "1", targetKind: "channel" as const, summary: "x", url: "https://example.test" };
  try {
    const first = new Outbox(path);
    expect(first.enqueue("durable-1", event)).toBe(true);
    first.close();

    const reopened = new Outbox(path);
    const due = reopened.due();
    expect(due?.id).toBe("durable-1");
    expect(due?.event).toEqual(event);
    reopened.delivered("durable-1");
    reopened.close();

    const again = new Outbox(path);
    expect(again.has("durable-1")).toBe(true);
    expect(again.due()).toBeNull();
    expect(again.enqueue("durable-1", event)).toBe(false);
    again.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
