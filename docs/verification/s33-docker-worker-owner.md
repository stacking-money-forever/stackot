# S33 Docker execution transport preparation — NOT ACCEPT

User said go after owner corrected an overly broad blocked judgment: final
runtime acceptance blockers do not prevent implementing this independent S33
transport. S27/S32 predecessors are accepted; S28/S29 are not bypassed. Full
project count remains59/81. Retained checkout stackot-s33-20260929, base963f4f7.

DockerWorker implements actual CLI create/start/inspect/kill/remove with a fixed
owner policy, immutable image and execution label, private output and current
authorization rechecks. It accepts no arbitrary Docker options and mounts no
host owner credentials. Cancel/timeout kills the owned container and retains
task files; ambiguous effects stay uncertain. It is built as a standalone module
and is absent from the default live plugin factory.

Local10tests/52assertions and typecheck pass with synthetic Docker call results.
Full source117tests/787assertions and standalone build pass. Final independent
uncommitted review found no actionable defect after the three corrections below.
Two disposable policy/start-ID omission mutations fail their targeted oracles;
s33-docker-worker-negative.json is S evidence, not a real worker result.
The added Linux Docker CI oracle exercises restricted filesystem/user/env,
normal exit, timeout and cancel using an inspected Alpine fixture image ID and
fake owner secret. Its planned receipt has fullS33Acceptance=false and actualCodexWorker=false;
actual run success must be read back before this transport is verified on Linux.
No existing task worktree, real secret, remote branch or personal auth state is
deleted/copied. Docker is installed on this Mac but its daemon is unavailable;
no Mac Docker engine/container run is claimed and no reboot was attempted.

Independent review found engine no-new-privileges colon-form rejection, false
success from unstarted created-state ExitCode0 and coding-home overlap with owner
credentials. All three were corrected with guard/oracle coverage. Final review,
publication and exact Linux CI evidence accompany this preparation.

brgr822c4cae local.devin configured SWE-2 High gave927bytes against a900byte
criterion; candidate rejected. Its substantive immutable-ID/identity-gap advice
was independently checked in code/tests, not accepted as proof. One narrowed
revision failed Herdr pane admission because the inherited callerw1:p2Z is stale;
lost result acknowledged, execution identity unknown, no third attempt/harness
switch. Model/effort observation unavailable. Sealed result retained separately.

Remaining R gate: real authentic grant plus actual Codex/ACP execution, scoped
coding login, task/Git lease lineage, independent result verification and approved
GitHub push receipt. The executor is code preparation, not a ready deployment.
