# Owner continuation state

Last updated 2026-09-28. The latest continuation is the section below; historical wave sections are retained as evidence.

## Current continuation — wave 03

- Native goal is active in the current owner thread. Completion still requires the full checklist; current accepted count is **48/81** (M2 2/14), not the historical 67-row arithmetic below.
- Owner checkout remains `/Users/justn/dev/.worktrees/stackot-completion-20260921`. S23 integration commit `b89e725cb4d370401501ebb6d67d6bbaccff4820` is published; exact-SHA CI run `36362592296` completed success. The owner has recorded S23 ACCEPT in wave-03.
- Active row: **S24**, task checkout `/Users/justn/dev/.worktrees/stackot-s24-20260928`, branch `codex/stackot-s24-20260928`, root pane `w6M:p1`, baseline `cb79eb02248652ada6bf8438a2969b27ec281bfd` (acceptance-record CI `36362829425` success). Its bounded launch contract is in wave-03 and the task prompt. S23's checkout/branch/evidence commit `c141e89087516a3d71e2381ab9479e001a60679f` are retained; its owned idle pane was closed after integration.
- Installed in the task checkout's ignored `receiver/node_modules/.stackot-runtime/`: checksum-verified Node `24.21.0`, OpenClaw `2026.9.6 (eb377ac)`, standalone acpx `0.19.3`, external ACP plugin `@openclaw/acpx@2026.9.6` (its private acpx dependency is `0.19.0`). No global runtime or user auth store was changed.
- Owner independently observed real local Gateway startup, token-authenticated health `ok: true`, acpx loaded with no plugin errors, zero external channels and sessions, and loopback-only listeners on port 28789. The owned probe Gateway shut down cleanly after SIGTERM. This is bounded R startup evidence only; no worker, Discord, deployed or human result was observed.
- S23 first attempt rejected for missing artifacts after bounded discovery. The one narrowed retry produced both files. Owner re-ran CLI/schema/source/helper oracles, corrected false wildcard/snapshot claims and removed the unproved Receiver-only storage mandate. Final contract/launch/receipt hashes match the task checkout. The native worker is terminal/cancelled; artifact evidence, not its completion label, supports the candidate.
- Resume with S24's bounded template/runtime compatibility contract using the S23 pins. Carry the original one-row, one narrowed retry, preserved worktree/receipt and CI-before-acceptance rules forward. Source, schema and helper observations do not prove live worker or account integration.
- S24 live monitoring target is the exact pane `w6M:p1` (startup name observation timed out but actual SWE-2 PID/argv and working TUI were verified; no restart). Scoped implementation now exists in its task checkout, but owner review requested corrections to plugin install arity, fixture/workspace isolation, subprocess bounds, oracle instrumentation, real plugin-aware schema coverage and unimplemented-guard wording. No S24 product delta is integrated or accepted yet. Task launch is locally committed as `68847d2ff4a366b5256aabcd4fbddb92bd3b8102`; owner launch/ledger plan is `3fd70cd` (not yet pushed).
- Latest S24 state supersedes that draft: Devin is idle with the retry artifact. Owner corrected/hardened the verifier and proved final candidate PASS plus old-template sandbox FAIL, both plugin-schema negative controls, JS/YAML/whitespace checks and eight file-hash matches. Delta is integrated; target replay/publication/Linux CI remains before ACCEPT. Accepted count remains 48/81.
- S24 target integration replay also passed. Retained task commit is `58a055e`; owner publication/CI is the next gate. No further worker work is planned for this row.
- Proxmox host access is now live through proxmox-agent's configured `pve`: four protected existing VMs, no Stackot guest. No VM mutation occurred. Host access is no longer a missing prerequisite, while guest provisioning, domain and actual deployment remain unproved.
- Superseded blocker: working repository-local Discord/GitHub credentials and GitHub admin/push access are now observed. Receiver configuration, required Discord forums/operations channels, deployment host/DNS and human participation remain unestablished. Credential access is not authorization for remote writes.
- The earlier latest-docs timeout finding is not a pinned-version defect: installed `2026.9.6` accepts and forwards per-call `runTimeoutSeconds`. Freeze the installed API before editing S24; do not rewrite it to match moving docs.

Full launch/preparation/runtime receipts: `docs/verification/wave-03.md`. The inherited caller `w1:p2Z` does not resolve, so it is not a callback target and no focused-pane substitute was chosen.

## Goal and standing constraints

Goal is active, no token budget. Product completion still requires real P0/P1 evidence from `docs/atomic-completion.md`; a green local suite is not completion.

User-mandated execution form: one interactive Devin worker per row with the exact selector `--model swe-2` (no brgr, no headless, no substitute model), owner verification before integration, and an owner ACCEPT/REJECT record in the wave ledger. The user additionally authorised, in this session: committing and pushing the integration branch, and running CI once per push.

## Repositories and checkouts

- Integration checkout: `/Users/justn/dev/.worktrees/stackot-completion-20260921`, branch `codex/stackot-completion-20260921`, pushed to `origin`. Working tree is clean apart from in-progress wave notes.
- Primary checkout `/Users/justn/dev/stackot` stays on `main` and is not used for this work.
- Canonical task DAG: `docs/atomic-completion.md` (67 rows) in the integration checkout.
- Ledgers: `docs/verification/wave-01.md` (historical, contains the corrected retained-worktree claim), `docs/verification/wave-02.md` (current: launch contracts, decisions, retro acceptance table).
- Row launch prompts live at `docs/verification/s<row>-launch.txt`, committed into the baseline before the row's worktree is created so the checkout already contains it.
- Task worktrees are retained, never deleted: `stackot-s12-20260921`, `stackot-s13-20260921`, `stackot-s17-20260921`, `stackot-s18-20260921`, `stackot-s19-20260921`, plus the older `stackot-ps-todos-20260913`, `stackot-receiver-delivery-20260914` and `/Users/justn/dev/stackot-roadmap`.

## M1 status — reliable ingress (S01–S22) closed at contract level

Every M1 row has an owner decision recorded in `docs/verification/wave-02.md` (launch contract, ACCEPT/REJECT, oracles, residual risks). Highlights of this session, in commit order:

- Baseline release: `814cf2c` (receiver reliability work + CI), `db95b2a` (atomic completion ledger, wave-01 correction).
- S12 dead-letter wiring (`57be0b6`), S13 manual replay (`47df399`) — both proven against a real receiver process, not only in unit tests.
- S17 comments surface (`49e1d94`), S18 pagination (`f1be5f5`), S19 backlink trust (`bfefe5a`) — the reverse-link path now only trusts a link whose guild matches and whose author is the configured recorder.
- S20 check_run PR preservation (`74ebffc`), S21 routing module (`b7254f8`), S22 documentation truth (`b5be3d0`).
- S04D lockfile layout (`0374d34`), S09A oracle (`5484670`), S03C4 placeholder rejection (`0f53822`), S11 backoff oracle (`5b47809`), S15 concurrency/durability policy (`7ee1c78`), S10 timeout oracle (`4ba3da9`), S09B write-failure handling (`ca6a9b0`) with a portable oracle (`2042df6`).

Baseline at close-out: `2042df6`, `bun test` 210 pass / 451 assertions across 17 files, `bun run typecheck` clean, `bun run build` emits `dist/server.js`, CI green on the pushed SHA.

Evidence class: local and synthetic process-level only. No runtime, deployment or human evidence exists — no live GitHub delivery, no OpenClaw Gateway, no Discord delivery, no deployed SHA, no restore/rollback drill, no human QA. Read every "works" claim with that class attached.

## Next queue

Two candidate rows were opened by this wave's findings. The first is now **done**:

1. **Persist-then-resolve** — completed as S21b (`76a27ed`): the request path persists the unrouted event and ACKs, routing moved into the drainer, `fetchItem` gained a 10 s timeout, and the ordering is proven with a held gate in front of a stubbed GitHub API. The routing path is now process-testable via `STACKOT_GITHUB_API_BASE`.
2. **Outbox-failure recovery or readiness failure** (from S09B, still open): after an outbox I/O failure the receiver keeps answering `/healthz` 200 and `/readyz` `ready` while every new delivery gets 503, because `ready()` is a plain `SELECT 1`. The row must make the receiver either reopen the database or fail readiness so a supervisor restarts it.

Then the remaining P1 local rows from `docs/atomic-completion.md`: S39 (redaction), S41 (health split), S42 (telemetry), S43 (metrics), S46 (backup), plus B01–B03. S37 is effectively satisfied by the committed scripts. S38's CI evidence exists for the current SHA but should be re-stated when S21-era routing lands in a release candidate.

## Observability and recovery bundle (S39, S41, S42, S43, S46) — closed

- S39 (`ea9087d`): configured secrets are masked in logs **and** in stored `last_error`; the leak was real (stderr showed `path: "…/<token>/repos/…"`).
- S41 (`991518d`): liveness / readiness / status split — a dead Gateway keeps intake accepting and shows up as `degraded` on `/status`, never as a readiness failure.
- S42 (`5fbb946`, ACCEPT after one narrowed retry): structured `delivery.*` and `routing.fallback` JSON lines correlated by delivery id; the retry backoff schedule moved to a single owner (`outbox.ts` `retryDelayMs`) with a drift assertion tying telemetry to the persisted `next_attempt_at`.
- S43 (`92d3716`): `Outbox.stats()` plus a periodic `queue.metrics` line and queue numbers on `/status`.
- S46 (`8b793b9`): consistent standalone snapshots via `VACUUM INTO`, with a CLI; the probe showed a naive file copy of the WAL-mode outbox yields a database that will not open.

Baseline at close-out: `4b56bf9`, `bun test` 271 pass / 939 assertions across 26 files, `bun run typecheck` clean, `bun run build` emits `dist/server.js`, CI green on the pushed SHA.

Still open from the findings of this wave: **outbox-failure recovery or readiness failure** (S09B) — after an induced outbox I/O failure the receiver keeps answering `/healthz` 200 and `/readyz` ready while new deliveries get 503, because `ready()` is a plain `SELECT 1`. The bundle did not fix it; `/status` now at least carries queue numbers but nothing detects an unwritable outbox.

## Remaining local rows

S38's CI evidence exists for the current SHA; the P1 rows still untouched are B01 (per-repo permission separation), B02 (per-repo concurrency cap), B03 (GitHub 429 Retry-After), B04 (alerting), B05 (status command), and the C-series. The deployment rows S44–S48 depend on a host and on the backup artifact just built.

## Wave 04 — closed local defects and P1 (S09Bb, B01, B03, B02)

- S09Bb (`2ff673f`): the top open defect from S09B is fixed. `Outbox` tracks its own writability, `ready()` proves write capability with `BEGIN IMMEDIATE` + `ROLLBACK` instead of a bare `SELECT 1`, `recover()` reopens and re-probes without throwing, and `/readyz` answers 503 while unwritable before attempting one bounded self-repair. Discrimination: the pre-fix receiver answered `200 "ready"` during the induced failure.
- B01 (`06d8c5c`): per-repo GitHub credentials. `repo-policy.ts` is the single authorization point (unconfigured repo denied before any network access, own token versus shared token recorded, grant bound to its repo), `repos[*].githubToken` is optional and validated, and repo tokens joined the redaction list. Discrimination: before the fix every request carried `Bearer shared-token`.
- B03 (`1a61861`): `githubFetch` honours `Retry-After` (delta-seconds and HTTP-date, capped, sequential, no burst) and `fetchItem` routes item, comment and paginated requests through it, with injectable sleep/clock. Discrimination: a 429 used to collapse the lookup to `null`, losing the backlink.
- B02 (`3d7bbf5`): `scheduler.ts` decides admission (global plus per-repo caps, least-in-flight-first with FIFO tie-break) and the drainer forwards concurrently with a candidate pool, in-flight id tracking and a pass that never exits with work running. Discrimination: three tests fail against the serial drainer, including the stalled-repo starvation case.

Baseline at close-out: `39fc797`, `bun test` **330 pass / 1159 assertions** across 30 files, `bun run typecheck` clean, `bun run build` emits `dist/server.js`, CI green on the pushed SHA. The suite now takes ~50 s, dominated by the S09Bb lock-induction tests.

Owner decision recorded: B01 and B02 sit behind S52 in the ledger's DAG, which is blocked on the runtime. They were implemented now because their content depends on no runtime evidence; their acceptance is against local oracles only.

## Remaining local work

- B04 (alerting) needs a delivery target and therefore a host; only the rule file could be authored locally, and a rule nobody can fire is not evidence.
- B05 (status command) and the C-series depend on the runtime surfaces (OpenClaw task state, review events).
- S38's CI evidence exists for the current SHA but should be re-stated for a release candidate once the runtime rows land.

## Wave 05 — S32 accepted, and the remaining rows are all environment-gated

- S32 (`19bf0e7`, retry `a91440f`): `verifier.ts` judges a worker's claim from the worktree rather than the report — observed changed files against the claimed scope, and a test command the verifier runs itself; a claimed pass with a failing command, a ghost file, an unclaimed change, a missing command, a timeout or an empty claim all reject, and `verified` requires observed passage. The module is deliberately not wired into a pipeline; the S30/S33 rows own that.
- CI found what local runs could not, again: the runner killed only the shell, so an orphaned child held the pipes open on Linux (and the new regression test now reproduces that on macOS too), and S21b's test had a latent race between the gateway hit and the `delivered` write. Both are fixed and verified on the runner (`a91440f` success).

Baseline: `a91440f`, `bun test` **344 pass / 1204 assertions** across 31 files, typecheck clean, CI green.

Remaining ledger rows and what each class needs (full enumeration in the wave-02 record):

- **Environment — OpenClaw/acpx (13 rows):** S23–S31 and S33–S36. S23 must freeze the real contract from the installed binaries before any adapter is written.
- **Host and deployment (5 rows):** S40, S44, S45, S47, S48.
- **Real GitHub and Discord surfaces plus a human approver (4 rows):** S49–S52.
- **Release and operations (8 rows):** B04–B11.
- **Post-release (4 rows):** C01–C04, explicitly not MVP-blocking.
- Also unset: the Discord guild ID and the backlink recorder's GitHub login (required config since S19), per-repo tokens if that posture is wanted, the hook token and webhook secret, and the host/DNS for the public endpoint.

## Blocked, with evidence

- M2–M4 (S23–S52) need the real runtime: `which openclaw acpx` finds neither binary, no process listens on 9377 or 18789, and no Discord app, GitHub webhook or host/DNS authority exists in this session. Caddy is installed but nothing else.
- Also unverified in this session: real GitHub webhook delivery, Discord delivery, CI on a deployed SHA, backup/restore drill, human QA. Never upgrade a synthetic or contract-level result to those classes.

## Operating notes for the next owner session

- `herdr agent start` reliably times out waiting for startup even though the real Devin process is running (six occurrences). Verify the pane's foreground argv and status instead of relaunching.
- Worker panes come from `herdr worktree create --no-focus`, which provisions a dedicated workspace and root pane at the checkout. `place-new-pane` was therefore not applied; that deviation is recorded in wave-02 for each row. Never focus or zoom those panes, and close only workspaces the owner created, after integration, once the worker is idle/done.
- Copy the accepted delta into the integration checkout and verify byte identity with md5 rather than trusting the worker, then re-run typecheck, the full suite and the build there.
- For every row, run the oracle against the pre-fix code in a disposable copy outside the candidate to prove the new tests discriminate; S17 and S18 records contain those results.
- Prefer an owner runtime proof (throwaway script driving the real receiver process with a stubbed dependency) whenever the row's property is about runtime behaviour rather than a pure function.
- Worker receipts are candidates. The receipt's own risk list is usually accurate and worth re-checking rather than copying.
