export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type State = { [key: string]: Json };
export type Snapshot = { revision: number; state: State };

export interface StateStore {
  read(): Promise<Snapshot>;
  compareAndSwap(revision: number, state: State): Promise<boolean>;
}

export interface NativeFlow {
  flowId: string;
  ownerKey: string;
  controllerId?: string;
  syncMode: string;
  status: string;
  revision: number;
  stateJson?: Json;
}
export interface ManagedFlows {
  get(flowId: string): Promise<NativeFlow | undefined>;
  setWaiting(input: { flowId: string; expectedRevision: number; stateJson: State }):
    Promise<{ applied: true; flow: NativeFlow } | { applied: false; code: string }>;
}

// Construct only from server-owned session/controller context, never callback text.
export class FlowStateStore implements StateStore {
  constructor(private readonly api: ManagedFlows, private readonly flowId: string,
              private readonly ownerKey: string, private readonly controllerId: string) {}

  async read(): Promise<Snapshot> {
    const flow = await this.api.get(this.flowId);
    if (!flow) throw new Error("FLOW_NOT_FOUND");
    if (flow.flowId !== this.flowId || flow.ownerKey !== this.ownerKey ||
        flow.controllerId !== this.controllerId || flow.syncMode !== "managed")
      throw new Error("FLOW_OWNER_MISMATCH");
    if (!["queued", "running", "waiting"].includes(flow.status))
      throw new Error("FLOW_NOT_ACTIVE");
    if (!Number.isSafeInteger(flow.revision) || flow.revision < 0 ||
        !flow.stateJson || typeof flow.stateJson !== "object" || Array.isArray(flow.stateJson))
      throw new Error("FLOW_STATE_INVALID");
    return { revision: flow.revision, state: structuredClone(flow.stateJson) };
  }

  async compareAndSwap(revision: number, state: State): Promise<boolean> {
    const latest = await this.read();
    if (latest.revision !== revision) return false;
    const result = await this.api.setWaiting({ flowId: this.flowId,
      expectedRevision: revision, stateJson: structuredClone(state) });
    if (result.applied) return true;
    if (result.code === "revision_conflict") return false;
    throw new Error("FLOW_WRITE_FAILED:" + result.code);
  }
}
