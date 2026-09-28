# S23 — installed OpenClaw/acpx contract

Baseline: fd5ff804a26931adb338b11a9a2e96e451772cb9. Pinned installed
implementation wins over moving online documentation. Devin SWE-2 collected the
candidate; owner corrections and acceptance are recorded in wave-03.md.

Evidence: CLI/help, installed schema and source are distinguished from actual
runtime observations. See s23-owner-probe.md for the owner's bounded R startup
receipt; no live worker, account connection, deployed or human result is implied.

## Versions and invocation

| Artifact | Installed version |
|---|---|
| Node (darwin-arm64) | 24.21.0 |
| OpenClaw | 2026.9.6, CLI build eb377ac |
| standalone acpx | 0.19.3 |
| @openclaw/acpx plugin | 2026.9.6, private acpx dependency 0.19.0 |
| @openclaw/discord plugin | 2026.9.6 |

OpenClaw's package engines require Node >=24.16.0 <25 or >=26.1.0. Source:
installed package.json; upstream repository github.com/openclaw/openclaw.
Private plugin and standalone CLI versions must not be conflated.

Run from /Users/justn/dev/.worktrees/stackot-s23-20260928 with command-local
environment, or export within a disposable shell:

~~~sh
R="$PWD/receiver/node_modules/.stackot-runtime"
export PATH="$R/node-v24.21.0-darwin-arm64/bin:$R/packages/node_modules/.bin:$PATH"
export OPENCLAW_STATE_DIR="$R/probe-state"
export OPENCLAW_CONFIG_PATH="$OPENCLAW_STATE_DIR/openclaw.json"
~~~

Exit-0 observations include versions, config validate/schema --json,
worktrees create/remove/restore/list/gc --help, tasks retry/flow/cancel/maintenance
--help, and acpx sessions --help. Do not run cleanup/remove commands merely
because their help is available.

## Schema / S24 input

Original deploy/openclaw.json5.template with synthetic IDs/token passes installed
config validate. It warns that the probe state lacks the acpx plugin and that
agents.entries.*.default is retired/removed. Schema acceptance proves neither
real identity nor operational safety. Owner installed the actual plugins in a
separate isolated owner-state and confirmed acpx loaded.

S24 must remove the retired marker and reconcile the sandbox/spawn mismatch.
Schema callback TTL cap is 86400000 ms; live channel readiness is a separate gate.

## ACP spawn contract

Pinned source: dist/sessions-spawn-tool-AW-VALLJ.mjs,
acp-spawn-DDLC3xRy.mjs, subagent-spawn-ownership-Bn-k4g7t.mjs,
policy-DEGknwt4.mjs.

- runtime=acp uses the external host harness. Params include agentId, task,
  mode=run/session, thread, cwd, resumeSessionId, streamTo=parent and
  runTimeoutSeconds. Other timeout key names are rejected.
- ACP enabled/dispatch policy and backend readiness gate admission. An empty
  allowedAgents list is unrestricted. Explicit codex allows codex. The asterisk
  is **not** a wildcard for this policy: owner invoked the installed guard and
  ["*"] rejected codex. Keep an explicit allowlist.
- A sandboxed requester cannot spawn ACP. sandbox=require is also rejected.
  Unsandboxed inherit passes this guard only; it does not prove a spawn succeeds.
  The template's non-main sandbox therefore conflicts with channel-derived
  ACP orchestration. ACP execution is not wrapped by the OpenClaw sandbox.
- Per-call runTimeoutSeconds overrides the configured
  agents.defaults.subagents.runTimeoutSeconds and is forwarded as runtime
  timeoutSeconds, capped at 86400 seconds. Owner input matrix verified override
  3600 and configured fallback 120. Current online docs describing rejection
  are not this installed version's behavior.
- resolveRuntimeCwdForAcpSpawn returns the explicit resolved cwd without its
  inherited-path fs.access check. The backend can still reject execution.
  cwd alone is not containment, credential isolation or publication authority.
- resumeSessionId requires requester-session ownership; context-free resume
  is not authorized. Live resume/cancel/timeout probes remain S29–S31 work.

## Managed worktrees

CLI create accepts repoRoot, --name, --base-ref and repeated --source-profile.
remove accepts --force/--if-lossless/--exact-state; restore supports
--recover-exact-state. Source: dist/service-hU3A9O0n.mjs.

Creation binds to the owner/repository. A live owner can reuse its checkout;
another live owner's name is rejected. A matching removed record can restore
from its snapshot; an independently occupied branch is not silently replaced.
Branches use openclaw/<name>.

Removal attempts a snapshot first. --force permits removal **if snapshot
creation fails**; it does not simply skip all snapshots. --if-lossless restricts
removal to clean/published state. No removal was executed by this contract probe.
Idle GC is 7 days, snapshots retain 30 days, and periodic GC is hourly. Consequently
snapshot retention is not an indefinite promise to keep dirty checkouts. S30/S31
must observe actual reuse, cancellation and preservation under the selected policy.

## Tasks / TaskFlow and extension surface

tasks retry retries delivery of up to ten blocked subagent completion results;
it is not a coding-task rerun. tasks flow CLI exposes list/show/cancel, not a
resume command.

TaskFlow uses durable SQLite records and expectedRevision transitions. A managed
flow has a controller; records alone do not resume execution after restart.
Source: dist/runtime-DkD2SJzC.mjs and task-flow-runtime-internal-DFSz6gyF.mjs.
Public installed declarations in dist/runtime-api-CkahAQr_.d.ts expose
api.runtime.tasks.async.{runs,flows,managedFlows}, bindSession/fromToolContext
and createManaged/tryCreateManaged/setWaiting/resume/finish/fail/requestCancel/
runTask. Synchronous counterparts are deprecated. These are API availability
observations, not a live creation/restart receipt.

Plugin API exposes worktrees, gateway.request, events and state.openKeyedStore.
Plugin loading uses entries, allow/deny and load.paths; installs can be pinned.

ACPX config includes permissionMode approve-all/approve-reads/deny-all and
nonInteractivePermissions deny/fail, separate from host exec approvals.
Generic timeoutSeconds bounds control operations; runs use agent/run timeouts.
CLI cancel is cooperative; --prompt-retries retries transient prompt failures.

S25 must choose and prove task/approval/run ownership through real restart and
authenticated-origin probes; S23 does not dictate a Receiver-only state store.

## Hook admission and replay

Sources: dist/hooks-HRQZlwij.mjs, hooks-B9gt5Q49.mjs,
server-constants-Dx_kHnY5.mjs.

POST <hooks.path>/agent uses Bearer or X-OpenClaw-Token authentication. Bad
credentials reject; bodies/routing/session policy are validated. HTTP 200 with
runId is admission, not Discord receipt or successful completion. Direct
waitForCompletion adds bounded completion facts; their operational behavior
has not been live-probed here.

Replay identity comes from Idempotency-Key, then X-OpenClaw-Idempotency-Key,
then payload idempotencyKey; keys are trimmed/nonempty and capped at 256 chars.
Identity includes token and resolved dispatch scope, including message/routing.
The handler creates an in-process Map: unresolved entries remain distinct from
terminal entries, whose TTL is 300 seconds and count cap 1000. Restart loses
this replay cache. A changed dispatch scope can create another run even with
the same header. Failed admission is retryable. Mapped fan-out is capped at 200.
S35/S36 must supply durable side-effect receipts; header stability is insufficient.

## Discord callbacks and product approvals

Pinned @openclaw/discord source is under dist/.setup:
send.components-ChY21qr-.mjs, provider-iOf73HW-.mjs,
approval-handler.runtime-CbBktBb4.mjs and components-yBEb75bB.mjs.

allowedUsers restricts button/select/modal interaction and is checked alongside
guild/member policy. Callback entries use runtime-provided keyed stores in
discord.components / discord.modals, bounded to 500 entries each. Default TTL
is 1800000 ms; configured cap is 24 hours. Persistence failures are reported with
in-memory fallback for the current process. Components are single-use unless
reusable is selected. Restart persistence has not been exercised here.

Native exec approval callbacks bind approvalId/kind/decision and check the actor
before gateway resolution. Generic allowedUsers, TTL and callback persistence
are not a product requester+plan-hash+action grant. Product guards must validate
the recorded action and current plan before execution/publication. S25 owns
the storage decision, S26/S27 the approval record/denial matrix and S28 the
live authenticated callback integration.

## Evidence limits

Owner's real isolated Gateway started on loopback 28789, loaded acpx without
plugin errors, answered authenticated health and stopped cleanly. It had no
external channels or sessions; no model turn or ACP worker was submitted.
Existing codex CLI login is observed but adapter execution is unproved.
Dependent rows still own live restart, actor denial, lifecycle and delivery
receipts. Schema/helper/source evidence is not worker, deployment or human QA.
