# S29 isolated Codex image preparation — NOT ACCEPT

Trusted dependency-only Docker context pins Node24.21.0, codex-acp1.11.0,
Codex0.153.4 and acpx0.19.0. Its separate image package lock captures public
dependencies; the repository's Bun package manager/lock remain unchanged.
Scripts are disabled during dependency installation. No repo checkout, auth
home or owner secrets enter the build context. Final metadata contains PATH only.

Actual Mac Docker image ID47a995270cc11974b3d485000445bf2044e6a1b9f6bb3b04aa6412af05bb391d
passed the full synthetic Docker isolation/timeout/cancel/linked-worktree oracle.
Native package probe under the fixed nonroot/read-only/offline profile also
confirms actual Linux Codex binary0.153.4 and other pins. Empty scoped auth home
reports login absent; task workspace unchanged and owned container removed.
Initial assertion that metadata commands leave the entire coding home empty
failed because the native CLI creates tmp/arg0 shims even for login status.
Corrected oracle admits only tmp, with no auth/config/session-store root entries.
This is package/runtime preparation, not ACP model execution or S29 R acceptance.

New private coding-homes/primary directory was created700 without copying any
personal auth. Pinned native CLI device login is waiting in existing owned Herdr
stackot-local-deploy/w6Y:p1. The user was asked to complete authentication directly;
one-time code, passwords and tokens are not copied into this report. Account
auth must be inspected through scoped CLI status, not raw auth JSON content.

Next required work: actual bidirectional contained ACP transport with host
callbacks disabled, owner-bound live start factory, fresh coding-plan approval,
before0/after1 genuine worker proof. Existing no-op approvals never authorize it.
Linux builds/probes this public image on the published SHA; no model/login/key
is provided to CI.59accepted/1skipped/21required; full goal remains active.

Final independent review found no actionable defect. Actual package/native-binary
metadata and full Docker fixture passed locally; source receipt is
s29-codex-image-macos.json. The actual approved ACP run remains unverified.
