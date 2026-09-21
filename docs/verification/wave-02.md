# Wave 02 launch contract and decisions

Owner: current Codex/Astra thread. Baseline for this wave: `db95b2a` (branch `codex/stackot-completion-20260921`, pushed to origin).

## Baseline release record

- `814cf2c` — receiver reliability work + `.github/workflows/ci.yml`.
- `db95b2a` — atomic completion ledger, wave-01 decisions, owner re-check addendum.
- Push: `codex/stackot-completion-20260921` → `origin` (first push; branch previously had no remote).
- CI: run `35579247524` (`receiver-ci`, push event) concluded **success** on head SHA `db95b2a1cd700baef9afaf29e8e22c3a5675d830`. Steps: frozen install, typecheck, test, build.
- Caveat for S38: this proves the workflow runs and passes on that SHA. It does not yet satisfy S38's predecessor set (S21 router absent) and the install is still not lockfile-pinned — `receiver/bun.lock` remains gitignored, so `--frozen-lockfile` resolves fresh each run (owner probe: succeeds, resolving `@types/bun@1.4.2`, `typescript@7.0.2`). S04D stays open.

## Pre-wave discovery: leftover task branches locate the previous wave's interruption point

`git for-each-ref refs/heads` shows 23 `codex/stackot-s*` branches, every one at `1259895` (zero committed work): s01, s02, s03a, s03b, s03c1, s03c2, s03c3, s03c4a, s03c4b, s04a, s04b, s04c, s05a, s05b, s06, s07, s08a, s08b, s09a, s10, s11, s12, s16, s17.

Inference from that set plus the code already in the completion checkout: the previous owner wave created task worktrees for S05A–S11 (their deltas are present and tested) and then stopped at S12 — its branch was created but no delta exists anywhere. The s03c4a/s03c4b pair is the exception: those branches exist and `receiver/src/config.ts` has no repo-forum-channel placeholder check, so S03C4 was launched but never integrated or rejected (no decision record survives). Branches are retained as-is; they are pointers at the baseline, not candidates.

## S12 launch contract — dead-letter wiring

Owner scope envelope decision: ledger row S12 nominates `outbox.ts` + `outbox.test.ts`, but its oracle ("한도 후 재시도 멈춤") is unreachable while the drainer never calls `outbox.fail`. The accepted envelope therefore also covers `delivery.ts` + `delivery.test.ts` for the port and the call site. No `server.ts` change, no schema or column addition.

Task checkout: `/Users/justn/dev/.worktrees/stackot-s12-20260921` on `codex/stackot-s12-20260921`, fast-forwarded from `1259895` to baseline `db95b2a` before launch (the branch pre-existed with no unique commits, so `merge --ff-only` preserved everything).

Launch prompt: `docs/verification/s12-launch.txt` inside the task checkout.

Route evidence: foreground argv read from the process table immediately after launch —
`devin --model swe-2 --permission-mode dangerous --prompt-file /Users/justn/dev/.worktrees/stackot-s12-20260921/docs/verification/s12-launch.txt` (pid 65835), pane footer `SWE-2 High`. Exactly one worker was launched; no fallback model.

Readiness: `herdr agent start` timed out waiting for agent startup although the real Devin process was running and later reported `working` — same behaviour recorded for S01. The owner did not relaunch or change the model, and manages the exact pane `w5N:p1`.

Placement record — deviation, documented: the worktree was created with `herdr worktree create --cwd /Users/justn/dev/stackot --base db95b2a --path /Users/justn/dev/.worktrees/stackot-s12-20260921 --label stackot-s12 --no-focus --trust-repository`, which provisioned workspace `w5N` (label `stackot-s12`) with root pane `w5N:p1` already rooted at the task checkout. `place-new-pane` was therefore not applied: Herdr supplied the pane, no caller-tab split was made, the protected `dev/lobby` surface was untouched, and nothing was focused. The caller pane `w5E:p1` remains the owner pane.

Status: launched; acceptance pending.
