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

## S12 decision — ACCEPT after one narrowed retry

First candidate (worker receipt 1): scope correct (delivery.ts, delivery.test.ts, outbox.test.ts), owner re-ran the oracles at 13 focused / 102 full pass, but it branched in the drainer on `attempts >= MAX_DELIVERY_ATTEMPTS` to choose between `retry` and `fail`. Owner rejected that shape for three reasons: the exhaustion policy existed in two places, `delivery.ts` (a port-only module) imported the concrete `bun:sqlite`-backed `outbox.ts`, and `Outbox.fail`'s below-limit branch became unreachable from production. One narrowed retry was issued with an explicit owner override permitting the `retry` → `fail` re-pin in `delivery.test.ts`.

Corrected candidate — ACCEPT. Owner verified by reading the whole delta and re-running every oracle:

- `receiver/src/delivery.ts`: `DeliveryOutbox` is now `due`/`delivered`/`fail` only; the `MAX_DELIVERY_ATTEMPTS` import is gone; the catch path is unconditional — `const message = error instanceof Error ? error.message : String(error); this.outbox.fail(job.id, job.attempts + 1, message);`. The `{ ok: false }` branch throws `gateway rejected delivery (status ${result.status ?? "unknown"})`, so `last_error` carries the gateway status.
- `receiver/src/outbox.ts`: **unchanged**. `fail` remains the single owner of the policy (at/over `MAX_DELIVERY_ATTEMPTS` → `dead_letter` + `last_error`; below → `retry` with exponential backoff), and that below-limit branch is reachable again.
- `receiver/test/delivery.test.ts`: mocks dropped `retry`; below-limit rejection asserts `fail("d2", 3, "gateway rejected delivery …")`, a thrown error asserts `fail("d3", 1, "timeout")`, and both at-limit cases assert `fail(id, MAX, message)` with the status. The success case asserts `fail` is unreachable. No assertion was weakened; the `retry` re-pin was owner-authorized.
- `receiver/test/outbox.test.ts`: the end-to-end test drives a real `Outbox` + `DeliveryDrainer` with a permanently failing forwarder through `MAX_DELIVERY_ATTEMPTS` drains and asserts `dead_letter`, `attempts = MAX`, non-empty `last_error`, and `due() === null`. A new below-limit test asserts `fail(id, 1, "boom")` leaves the row `pending` with `attempts = 1`, `due()` null until `next_attempt_at` passes, then due again.
- Scope: `git status` in the task checkout showed exactly those three files; `outbox.ts`, `server.ts` and everything else untouched. HEAD unchanged at `db95b2a` — the worker did not commit.

Owner oracles in the task checkout: `bun run typecheck` clean, `bun test test/delivery.test.ts test/outbox.test.ts` 14 pass / 45 assertions, `bun test` 103 pass / 198 assertions across 12 files.

Owner integration: the three accepted files were copied verbatim into the completion checkout and verified byte-identical by md5 (three MATCH). Completion-side oracles: `bun run typecheck` clean, `bun test` 103 pass / 198 assertions, `bun run build` emits `dist/server.js` (18.85 KB).

Owner runtime proof (throwaway script, real receiver process, gateway stubbed to always answer 502): POST /webhook → `200 accepted`; the server's own drain recorded the first failure (`pending`, attempts 1, `last_error` null, gateway hit 1); after forcing `attempts = 4` the next real drain failure produced `state = dead_letter`, `attempts = 5`, `last_error = "gateway rejected delivery (status 502)"` (gateway hit 2); `due()` returned null afterwards, so retries stop for good. This closes the row's completion condition ("한도 후 재시도 멈춤") in the running process, not only in unit tests.

Residual risks carried forward, none blocking this row: no non-Error throw message quality test; `(status unknown)` when the forwarder omits a status; and the redelivery boundary below.

## S12 boundary that remains open (owner decision pending)

A GitHub redelivery whose delivery ID is already `dead_letter` is still answered `200 duplicate` and nothing is requeued, because `outbox.has(id)` is state-agnostic. Owner reproduced this against a real receiver process before the fix: seeded `dead_letter` row (attempts 5) → redelivery answered `200 "duplicate"` → row unchanged, no retry, no recovery. S13 (replay CLI) is the recovery path for this; whether `server.ts` should also auto-requeue a redelivered dead-letter ID is a separate owner decision and is deliberately not bundled into S13.

Worker lifecycle: the S12 worker settled `done` and its pane `w5N:p1` is idle in workspace `w5N` (label `stackot-s12`). The pane and the task worktree are retained until the S13 bootstrap copies from this integrated baseline.

## Retro acceptance record for the unrecorded wave (S05A–S14)

The previous owner wave integrated this block without leaving a decision record, so the owner reconstructed it at baseline `db95b2a` by reading the source and tests and re-running the suite: `bun test` 99 pass / 0 fail / 181 assertions across 12 files, `bun run typecheck`, `bun run build`, plus CI run `35579247524` on that SHA. Rows below are marked ACCEPT (oracle met as written), ACCEPT-WITH-GAP (behaviour present, the row's named oracle is missing or narrower than the claim), or NOT DONE. No row is accepted on the strength of a file merely existing.

| Row | Decision | Basis |
|---|---|---|
| S03C4 | NOT DONE | `config.ts` validates `openclawHookSecret`/`openclawHookToken`/`githubToken`/`ciAlertsChannelId`/`adminChannelId` placeholders, but `repos[*].issuesForumChannelId` and `prsForumChannelId` accept `<PLACEHOLDER>` unchanged. Branches `s03c4a`/`s03c4b` exist at the baseline with no delta and no decision. |
| S04A/B/C | ACCEPT | `receiver/package.json` scripts `test`, `typecheck`, `build`; all three re-run by the owner and by CI. `receiver/dist/` is ignored so the build does not dirty the tree. |
| S04D | NOT DONE | `receiver/bun.lock` is gitignored; a disposable-copy probe shows `bun install --frozen-lockfile` in `receiver/` succeeds with no lockfile by resolving fresh (`@types/bun@1.4.2`, `typescript@7.0.2`). Reproducibility is not established. |
| S05A | ACCEPT | `ingress.requireDeliveryId` returns the id verbatim and rejects missing/blank; four helper cases in `test/ingress.test.ts`. |
| S05B | ACCEPT | `test/server.delivery.integration.test.ts`: missing and whitespace-only header → 400 with zero outbox rows. |
| S06 | ACCEPT | `test/server.malformed.integration.test.ts`: malformed body → 400, then a valid body with the same delivery ID → 200 `accepted` and exactly one `pending` row, so the ID was not reserved. |
| S07 | ACCEPT (wave-01 REJECT superseded) | `server.ts` rejects a missing/non-string/blank `repository.full_name` before dedupe, and `test/server.repository.integration.test.ts` drives three invalid shapes through a real child process to 400 with zero rows. wave-01 recorded S07 as REJECTED and required re-specification from a fresh worktree; that partial candidate no longer exists, and the required shape gate plus child-process test are now present and pass. |
| S08A | ACCEPT | `readBodyWithinLimit` enforces the limit during streaming (a chunk that would exceed it fails immediately) and its tests cover the exact-limit boundary, the overrun case and the invalid-`maxBytes` guard. It still buffers the accepted body in memory, which is bounded by the 1 MiB limit. |
| S08B | ACCEPT | `test/server.size.integration.test.ts`: 1 048 577-byte signed body → 413 and zero outbox rows. |
| S09A | ACCEPT-WITH-GAP | Behaviour holds: `server.ts` returns 200 only after a synchronous `enqueue` commit, and the restart test observes the `pending` row before the ACK is acted on. The row's named oracle `test/server.outbox.integration.test.ts` does not exist, so the row is not literally proven by the file it names. |
| S10 | ACCEPT-WITH-GAP | `forwardToGateway` gained `signal: AbortSignal.timeout(10_000)`. There is no hanging-gateway timeout test: `test/gateway.test.ts` only covers message framing, the idempotency key and the bearer header. |
| S11 | ACCEPT-WITH-GAP | `DeliveryDrainer` drains due rows, keeps one in-flight drain at a time, and calls `retry` with `attempts + 1`; `outbox.retry` applies exponential backoff capped at 60 s. Gaps: no fake-clock test of the backoff schedule, and the exhaustion path is not wired (see the S12 envelope note) — so a permanently failing delivery retries forever at 60 s. |
| S12 | row satisfied literally, system property not met | The outbox side and its tests already exist (`outbox.fail` writes `dead_letter` + `last_error`; `test/outbox.test.ts` covers the fifth-failure case, the `last_error` migration and `requeue`). Because nothing calls `fail`, the row's completion condition ("한도 후 재시도 멈춤") is still false end to end. This is exactly what the wave-02 S12 launch now closes. |
| S14 | ACCEPT | `test/server.restart.integration.test.ts`: first delivery 502 → row stays `pending` with attempts 1 → process restart → re-delivery succeeds and the row becomes `delivered`, with the gateway receiving the same `stackot-<deliveryId>` idempotency key twice. |

Consequence for milestone M1: S03C4, S04D, S13, S17–S22 remain, and S07/S03C4 have no surviving candidate, so those rows must run as fresh tasks. S09A and S10 need their named oracles before M1 can be called closed.
