import { expect, test } from "bun:test";
import { DeliveryDrainer, type PendingDelivery } from "../src/delivery.ts";
import { MAX_DELIVERY_ATTEMPTS } from "../src/outbox.ts";

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
