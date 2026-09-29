import type { Json, State, StateStore } from "./state/flow-store.ts";

// Error classification only; never a substitute for native actor authorization.
export class ApprovalExpiredError extends Error {
  constructor(){super("APPROVAL_EXPIRED");this.name="ApprovalExpiredError";}
}
export class ApprovalAlreadyDecidedError extends Error {
  constructor(){super('APPROVAL_ALREADY_DECIDED');this.name='ApprovalAlreadyDecidedError';}
}

export type Action = "start" | "push" | "pr";
type ApprovalFields = {
  schemaVersion: 1;
  requestId: string; taskId: string; requesterId: string;
  planHash: string; planVersion: number; action: Action;
  requestedAt: number; expiresAt: number;
};
export type Approval = ApprovalFields & (
  {status:"pending"} |
  {status:"approved"|"denied";decidedAt:number;decidedBy:string} |
  {status:"consumed";decidedAt:number;decidedBy:string;consumedAt:number;operationId:string}
);
export type ApprovalInput = Pick<ApprovalFields,
  "requestId"|"taskId"|"requesterId"|"planHash"|"planVersion"|"action"> & {ttlMs:number};
// Construct only in the trusted server adapter. This type is not authentication.
export type ApprovalContext = Omit<ApprovalInput,"requesterId"|"ttlMs"> & {actorId:string};
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
  if (entry.schemaVersion !== 1 || !["pending","approved","denied","consumed"].includes(entry.status) ||
      !Number.isSafeInteger(entry.requestedAt) || entry.requestedAt < 0 ||
      !Number.isSafeInteger(entry.expiresAt)) throw new Error("APPROVAL_STATE_INVALID");
  validate({ ...entry, ttlMs: entry.expiresAt - entry.requestedAt });
  if (entry.status !== "pending") {
    if (entry.decidedBy !== entry.requesterId || !Number.isSafeInteger(entry.decidedAt) ||
        entry.decidedAt < entry.requestedAt || entry.decidedAt >= entry.expiresAt)
      throw new Error("APPROVAL_STATE_INVALID");
    if (entry.status === "consumed" && (!Number.isSafeInteger(entry.consumedAt) ||
        entry.consumedAt < entry.decidedAt || entry.consumedAt >= entry.expiresAt ||
        typeof entry.operationId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(entry.operationId)))
      throw new Error("APPROVAL_STATE_INVALID");
  }
  return entry;
}

// S27 checks supplied context; authenticated Discord actor provenance is S28.
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

  async decide(context: ApprovalContext, decision: "approve"|"deny"): Promise<Approval> {
    if(decision!=="approve"&&decision!=="deny")throw new Error("DECISION_INVALID");
    return this.transition(context,"pending",(entry,now)=>({...entry,
      status:decision==="approve"?"approved":"denied",decidedAt:now,decidedBy:context.actorId}));
  }

  async consume(context: ApprovalContext, operationId: string): Promise<Approval> {
    if(typeof operationId!=="string"||!/^[a-zA-Z0-9_-]{1,80}$/.test(operationId))
      throw new Error("OPERATION_ID_INVALID");
    return this.transition(context,"approved",(entry,now)=>{
      if(entry.status!=="approved")throw new Error("APPROVAL_NOT_APPROVED");
      return {...entry,status:"consumed",consumedAt:now,operationId};
    });
  }

  private async transition(context: ApprovalContext, from: "pending"|"approved",
                           next:(entry:Approval,now:number)=>Approval):Promise<Approval> {
    // Validation precedes all record/identity returns. Callback text never sets actorId.
    validate({...context,requesterId:context.actorId,ttlMs:1});
    for(let attempt=0;attempt<4;attempt++) {
      const snapshot=await this.store.read();
      if(snapshot.state.schemaVersion!==1)throw new Error("STATE_VERSION_UNSUPPORTED");
      const entries=snapshot.state.approvals===undefined?{}:object(snapshot.state.approvals);
      if(!Object.hasOwn(entries,context.requestId))throw new Error("APPROVAL_NOT_FOUND");
      const entry=stored(entries[context.requestId]);
      if(entry.requesterId!==context.actorId)throw new Error("APPROVAL_ACTOR_DENIED");
      if(entry.requestId!==context.requestId||entry.taskId!==context.taskId||entry.action!==context.action)
        throw new Error("APPROVAL_BINDING_MISMATCH");
      const task=object(snapshot.state.task);
      if(task.id!==entry.taskId||task.requesterId!==entry.requesterId)
        throw new Error("TASK_PLAN_BINDING_MISMATCH");
      if(!["planned","waiting","running"].includes(task.status as string))
        throw new Error("TASK_NOT_ACTIVE");
      if(task.planHash!==entry.planHash||task.planVersion!==entry.planVersion||
          context.planHash!==entry.planHash||context.planVersion!==entry.planVersion)
        throw new Error("TASK_PLAN_BINDING_MISMATCH");
      const now=this.now();
      if(!Number.isSafeInteger(now)||now<entry.requestedAt||
          (entry.status!=="pending"&&now<entry.decidedAt))throw new Error("CLOCK_INVALID");
      if(now>=entry.expiresAt)throw new ApprovalExpiredError();
      if(entry.status!==from){
        if(from==='pending')throw new ApprovalAlreadyDecidedError();
        throw new Error('APPROVAL_NOT_APPROVED');
      }
      const updated=next(entry,now);
      if(await this.store.compareAndSwap(snapshot.revision,{...snapshot.state,
          approvals:{...entries,[context.requestId]:updated as unknown as Json}})) {
        // A slow persistence acknowledgement must not return expired eligibility.
        // The committed marker remains for trusted controller reconciliation.
        const committedAt=this.now();
        if(!Number.isSafeInteger(committedAt)||committedAt<now)throw new Error("CLOCK_INVALID");
        if(committedAt>=entry.expiresAt)throw new ApprovalExpiredError();
        return structuredClone(updated);
      }
    }
    throw new Error("APPROVAL_WRITE_CONFLICT");
  }
}
