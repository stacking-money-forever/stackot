# Stackot task, approval and run state contract

Pinned runtime: OpenClaw 2026.9.6 on Node 24.21.0. S25 determines ownership and
storage; it does not implement product approval guards or claim worker delivery.

## Owners and module boundary

| State | Authoritative owner | Stackot responsibility |
|---|---|---|
| Product task identity, plan, requester and action grants | Gateway-side Stackot controller, persisted in native managed-flow stateJson | Validate typed fields and mutate with expectedRevision; never trust model claims |
| Native flow identity/status/revision and durability | OpenClaw managed-flow registry | Use async managedFlows API and native IDs; explicitly reconcile/resume after restart |
| Actual run identity/lifecycle | OpenClaw runtime task ledger and backing ACP runtime | Record returned IDs and terminal facts; never manufacture a run or infer success from admission |
| Authenticated interaction principal | Native Discord ingress/interaction adapter | Bind numeric actor ID, account, guild and task/action to the stored request; S28 proves actual integration |
| GitHub ingress delivery | Receiver durable outbox | Queue signed events; it is not the product approval or coding-run owner |

Product locations fixed for dependent rows: `gateway/src/state/flow-store.ts`
wraps native managedFlows, `gateway/src/approval.ts` owns requester/plan/action/TTL
validation, and `gateway/src/controller.ts` drives transitions. These are planned
implementation boundaries: S26 implements the store facade and pending repository;
the controller and action guards remain later-row work. The plugin
must derive owner/session/actor context from server-owned runtime context, not
caller-supplied IDs or callback text.

Native keyed-store access is **not** the selected local-plugin storage path.
The installed host rejects this local source with `PLUGIN_TRUST_REFUSED`.
Neither --link, local-source confirmation nor an operator token grants that
surface. No trust-policy bypass or keyed-store durability is claimed. Native
managed-flow stateJson is available to this plugin and provides tested revision
checks. This decision retains task/approval semantics in controller code rather
than mistaking generic component registry entries for grants.

## Stored product shape and transitions

S28 facade exposes native `cancelRequestedAt` beside snapshot revision/stateJson.
It is native metadata, not a model-controlled task JSON flag. Callback eligibility
checks it before reads/CAS, including after binding discovery. Receipt stores retain
their existing policy. Cancellation predicate tests are synthetic; actual native
cancel/worker lifecycle remains a runtime gate.

The controller will own versioned stateJson containing task identity/repository,
canonical requester ID, current plan/hash/version, allowed action, grant expiry,
decision/consumption state, worktree lineage and observed run/receipt references.
S26/S27 define and test the actual schema and denial rules. Every mutation must
use the current native revision. On conflict, re-read and revalidate the complete
predicate; do not replay a side effect or overwrite state blindly.

Native queued/running/waiting/terminal status describes the flow. Persisted
waiting metadata is not a timer or executable continuation. The controller must
reload the flow, check cancellation, reconcile actual runtime/side-effect receipts
and explicitly resume. Run IDs come only from real backing execution; no child
was launched or linked in the S25 probe. S29–S34 own that execution/publication
integration. Finished-record retention is not permanent product audit storage.

## Owner-observed native restart oracle

Run `python3 docs/verification/s25-probe/run.py --openclaw <pinned-cli>
--output <owned-ignored-path>/receipt.json` with compatible Node first on PATH.
The script installs only the reviewed local probe into fresh isolated state,
uses a synthetic token/values, binds loopback, creates a real native session
without starting a turn, and calls the actual SDK through an operator.admin RPC.
It uses no stub store, model call, worker or external channel.

Owner task-checkout run observed native flow
`bc309910-7c00-4a1c-ac39-a3cb5289c695`, bound to real session
`agent:main:s25-546a0a74b3684ba2bad5bc528a9fe841`. It moved queued revision 0
to waiting revision 1. After stopping PID 44313 and starting PID 44468, native
get/list recovered the same flow ID, owner, revision and synthetic approval-shaped
stateJson. Stale revision writes rejected with `revision_conflict` before and
after restart. The first listener was confirmed stopped before the next process;
the plugin reports actual server PIDs, preventing a surviving first server from
being mistaken for a restart. Both processes are stopped in cleanup.

The same native keyed-store attempt returned `PLUGIN_TRUST_REFUSED` in both
processes. That refusal is an observed boundary, not missing evidence patched
over with a mock. The stored demonstration value is explicitly synthetic and
is not a real authorization. No state-consuming product action was tested.

## Callback source contract and remaining evidence

Pinned Discord source `dist/.setup/provider-iOf73HW-.mjs` resolves native
interaction user/guild/channel policy and invokes ensureComponentUserAllowed
using `params.user.id`. Only then does it dispatch the registered plugin event
from `params.interaction`, stored callback data and runtime route context.
Product code must use this authenticated principal/context and numeric IDs,
never a username, model-reported actor or actor embedded in callback text.
Generic allowedUsers and registry TTL do not bind the current plan/action grant.

This is installed-source evidence only. Actual two-user denial/expiry/plan-change
callback behavior is unproved until S28. S26 stores pending requests with exact
task/requester/plan/action binding and stable epoch-ms expiry. An expired record
remains readable and an identical creation replay does not renew it; this is
persistence, not an eligibility decision. S27 must implement decision/consumption
and expiry denial; S29 onward must enforce grants before worker/push/PR actions.
No deployed VM, webhook→Discord delivery, human approval, worker execution or
release evidence is established here. Owner acceptance also requires the same
published SHA's Linux oracle; see wave-03 for the decision.
