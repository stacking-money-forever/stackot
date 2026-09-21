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

## Accepted in this session

- Baseline release: `814cf2c` (receiver reliability work + CI), `db95b2a` (ledger and owner re-check). CI runs `35579247524`, `35580391739` and later runs are green on their head SHAs.
- S12 dead-letter wiring (`57be0b6`): `DeliveryDrainer` reports failure through the single port method `fail(id, attempts, message)`; `Outbox.fail` owns the exhaustion policy. Owner runtime proof: below-limit failure stays `pending` with attempts 1; at the limit the row becomes `dead_letter` with `last_error = "gateway rejected delivery (status 502)"` and `due()` returns null.
- S13 manual replay (`47df399`): `receiver/src/replay.ts` plus CLI. Owner runtime proof: a dead-lettered row recovered by the CLI became `pending` with attempts preserved and was then delivered by the running drainer with a stable idempotency key. Owner decision: redelivery of a dead-letter id stays `200 duplicate`; the CLI is the recovery path (closed, see wave-02).
- S17 reverse-link comments surface (`49e1d94`): PR discussion comments are read from the issues surface. Two of the new mapping tests fail against the previous code.
- S18 comment pagination (`f1be5f5`): follows `Link rel="next"`, stops early on a hit, bounded by `MAX_COMMENT_PAGES` (10). Two of the new mapping tests fail against the previous code.
- S19 backlink trust (`bfefe5a`, ACCEPT after one narrowed retry): `findThreadId` requires trust inputs, only a link whose guild equals `discordGuildId` and whose text was written by `githubBacklinkLogin` counts, the unauthenticated fallback is deleted, and the two keys are required config that fails startup when missing or placeholder. Ten of the new mapping assertions fail against the previous implementation; the config guard was also checked against the real server process.
- Retro record for the unrecorded wave (S05A–S14) with per-row ACCEPT / ACCEPT-WITH-GAP / NOT DONE in wave-02. S09A and S10 carry ACCEPT-WITH-GAP because their named oracles are absent.
- Test baseline after S19: `bun test` 151 pass / 290 assertions across 14 files, `bun run typecheck` clean, `bun run build` emits `dist/server.js`.

## Next queue after S19

1. M1 close-out: S20 (check_run PR destination), S21 (`router.ts` destination decision), S22 (spec/deploy docs claiming unimplemented `check_suite`/`push`/`release`), plus the missing named oracles for S09A and S10.
2. S03C4 (repo forum channel placeholder validation) — no surviving candidate, must run as a fresh row.
3. S04D + S38 (lockfile location, CI reproducibility): `receiver/bun.lock` is gitignored, so `bun install --frozen-lockfile` in CI resolves fresh on every run.
4. S15 (SQLite busy/durability), S39 (redaction), S41 (health split), S42 (telemetry), S43 (metrics), S46 (backup).
5. Candidate row suggested by S17: let the receiver take a GitHub API base from configuration so a disposable environment can point mapping lookups at a stub and the mapping path becomes process-testable.

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
