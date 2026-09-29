# S33 token environment leak hardening — preparation, NOT ACCEPT

User authorized remaining work while prohibiting reboot. S33's canonical
S27/S32 predecessors are accepted; no S28/S29 dependency was bypassed and no
live approval/worker/remote push was activated. Count remains59/81.

Actual Mac deny-default Seatbelt tests use only synthetic fixture secrets,
private scratch/home, resolved filesystem paths and a separate synthetic owner
process. Workspace reads/writes work; owner direct/symlink read/write, network,
inherited FD/env marker and descendant file read are denied. The expanded
kernel probe nevertheless reads that fixture owner's environment through
KERN_PROCARGS2. Its final verdict is unsafe/exit2. Selective uname sysctls are
allowed, not a broad sysctl/process-info grant. This observation does not read
the user's real auth store or any real process credential environment.

Preserve s33-worker-isolation-native.json as the earlier nine-check observation;
it omitted cross-process environment reads and is superseded for boundary
assessment by s33-worker-isolation-expanded.json. Neither accepts S33 or proves
real Codex/ACP isolation. Docker daemon availability was false; no Docker launch,
new OS account, personal auth-store copy, sandbox installation or reboot occurred.

The prepared OwnerGitPush transport previously passed token bytes in
STACKOT_OWNER_PUSH_TOKEN. It now writes a fresh0600 file in a per-operation0700
owner directory; Git/askpass inherit only its path. Askpass reads the file;
finally truncates the original descriptor and removes the generated directory
on success or failure. Cleanup failure disables the instance and emits a fixed
diagnostic while preserving a confirmed remote receipt. Credentials
still require real worker denial of owner files; same UID/mode alone is not it.

The owner Git wrapper fixture invokes real local Git and the actual askpass,
checks password/username correctness and mode0600, asserts no credential bytes
in child argv/env, and proves cleanup after successful and failed dispatch.
New oracle passes60 assertions, including forced cleanup failure with empty
credential contents, preserved confirmation and disabled transport. In a
disposable copy using pre-fix b443827
transport, it fails specifically on envContainsCredential=false/receivedtrue.
Receipt s33-token-env-negative.json. Full source gateway107tests/735assertions,
typecheck/build pass. This is S transport evidence, not a real GitHub write.

brgr d335768b used healthy local.devin configured SWE-2 High for bounded
read-only advice; per-task model selectors and workspace_write are unsupported.
An initial write-capability admission was refused before a task was created;
no capability was silently dropped for an implementation task. Separate
read-only advice timed out180s with no artifact and was acknowledged, not accepted.
One attempted narrowed revision was refused because a failed result cannot get
a Codex candidate decision; no extra runtime attempt or harness substitution.
Owner implementation and observed oracles are the evidence.

Independent uncommitted review found cleanup errors replaced a confirmed receipt
with uncertainty. The descriptor wipe/fixed diagnostic/disabled-instance fix and
forced directory-permission failure oracle above resolve that finding. A final
independent review found no actionable regression. Omitting descriptor truncation
in a disposable mutation fails specifically on nonempty retained fixture bytes
(s33-token-wipe-negative.json); teardown restores only fixture permissions so
it cannot hide the assertion. Exact Linux CI accompanies publication.
No auth files are installed in
production; process/host termination cleanup remains an activation risk.
Native probe command uses `/opt/homebrew/bin/python3`; the user's mise interpreter
is deliberately outside the profile whitelist. Expanded native result exit2
is the expected unsafe boundary finding, not a passing sandbox certificate.

Linux CI checks unsafe fixture controls and unsupported-native fail-closed
behavior only. A native kernel probe is not used as a Linux PASS substitute.
Actual worker task lineage, scoped coding authentication, owner filesystem/IPC
isolation, native separate push approval and GitHub ref readback remain open.
