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
