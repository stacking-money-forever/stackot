import { createHash, randomUUID } from "node:crypto";
import type { Json, State, StateStore } from "./state/flow-store.ts";

export type Scope = { taskId: string; forumId: string; botId: string };
export type ThreadRef = Scope & { operationId: string; threadId: string };
type Entry = { version: 1; scope: Scope; operationId: string; fingerprint: string;
  phase: "prepared" | "inflight" | "created"; receipt?: ThreadRef };
export interface ThreadBackend {
  // Must be fixed from actual provider evidence, not a model/caller assertion.
  durableIdempotency: boolean;
  create(scope: Scope, operationId: string): Promise<ThreadRef>;
  findByOperation(scope: Scope, operationId: string): Promise<ThreadRef | undefined>;
}
export type ThreadResult = { kind: "thread"; receipt: ThreadRef; reused: boolean } |
  { kind: "uncertain"; operationId: string; reason: string };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const snowflake = (value: unknown): value is string => typeof value === "string" &&
  /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= 18_446_744_073_709_551_615n;
function object(value: Json | undefined): State {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("THREAD_STATE_INVALID");
  return value;
}
function valid(ref: ThreadRef, scope: Scope, operationId: string) {
  return ref.operationId === operationId && ref.taskId === scope.taskId &&
    ref.forumId === scope.forumId && ref.botId === scope.botId &&
    snowflake(ref.threadId);
}

export class ThreadReceiptRepository {
  constructor(private readonly store: StateStore, private readonly backend: ThreadBackend) {}

  async ensure(scope: Scope): Promise<ThreadResult> {
    if (!scope.taskId || typeof scope.taskId !== "string" ||
        !snowflake(scope.forumId) || !snowflake(scope.botId))
      throw new Error("THREAD_SCOPE_INVALID");
    const key = hash(scope.taskId);
    const fingerprint = hash(JSON.stringify([scope.taskId, scope.forumId, scope.botId]));
    const proposedId = randomUUID();
    for (let attempt = 0; attempt < 8; attempt++) {
      const snapshot = await this.store.read();
      if (snapshot.state.schemaVersion !== 1) throw new Error("STATE_VERSION_UNSUPPORTED");
      const entries = snapshot.state.threadReceipts === undefined ? {} : object(snapshot.state.threadReceipts);
      const raw = Object.hasOwn(entries, key) ? entries[key] : undefined;
      if (raw === undefined) {
        const prepared: Entry = { version: 1, scope: structuredClone(scope),
          operationId: proposedId, fingerprint, phase: "prepared" };
        if (await this.store.compareAndSwap(snapshot.revision, { ...snapshot.state,
          threadReceipts: { ...entries, [key]: prepared as unknown as Json } })) continue;
        continue;
      }
      const entry = object(raw) as unknown as Entry;
      if (entry.version !== 1 || typeof entry.operationId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(entry.operationId) ||
          !entry.scope || typeof entry.scope.taskId !== "string" ||
          !snowflake(entry.scope.forumId) || !snowflake(entry.scope.botId) ||
          !["prepared", "inflight", "created"].includes(entry.phase))
        throw new Error("THREAD_STATE_INVALID");
      if (entry.fingerprint !== fingerprint) throw new Error("THREAD_SCOPE_CONFLICT");
      if (entry.scope.taskId !== scope.taskId || entry.scope.forumId !== scope.forumId ||
          entry.scope.botId !== scope.botId) throw new Error("THREAD_STATE_INVALID");
      if (entry.phase === "created") {
        if (!entry.receipt || !valid(entry.receipt, scope, entry.operationId))
          throw new Error("THREAD_RECEIPT_UNTRUSTED");
        return { kind: "thread", receipt: structuredClone(entry.receipt), reused: true };
      }
      if (entry.phase === "prepared") {
        const inflight: Entry = { ...entry, phase: "inflight" };
        if (!await this.store.compareAndSwap(snapshot.revision, { ...snapshot.state,
          threadReceipts: { ...entries, [key]: inflight as unknown as Json } })) continue;
        return this.createAndRecord(scope, key, inflight);
      }
      // Inflight does not expire into permission to create again. A late old
      // request may still land even after an empty strongly-consistent lookup.
      let found: ThreadRef | undefined;
      try { found = await this.backend.findByOperation(scope, entry.operationId); }
      catch { return {kind: "uncertain", operationId: entry.operationId, reason: "LOOKUP_UNAVAILABLE"}; }
      if (found) return this.record(scope, key, entry, found, true);
      if (this.backend.durableIdempotency === true) return this.createAndRecord(scope, key, entry);
      return {kind: "uncertain", operationId: entry.operationId, reason: "CREATION_NOT_PROVED_ABSENT"};
    }
    throw new Error("THREAD_STATE_CONTENTION");
  }

  private async createAndRecord(scope: Scope, key: string, entry: Entry): Promise<ThreadResult> {
    let receipt: ThreadRef;
    try { receipt = await this.backend.create(scope, entry.operationId); }
    catch {
      return {kind: "uncertain", operationId: entry.operationId, reason: "CREATION_AMBIGUOUS"};
    }
    return this.record(scope, key, entry, receipt, false);
  }

  private async record(scope: Scope, key: string, entry: Entry, receipt: ThreadRef,
                       reused: boolean): Promise<ThreadResult> {
    if (!valid(receipt, scope, entry.operationId)) throw new Error("THREAD_RECEIPT_UNTRUSTED");
    for (let attempt = 0; attempt < 8; attempt++) {
      const snapshot = await this.store.read();
      if (snapshot.state.schemaVersion !== 1) throw new Error("STATE_VERSION_UNSUPPORTED");
      const entries = object(snapshot.state.threadReceipts);
      const current = object(entries[key]) as unknown as Entry;
      if (current.version !== 1 || current.operationId !== entry.operationId || current.fingerprint !== entry.fingerprint)
        throw new Error("THREAD_OPERATION_CHANGED");
      if (!current.scope || current.scope.taskId !== scope.taskId ||
          current.scope.forumId !== scope.forumId || current.scope.botId !== scope.botId)
        throw new Error("THREAD_STATE_INVALID");
      if (!["inflight", "created"].includes(current.phase)) throw new Error("THREAD_OPERATION_CHANGED");
      if (current.phase === "created") {
        if (!current.receipt || !valid(current.receipt, scope, entry.operationId) ||
            current.receipt.threadId !== receipt.threadId) throw new Error("THREAD_DUPLICATE_DETECTED");
        return {kind: "thread", receipt: structuredClone(current.receipt), reused: true};
      }
      const created: Entry = { ...current, phase: "created", receipt: structuredClone(receipt) };
      if (await this.store.compareAndSwap(snapshot.revision, { ...snapshot.state,
        threadReceipts: { ...entries, [key]: created as unknown as Json } }))
        return {kind: "thread", receipt: structuredClone(receipt), reused};
    }
    // External success is real but local receipt is not committed. Future
    // callers reconcile the unchanged inflight intent; they do not recreate.
    return {kind: "uncertain", operationId: entry.operationId, reason: "RECEIPT_NOT_COMMITTED"};
  }
}
