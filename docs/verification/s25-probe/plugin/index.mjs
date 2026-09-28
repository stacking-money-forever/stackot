// S25 synthetic probe plugin. NOT product approval code.
// Registers one isolated operator.admin gateway method `s25probe.state` that
// exercises the installed native task/flow durability surface and records the
// native keyed-store trust boundary verbatim.
const NAMESPACE = "s25-probe.approvals";
const APPROVAL_KEY = "synthetic-approval-shaped-value";

const PROBE_VALUE_NOTE =
  "synthetic probe value; NOT a real approval and NOT live actor evidence";

function fail(respond, message) {
  respond(false, undefined, { code: "INVALID_REQUEST", message });
}

function bindFlows(api, sessionKey) {
  return api.runtime.tasks.async.managedFlows.bindSession({ sessionKey });
}

// Attempt the real native keyed store; an untrusted plugin is refused by the
// host itself. We record the exact native refusal instead of bypassing it.
async function tryKeyedStore(api, write) {
  try {
    const store = api.runtime.state.openKeyedStore({
      namespace: NAMESPACE,
      retention: "retained"
    });
    if (write) {
      await store.registerIfAbsent(APPROVAL_KEY, {
        synthetic: true,
        note: PROBE_VALUE_NOTE
      });
    }
    const value = await store.lookup(APPROVAL_KEY);
    return { refused: false, value: value ?? null };
  } catch (error) {
    return {
      refused: true,
      code: error?.code ?? null,
      name: error?.name ?? null,
      message: String(error?.message ?? error)
    };
  }
}

function approvalShapedValue(flowId, sessionKey) {
  return {
    synthetic: true,
    kind: "s25-probe-approval-shaped",
    note: PROBE_VALUE_NOTE,
    requester: "synthetic-requester",
    planHash: "synthetic-plan-hash",
    action: "synthetic-action",
    flowId,
    sessionKey
  };
}

async function phaseInit(api, sessionKey, respond) {
  const flows = bindFlows(api, sessionKey);
  const flow = await flows.createManaged({
    controllerId: "s25-probe-controller",
    goal: "s25 synthetic managed-flow durability probe; no child run is executed",
    stateJson: {
      synthetic: true,
      probe: "s25",
      keyedValues: { [APPROVAL_KEY]: approvalShapedValue("pending", sessionKey) }
    },
    notifyPolicy: "silent"
  });
  const revisionAtCreate = flow.revision;
  const applied = await flows.setWaiting({
    flowId: flow.flowId,
    expectedRevision: revisionAtCreate,
    currentStep: "s25-probe-wait",
    stateJson: {
      synthetic: true,
      probe: "s25",
      stage: "waiting",
      keyedValues: {
        [APPROVAL_KEY]: approvalShapedValue(flow.flowId, sessionKey)
      }
    }
  });
  // Deliberately stale: reuse the pre-transition revision and require denial.
  const stale = await flows.setWaiting({
    flowId: flow.flowId,
    expectedRevision: revisionAtCreate,
    currentStep: "s25-stale-should-be-denied"
  });
  const keyedStore = await tryKeyedStore(api, true);
  respond(true, {
    phase: "init",
    gatewayPid: process.pid,
    sessionKey,
    ownerKey: flow.ownerKey,
    flowId: flow.flowId,
    syncMode: flow.syncMode,
    controllerId: flow.controllerId,
    statusAtCreate: flow.status,
    revisionAtCreate,
    transitionApplied: applied.applied,
    revisionAfterTransition: applied.applied ? applied.flow.revision : undefined,
    staleDenied: stale.applied === false,
    staleCode: stale.applied ? undefined : stale.code,
    keyedStore
  });
}

async function phaseRead(api, sessionKey, params, respond) {
  const flows = bindFlows(api, sessionKey);
  const flowId = typeof params.flowId === "string" ? params.flowId : "";
  const staleRevision = Number.isInteger(params.staleRevision)
    ? params.staleRevision
    : undefined;
  const flow = flowId ? await flows.get(flowId) : undefined;
  let postRestartStale;
  if (flow && staleRevision !== undefined) {
    const attempt = await flows.setWaiting({
      flowId,
      expectedRevision: staleRevision,
      currentStep: "s25-post-restart-stale-should-be-denied"
    });
    postRestartStale = {
      denied: attempt.applied === false,
      code: attempt.applied ? undefined : attempt.code
    };
  }
  const listed = (await flows.list()).map((entry) => ({
    flowId: entry.flowId,
    revision: entry.revision,
    status: entry.status,
    ownerKey: entry.ownerKey
  }));
  const keyedStore = await tryKeyedStore(api, false);
  respond(true, {
    phase: "read",
    gatewayPid: process.pid,
    sessionKey,
    flowFound: Boolean(flow),
    flow: flow ?? null,
    listedFlows: listed,
    postRestartStale: postRestartStale ?? null,
    keyedStore
  });
}

const definition = {
  id: "s25-probe",
  name: "S25 State Ownership Probe",
  description:
    "Synthetic S25 probe only; not a product approval implementation.",
  configSchema: { type: "object", additionalProperties: false, properties: {} },
  register(api) {
    api.registerGatewayMethod(
      "s25probe.state",
      async ({ params, respond }) => {
        try {
          const sessionKey =
            typeof params?.sessionKey === "string" ? params.sessionKey : "";
          if (!sessionKey) return fail(respond, "sessionKey is required");
          if (params?.phase === "init") {
            await phaseInit(api, sessionKey, respond);
            return;
          }
          if (params?.phase === "read") {
            await phaseRead(api, sessionKey, params, respond);
            return;
          }
          fail(respond, "phase must be init or read");
        } catch (error) {
          respond(false, undefined, {
            code: "PROBE_ERROR",
            message: String(error?.message ?? error)
          });
        }
      },
      { scope: "operator.admin" }
    );
  }
};

export default definition;
