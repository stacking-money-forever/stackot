# Owner-controlled Docker worker executor

`gateway/src/docker-worker.ts` is an execution transport, constructed only by
trusted owner code. It is not a Gateway RPC and does not enable the deployed
worker dispatcher. S29 must supply authentic current task/approval/plan authority;
S30 must supply its approved task workspace and Git lineage. S33 is NOT ACCEPT
until the real controller/Codex/credential boundary is observed.

Owner pins a locally installed `sha256:<image-id>` and a program inside that
vetted image. No tag resolution or automatic pull occurs at execution. Images
with declared volumes or environment entries beyond PATH are rejected. The
Docker client uses an explicit local Unix endpoint, a fresh private empty client
configuration and a minimal environment, with no ambient registry/helper/proxy
auth. Only the exact task directory is writable on the host. The owner root and
other tasks are not mounted; names with mount-CSV delimiters and symlink aliases
are refused. The controller must own workspace-root mutation during creation.
No host home, SSH agent, Keychain, Git credentials or Docker socket is mounted.

Container runs as the non-root owner UID/GID, read-only rootfs, ALL capabilities
dropped, no-new-privileges, private IPC/cgroup namespaces and default private PID
namespace. Limits are256processes,2GiB,1CPU; home/tmp use bounded private tmpfs.
Default network is none. Real model requests require an owner-selected local
bridge network carrying `me.justn.stackot.role=worker-egress`; this mode allows
outbound networking and is not an egress-domain allowlist or a host-service
firewall. Do not claim otherwise.

Optional coding-home mounts must be task children of a separately approved
private coding-home root, disjoint from both workspace and owner credential
roots. It holds a separately configured coding account. The executor never
copies existing personal authentication stores. Caller must supply appropriate
model authentication; an offline fixture cannot prove an actual Codex run.
Git linked-worktree metadata outside the bind mount is not exposed. The task
allocator must provide safe in-task Git metadata before real Git operations;
the executor does not silently mount shared host `.git` state or mint lineage.

Current owner authorization is checked before Docker operations, before create
and before start. Returned immutable container ID, execution UUID label, image,
UID, entrypoint, mounts and security policy are inspected before execution.
Start/kill/remove use that ID, not a mutable name. An exited status and actual
start timestamp are required; default created-state ExitCode0 cannot be success.
Raw worker stdout stays in a private0600 owner output file. CLI output is bounded
to1MiB and provider/daemon stderr is never returned as a public diagnostic.

Cancel/timeout first terminates the attached CLI, then kills and re-inspects the
actual owned container before removing it. Task files remain untouched. Unknown
create ACK uses exact execution-label discovery once; zero/multiple matches or
unconfirmed kill stays uncertain. No blind create/start retry, foreign-container
kill or claim of cancellation from CLI exit alone. Receipts with
cleanupConfirmed=false need owner reconciliation; no automated new execution.

Tests cover guard denial/revocation, policy rejection, timeout/cancel, uncertain
kill, foreign ownership and lost create ACK. Actual Linux Docker CI uses a public
Alpine fixture pinned to its inspected local ID, synthetic files, normal exit and
real cancel/timeout with task-file preservation. It is real container execution
with synthetic worker/credentials, not actual Codex/ACP, Mac deployment or full
S33 acceptance. Source/profile omission mutations must fail their oracles.

Semantics checked against the installed Docker29.4.1 help and official
[run documentation](https://docs.docker.com/engine/containers/run/) and
[bind-mount documentation](https://docs.docker.com/engine/storage/bind-mounts/).
