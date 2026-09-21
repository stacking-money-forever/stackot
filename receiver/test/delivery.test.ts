import { expect, test } from "bun:test";
import { DeliveryDrainer, type PendingDelivery } from "../src/delivery.ts";

const event = { repo: "example/app", item: "issue #1", target: "1", targetKind: "channel" as const, summary: "x", url: "https://example.test" };

test("delivers pending job once on successful forward", async () => {
  const jobs: PendingDelivery[] = [{ id: "d1", event, attempts: 0 }];
  const delivered: string[] = [];
  const keys: string[] = [];
  const drainer = new DeliveryDrainer({ due: () => jobs.shift() ?? null, delivered: (id) => delivered.push(id), retry: () => expect.unreachable("retry") }, async (job) => { keys.push(job.id); return { ok: true }; });
  await Promise.all([drainer.drain(), drainer.drain()]);
  expect(keys).toEqual(["d1"]);
  expect(delivered).toEqual(["d1"]);
});

test("retries failed forward with incremented attempts", async () => {
  const jobs: PendingDelivery[] = [{ id: "d2", event, attempts: 2 }];
  const retries: Array<[string, number]> = [];
  const drainer = new DeliveryDrainer({ due: () => jobs.shift() ?? null, delivered: () => expect.unreachable("delivered"), retry: (id, attempts) => retries.push([id, attempts]) }, async () => ({ ok: false }));
  await drainer.drain();
  expect(retries).toEqual([["d2", 3]]);
});

test("retries thrown forward with incremented attempts", async () => {
  const jobs: PendingDelivery[] = [{ id: "d3", event, attempts: 0 }];
  const retries: Array<[string, number]> = [];
  const drainer = new DeliveryDrainer({ due: () => jobs.shift() ?? null, delivered: () => expect.unreachable("delivered"), retry: (id, attempts) => retries.push([id, attempts]) }, async () => { throw new Error("timeout"); });
  await drainer.drain();
  expect(retries).toEqual([["d3", 1]]);
});
