import { expect, test } from "bun:test";
import { ApprovalRepository, type ApprovalInput } from "../src/approval.ts";
import { FlowStateStore, type Json, type State, type StateStore, type ManagedFlows,
  type NativeFlow } from "../src/state/flow-store.ts";

const input: ApprovalInput = { requestId: "request-1", taskId: "owner/repo#7",
  requesterId: "123456789012345678", planHash: "a".repeat(64), planVersion: 1,
  action: "start", ttlMs: 1000 };
const seed = (): State => ({ schemaVersion: 1, unrelated: { keep: true },
  task: { id: input.taskId, requesterId: input.requesterId,
    planHash: input.planHash, planVersion: input.planVersion } });

class MemoryStore implements StateStore {
  revision = 0; conflicts = 0; state = seed();
  async read() { return { revision: this.revision, state: structuredClone(this.state) }; }
  async compareAndSwap(revision: number, state: State) {
    if (this.conflicts-- > 0 || revision !== this.revision) return false;
    this.state = structuredClone(state); this.revision++; return true;
  }
}

test("pending request survives a new repository instance, preserving unrelated state and expiry", async () => {
  const store = new MemoryStore();
  const created = await new ApprovalRepository(store, () => 100).request(input);
  expect(created.created).toBe(true);
  expect(created.approval).toMatchObject({ schemaVersion: 1, status: "pending",
    requesterId: input.requesterId, planHash: input.planHash, action: "start",
    requestedAt: 100, expiresAt: 1100 });
  const reopened = new ApprovalRepository(store, () => 500);
  expect(await reopened.get(input.requestId)).toEqual(created.approval);
  const repeated = await reopened.request(input);
  expect(repeated).toEqual({ created: false, approval: created.approval });
  expect(store.revision).toBe(1);
  expect(store.state.unrelated).toEqual({ keep: true });
});

test("same request ID cannot silently change its approved-plan binding or TTL", async () => {
  const store = new MemoryStore(); const repo = new ApprovalRepository(store, () => 100);
  await repo.request(input);
  await expect(repo.request({ ...input, action: "push" })).rejects.toThrow("REQUEST_ID_CONFLICT");
  await expect(repo.request({ ...input, ttlMs: 2000 })).rejects.toThrow("REQUEST_ID_CONFLICT");
  expect(store.revision).toBe(1);
});

test("malformed IDs/hashes/versions/TTL never mutate state", async () => {
  for (const delta of [{ requestId: undefined }, { requestId: "__proto__" },
    { requesterId: 123 }, { requesterId: "18446744073709551616" },
    { planHash: "not-a-hash" }, { planVersion: 0 }, { action: "merge" },
    { ttlMs: 0 }, { ttlMs: 86400001 }, { ttlMs: 0.5 }]) {
    const store = new MemoryStore(); const repo = new ApprovalRepository(store, () => 100);
    await expect(repo.request({ ...input, ...delta } as ApprovalInput)).rejects.toThrow();
    expect(store.revision).toBe(0);
  }
});

test("current task requester and plan binding must match on every retry", async () => {
  const store = new MemoryStore();
  (store.state.task as State).planHash = "b".repeat(64);
  await expect(new ApprovalRepository(store).request(input)).rejects.toThrow("TASK_PLAN_BINDING_MISMATCH");
  expect(store.revision).toBe(0);
});

test("bounded conflicts fail without a memory-only successful request", async () => {
  const store = new MemoryStore(); store.conflicts = 10;
  await expect(new ApprovalRepository(store).request(input)).rejects.toThrow("APPROVAL_WRITE_CONFLICT");
  expect(store.revision).toBe(0);
  expect(store.state.approvals).toBeUndefined();
});

test("concurrent requests use CAS, retaining both records", async () => {
  const store = new MemoryStore(); const repo = new ApprovalRepository(store, () => 100);
  await Promise.all([repo.request(input), repo.request({ ...input, requestId: "request-2", action: "pr" })]);
  expect(Object.keys(store.state.approvals as State)).toEqual(["request-1", "request-2"]);
  expect(store.revision).toBe(2);
});

test("native facade checks owner/controller and propagates persistence failure", async () => {
  let flow: NativeFlow = { flowId: "flow", ownerKey: "session", controllerId: "stackot",
    syncMode: "managed", status: "waiting", revision: 0, stateJson: seed() };
  const api: ManagedFlows = { get: async () => structuredClone(flow),
    setWaiting: async () => ({ applied: false, code: "persist_failed" }) };
  const store = new FlowStateStore(api, "flow", "session", "stackot");
  await expect(store.compareAndSwap(0, seed())).rejects.toThrow("FLOW_WRITE_FAILED:persist_failed");
  flow.ownerKey = "other";
  await expect(store.read()).rejects.toThrow("FLOW_OWNER_MISMATCH");
});

test("corrupt persisted grant shape fails closed instead of returning an asserted type", async () => {
  const store = new MemoryStore(); const repo = new ApprovalRepository(store, () => 100);
  await repo.request(input);
  const entry = (store.state.approvals as State)[input.requestId] as State;
  entry.expiresAt = null;
  await expect(repo.get(input.requestId)).rejects.toThrow("APPROVAL_STATE_INVALID");
});

test("CAS race re-reads task binding and never retries a real storage failure", async () => {
  const store = new MemoryStore(); let calls = 0;
  store.compareAndSwap = async () => {
    calls++; (store.state.task as State).planVersion = 2; return false;
  };
  await expect(new ApprovalRepository(store, () => 100).request(input))
    .rejects.toThrow("TASK_PLAN_BINDING_MISMATCH");
  expect(calls).toBe(1);
  store.state = seed();
  store.compareAndSwap = async () => { calls++; throw new Error("DISK_UNAVAILABLE"); };
  await expect(new ApprovalRepository(store, () => 100).request(input))
    .rejects.toThrow("DISK_UNAVAILABLE");
  expect(calls).toBe(2); expect(store.state.approvals).toBeUndefined();
});

test("uint64 ID stays exact and request retry after expiry never renews timestamps", async () => {
  const store = new MemoryStore();
  const boundary = { ...input, requesterId: "18446744073709551615" };
  (store.state.task as State).requesterId = boundary.requesterId;
  const first = await new ApprovalRepository(store, () => 100).request(boundary);
  const later = await new ApprovalRepository(store, () => 9999).request(boundary);
  expect(later).toEqual({ created: false, approval: first.approval });
  expect(later.approval.requesterId).toBe(boundary.requesterId);
  expect(store.revision).toBe(1);
});

test("native CAS uses expectedRevision and maps only revision_conflict to retry", async () => {
  const flow: NativeFlow = { flowId: "flow", ownerKey: "session", controllerId: "stackot",
    syncMode: "managed", status: "waiting", revision: 3, stateJson: seed() };
  let calls = 0;
  const api: ManagedFlows = { get: async () => structuredClone(flow),
    setWaiting: async (request) => {
      calls++; expect(request.expectedRevision).toBe(3);
      return { applied: false, code: "revision_conflict" };
    } };
  const facade = new FlowStateStore(api, "flow", "session", "stackot");
  const snapshot = await facade.read(); snapshot.state.unrelated = null;
  expect((flow.stateJson as State).unrelated).toEqual({keep: true});
  expect(await facade.compareAndSwap(2, seed())).toBe(false);
  expect(calls).toBe(0);
  expect(await facade.compareAndSwap(3, seed())).toBe(false);
  expect(calls).toBe(1);
});
