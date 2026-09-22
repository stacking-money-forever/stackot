import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeliveryDrainer, type PendingDelivery } from "../src/delivery.ts";
import { MAX_DELIVERY_ATTEMPTS, Outbox } from "../src/outbox.ts";

const event = { repo: "example/app", item: "issue #1", target: "1", targetKind: "channel" as const, summary: "x", url: "https://example.test" };

test("delivers pending job once on successful forward", async () => {
  const jobs: PendingDelivery[] = [{ id: "d1", event, attempts: 0 }];
  const delivered: string[] = [];
  const keys: string[] = [];
  const drainer = new DeliveryDrainer({ due: () => jobs.shift() ?? null, delivered: (id) => delivered.push(id), fail: () => expect.unreachable("fail") }, async (job) => { keys.push(job.id); return { ok: true }; });
  await Promise.all([drainer.drain(), drainer.drain()]);
  expect(keys).toEqual(["d1"]);
  expect(delivered).toEqual(["d1"]);
});

test("fails rejected forward with incremented attempts and status detail", async () => {
  const jobs: PendingDelivery[] = [{ id: "d2", event, attempts: 2 }];
  const failures: Array<[string, number, string]> = [];
  const drainer = new DeliveryDrainer({ due: () => jobs.shift() ?? null, delivered: () => expect.unreachable("delivered"), fail: (id, attempts, error) => failures.push([id, attempts, error]) }, async () => ({ ok: false }));
  await drainer.drain();
  expect(failures).toHaveLength(1);
  expect(failures[0]?.[0]).toBe("d2");
  expect(failures[0]?.[1]).toBe(3);
  expect(failures[0]?.[2]).toContain("gateway rejected delivery");
});

test("fails thrown forward with incremented attempts and the error message", async () => {
  const jobs: PendingDelivery[] = [{ id: "d3", event, attempts: 0 }];
  const failures: Array<[string, number, string]> = [];
  const drainer = new DeliveryDrainer({ due: () => jobs.shift() ?? null, delivered: () => expect.unreachable("delivered"), fail: (id, attempts, error) => failures.push([id, attempts, error]) }, async () => { throw new Error("timeout"); });
  await drainer.drain();
  expect(failures).toEqual([["d3", 1, "timeout"]]);
});

test("fails rejected forward at the attempt limit with status detail", async () => {
  const jobs: PendingDelivery[] = [{ id: "d4", event, attempts: MAX_DELIVERY_ATTEMPTS - 1 }];
  const failures: Array<[string, number, string]> = [];
  const drainer = new DeliveryDrainer({ due: () => jobs.shift() ?? null, delivered: () => expect.unreachable("delivered"), fail: (id, attempts, error) => failures.push([id, attempts, error]) }, async () => ({ ok: false, status: 502 }));
  await drainer.drain();
  expect(failures).toHaveLength(1);
  expect(failures[0]?.[0]).toBe("d4");
  expect(failures[0]?.[1]).toBe(MAX_DELIVERY_ATTEMPTS);
  expect(failures[0]?.[2]).toContain("502");
});

test("fails thrown forward at the attempt limit with the error message", async () => {
  const jobs: PendingDelivery[] = [{ id: "d5", event, attempts: MAX_DELIVERY_ATTEMPTS - 1 }];
  const failures: Array<[string, number, string]> = [];
  const drainer = new DeliveryDrainer({ due: () => jobs.shift() ?? null, delivered: () => expect.unreachable("delivered"), fail: (id, attempts, error) => failures.push([id, attempts, error]) }, async () => { throw new Error("timeout"); });
  await drainer.drain();
  expect(failures).toEqual([["d5", MAX_DELIVERY_ATTEMPTS, "timeout"]]);
});

// S11 oracle — the retry schedule the drainer depends on. Real time is read by
// the production code, so the delay is asserted from the stored next_attempt_at
// rather than by holding fake timers.
test("outbox.retry schedules exponential backoff capped at one minute", () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-backoff-"));
  const path = join(dir, "outbox.sqlite");
  const event = { repo: "example/app", item: "issue #1", target: "1", targetKind: "channel" as const, summary: "x", url: "https://example.test" };
  try {
    const outbox = new Outbox(path);
    outbox.enqueue("backoff-1", event);
    const db = new Database(path);
    const expected: Record<number, number> = { 1: 2_000, 2: 4_000, 3: 8_000, 4: 16_000, 5: 32_000, 6: 60_000, 7: 60_000, 8: 60_000 };
    for (const [attempts, delayMs] of Object.entries(expected)) {
      const before = Date.now();
      outbox.retry("backoff-1", Number(attempts));
      const row = db.query("SELECT attempts, next_attempt_at FROM outbox WHERE id = ?").get("backoff-1") as { attempts: number; next_attempt_at: number };
      const scheduled = row.next_attempt_at - before;
      expect(row.attempts).toBe(Number(attempts));
      expect(scheduled).toBeGreaterThanOrEqual(delayMs - 250);
      expect(scheduled).toBeLessThanOrEqual(delayMs + 1_000);
    }
    db.close();
    outbox.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/** Bounded poll so assertions can wait on real async drain progress without long wall-clock sleeps. */
async function eventually(cond: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("condition not met before deadline");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("a stalled repo does not starve another repo's deliveries", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-drain-fair-"));
  const path = join(dir, "outbox.sqlite");
  try {
    const outbox = new Outbox(path);
    const evA = { ...event, repo: "repo/a" };
    const evB = { ...event, repo: "repo/b" };
    expect(outbox.enqueue("a-1", evA)).toBe(true);
    expect(outbox.enqueue("b-1", evB)).toBe(true);
    expect(outbox.enqueue("b-2", evB)).toBe(true);
    expect(outbox.enqueue("b-3", evB)).toBe(true);

    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => { releaseA = resolve; });
    const forwarded: string[] = [];
    const drainer = new DeliveryDrainer(outbox, async (job) => {
      forwarded.push(job.id);
      if (job.event.repo === "repo/a") await gateA;
      return { ok: true };
    });

    const drainPromise = drainer.drain();
    // a-1 starts and is held open; b-* must still run to completion behind it.
    await eventually(() => forwarded.includes("a-1"));
    await eventually(() => outbox.stats().delivered === 3);
    const db = new Database(path, { readonly: true });
    const pending = db.query("SELECT id, state FROM outbox WHERE state = 'pending'").all() as { id: string; state: string }[];
    expect(pending).toEqual([{ id: "a-1", state: "pending" }]);
    db.close();

    releaseA();
    await drainPromise;
    expect(outbox.stats().delivered).toBe(4);
    expect(outbox.due()).toBeNull();
    expect(new Set(forwarded).size).toBe(forwarded.length);
    outbox.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("concurrent forwards never exceed maxPerRepo for any repo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-drain-cap-"));
  const path = join(dir, "outbox.sqlite");
  try {
    const outbox = new Outbox(path);
    const evA = { ...event, repo: "repo/a" };
    const evB = { ...event, repo: "repo/b" };
    for (const id of ["a-1", "a-2", "a-3", "a-4"]) outbox.enqueue(id, evA);
    for (const id of ["b-1", "b-2", "b-3", "b-4"]) outbox.enqueue(id, evB);

    const active = new Map<string, number>();
    const peak = new Map<string, number>();
    let started = 0;
    let releaseAll!: () => void;
    const gate = new Promise<void>((resolve) => { releaseAll = resolve; });
    const drainer = new DeliveryDrainer(outbox, async (job) => {
      const repo = job.event.repo;
      const now = (active.get(repo) ?? 0) + 1;
      active.set(repo, now);
      peak.set(repo, Math.max(peak.get(repo) ?? 0, now));
      started += 1;
      if (started === 4) releaseAll(); // both repos at cap 2 — the first full wave
      await gate;
      active.set(repo, (active.get(repo) ?? 1) - 1);
      return { ok: true };
    }, { maxGlobal: 8, maxPerRepo: 2 });

    await drainer.drain();
    expect(started).toBe(8);
    expect(peak.get("repo/a")).toBeLessThanOrEqual(2);
    expect(peak.get("repo/b")).toBeLessThanOrEqual(2);
    expect(outbox.stats().delivered).toBe(8);
    outbox.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("overlapping drain calls never forward the same delivery twice", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-drain-dupe-"));
  const path = join(dir, "outbox.sqlite");
  try {
    const outbox = new Outbox(path);
    for (const repo of ["repo/c", "repo/d", "repo/e"]) {
      expect(outbox.enqueue(`dup-${repo}`, { ...event, repo })).toBe(true);
    }
    const forwarded: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const drainer = new DeliveryDrainer(outbox, async (job) => {
      forwarded.push(job.id);
      await gate;
      return { ok: true };
    });

    const first = drainer.drain();
    const second = drainer.drain(); // re-entrant: must not start a second pass
    const third = drainer.drain();
    await eventually(() => forwarded.length === 3);
    release();
    await Promise.all([first, second, third]);
    expect(new Set(forwarded).size).toBe(3);
    expect(outbox.stats().delivered).toBe(3);
    outbox.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("one repo's forward failure does not stop another repo's delivery", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-drain-iso-"));
  const path = join(dir, "outbox.sqlite");
  try {
    const outbox = new Outbox(path);
    expect(outbox.enqueue("iso-a", { ...event, repo: "repo/a" })).toBe(true);
    expect(outbox.enqueue("iso-b", { ...event, repo: "repo/b" })).toBe(true);
    const drainer = new DeliveryDrainer(outbox, async (job) => {
      if (job.event.repo === "repo/a") throw new Error("gateway timeout");
      return { ok: true };
    });
    await drainer.drain();

    const db = new Database(path, { readonly: true });
    const a = db.query("SELECT state, attempts, next_attempt_at FROM outbox WHERE id = ?").get("iso-a") as { state: string; attempts: number; next_attempt_at: number };
    const b = db.query("SELECT state FROM outbox WHERE id = ?").get("iso-b") as { state: string };
    expect(b.state).toBe("delivered");
    expect(a.state).toBe("pending");
    expect(a.attempts).toBe(1);
    expect(a.next_attempt_at).toBeGreaterThan(Date.now()); // backoff scheduled
    db.close();
    expect(outbox.due()).toBeNull(); // a is not due again until the backoff elapses
    outbox.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
