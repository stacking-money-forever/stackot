# Owner verification inside the worker boundary

`gateway/src/docker-verifier.ts` adapts the accepted S32 observation logic through
an explicit Docker-backed CommandRunner. Every Git observation and repository
test executes in the approved container; the existing receiver-local default
runner remains unchanged and is never used by this adapter. Image program is
fixed to `/bin/sh`, networking disabled and coding-home mounting disabled.
Git is `/usr/bin/git` in the vetted read-only image, with global/system config,
replacements, fsmonitor and hooks disabled. No workspace executable can replace
the Git observer through PATH.

Owner freezes task/workspace, immutable base SHA, expected repo/branch/commit,
test command and claim. A worker-proposed weaker/different test is rejected.
Before and after tests, HEAD and branch of the clean snapshot must match the
target and the trusted source branch ref must remain pinned. Push cannot promote
a test result obtained from uncommitted edits or
a test-modified revision. Existing S32 logic compares committed changes against
the base SHA and rejects ghost/unclaimed files or actual test failure.
Tests run in a new private no-hardlinks checkout of the pinned commit, not the
worker directory. Ignored worker artifacts cannot influence the result. The
checkout itself must retain its HEAD and clean state after the command. Image
must contain the owner-approved test dependencies; there is no reuse of ignored
worker-installed dependencies. Git untracked-file visibility is forced on.
`verification-snapshot.ts` reads only owner-vetted common Git objects/refs through
a private clean reader, streams the target/base pack through strict index-pack,
and checks out a self-contained repository under a separate approved snapshot
root. No worker config/hooks/index/files are copied. This supports linked host
worktrees without mounting shared Git metadata. Original worker directories are
not mounted in verification containers, even at `/work`; only the clean snapshot
is exposed. Generated snapshots are disposed, original task worktrees retained.

Container exit and cleanup must be confirmed. Output comes only from a bounded,
regular owner-private stdout file, with no-follow leaf and canonical parent path
checks; unconfirmed receipt, timeout, invalid output or changed identity rejects.
S32 applies its existing output-tail redaction. There is no host command fallback.

`isolatedRevisionVerifier(policy).verifyTarget` has the signature required by
PreparedOwnerPush.verify. A real owner catalog must supply its trusted stopped
worker/task/Git lease and the owner-selected test command; this adapter does not
mint lineage or accept worker/RPC-supplied functions. Default plugin still
provides no push factory, no worker activation and no new Gateway API.

Linux Docker CI uses a trusted Alpine+Git fixture, a clean self-contained task
repository and an outside fake owner secret. The owner test succeeds only inside
the container; on the host that fake secret exists. Failing owner tests must
reject the same worker success claim. This is synthetic worker/credential
evidence on a real Docker engine, not actual Codex/ACP or GitHub push acceptance.
