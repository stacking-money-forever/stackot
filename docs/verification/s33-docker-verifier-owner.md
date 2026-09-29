# S33 isolated owner verification preparation — NOT ACCEPT

Receiver S32 default runner actually executes Git and a claimed shell command
on the host. This default is preserved for its accepted local contract. The new
gateway adapter always injects Docker execution and binds the owner-selected
test command, immutable base SHA and pinned target. No coding home/network is
provided; Git observations and untrusted repo tests cannot read owner files.

Local3tests/38assertions cover container-only command routing, weaker command or
changed target denial, failed tests, dirty tree, changed tested SHA and uncertain
cleanup. Disabling owner-command equality or post-test identity makes its
targeted disposable-copy oracle fail; s33-docker-verifier-negative.json is S.
Linux real-Docker fixture now builds a trusted Alpine+Git image and executes the
same adapter against a committed task repo. Its owner test can pass only where
the outside fake secret is absent; a failing test must reject the success claim.
Full native run must be read back before claiming Linux validation.
Review found ignored worker files could influence tests despite a clean status.
Owner test now runs in a fresh no-hardlinks checkout of the target, with unchanged
HEAD/clean checkout enforced afterwards. Actual CI includes an ignored input
present only in the original worker tree; the owner test requires its absence.
Private tmpfs scratch limit is1GiB within the existing2GiB worker memory limit.
Further review found linked Git metadata outside the mount and absolute `/work`
could defeat the checkout-only guarantee. Owner now materializes a self-contained
snapshot from vetted common Git objects/refs, with strict pack import and no
source config/hooks/files. Only that snapshot is mounted; original linked
worktree, untracked/ignored artifacts and common Git metadata remain hidden.
An actual local linked-worktree oracle verifies unchanged source refs, absent
ignored input/hooks, exact target/base diff and retained original files.
Final source121tests/851assertions, integration128/884, typecheck/build pass;
independent final snapshot review found no actionable defect. Native Linux
Docker run remains a separate publication oracle, not inferred from local tests.

`.verifyTarget` is directly compatible with PreparedOwnerPush.verify; actual
catalog task/lease provisioning is not fabricated. No default bootstrap factory,
auth-store copy, real model, GitHub push or reboot. Full count remains59/81 and
S33 NOT ACCEPT until its real credential/controller/worker oracle is satisfied.

brgr b556bd4c local.devin configured SWE-2 High used one read-only task;660byte
candidate exceeded600byte criterion and was rejected, with one narrowed revision.
Narrowed398byte artifact was independently checked and accepted as advice only;
this is separate from product-row acceptance. Sealed result and decision retained.
Native model/effort observation unavailable. Final sealed result and owner
decision are retained separately. Independent review and exact Linux CI
accompany publication.
