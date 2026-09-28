# S24 receipt — pinned runtime-config compatibility (candidate)

Base cb79eb0 (S23 owner-accepted). Evidence: config/schema policy via installed
S23 public CLI (Node 24.21.0 / OpenClaw 2026.9.6) in isolated mkdtemp state.
NOT deployed/worker/human evidence.

## Changed files
- `deploy/openclaw.json5.template` — retired `agents.entries.*.default` removed;
  `agents.entries.stackot.sandbox.mode="off"` added (channel-derived controller
  must spawn ACP/Discord actions; a sandboxed requester cannot spawn ACP);
  global `agents.defaults.sandbox.mode="non-main"` kept; `bindings[]` route
  added (`channel:"discord"`, `guildId`, agentId stackot; accountId unset =
  single account). Comments: unsandboxed controller/ACP is not worker
  containment; spec-required push/PR guards are NOT yet implemented and need
  independent verification before live operation.
- `deploy/verify-openclaw-template.mjs` — public-CLI oracle, Node builtins only.
- `deploy/vm/cloud-init.yaml` — NodeSource `setup_22.x`→`setup_24.x` only.
- `.github/workflows/ci.yml` — new `runtime-config` job (setup-node 24.21.0,
  `npm i -g openclaw@2026.9.6 --allow-scripts=openclaw`, `openclaw --version`,
  oracle on pushed SHA). Receiver job untouched.
- `docs/spec.md`, `deploy/README.md`, `deploy/vm/README.md` — pinned versions;
  separate per-plugin install commands (`--pin --accept-capabilities`);
  `openclaw.json` filename; guards required-but-unimplemented wording.

## Oracle fixture (isolated mkdtemp; synthetic IDs/token; bounded timeouts)
`{}` bootstrap config → `plugins install @openclaw/acpx@2026.9.6` then
`@openclaw/discord@2026.9.6` (each `--pin --accept-capabilities`). No forced
reinstall, doctor/service/auth repair, or assumed already-present-entry success.
Owner correction: bootstrap without a Discord token, install each pinned plugin
without --force or an already-present-entry fallback, then add only installer
metadata. Product plugin settings are retained unchanged. Workspace/state stay
inside the owned temp root; ambient OpenClaw/Discord env is scrubbed.

## Results (installed CLI, local run)
- Candidate: installs OK; `config validate` exit 0 with real plugin schemas;
  negative control `agentComponents.ttlMs=-1` REJECTED by the discord plugin
  schema; stackot `mode=off sessionIsSandboxed=false`; injected `s24probe`
  `mode=non-main sessionIsSandboxed=true`. **ORACLE PASS, exit 0.**
- Old (`git show HEAD:`): **FAIL, exit 1** specifically on the stackot sandbox
  assertion (`sessionIsSandboxed=true`). No test-marker dependency.
- `node --check` clean.

## Residuals — unproved
- No gateway start, Discord connect, model turn, ACP/worker spawn, live
  callback, or deployment. Binding validated against schema only; live Discord
  routing needs real guild/token (owner asset rows).
- Owner added and passed an ACP invalid-permissionMode control, requiring exit 1
  and the intended plugin field error; Discord control likewise requires its
  exact field denial. Final candidate passes; original fails only the sandbox
  assertion. Owner syntax/YAML checks pass. Linux CI remains pending.
- npm install of `openclaw@2026.9.6` on the Linux runner not yet observed.
