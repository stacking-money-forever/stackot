# S23 owner probe (2026-09-28)

Target: `/Users/justn/dev/.worktrees/stackot-s23-20260928`, baseline `fd5ff804a26931adb338b11a9a2e96e451772cb9`. This is owner-observed evidence, not the worker's candidate claim or an ACCEPT decision.

## Installed provenance

- Official Node distribution `node-v24.21.0-darwin-arm64.tar.gz`; SHA-256 `bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057`, compared to the official `https://nodejs.org/dist/v24.21.0/SHASUMS256.txt` before extraction.
- `openclaw@2026.9.6`, CLI output `OpenClaw 2026.9.6 (eb377ac)`.
- `acpx@0.19.3` standalone CLI. The real `@openclaw/acpx@2026.9.6` plugin has a separate installed dependency `acpx@0.19.0`.
- Real external `@openclaw/discord@2026.9.6` installed in the isolated owner state for channel-contract source inspection. No Discord account is connected by this probe.

Runtime root `R=receiver/node_modules/.stackot-runtime`; use its Node `node-v24.21.0-darwin-arm64/bin` and package `packages/node_modules/.bin` directories in the command-local PATH. Set `OPENCLAW_STATE_DIR=$PWD/$R/owner-state` and `OPENCLAW_CONFIG_PATH=$OPENCLAW_STATE_DIR/openclaw.json`. These paths are ignored by Git. No global Node, provider auth, or primary-checkout secret was modified.

## Owner CLI oracle

Re-ran `openclaw --version`, `acpx --version`, `openclaw worktrees create --help`, `openclaw tasks retry --help`, `openclaw tasks flow --help`, and `openclaw config validate`; all exited 0. `tasks retry` explicitly says it retries blocked subagent completion **delivery**. It does not promise re-execution of an ACP coding task.

`openclaw plugins install --pin --accept-capabilities @openclaw/acpx@2026.9.6` succeeded. The selected acpx entry from `openclaw plugins list --json` was enabled/loaded, version `2026.9.6`, no diagnostics, and all declared dependencies installed. Later installed Discord with the equivalent pinned command.

The original `deploy/openclaw.json5.template`, with synthetic non-secret IDs/token, passed `openclaw config validate` in a separate isolated template state. It emitted warnings for the absent acpx installation in that separate state and retired per-agent `default` markers. This validates syntax/schema, not identity, authorization, a live Discord connection, or safe execution.

## Installed policy oracle

Executed the pinned core module `dist/subagent-spawn-ownership-Bn-k4g7t.mjs` directly, importing `f` (`resolveSpawnSandboxError`) and `n` (`resolveConfiguredSubagentRunTimeoutSeconds`). Five assertions passed:

1. ACP plus `requesterSandboxed=true` rejects.
2. ACP plus unsandboxed requester and `sandbox=inherit` passes this guard only.
3. ACP plus `sandbox=require` rejects.
4. Per-call `runTimeoutSeconds=3600` overrides the configured 120 seconds.
5. With no override, the configured 120 seconds is returned.

The actual ACP path in `dist/acp-spawn-DDLC3xRy.mjs` also forwards the resolved value to runtime `timeoutSeconds`. The moving latest documentation's prohibition on per-call timeout is not the contract of this installed version. These are installed-helper/input-matrix observations, not a real worker spawn.

Pinned hook source: `dist/hooks-HRQZlwij.mjs` accepts replay identity in header order `Idempotency-Key`, `X-OpenClaw-Idempotency-Key`, then payload `idempotencyKey`, after non-empty trimming and a length cap. `dist/hooks-B9gt5Q49.mjs` allocates `hookReplayCache` as an in-process `Map`, expires terminal entries after `3e5` ms and uses `DEDUPE_MAX` for terminal-entry pruning; unresolved entries are treated separately. Cache creation is inside request-handler construction, so this source gives no cross-process/restart replay persistence. Admission/replay alone cannot prove a durable Discord receipt.

Existing native worker authentication preflight: `codex login status` returned `Logged in using ChatGPT`. This proves CLI login state only; no model request, worker run, publication privilege boundary, or approved action was tested.

Pinned public TaskFlow types are available in `dist/runtime-api-CkahAQr_.d.ts`: `api.runtime.tasks.async` exposes bound `runs`, `flows` and `managedFlows`; managed writes include `createManaged`, `tryCreateManaged`, `setWaiting`, `resume`, `finish`, `fail`, `requestCancel` and `runTask`. The synchronous counterparts are deprecated in these declarations. This gives an actual installed API entry point for S25; type availability is not yet a successful managed-flow creation or restart receipt.

## Real local startup oracle

Started `openclaw gateway run --allow-unconfigured --port 28789 --bind loopback --auth token --token synthetic-owner-contract-probe-token` against the isolated owner state. No account credentials or model turn were supplied. Authenticated `openclaw gateway call health --url ws://127.0.0.1:28789 --token synthetic-owner-contract-probe-token --json` returned:

- `ok: true`;
- acpx in `plugins.loaded`, no plugin errors;
- no external channels and zero sessions.

`lsof` showed only `127.0.0.1:28789` and `[::1]:28789`. After verifying the listener PID was the owned `openclaw-gateway` process, sent SIGTERM; it reported clean shutdown in 1112 ms and exit 0. A fresh listener check found no remaining listener on that port.

This is **R for startup/health/plugin loading only**. No ACP coding run, webhook delivery, Discord send, restart durability, deployment, or human QA is proved. Such claims remain with their own rows.
