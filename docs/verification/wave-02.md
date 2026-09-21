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
