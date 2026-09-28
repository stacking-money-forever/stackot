import type { Json, State, StateStore } from "./state/flow-store.ts";

export type Action = "start" | "push" | "pr";
export type Approval = {
  schemaVersion: 1;
  requestId: string; taskId: string; requesterId: string;
  planHash: string; planVersion: number; action: Action;
  requestedAt: number; expiresAt: number; status: "pending";
};
export type ApprovalInput = Omit<Approval, "schemaVersion" | "requestedAt" | "expiresAt" | "status"> & { ttlMs: number };
const MAX_TTL_MS = 86_400_000;

function object(value: Json | undefined): State {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("STATE_INVALID");
  return value;
}
function validate(input: ApprovalInput) {
  if (typeof input.requestId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.requestId) ||
      ["__proto__", "prototype", "constructor"].includes(input.requestId))
    throw new Error("REQUEST_ID_INVALID");
  if (!input.taskId || typeof input.taskId !== "string") throw new Error("TASK_ID_INVALID");
  if (typeof input.requesterId !== "string" || !/^[1-9][0-9]{0,19}$/.test(input.requesterId) ||
      BigInt(input.requesterId) > 18_446_744_073_709_551_615n)
    throw new Error("REQUESTER_ID_INVALID");
  if (typeof input.planHash !== "string" || !/^[0-9a-f]{64}$/.test(input.planHash) ||
      !Number.isSafeInteger(input.planVersion) || input.planVersion < 1)
    throw new Error("PLAN_INVALID");
  if (!["start", "push", "pr"].includes(input.action)) throw new Error("ACTION_INVALID");
  if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs <= 0 || input.ttlMs > MAX_TTL_MS)
    throw new Error("TTL_INVALID");
}
function bindingMatches(value: Approval, input: ApprovalInput) {
  return value.requestId === input.requestId && value.taskId === input.taskId &&
    value.requesterId === input.requesterId && value.planHash === input.planHash &&
    value.planVersion === input.planVersion && value.action === input.action &&
    value.expiresAt - value.requestedAt === input.ttlMs;
}
function stored(value: Json | undefined): Approval {
  const entry = object(value) as unknown as Approval;
  if (entry.schemaVersion !== 1 || entry.status !== "pending" ||
      !Number.isSafeInteger(entry.requestedAt) || entry.requestedAt < 0 ||
      !Number.isSafeInteger(entry.expiresAt)) throw new Error("APPROVAL_STATE_INVALID");
  validate({ ...entry, ttlMs: entry.expiresAt - entry.requestedAt });
  return entry;
}

// Persistence only. Approval/consumption and authenticated actor guards are S27/S28.
export class ApprovalRepository {
  constructor(private readonly store: StateStore, private readonly now = Date.now) {}

  async request(input: ApprovalInput): Promise<{ created: boolean; approval: Approval }> {
    validate(input);
    const requestedAt = this.now();
    if (!Number.isSafeInteger(requestedAt) || requestedAt < 0 ||
        !Number.isSafeInteger(requestedAt + input.ttlMs)) throw new Error("CLOCK_INVALID");
    for (let attempt = 0; attempt < 4; attempt++) {
      const snapshot = await this.store.read();
      if (snapshot.state.schemaVersion !== 1) throw new Error("STATE_VERSION_UNSUPPORTED");
      const task = object(snapshot.state.task);
      if (task.id !== input.taskId || task.requesterId !== input.requesterId ||
          task.planHash !== input.planHash || task.planVersion !== input.planVersion)
        throw new Error("TASK_PLAN_BINDING_MISMATCH");
      const entries = snapshot.state.approvals === undefined ? {} : object(snapshot.state.approvals);
      if (Object.hasOwn(entries, input.requestId)) {
        const existing = stored(entries[input.requestId]);
        if (existing.status !== "pending" || !bindingMatches(existing, input))
          throw new Error("REQUEST_ID_CONFLICT");
        return { created: false, approval: structuredClone(existing) };
      }
      const approval: Approval = { schemaVersion: 1, requestId: input.requestId, taskId: input.taskId,
        requesterId: input.requesterId, planHash: input.planHash,
        planVersion: input.planVersion, action: input.action, requestedAt,
        expiresAt: requestedAt + input.ttlMs, status: "pending" };
      const state: State = { ...snapshot.state,
        approvals: { ...entries, [input.requestId]: approval as unknown as Json } };
      if (await this.store.compareAndSwap(snapshot.revision, state))
        return { created: true, approval: structuredClone(approval) };
    }
    throw new Error("APPROVAL_WRITE_CONFLICT");
  }

  async get(requestId: string): Promise<Approval | undefined> {
    const snapshot = await this.store.read();
    if (snapshot.state.schemaVersion !== 1) throw new Error("STATE_VERSION_UNSUPPORTED");
    if (snapshot.state.approvals === undefined) return undefined;
    const entries = object(snapshot.state.approvals);
    if (!Object.hasOwn(entries, requestId)) return undefined;
    const approval = stored(entries[requestId]);
    if (approval.requestId !== requestId) throw new Error("APPROVAL_STATE_INVALID");
    return structuredClone(approval);
  }
}
