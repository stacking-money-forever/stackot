import { ApprovalRepository, type ApprovalInput } from "../../src/approval.ts";
import { FlowStateStore, type ManagedFlows, type NativeFlow } from "../../src/state/flow-store.ts";

const controllerId = "stackot-s26-probe";
const input: ApprovalInput = { requestId: "approval-fixture", taskId: "owner/repo#7",
  requesterId: "123456789012345678", planHash: "a".repeat(64), planVersion: 1,
  action: "start", ttlMs: 1800000 };
type Api = { runtime: { tasks: { async: { managedFlows: {
  bindSession(input: {sessionKey: string}): ManagedFlows & {
    createManaged(input: object): Promise<NativeFlow>
  }
}}}}; registerGatewayMethod(name: string, handler: (input: {
  params: Record<string, unknown>; respond: (ok: boolean, value?: object, error?: object) => void
}) => Promise<void>, options: object): void };

export default {
  id: "s26-probe", name: "S26 approval storage probe",
  configSchema: { type: "object", additionalProperties: false, properties: {} },
  register(api: Api) {
    api.registerGatewayMethod("s26probe.state", async ({params, respond}) => {
      try {
        if (typeof params.sessionKey !== "string") throw new Error("SESSION_REQUIRED");
        const sessionKey = params.sessionKey;
        const native = api.runtime.tasks.async.managedFlows.bindSession({sessionKey});
        if (params.phase === "init") {
          const flow = await native.createManaged({ controllerId, goal: "S26 storage fixture",
            notifyPolicy: "silent", stateJson: { schemaVersion: 1, synthetic: true,
              task: {id: input.taskId, requesterId: input.requesterId,
                planHash: input.planHash, planVersion: 1}, unrelated: {keep: true} } });
          const store = new FlowStateStore(native, flow.flowId, sessionKey, controllerId);
          const repo = new ApprovalRepository(store);
          const first = await repo.request(input);
          const repeated = await repo.request(input);
          const snapshot = await store.read();
          respond(true, { gatewayPid: process.pid, flowId: flow.flowId,
            created: first.created, repeatedCreated: repeated.created,
            record: first.approval, repeatedRecord: repeated.approval,
            revision: snapshot.revision, unrelated: snapshot.state.unrelated });
        } else if (params.phase === "read" && typeof params.flowId === "string") {
          const store = new FlowStateStore(native, params.flowId, sessionKey, controllerId);
          const repo = new ApprovalRepository(store);
          const snapshot = await store.read();
          respond(true, { gatewayPid: process.pid, flowId: params.flowId,
            record: await repo.get(input.requestId), revision: snapshot.revision,
            unrelated: snapshot.state.unrelated });
        } else throw new Error("PHASE_INVALID");
      } catch (error) {
        respond(false, undefined, {code: "PROBE_ERROR", message: String(error)});
      }
    }, {scope: "operator.admin"});
  }
};
