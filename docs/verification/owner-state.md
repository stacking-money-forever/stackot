# Owner continuation state

Last updated 2026-09-21 (after S12, S13, S17, S18 accepted; S19 in flight).

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
