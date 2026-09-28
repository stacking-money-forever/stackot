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

## S24 launch contract — pinned runtime configuration compatibility

Owner acceptance bookkeeping was published as `cb79eb02248652ada6bf8438a2969b27ec281bfd`; CI run `36362829425` also completed success on that exact SHA. S24 starts from that accepted baseline in `/Users/justn/dev/.worktrees/stackot-s24-20260928`, branch `codex/stackot-s24-20260928`, automatically provisioned non-focused Herdr root `w6M:p1`.

S23 evidence fixes S24's exact scope: template per-agent sandbox/explicit Discord route and removal of the retired default marker; one public-CLI configuration oracle; a separate pinned Linux runtime-config CI job; Node bootstrap version in cloud-init; and the three required spec/runbook truth updates. This is one runtime-compatibility changeset. No task/approval controller, Receiver logic, account, provider/model selection, deployed host or worker execution is part of S24.

Primary oracle: installed public CLI validates a synthetic substitution, and `sandbox explain` proves the Stackot channel controller is unsandboxed while the default non-main policy stays enabled for other agents. Owner already ran this public command against the old template: it reports `sandbox.sessionIsSandboxed: true`, discriminating the intended ACP compatibility fix even though old schema validation passes. Candidate must pass; old template must fail the same oracle. Linux CI must pass before acceptance. Fixtures do not become live worker/account/deployment evidence.

Worker contract: interactive Devin `--model swe-2 --permission-mode dangerous`, one row, <=12 tool actions, at most two flat Todos, no subagents, one narrowed retry. S23 installed packages are reused read-only; S24 state/workspace must stay isolated. Launch prompt is retained in the task checkout; accepted count stays 48/81 until S24 is verified and published.

Launch observation: Herdr's 5-second startup observation timed out. A subsequent exact `pane process-info` proved PID 86951 running the requested `devin --model swe-2 --permission-mode dangerous --prompt-file .../s24-launch.txt` in the task checkout. The agent name had not yet registered, so monitoring uses the exact existing `w6M:p1` instead of restarting or selecting a different pane/model. Timeout is not a terminal worker result.

The same pane subsequently registered Devin/working and showed the bounded original-template public CLI probe. The process was not restarted. Host prerequisite refresh: local Tailscale reports Running, but no peer hostname identified as Stackot/Proxmox; the SSH aliases also supplied no such designation. This does not prove that no VM exists. Deployment still needs a designated reachable target; it does not block the independent local contract/approval/receipt work.

### S24 draft owner review (not accepted/integrated)

The worker produced the scoped template, CLI verifier, Node bootstrap, workflow and runbook/spec delta. Owner read the current draft and sent bounded corrections: pinned `plugins install` accepts one spec, so the runbooks need separate package commands; the oracle must keep workspace as well as state inside its owned fixture and bound subprocess time; the product template should not carry an oracle-only marker; skipped/missing-plugin settings must not be presented as complete plugin-aware schema validation; and unimplemented push/PR guards remain requirements, not working features. Candidate and pre-fix discriminator receipts are still pending. Accepted count stays 48/81.

### S24 attempt 1 — REJECT (incomplete schema proof / repair scope)

The current receipt still claimed missing-plugin warning validation as a pass, while the corrected verifier's real plugin installations encountered deferred data/settings validation. The worker expanded that investigation to general `doctor --fix --yes`; this is outside the row's config/schema-only scope, so owner interrupted the turn. A targeted metadata check found no user-global Stackot workspace, OpenClaw config or Gateway LaunchAgent, and no remaining OpenClaw process. This is a bounded check, not a claim to have audited every possible global side effect. No S24 delta is integrated or accepted. One narrowed retry remains, restricted to isolated plugin-aware verification with no doctor, service, auth or deployment repair.

Owner prerequisite discrimination: in a new isolated `owner-clean` state, initialized config to `{}`, installed the two actual pinned plugins separately, then merged the rendered template with installer-generated metadata/bootstrap entries. Candidate `config validate` exited 0 without missing/deferred plugin warnings. A separate invalid Discord TTL (`-1`) config exited 1 with `channels.discord.agentComponents.ttlMs: invalid config for plugin discord: must be > 0`. This proves active plugin schema checks rather than a skipped-validation pass. It identifies bootstrap-before-product-declaration as the bounded fix, with no general doctor/service/auth repair. The one narrowed retry was launched on the same native SWE-2 process to incorporate that sequence, strict schema controls and truthful receipts.

### S24 final candidate — owner verified, Linux CI pending

Devin completed the narrowed retry and its native pane is idle; the candidate receipt and scoped files exist. Owner re-ran its oracle, then hardened it: remove ambient Discord activation during bootstrap, remove forced reinstall/already-present-entry assumptions, retain actual template plugin settings instead of overwriting them with installer defaults, and add exact-field ACP schema denial alongside the Discord control. No extra worker retry was used.

Final task-checkout oracle: candidate exits 0, both official pinned installs succeed, active plugin-aware validation passes, invalid Discord TTL and invalid ACP permissionMode both exit 1 for their intended fields, Stackot controller is unsandboxed, and the other-agent default stays sandboxed. The identical oracle against the pre-fix template exits 1 specifically for Stackot's sandbox assertion, after passing schema and both denial controls. JS syntax, both YAML parses and diff whitespace checks pass. Eight product/receipt files were integrated via apply_patch and SHA-256 matched; target-worktree replay is required before publication. Key hashes: verifier `03243604063ac02aa78ae1ad4297ac658baa9ead826b1818cc22f7e726a3f1ce`, template `a6a6440b9f17bd0078cfaa5f9f55da9db1de3d259d6095cd77eed80d471b7564`. S24 is not ACCEPT before Linux CI.

Host prerequisite updated through the newly available proxmox-agent capability: live `vmctl list --json` reached configured node `pve`. It reports four existing VMs, all protected, and no Stackot guest. No VM or host was changed. The earlier inability to identify a host is superseded by this live access observation; provisioning/domain/guest/service evidence remains pending.

Target integration worktree re-ran the final oracle successfully (both pinned installs, plugin-aware validation, both exact-field denials, controller/default sandbox policy). Task evidence is preserved in local commit `58a055e` on the S24 branch. Product delta and verification notes are ready for integration-branch publication; S24 remains pending the exact-SHA Linux run.

Published S24 integration SHA: `cd1b2af7f9c9ebd84643229071f73fb1cb27a0d1`. Exact-SHA Linux CI run [36365179491](https://github.com/stacking-money-forever/stackot/actions/runs/36365179491) was observed in progress. It includes both unchanged Receiver verification and the new pinned runtime-config oracle. The owned idle Devin pane `w6M:p1` was closed after integration and a fresh idle check; task checkout/branch/commits/probe evidence are retained. Do not mark S24 ACCEPT before the actual CI result.

### S24 — ACCEPT after exact-SHA Linux success

Run `36365179491` completed **success** on `cd1b2af7f9c9ebd84643229071f73fb1cb27a0d1`; both `receiver` and `runtime-config` jobs succeeded. Owner task/target replay, old-template sandbox discrimination and both plugin-schema negative controls are recorded above. S24 is ACCEPT; count **49/81**, M2 **3/14**. Evidence is actual installed CLI schema/policy plus bounded fixtures and Linux verification, not live worker, Discord delivery, deployed host or human acceptance. S25 is the next dependency-ready row.

## S25 launch contract — native ownership and restart

Task checkout `/Users/justn/dev/.worktrees/stackot-s25-20260928`, branch `codex/stackot-s25-20260928`, base `bce6c43e10d9c3f9b59eb6758ce6875f85fb6253`, non-focused managed root pane `w6N:p1`. Exact interactive Devin selector/permission mode remains SWE-2/dangerous; provider coverage uncovered. Primary artifact `docs/contracts/task-state.md`, with a minimal real SDK probe/receipt under `docs/verification/s25-probe/`. No product approval/controller implementation, real account, model, worker or host mutation is authorized in this row.

Oracle: actual native flow/keyed-store creation and native reads after stopping/restarting an owned isolated Gateway; IDs, revisions, ownership and clearly synthetic approval-shaped values must be preserved. Helper/schema/file-existence evidence alone is insufficient. Installed types provide async managedFlows and native keyed stores; authenticated probe methods require operator.admin. Callback sender source inspection does not become live Discord evidence. Owner reruns and reviews all artifacts; one narrowed retry, <=18 scoped tool actions. Product module paths/storage decisions must follow the observed native contract rather than an assumed Receiver-only design.

Live launch: Herdr's 5-second startup observation timed out, but exact foreground inspection showed PID 20247 with `devin --model swe-2 --permission-mode dangerous --prompt-file .../s25-launch.txt` in the S25 checkout. The same `w6N:p1` then registered Devin/working. It was not restarted or replaced; monitor this exact pane/artifact set. S25 is not accepted yet.

## Parallel execution update — user-authorized 2026-09-28

Understood as: keep the full goal, run independent dependency-ready lanes in parallel, and retain row-specific ownership, actual oracles and explicit owner acceptance. The user's latest instruction supersedes the earlier one-active-row scheduling limit. At most two sibling Devin workers remain the bound; shared owner ledgers/integration are still serialized.

- Lane 1 S25 remains on `w6N:p1`, owning native state contract/probe files only.
- Lane 2 B10 is dependency-ready from accepted S38. Checkout `/Users/justn/dev/.worktrees/stackot-b10-20260928`, branch `codex/stackot-b10-20260928`, base `bce6c43e10d9c3f9b59eb6758ce6875f85fb6253`, non-focused managed root `w6P:p1`. Same exact SWE-2/dangerous harness; provider coverage uncovered. Owns repository protection readback, concrete plan JSON and its receipt only.

B10 is read-only GitHub inspection/preparation: no setting change, merge, credential access or remote message is authorized by parallelism. Its oracle is actual feature/check enforcement readback, so a disabled configuration remains unsatisfied even when its plan is ready. Neither worker may edit checklist/owner-state/waves or the other's files. Owner re-runs each oracle, integrates separately and records ACCEPT/REJECT. Count stays 49/81.

B10 startup observation timed out at 5 seconds; exact foreground inspection then confirmed PID 27995 with the requested SWE-2/dangerous argv in its checkout, and the same `w6P:p1` registered Devin/working. No restart/model substitution occurred. S25 remains concurrently live and its owned probe Gateway was observed on loopback 28790; that alone is not its restart/state oracle.

## User-directed brgr migration

The user explicitly removed the interactive-only restriction and requested brgr. Active AGENTS/checklist/ledger/owner-state now use brgr; historical launch receipts remain factual past evidence. Direct S25 was interrupted, its owned Gateway shut down cleanly, and its partial probe was preserved. B10 had already produced its audit/plan/receipt; those files are retained.

Live brgr 2.3.1 doctor reports healthy registry/store/integration and local.devin. Its route uses configured default only; safe config read confirmed agent.model `swe-2-high`, matching the prior SWE-2 High execution. No per-task model/effort flag or global model/config change was made. A write-requiring task was rejected before admission because workspace_write is unsupported. A scoped custom write-harness contract passed syntax validation but its scratch did not produce a write witness/successful result; it was not activated and no write capability is claimed.

Supported migration shape is explicit: brgr produces read-only review/patch proposals; Codex owns actual file application/runtime execution and the full row oracle. This does not remove the row's write/restart/publication requirements or turn advice into acceptance. Two actual brgr tasks were admitted through healthy local.devin:
- B10 readback/plan verification: `1b4324d2-e776-4826-8368-47a095c4edb2`.
- S25 native-contract/probe patch proposal: `d2c703dc-5254-48f1-8b1b-0632f497222b`.

The inherited Herdr caller ID is stale. These brgr process runs omit only stale Herdr presentation variables for that invocation rather than targeting a focused/unrelated pane or changing global auto-pane settings. Owner binding remains the exact Codex thread (confirmed in task status). Workspaces/snapshots are created by brgr; inspect sealed results and explicitly accept/reject, then separately decide the product row. Existing product count remains 49/81.

Migration policy was committed/pushed as `33d03d597ea87942a43b2d06e99e565bfc16fa09`; CI `36367146267` is in progress. Six requested snapshot files matched their preserved source hashes. Legacy owned idle panes `w6N:p1` and `w6P:p1` were closed after this handoff, without removing any worktree/evidence.

B10 managed task reached a failed terminal result (`attempt deadline elapsed`) despite retaining a 3939-byte review artifact. Owner inspected the sealed result and acknowledged it; it was **not** accepted. Its report confirms disabled/unprotected settings but also overstates integration-only check rollout as a universal merge deadlock, which needs owner qualification. No product B10 acceptance or settings mutation occurred. S25 managed task remains running. Configured SWE-2 High was verified before admission, but this harness reports model/effort observation as unavailable; do not upgrade config evidence to observed per-task model evidence.

## S25 owner oracle and contract — publication/CI pending

Brgr S25 revision 1 was explicitly rejected: it delivered discovery text only after a noninteractive permission refusal. The one narrowed revision 2 produced a no-tool ownership proposal from supplied native facts; owner inspected it, scoped product guard implementation to later rows, qualified its broad trust/storage claims, and explicitly accepted the advisory task (decision `aab8a8b8-8b62-4743-8d78-385aceb6bb89`). This does not accept product S25.

Owner assembled a reproducible real-native probe from the preserved plugin, with isolated state/workspace, reviewed local source confirmation, operator.admin method, no model/worker/account requests, new process groups, listener closure and actual server PID comparison. No native trust gate is bypassed. Task oracle recovered flow `bc309910-7c00-4a1c-ac39-a3cb5289c695` after actual Gateway PIDs `44313 → 44468`; target-worktree replay recovered new flow `3efcb30e-6e62-4ca2-bec2-3df7f8ebadec` after `46110 → 46360`. Both retained owner/revision 1/waiting/synthetic stateJson and rejected stale revisions before and after. Both actually refused native keyed store with PLUGIN_TRUST_REFUSED. No fake file/store is substituted.

Seven source/contract/receipt/launch artifacts SHA-256 matched between retained task and integration checkouts. JS/Python syntax, workflow YAML and whitespace checks pass. The native source actor contract uses authenticated Discord interaction user/policy before plugin dispatch; actual two-user behavior remains S28. Product module/storage locations are now frozen in task-state.md, but product approval/controller code is not implemented by S25. The workflow adds the same real native restart oracle on Linux; no acceptance before exact-SHA success. Count stays 49/81.

Herdr prepared the task worktree from the repository parent with `--no-focus`. Its automatically provisioned root pane is `w6J:p1`; no existing pane was split, moved, focused, or zoomed. The inherited caller ID does not resolve (`pane_not_found`), so it is not used as a callback target or substituted with the focused pane.

## Corrected prerequisite audit

The earlier blanket environmental blocker is superseded by current observations: repository-local `.env` contains working Discord/GitHub credentials; the GitHub credential can read the Stackot repository and reports admin/push permission. These are access observations, not approval for remote writes. Receiver JSON configuration is absent, required Discord forums/operations channels are absent, and OpenClaw/acpx are not installed on the default PATH. GitHub protection/rulesets and repository secret-scanning settings are not enabled. Host/DNS and human QA evidence remain unestablished.

Existing secrets are not copied into a worker checkout or recorded here. The missing runtime is being prepared in repository scope instead of being treated as a user-only prerequisite.
