# Wave 03 — resume real runtime verification (2026-09-28)

Understood as: resume Stackot completion, resolve routine compatibility and implementation choices autonomously, and preserve row-level owner verification plus L/S/R/D/H evidence boundaries.

Baseline: `fd5ff804a26931adb338b11a9a2e96e451772cb9`. Accepted count remains 47/81 until a new row has met its oracle and owner acceptance requirements.

## S23 launch contract — installed OpenClaw/acpx contract

- Task branch: `codex/stackot-s23-20260928`.
- Task worktree: `/Users/justn/dev/.worktrees/stackot-s23-20260928`.
- Harness: interactive Devin, exact `--model swe-2 --permission-mode dangerous`; provider coverage is `uncovered` (Devin).
- Artifact: `docs/verification/openclaw-contract.md`, with sanitized, repeatable installed-binary version/help/schema/ACP/worktree observations.
- Oracle: owner re-runs the documented probes against the installed packages and checks every supported/unsupported claim against the pinned implementation. Documentation search alone is not runtime evidence.
- Scope: contract document and bounded probe receipt only. No approval, worker, routing, deployment, or external-account mutations in this row. No secrets, global installation, commits, push, worktree deletion, or subagents by the worker.
- Runtime preparation: owner installs a compatible Node distribution and pinned packages below the task worktree's ignored `receiver/node_modules/.stackot-runtime/`. Global Node and native harness credentials stay untouched.
- Retry: at most one narrowed attempt after an owner rejection.
- Status: worker running; not accepted.

Owner installation observed Node `v24.21.0`, OpenClaw `2026.9.6 (eb377ac)`, and standalone acpx `0.19.3`. The Node download was compared against the SHA-256 in the official distribution's `SHASUMS256.txt` before extraction. The packages are ignored by Git; no credential or package install entered the tracked source. npm did not execute uncovered package scripts, which remains a plugin/backend readiness question rather than a successful backend claim.

Live harness proof: `herdr agent start` returned exact argv `devin --model swe-2 --permission-mode dangerous --prompt-file .../docs/verification/s23-launch.txt`; `herdr pane process-info --pane w6J:p1` independently showed the same foreground argv. The TUI identifies the native family resolution as SWE-2 High and was working on the bounded task. No substitute selector was used.

Owner plugin preparation: `openclaw plugins install --pin --accept-capabilities @openclaw/acpx@2026.9.6` succeeded in the isolated `owner-state`. `plugins list --json` reported acpx version `2026.9.6`, enabled/loaded, no diagnostics and all declared dependencies installed. This plugin uses its own pinned `acpx@0.19.0`; the separately installed standalone CLI is `0.19.3`, and these must not be conflated in receipts. Node archive SHA-256: `bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057`.

Owner schema oracle: original template with synthetic values passed `openclaw config validate` on `2026.9.6`, with warnings about the absent plugin in that separate template probe state and retirement of per-agent `default` markers. An earlier web-research claim that per-call ACP timeout must be removed is **not accepted** against this pinned version: both `sessions-spawn-tool-AW-VALLJ.mjs` and `acp-spawn-DDLC3xRy.mjs` accept/forward `runTimeoutSeconds`. The installed contract takes precedence over moving latest documentation. The sandbox prohibition and controller/replay boundaries still need their exact source/probe evidence in the worker artifact.

Owner runtime oracle: started an isolated, token-authenticated Gateway on port 28789 with the installed real plugin, then `gateway call health` returned `ok: true`, acpx in `plugins.loaded`, no plugin errors, zero external channels and zero sessions. `lsof` showed only `127.0.0.1:28789` and `[::1]:28789`. This is R evidence for Gateway startup/health/plugin loading only, not ACP execution, Discord delivery, deployment or human QA. The owned probe Gateway is stopped after the health receipt; no model turn was submitted.

Continuation owner probes: six CLI commands re-ran successfully; the installed sandbox/timeout helper matrix passed five assertions (sandboxed ACP rejected, unsandboxed inherit allowed by this guard, ACP require-sandbox rejected, per-call 3600 s retained, configured fallback 120 s retained). The pinned Discord plugin `@openclaw/discord@2026.9.6` was also installed into the isolated owner state. Its hidden `dist/.setup/send.components-ChY21qr-.mjs` implements in-memory entries plus runtime-provided persistent stores in `discord.components`/`discord.modals`, default callback TTL 30 minutes, and reports persistence failure with an in-memory fallback. This source evidence does not prove a live callback or its restart behavior; S25/S28 still own those probes and product approval binding. Reproducible owner observations are in `s23-owner-probe.md`.

Worker discovery was narrowed after extensive source scans: stop further discovery, write the two bounded candidate files from existing evidence, and identify unresolved contracts explicitly. The worker remains live on the exact selected harness; no restart or model substitution occurred.

### S23 attempt 1 — REJECT (missing artifact / bounded discovery exhausted)

After roughly 14 minutes of discovery the worker had not produced either contracted file. Owner supplied exact installed source locations and a three-tool limit to finish the artifacts; the TUI continued discovery instead. The attempt is rejected for failure to deliver the primary artifact, not because runtime installation failed. Owner interrupted the current turn through the native `esc esc` action and will use the one permitted narrowed retry on the same SWE-2 harness. All runtime preparation and observations are retained. No ACCEPT count changes.

### S23 narrowed retry — owner-verified candidate, publication pending

The retry produced `openclaw-contract.md` and `s23-receipt.md`. Its remaining tool response was interrupted after the files existed; native terminal completion alone is not relied upon. The exact agent then settled `done`/cancelled with the artifacts preserved. Owner read both files and integrated the candidate through apply_patch, first proving three SHA-256 MATCH results including the launch prompt.

Owner corrections (source/CLI-discriminated): `allowedAgents: ["*"]` does not authorize codex in the installed policy; a direct guard invocation rejects it while empty and explicit-codex lists allow it. `worktrees remove --force` means removal may proceed if snapshot creation fails, not that snapshots are always skipped (confirmed by CLI help and the removal source). The Receiver-only approval-store assertion was a design choice without evidence, so it is replaced with the S25 ownership decision. The document was shortened without discarding the core contracts. No product code changed.

Owner re-ran the installed CLI/schema/help commands, source paths and the sandbox/timeout/allowlist matrices. The baseline has no contract artifact; the new artifact supplies actual installed-version contracts and distinguishes source/schema/helper facts from bounded real Gateway startup. Dependent restart, worker, publication, delivery, deployment and human claims stay unproved.

Final donor/integration SHA-256 MATCH values:
- contract: `9ac5e4b413497b56777deb8539ee08865af1586434a7d217f4fa2ef6ea73c71d` (8982 bytes);
- launch: `433acce6d1e75ad1baa5fc8e2da0eba176846c0e90ef409316bb0a2434ccec18`;
- receipt: `a93047072c3fe53bfb1605e1ef674ff1a8cda7001b87227d40d7993c94d02845` (2686 bytes).

### S23 — ACCEPT after publication and exact-SHA CI

Task evidence commit: `c141e89087516a3d71e2381ab9479e001a60679f` on the retained S23 branch. Owner integration commit `b89e725cb4d370401501ebb6d67d6bbaccff4820` was pushed to `origin/codex/stackot-completion-20260921`. CI run [36362592296](https://github.com/stacking-money-forever/stackot/actions/runs/36362592296) completed **success** on exactly that SHA. Owner checked both the source contracts and the real installed CLI/runtime oracles above. Row S23 is ACCEPT; total becomes **48/81**, M2 **2/14**.

Residual: no live ACP turn, approved publication, Discord callback/send, native state restart, deployed host or human result is claimed. These remain their own rows. The owned terminal/cancelled Devin pane `w6J:p1` was closed only after artifact integration and a fresh live done check. Its worktree, local task commit, launch prompt, receipt, and ignored installation/probe state are retained.

Herdr prepared the task worktree from the repository parent with `--no-focus`. Its automatically provisioned root pane is `w6J:p1`; no existing pane was split, moved, focused, or zoomed. The inherited caller ID does not resolve (`pane_not_found`), so it is not used as a callback target or substituted with the focused pane.

## Corrected prerequisite audit

The earlier blanket environmental blocker is superseded by current observations: repository-local `.env` contains working Discord/GitHub credentials; the GitHub credential can read the Stackot repository and reports admin/push permission. These are access observations, not approval for remote writes. Receiver JSON configuration is absent, required Discord forums/operations channels are absent, and OpenClaw/acpx are not installed on the default PATH. GitHub protection/rulesets and repository secret-scanning settings are not enabled. Host/DNS and human QA evidence remain unestablished.

Existing secrets are not copied into a worker checkout or recorded here. The missing runtime is being prepared in repository scope instead of being treated as a user-only prerequisite.
