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

## S13 launch contract — dead-letter manual replay

Baseline: `eb0dba7` (S12 integrated and pushed; CI run `35580391739` success on that SHA).

Task checkout: `/Users/justn/dev/.worktrees/stackot-s13-20260921` on new branch `codex/stackot-s13-20260921`, created with `herdr worktree create --base eb0dba7 --label stackot-s13 --no-focus --trust-repository`, which provisioned workspace `w5P` with root pane `w5P:p1` rooted at the checkout (same placement deviation as S12: Herdr supplied the pane, no caller-tab split, no focus change).

Launch prompt: `docs/verification/s13-launch.txt`, committed into the baseline so the checkout already contains it.

Route evidence: foreground argv read from the process table after launch —
`devin --model swe-2 --permission-mode dangerous --prompt-file /Users/justn/dev/.worktrees/stackot-s13-20260921/docs/verification/s13-launch.txt` (pid 8476), pane footer `SWE-2 High`. Exactly one worker; no fallback model. `herdr agent start` again timed out waiting for startup while the real process ran, and the owner did not relaunch it (third occurrence of this Herdr behaviour: S01, S12, S13).

Scope: `receiver/src/replay.ts` + `receiver/test/replay.test.ts` (new), plus at most one `receiver/package.json` script line. `server.ts`, `outbox.ts` and every existing test are out of scope. The prompt forbids weakening existing tests and requires the receipt to document that a redelivered dead-letter id is still answered `200 duplicate` by design, with the replay CLI as the operator recovery path.

Predecessor evidence reused: the owner reproduction against a real receiver process showing the redelivery gap (`200 "duplicate"`, row unchanged) is recorded in the S12 boundary section above.

## S13 decision — ACCEPT, no retry needed

Worker candidate: `receiver/src/replay.ts` (new) and `receiver/test/replay.test.ts` (new); `receiver/package.json` deliberately unchanged because `bun src/replay.ts <id>` runs the file directly. `git status` in the task checkout showed only those two new files; HEAD unchanged at `eb0dba7` — the worker did not commit. The worker ran one `bun install` inside the checkout (no `node_modules` existed) and reported that it resolved from the Bun cache at the same versions the wave-02 record pins.

Owner verified by reading both files and re-running every oracle:

- `replayDelivery(outbox, id)` composes only existing primitives: `outbox.has(id)` distinguishes a missing id, then `outbox.requeue(id)` performs the transition, so `outbox.ts` and the schema are untouched. Results are `resumed` / `not_found` / `not_dead_letter`.
- The CLI runs under `import.meta.main`, reads `STACKOT_OUTBOX_PATH` with the same default as `server.ts`, prints one operator-readable line, and sets exit code 0 on resume, 1 when the id is not a replay target, 2 on usage error.
- Tests assert observable behaviour, not implementation shape: resume of one exact id with `attempts` preserved and `next_attempt_at <= now`; a second replay returns `not_dead_letter` and leaves the row byte-identical (`SELECT *` comparison); another dead-letter row and a delivered row stay untouched; and a real child process runs the CLI to check exit codes, stdout, and resulting DB state for the resume, repeat, missing-id and delivered-id cases.
- Owner oracles in the task checkout: `bun run typecheck` clean, `bun test test/replay.test.ts` 4 pass / 22 assertions, `bun test` 107 pass / 220 assertions across 13 files (S12 left it at 103).

Owner integration: both files copied verbatim into the completion checkout and verified byte-identical by md5 (two MATCH). Completion-side oracles: `bun run typecheck` clean, `bun test` 107 pass / 220 assertions, `bun run build` emits `dist/server.js`.

Owner runtime proof (throwaway script, real receiver process, gateway stubbed to fail with 502 until flipped): POST /webhook → `200 accepted`; the server drain drove the row to `dead_letter` (`attempts = 5`, `last_error = "gateway rejected delivery (status 502)"`); then `bun src/replay.ts s13-runtime-proof` exited `0` with stdout `replayed s13-runtime-proof: dead_letter -> pending`, leaving the row `pending` with `attempts = 5` preserved and `last_error` cleared; with the gateway healthy again the running drainer delivered it, ending at `state = delivered` with the gateway receiving the same `stackot-s13-runtime-proof` idempotency key on every attempt. So the manual recovery path leads all the way to delivery in the live process, not only in unit tests.

Residual risks accepted with the row (from the worker receipt, all re-checked by the owner as accurate):

- `has` followed by `requeue` is not atomic; the only deletion path in the outbox is the delivered-row TTL sweep, and dead-letter rows are never deleted, so the window is not reachable in practice.
- Exit code 2 for a usage error is beyond the contract but keeps it distinguishable from "not a replay target".
- `requeue` clears `last_error` (pre-existing behaviour), so an operator must read the row before replaying if the cause matters.
- The CLI creates the outbox file when `STACKOT_OUTBOX_PATH` points somewhere empty, so a mistyped path yields a new empty outbox and `not_found` instead of an error.
- A GitHub redelivery of a dead-lettered ID is still `200 duplicate`; the replay CLI is the documented operator recovery path. Changing `server.ts` dedupe remains an open owner decision, not part of this row.

Worker lifecycle: the S13 worker settled `idle` with its receipt written; its workspace `w5P` (label `stackot-s13`) was closed after integration, and the task worktree `/Users/justn/dev/.worktrees/stackot-s13-20260921` is retained.

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

Consequence for milestone M1: S03C4, S04D, S15, S20–S22 remain, and S07/S03C4 have no surviving candidate, so those rows must run as fresh tasks. S09A and S10 need their named oracles before M1 can be called closed. S17–S19 are accepted (see their decision sections below).

## S13 boundary — owner decision closed: CLI-only recovery

Owner decision (2026-09-21, after S13 ACCEPT): a GitHub redelivery whose delivery ID is already `dead_letter` stays answered `200 duplicate` and is **not** auto-requeued. The replay CLI is the documented operator recovery path, because a dead-lettered row means the Gateway rejected the event through its full retry budget, and silently re-arming it from an inbound header would let any replayed request drive delivery attempts. Removing that boundary later requires a separate row with its own oracle; it is not an implied extension of S12/S13.

Operator procedure recorded for the runbook work: `cd receiver && STACKOT_OUTBOX_PATH=<outbox path> bun src/replay.ts <delivery-id>` → exit 0 and `replayed <id>: dead_letter -> pending`; exit 1 means the ID is not a replay target (missing, pending or already delivered); exit 2 means the argument was missing.

## S17 launch contract — PR general-comment backlink lookup

Baseline: `0365a32`.

Row: `mapping.ts` + `mapping.test.ts`. Completion condition: a backlink recorded in a pull request's **general discussion comment** is resolved, not only one recorded in a review comment. Failure trigger: only the review-comment surface is searched.

Defect the owner confirmed by reading the source: `server.ts` resolves follow-ups with `fetchItem(cfg, ev.repo, kind, number)` where `kind` is `"issues"` or `"pulls"`, and `fetchItem` requests `${base}/${kind}/${number}/comments`. For a pull request that is the *review comment* surface (`/pulls/{n}/comments`), so a Discord thread URL the bot records as an ordinary PR comment is never found and the event falls through to the admin channel.

Envelope (owner decision): the row's own scope is `mapping.ts` + `mapping.test.ts`. To make the row's oracle — a fetch URL contract test — actually expressible, `fetchItem` may gain an optional options argument carrying an API base that defaults to `https://api.github.com`, so a test can point it at a local stub server instead of reaching the network or monkey-patching global `fetch`. No `server.ts` change is expected: `resolveTarget` already passes the kind, and only the URLs `fetchItem` builds change.

Required behaviour for the worker: the general-discussion comments are read from the issues comments surface for pull requests as well as issues, while the item body still comes from the surface that carries it. The owner will reject a candidate that "fixes" this by fetching both comment surfaces and merging them without a stated reason, or that weakens the existing `findThreadId` semantics.

Status: launched 2026-09-21 from baseline `00f5fb2`. Task checkout `/Users/justn/dev/.worktrees/stackot-s17-20260921` on the pre-existing empty row branch `codex/stackot-s17-20260921`, fast-forwarded from `1259895` to the baseline before launch. `herdr worktree create --label stackot-s17 --no-focus` provisioned workspace `w5Q` with root pane `w5Q:p1` rooted at the checkout (same documented placement deviation as S12/S13). Foreground argv verified from the process table: `devin --model swe-2 --permission-mode dangerous --prompt-file …/s17-launch.txt` (pid 80512), pane footer `SWE-2 High`, exactly one worker. `herdr agent start` again timed out waiting for startup while the real process ran; no relaunch, no model change (fourth occurrence: S01, S12, S13, S17).

### S17 decision — ACCEPT, no retry needed

Candidate: `receiver/src/mapping.ts` modified, `receiver/test/mapping.test.ts` new; nothing else changed, HEAD unchanged at `00f5fb2` — the worker did not commit. The delta is seven lines of behaviour: `const commentsKind = kind === "pulls" ? "issues" : kind;` feeds the comments request while the item body still comes from `${kind}/${number}`, plus an optional `opts: { apiBase?: string } = {}` seam defaulting to `https://api.github.com`. No `server.ts` change was needed, as the contract predicted.

Owner oracles in the task checkout: `bun run typecheck` clean, `bun test test/mapping.test.ts` 4 pass / 14 assertions, `bun test` 111 pass / 234 assertions across 14 files (S13 left it at 107).

Oracle discrimination check (owner, disposable copy outside the candidate): reverting only `commentsKind` to the previous `${kind}` makes 2 of the 4 mapping tests fail — the URL-contract test and the PR discussion-comment resolution test — so the new oracle genuinely detects the defect it was written for rather than passing vacuously.

Test quality: a local `Bun.serve` stub records every request, so the test asserts observed paths (PR comments from `/issues/{n}/comments` with `per_page=20`, never `/pulls/{n}/comments`), the resolved thread id, the issue-path regression, and the bearer header on each request. No global `fetch` patching and no live network.

Owner integration: both files copied verbatim into the completion checkout and verified byte-identical by md5 (two MATCH). Completion-side oracles: typecheck clean, 111 pass / 234 assertions, `bun run build` emits `dist/server.js` (18.95 KB).

Residual risk accepted with the row: this lookup is verified at contract level (evidence class S) only. `server.ts` calls `fetchItem` without an `apiBase`, so the running receiver always talks to the live GitHub API, which means an end-to-end proof of reverse-link routing needs real GitHub credentials — the same boundary as S49. A candidate follow-up row (not part of S17) is to let the receiver take an API base from configuration so a disposable integration environment can point it at a stub; that would also make the mapping path testable at the process level.

Worker lifecycle: the S17 worker settled `idle` after writing its receipt; workspace `w5Q` (label `stackot-s17`) was closed after integration and the task worktree is retained.

## S18 launch contract — reverse-link comment pagination

Baseline: `360350f` (S17 integrated; CI run success on that SHA).

Row: `mapping.ts` + `mapping.test.ts`. Completion condition: a backlink recorded beyond the first comment page is still resolved. Failure trigger: only the first 20 comments are read.

Defect the owner confirmed by reading the source: `fetchItem` requests `…/comments?per_page=20` exactly once and never follows the `Link: rel="next"` chain, so on an issue or PR with more than 20 comments a thread URL on a later page is missed and the event falls through to the admin channel.

Owner envelope: pagination follows the server-provided `Link` `rel="next"` URL rather than guessing a `page` parameter; it stops as soon as a thread URL is found; it has an exported hard page cap (default 10) that is injectable through the same options object so the cap is testable without a ten-page fixture; `per_page=20`, the S17 comments-surface rule and `findThreadId` semantics are unchanged, so no S17 assertion needs re-pinning.

Task checkout: `/Users/justn/dev/.worktrees/stackot-s18-20260921`, branch `codex/stackot-s18-20260921`, created from the baseline with `herdr worktree create --label stackot-s18 --no-focus --trust-repository` (workspace `w5S`, root pane `w5S:p1`, owner read back from the create result rather than predicted). Launch prompt: `docs/verification/s18-launch.txt`, committed into the baseline so the checkout contains it.

Status: launched 2026-09-21 from baseline `7bd0a3c`. Foreground argv verified from the process table: `devin --model swe-2 --permission-mode dangerous --prompt-file …/s18-launch.txt` (pid 15413), pane footer `SWE-2 High`, exactly one worker, no fallback model. `herdr agent start` again timed out waiting for startup while the real process ran; no relaunch (fifth occurrence: S01, S12, S13, S17, S18). One worker policy holds: the S17 workspace was already closed before this launch.

### S18 decision — ACCEPT, no retry needed

Candidate: `receiver/src/mapping.ts` (+30/-3) and `receiver/test/mapping.test.ts` (+94/-6); nothing else changed, HEAD unchanged at `7bd0a3c`. The worker ran one `bun install` (cached, no new packages) because the checkout had no `node_modules`.

Owner verified by reading the delta and re-running every oracle. Implementation: an exported `MAX_COMMENT_PAGES = 10`; a `nextPageUrl` helper that splits the `Link` header and returns the `rel="next"` URL verbatim; `opts.maxCommentPages` injection; and a loop `for (let pages = 1; next && pages < maxPages && !findThreadId(result); pages++)` that fetches the next page, appends its comments, breaks on a non-ok page, and re-reads the new `Link` header. The item and page-1 requests are unchanged, `commentsKind` (issues surface for PRs) is unchanged, and `server.ts` still needs no change.

Owner oracles in the task checkout: `bun run typecheck` clean, `bun test test/mapping.test.ts` 8 pass / 27 assertions, `bun test` 115 pass / 247 assertions across 14 files (S17 left it at 111).

Oracle discrimination check (owner, disposable copy outside the candidate): deleting only the pagination loop makes 2 of the 8 mapping tests fail — later-page recovery and the cap test — so the new tests fail against the pre-fix behaviour rather than passing vacuously.

Test quality: the stub now accepts either a JSON body or a handler that can emit `Link` headers; the later-page test advertises an opaque `cursor=opaque-page-2` next URL (proving the server URL is used verbatim instead of a guessed `page` parameter) and asserts the exact query strings and bearer token per request; early termination is proven by exactly one comment request when page 1 already carries the thread URL; the cap test asserts exactly `maxCommentPages` requests; and the no-`Link` case asserts a single request.

Owner integration: both files copied verbatim and md5-verified (two MATCH). Completion-side oracles: typecheck clean, 115 pass / 247 assertions, `bun run build` emits `dist/server.js` (19.63 KB).

Residual risks accepted with the row (from the receipt, re-checked as accurate): a thread URL beyond the tenth page is still missed, now bounded by design rather than by accident; `maxCommentPages` below 1 cannot go below the single inherent first-page request; a failing page ≥2 truncates the collected comments silently (consistent with the pre-existing treatment); and the row remains contract-level evidence (S) because `server.ts` still talks to the live GitHub API.

Worker lifecycle: the S18 worker settled `idle` after writing its receipt; workspace `w5S` (label `stackot-s18`) was closed after integration and the task worktree is retained.

## S19 launch contract — reverse-link trust verification

Baseline: `f1be5f5` (S18 integrated). Task checkout `/Users/justn/dev/.worktrees/stackot-s19-20260921`, branch `codex/stackot-s19-20260921`, created with `herdr worktree create --label stackot-s19 --no-focus --trust-repository`; the workspace and pane IDs are read back from the create result rather than predicted.

Row: `mapping.ts` + `mapping.test.ts`, completion condition "임의 댓글 링크 거부" (an arbitrary comment's link must not steer routing), failure trigger "다른 길드로 라우팅".

Owner envelope decision, wider than the row's nominal scope and justified the same way as S12's: the guard is only real if the expected guild and backlink author reach the lookup, so the row also covers `config.ts`, `config.test.ts`, `config.example.json`, the `resolveTarget` call site in `server.ts`, and **config-fixture-only** edits in `test/server.*.integration.test.ts`. Owner confirmed by inspection that five integration suites and the `config.test.ts` base fixture construct config JSON inline; adding two required keys without updating them would fail startup and break the whole suite. Fixture edits are limited to adding the new keys — no assertion or scenario change. Out of scope: `outbox.ts`, `delivery.ts`, `replay.ts`, `ingress.ts`, `package.json`, `.github/`.

Two required keys are the owner's design choice over making them optional: `discordGuildId` and `githubBacklinkLogin`. The receiver has never been deployed, so fail-fast on a missing key costs nothing today, and an optional key that silently degrades to "no backlink is trusted" would push every follow-up event to the admin channel without any startup signal. Both keys are validated like the existing ones (non-blank, no `<...>` placeholder, shape-checked) and `config.example.json` is updated. The real values are boundary-E user assets and are not part of this row.

Status: launched 2026-09-21 from baseline `bd00c9e`. `herdr worktree create --label stackot-s19 --no-focus` provisioned workspace `w5T` with root pane `w5T:p1` at the checkout. Foreground argv verified from the process table: `devin --model swe-2 --permission-mode dangerous --prompt-file …/s19-launch.txt` (pid 60724), pane footer `SWE-2 High`, exactly one worker, no fallback model. `herdr agent start` again timed out waiting for startup while the real process ran; no relaunch (sixth occurrence). The S18 workspace was closed before this launch, so the one-worker policy holds.

### S19 decision — ACCEPT after one narrowed retry

First candidate: functionally complete and in scope (12 files: `config.ts`, `config.example.json`, `mapping.ts`, `server.ts`, five integration fixtures, `config.test.ts`, `mapping.test.ts`), owner oracles green, and the trust cases matched the contract. Owner nevertheless rejected one shape: `findThreadId(item, trust?)` made trust optional and kept a `THREAD_URL_RE` unauthenticated fallback for older call sites, so the insecure behaviour remained the function's default. One narrowed retry was issued to make trust required, delete the fallback path and its pattern, and let `normalize.test.ts` (owner-added to the envelope for that single test) pass trust while preserving its body-before-comments intent.

Corrected candidate — ACCEPT. Owner verified by reading the delta and re-running every oracle:

- `mapping.ts`: `findThreadId(item: GitHubItem, trust: BacklinkTrust)` requires trust; `THREAD_URL_RE` is deleted and no code path reaches an unauthenticated scan. The guild segment must match `trust.discordGuildId` exactly (the pattern is built from the configured value), and `isRecorder` compares `user.login` with `githubBacklinkLogin` case-insensitively. Text order is unchanged (body first, then comments), so the earliest *trusted* link wins.
- `mapping.ts` `fetchItem`: `GitHubItem` now carries `author` for the body and for each comment, mapped from GitHub's `user.login` (absent → `null`), including every paginated page; the pagination loop's early-stop check is trust-aware.
- `config.ts`: `discordGuildId` must be a non-blank, non-placeholder `^\d+$` string; `githubBacklinkLogin` must be a non-blank, non-placeholder GitHub login (`[A-Za-z0-9][A-Za-z0-9_-]{0,38}` with optional `[bot]` suffix). Both are required keys. `config.example.json` documents them and the five integration fixtures carry synthetic values.
- `server.ts`: the only change is `findThreadId(item, cfg)`.
- Tests: recorder-authored comment and body links resolve; foreign-guild links, non-recorder authors, recorder-authored links in another guild, and unknown authors are all rejected; a forged link before a valid one is skipped in favour of the valid one; the recorder login matches case-insensitively; and the S17/S18 path, pagination, early-stop and cap assertions still pass unchanged. `config.test.ts` adds rejection cases for both new keys.

Owner oracles in the task checkout: `bun run typecheck` clean, `bun test test/mapping.test.ts test/config.test.ts test/normalize.test.ts` 113 pass / 174 assertions, `bun test` **151 pass / 290 assertions** across 14 files (S18 left it at 115).

Oracle discrimination check (owner, disposable copy outside the candidate): running the new `mapping.test.ts` against the S18 `mapping.ts` fails 10 of 19 assertions — the pre-S19 code accepts the forged links these tests exist to reject.

Owner runtime check of the new config guard (throwaway configs, real `bun src/server.ts`): a config without `discordGuildId` exits 1 with `config missing: discordGuildId (non-empty numeric string required)`, and a `<GUILD_ID>` placeholder exits 1 with `config invalid: discordGuildId is an angle-bracket placeholder; set the real guild ID`. So the guard fails fast at startup rather than degrading silently.

Owner integration: all 12 files copied verbatim and md5-verified (12 MATCH). Completion-side oracles: typecheck clean, 151 pass / 290 assertions, `bun run build` emits `dist/server.js` (21.26 KB).

Residual risks carried with the row: the real `discordGuildId` and `githubBacklinkLogin` values are boundary-E user assets and are still unset anywhere; an issue or PR whose author and comment authors are all unknown resolves to no thread (correct, but it means routing depends on the API returning `user.login`); a thread URL recorded by a *different* repository's bot account would be rejected, so a second recorder account would need its own row; and the mapping path stays contract-level evidence (S) because `server.ts` still calls the live GitHub API.

Worker lifecycle: the S19 worker settled `done` after the retry; workspace `w5T` (label `stackot-s19`) was closed after integration and the task worktree is retained. D3 (S17–S19) is therefore complete at contract level; the live end-to-end claim still depends on the blocked runtime rows.

One process note for future owners: the first S19 turn spent a long time exploring without editing, and the steering message submitted while it was working sat queued in the Devin TUI (Herdr reported the pane `idle` while a message waited for Enter). `herdr agent send-keys <pane> enter` delivered it and the worker resumed. Treat a Herdr `idle` on a worker pane as "awaiting input" until the pane text is checked.

## S20 launch contract — preserve the linked PR on check_run

Baseline: `537c0d0` (S19 integrated). Task checkout `/Users/justn/dev/.worktrees/stackot-s20-20260921`, branch `codex/stackot-s20-20260921`, created with `herdr worktree create --label stackot-s20 --no-focus --trust-repository`; workspace and pane IDs are read back from the create result.

Row: `normalize.ts` + new `routing.test.ts`, with `normalize.test.ts` limited to strengthening its existing check_run/PR cases. Completion condition: the CI event keeps the PR id and the CI identity. Failure trigger: the CI channel is the only thing the event can reach.

Defect the owner confirmed by reading the source: `CheckRunPayload` ignores `check_run.pull_requests`, and `NormalizedEvent` has no PR field, so a failed check leaves only `item: "CI <name>"`. spec.md line 104 requires "CI 실패 → PR 스레드 답글 + #ci-alerts 알림", which needs the PR identity to survive normalization — that routing decision is S21's, so S20 is deliberately data-only.

Owner envelope: `NormalizedEvent` gains an optional `prNumbers?: number[]` set only by the check_run branch (every other branch stays untouched), numbers are order-preserving and deduplicated with non-finite/zero/negative/fractional/missing entries dropped silently, and the CI summary gains a `PR #<n>` reference when one exists so the identity is visible to both the agent and a human reader. Existing check_run gating (completed only, failure conclusions only, channel target, `CI <name>` item) must not change. `server.ts`, `gateway.ts`, `mapping.ts` and `config.ts` stay out of scope — the routing change is S21.

Status: contract written; launch follows.

### S20 decision — ACCEPT, no retry needed

Candidate: `receiver/src/normalize.ts` (+20/-2), `receiver/test/normalize.test.ts` (+18), new `receiver/test/routing.test.ts` (10 tests); nothing else changed, HEAD unchanged at `6139bb9`, no commit by the worker. It ran the permitted single cached `bun install`.

Owner verified by reading the delta and re-running every oracle. `NormalizedEvent` gains optional `prNumbers?: number[]`; `CheckRunPayload.check_run` gains `pull_requests?: { number?: unknown }[]`; the failure branch collects entries where `typeof n === "number" && Number.isInteger(n) && n > 0`, dedupes in first-seen order, sets `prNumbers` only when non-empty, and adds a `연결 PR: PR #12, PR #34` summary line. The existing guards are byte-identical: `action !== "completed"` → null, missing/success/skipped/neutral conclusion → null, otherwise `target: ""`, `targetKind: "channel"`, `item: "CI <name>"`. No other branch sets the new field.

Owner oracles in the task checkout: `bun run typecheck` clean, `bun test test/routing.test.ts test/normalize.test.ts` 27 pass / 70 assertions, `bun test` **162 pass / 319 assertions** across 15 files (S19 left it at 151).

Oracle discrimination check (owner, disposable copy outside the candidate): the new `routing.test.ts` against the previous `normalize.ts` fails 3 of its 10 tests (linked-PR preservation, order/dedupe, malformed entries), so it detects the defect rather than passing vacuously.

Owner integration: three files copied verbatim and md5-verified (three MATCH). Completion-side oracles: typecheck clean, 162 pass / 319 assertions, `bun run build` emits `dist/server.js` (21.66 KB).

Residual risks accepted with the row: only the `check_run` payload's own `pull_requests` list is used, so an event GitHub sends without it still routes to the CI channel; the summary line is agent-visible text, so a future summary format change must keep the PR reference; and this row is data-only by design — nothing consumes `prNumbers` until S21 routes it.

Worker lifecycle: the S20 worker settled `idle` at its prompt with the report delivered; workspace `w5V` (label `stackot-s20`) was closed after integration and the task worktree is retained.

## S21 launch contract — routing decision module

Baseline: `74ebffc` (S20 integrated). Task checkout `/Users/justn/dev/.worktrees/stackot-s21-20260921`, branch `codex/stackot-s21-20260921`, created with `herdr worktree create --label stackot-s21 --no-focus --trust-repository`; workspace and pane IDs are read back from the create result.

Row: new `router.ts` plus `routing.test.ts`, completion condition "opened/followup/CI 목적지 일치", failure trigger "repo 간 혼선".

Owner envelope decision: the destination decision currently lives inline in `server.ts`'s `resolveTarget` and is only reachable through integration tests, so the row also covers `server.ts` (call the router, delete the inline `resolveTarget`/`titleFrom`), `normalize.ts` (a `noticeChannelId?: string` field on `NormalizedEvent` only), and `gateway.ts` (one extra message line when a notice channel is present). Without the last two the spec's "CI 실패 → PR 스레드 답글 + #ci-alerts 알림" would be half-realized: the event would reach the PR thread but nothing would tell the agent about the CI channel. The router itself must take the thread lookup as an injected dependency (`resolveThreadId`), so no test touches the network and the GitHub call stays in `server.ts`.

Routing table the owner specified, in priority order: unconfigured repo → admin; CI with a resolvable linked PR thread → that thread plus `noticeChannelId = ciAlertsChannelId`; CI otherwise → `ciAlertsChannelId`; opened issue/PR → `createThread` in that repo's forum with the existing title rule; follow-up resolved → that thread; follow-up unresolved or a throwing lookup → admin. The router decides only — no thread creation, no GitHub writes, no outbox or dedupe work.

Status: contract written; launch follows.

### S21 decision — ACCEPT, no retry needed

Candidate: new `receiver/src/router.ts`, extended `receiver/test/routing.test.ts`, plus `server.ts`, `gateway.ts` and the `noticeChannelId` field in `normalize.ts`. Nothing outside the envelope changed and HEAD stayed at `d41a46b` — the worker did not commit. The worker ran the permitted cached `bun install`.

Owner verified by reading every file and re-running every oracle. `router.ts` exposes `route(ev, deps)` with `resolveThreadId` injected, so it never touches the network; `titleFrom` moved there from `server.ts`. The table matches the owner's specification exactly, with one improvement the owner did not ask for but accepts: the follow-up branch guards the parsed number with `Number.isInteger(number) && number > 0`, which closes the old `NaN`-into-URL path. The CI branch keys off `item.startsWith("CI ")`, catches a throwing lookup and falls through to `#ci-alerts`. `server.ts` keeps only wiring: a `resolveThreadId` closure built from `fetchItem` + trust-aware `findThreadId`, then the decision applied to the event before enqueue. `gateway.ts` adds one `CI 알림 채널: <id>` line when the event carries a notice channel.

Owner oracles in the task checkout: `bun run typecheck` clean, `bun test test/routing.test.ts` 23 pass / 54 assertions, `bun test` **175 pass / 350 assertions** across 15 files (S20 left it at 162).

Oracle discrimination check (owner, disposable copy outside the candidate): disabling the CI branch in `router.ts` fails 4 of the 23 routing assertions, so the table is detecting the rule rather than restating it.

Owner runtime proof (throwaway script, real receiver process, stub gateway, no GitHub dependency): POST of an `issues opened` webhook → `200 accepted` and the persisted row carries `target: ""`, `targetKind: "channel"`, `createThread: { forumChannelId: "101", title: "[owner/repo#42] 로그인 오류" }`, with the gateway receiving `새 포럼 스레드 필요: 채널 101, 제목 "[owner/repo#42] 로그인 오류"`. POST of a `check_run` failure with no linked PR → `200 accepted`, row `target: "103"` (ci-alerts), no notice channel, gateway receiving `대상 스레드: 103`. So the routing decision survives into the outbox and into the forwarded message.

Owner-applied delta (recorded, not part of the worker candidate): the pipeline comment at the top of `server.ts` still claimed "CI failure → #ci-alerts"; the owner corrected it to name the linked PR thread and the notice channel, then re-ran typecheck and the full suite in the completion checkout (175 pass / 350 assertions, build 22.93 KB).

Residual risks accepted with the row: the PR-thread happy path (a CI failure whose linked PR thread actually resolves) can only be exercised against the live GitHub API, so it is proven at router level with an injected resolver and remains a contract-level claim; `noticeChannelId` is currently consumed only as one message line, so the agent still has to act on it; and the `unrouted` row (a channel-kind event that is neither an opened issue/PR nor CI) passes the event's own target through unchanged.

### Owner-observed finding from S21 — resolution precedes persistence, with no lookup timeout (new candidate row)

Reading the accepted wiring exposed a real M1-relevant gap that is **not** fixed here and is not part of S20–S22: `server.ts` awaits `route(...)` — and therefore the GitHub reverse-link lookup — **before** `outbox.enqueue`, and `mapping.ts`'s `fetchItem` sets no request timeout (unlike `gateway.ts`, which aborts at 10 s). A slow or hung GitHub API therefore delays both the webhook ACK and the persistence of the event. GitHub marks the delivery failed on its own timeout and redelivers, and the delivery-id dedupe covers that, so no event is silently lost, but the ACK durability that M1 claims is coupled to a third-party API.

Proposed candidate row (owner, TODO in this ledger): persist the normalized event first and resolve the destination inside the drainer, add a bounded lookup timeout, and prove it with a hanging-GitHub probe plus a redelivery test. Do not fold this into S22, which is a documentation-truth row.

Worker lifecycle: the S21 worker settled `idle` at its prompt with its report delivered; workspace `w5W` (label `stackot-s21`) was closed after integration and the task worktree is retained.

## S22 decision — ACCEPT (owner-authored), M1 documentation truth

Baseline: `b7254f8`. Owner decision: this row is documentation truth whose oracle is a source comparison, so the owner wrote it directly instead of spending a worker round-trip on prose. The record below is the acceptance evidence.

Owner oracle (throwaway script, run against this checkout, then deleted):

- `normalize.ts` handles `issues`, `issue_comment`, `pull_request`, `pull_request_review`, `pull_request_review_comment`, `check_run`.
- `docs/spec.md` §4 now declares exactly that list, plus an explicit note that `check_suite`, `push` and `release` are **not** subscribed and are ignored if a webhook is attached. Comparison result: `spec.md event list matches source: true`.
- `deploy/README.md` §4 now tells the operator to subscribe to Issues, Issue comments, Pull requests, Pull request reviews, Pull request review comments, Check runs — the same six events (`deploy/README subscription list matches source: true`). "Check suites" was removed.
- `deploy/README.md` §3's config example gained the two keys that became required in S19 (`discordGuildId`, `githubBacklinkLogin`); with its `<...>` placeholders filled, the documented example **loads through the real `loadConfig`** (`deploy guide config loads: true`), so the guide can no longer produce a config that fails startup for a reason the guide never mentions.
- `deploy/README.md` §6 documented the dedupe store as `receiver/var/dedupe.sqlite`, but `server.ts` defaults to `receiver/var/outbox.sqlite`; the guide now names the real file, notes that it holds dedupe and undelivered events together, and records the `STACKOT_OUTBOX_PATH` override. Verified against the source default.

Files changed: `docs/spec.md`, `deploy/README.md`. No source or test change, so no code oracle was re-run beyond this comparison; the suite was unaffected and CI ran on the push.

Residual risks: the note about unsubscribed events states current behaviour only, so whichever row implements `check_suite`/`push`/`release` must update both documents in the same change; and the guide's CI checklist step ("CI 실패 → #ci-alerts 알림 + PR 스레드 답글") is now backed by S21's routing plus the `CI 알림 채널` message line, but the actual Discord posting still depends on the agent and the blocked runtime rows.

### S04D decision — ACCEPT (owner-authored), M1 tooling truth

Baseline: `b5be3d0`. Owner-authored reasoning, same as S22: the change is mechanical tooling plus a lock regeneration, and the oracle is an external clean-copy check the owner must run anyway.

Diagnosis (owner, disposable copy): the tracked root `bun.lock` declares a `stackot-impl` workspace whose `package.json` no longer exists at the repository root and is referenced by nothing, while `receiver/bun.lock` was gitignored and therefore never committed. Installing inside `receiver/` creates its own lock and leaves the root lock byte-identical, so there is no hidden root traversal — the real defect is that CI's `bun install --frozen-lockfile` ran with `working-directory: receiver`, found no lockfile, and re-resolved the tree on every run.

Change: the ignore rule for `receiver/bun.lock` is dropped, the receiver lock is generated and committed beside `receiver/package.json`, and the orphaned root lock is removed so exactly one lockfile governs the receiver.

Oracle (clean copy of the commit, `git archive` + tar): `bun install --frozen-lockfile` twice in `receiver/` produced the identical lock hash `d225c2accecb474fd668874690a5d42d` and the second run reported "no changes"; `bun run typecheck`, `bun test` (175 pass / 350 assertions) and `bun run build` all passed from that pinned install; no root lock exists in the copy. CI on `0374d34` then ran the same frozen install with the committed lock and passed.

Residual risks: the lock pins the receiver's devDependencies only (`@types/bun`, `typescript`), so a future runtime dependency must be added to `receiver/package.json` and re-locked deliberately; and dropping the root lock means any future root-level tooling needs its own `package.json` and lock rather than reusing the removed one.

## S03C4 launch contract — reject placeholder repo forum channel IDs

Baseline: `0374d34`. Task checkout `/Users/justn/dev/.worktrees/stackot-s03c4-20260921`, branch `codex/stackot-s03c4-20260921`, created with `herdr worktree create --label stackot-s03c4 --no-focus --trust-repository`; workspace and pane IDs are read back from the create result.

Row: `config.ts` + `config.test.ts`, completion condition "<...> forum ID는 시작 실패", failure trigger "유효 ID 회귀".

Defect the owner confirmed by reading the source: repo entries are only checked for truthiness, so `"<ISSUES_FORUM_CHANNEL_ID>"` starts the receiver and the bot then tries to create threads in a channel that cannot exist. Every other configured secret or channel ID already rejects whole-token `<...>` placeholders.

Owner envelope: only the two repo forum channel IDs are added to that existing rule; they must be strings, non-blank after trim, and not a single whole-token placeholder, while values that merely contain angle brackets (`<a><b>`) stay valid for consistency with S03C1–C4. Non-string types are rejected. The error must name the repo and the key. Nothing else in `loadConfig` changes, and `config.example.json` is only touched if a JSON comment-free edit is possible.

Status: contract written; launch follows.

## S15 launch contract — SQLite busy and durability policy

Baseline will be the S03C4 integration commit; the task checkout is created after that row is accepted, so the two rows never share a worktree.

Row: `outbox.ts` + `outbox.test.ts`, completion condition "동시 ID 하나만 저장", failure trigger "두 side-effect job 생성".

Defect the owner confirmed by reading the source: `Outbox` sets only `journal_mode = WAL`; with no `busy_timeout`, a concurrent writer can surface `SQLITE_BUSY` into the webhook path and produce a 5xx, which is exactly the window in which a second client could introduce another delivery attempt.

Owner envelope: declare both policies in code — a finite exported `busy_timeout` constant and an explicit `synchronous` level with the reason for that choice — without changing the schema or the public API. The oracle is a concurrent duplicate insert (two connections racing the same delivery id must yield exactly one row and exactly one `true`), a lock-contention case where a short write transaction on one connection does not make the other fail, and a durability case where a pending row survives close and reopen. Schema changes and column additions are forbidden.

Status: launched 2026-09-21 from baseline `ee19025`. `herdr worktree create --label stackot-s15 --no-focus` provisioned workspace `w5Y` with root pane `w5Y:p1` at the checkout. Foreground argv verified from the process table: `devin --model swe-2 --permission-mode dangerous --prompt-file …/s15-launch.txt` (pid 88003), pane footer `SWE-2 High`, exactly one worker, no fallback model; the S03C4 workspace was closed first.

## S10 launch contract — gateway request timeout oracle

Baseline will be the S15 integration commit; the task checkout is created after that row is accepted.

Row: `gateway.ts` + `gateway.test.ts`, completion condition "정해진 시간에 실패 반환", failure trigger "무기한 pending fetch".

Defect the owner confirmed by reading the source: the 10 s limit exists (`signal: AbortSignal.timeout(10_000)`) but is hardcoded, so no test can exercise it and `gateway.test.ts` only covers framing and headers. S10 was recorded as ACCEPT-WITH-GAP for exactly that reason.

Owner envelope: the timeout becomes injectable through an options argument with the default exported as a constant, the abort must surface as a rejection the drainer treats as a failure (so a hanging gateway schedules a retry rather than hanging forever), and `server.ts` stays untouched so production keeps the default. The hanging case must be tested against a local stub that never responds using a small injected timeout, keeping the suite fast, and the existing framing/header/bearer assertions must survive unchanged.

Status: launch follows the S15 integration commit `ce5791c`.

### S09A decision — oracle gap closed (owner-authored test)

Baseline: `0374d34`. S09A had been recorded as ACCEPT-WITH-GAP because the row's named oracle `test/server.outbox.integration.test.ts` did not exist. The owner wrote that file: one signed webhook against a running receiver whose gateway is unreachable, then a read of the outbox **immediately** after the `200 accepted` response with no delay, asserting the delivery row exists, is `pending` with `delivered_at` null, and that a redelivery of the same id is answered `duplicate` with the row count still one. The unreachable gateway is what makes the assertion meaningful: a missing row could not be explained by a successful delivery.

Result: `bun test test/server.outbox.integration.test.ts` 2 pass / 9 assertions, `bun run typecheck` clean, full suite 177 pass at that commit. S09A's gap is closed; the row is ACCEPT rather than ACCEPT-WITH-GAP.

## S03C4 decision — ACCEPT, no retry needed

Baseline: `1471dee`. Task checkout `/Users/justn/dev/.worktrees/stackot-s03c4-20260921` (workspace `w5X`), candidate limited to `receiver/src/config.ts` and `receiver/test/config.test.ts`, HEAD unchanged at the baseline, no worker commit.

Owner verified by reading the delta and re-running every oracle. The truthiness check became a loop over the two repo forum channel keys: each must be a string whose trim is non-empty and must not match `/^<[^<>]*>$/`, and the thrown message names both the repo and the key. Values such as `<a><b>` remain valid, and every other validation in `loadConfig` is untouched — the diff is ten lines of source.

Owner oracles in the task checkout: `bun run typecheck` clean, `bun test test/config.test.ts` 101 pass / 118 assertions, full suite 198 pass / 378 assertions.

Oracle discrimination check (owner, disposable copy outside the candidate): restoring the previous truthiness check makes 22 of the 101 config assertions fail, including the placeholder cases, so the new tests detect the defect.

Owner integration: both files copied verbatim and md5-verified (two MATCH). Completion-side oracles: typecheck clean, **200 pass / 387 assertions** across 16 files.

Residual risks: channel IDs are intentionally not enforced as numeric here (the row's scope is placeholders, and over-rejecting would break valid deployments); a syntactically valid but wrong channel ID still starts the receiver, and the failure would only surface as a Discord API error inside the agent — the runtime rows remain the place where that is proven.

Worker lifecycle: the S03C4 worker settled `idle` at its prompt with its receipt written; workspace `w5X` (label `stackot-s03c4`) was closed after integration and the task worktree is retained.

### S15 decision — ACCEPT, no retry needed

Baseline: `ee19025`. Candidate: `receiver/src/outbox.ts` (+14) and `receiver/test/outbox.test.ts` (+86), nothing else, HEAD unchanged, no worker commit.

Owner verified by reading the delta and re-running every oracle. `BUSY_TIMEOUT_MS = 5000` is exported and applied **before** the journal-mode switch — the worker's comment explains why that order matters, and the owner confirmed the reasoning: the WAL switch itself writes, so it can hit a lock too. `synchronous = FULL` is set with a written rationale tied to the ACK contract. No schema or column change, and the public API is untouched.

Owner oracles in the task checkout: `bun run typecheck` clean, `bun test test/outbox.test.ts` 12 pass / 48 assertions (three consecutive runs, stable at ~180 ms), full suite 203 pass / 402 assertions.

Discrimination checks (owner, disposable copies outside the candidate): `bun:sqlite`'s **default `busy_timeout` is 0**, so the explicit pragma is load-bearing rather than decorative; removing the two pragma lines makes the suite fail. One precision the owner recorded: `synchronous` already defaults to 2 (FULL) in bun:sqlite, so that line states the policy rather than changing behaviour — the commit message says so explicitly.

Test quality: the race test opens two `Outbox` connections and asserts exactly one `true` plus one row; the contention test spawns a separate process that holds `BEGIN IMMEDIATE` for ~100 ms behind a stdout handshake, then asserts the enqueue waits longer than 0 ms, less than the busy timeout, and still inserts; the durability test closes and reopens the outbox and asserts the pending row is still due. Deleting the pragmas reproduces the failure the row exists to prevent.

Owner integration: both files copied verbatim and md5-verified (two MATCH). Completion-side oracles: typecheck clean, 203 pass / 402 assertions, `bun run build` emits `dist/server.js` (23.35 KB). CI runs on the push.

Residual risks: the contention test depends on real process timing, so a machine that cannot spawn a child process within the handshake window would fail loudly rather than silently pass; `synchronous = FULL` costs an fsync per commit, which is the deliberate price of the ACK-durability claim and would be the first thing to revisit if ingress throughput ever matters; and the busy timeout only helps when the *other* writer is a cooperating process — an external tool holding the lock longer than five seconds still produces SQLITE_BUSY, which is a deliberate bound.

Worker lifecycle: the worker's candidate was already complete — both source and test files written, receipt on disk — and the owner had finished verifying and integrating it when workspace `w5Y` (label `stackot-s15`) was closed. The worker's final summary turn was still composing text at that moment, so that turn was cut short on purpose after integration; nothing needed from it remained. The task worktree is retained.

## S09B launch contract — outbox write failure must not ACK

Owner-observed while closing M1: S09B is the last unimplemented row in the M1 range. `server.ts` calls `outbox.enqueue` without a try/catch, so a failing commit lets the exception escape and Bun answers with its default error response; the row requires an explicit 5xx, no ACK, and a surviving process.

Owner-verified reproduction (probed directly before writing this contract): chmod alone does **not** produce a failure, because an already-open file descriptor keeps write access; deleting the outbox `-wal` and `-shm` files and then making the directory `0555` and the database file `0444` does — the next write throws `SQLiteError: disk I/O error`. That recipe is written into the launch prompt so the worker does not have to rediscover it.

Owner envelope: `server.ts` plus a new `test/server.outbox.failure.integration.test.ts`. The failure path must return 5xx (503 preferred) with a short body and must not leak internals or secrets, the process must still answer `/healthz`, a failed delivery id must leave no partial row, and the healthy path (200 accepted with the row committed, 200 duplicate) must stay intact. `outbox.ts` is out of scope. Whether the connection recovers once permissions return must be reported as a fact rather than assumed.

Status: contract written; launch follows the S10 integration commit.

### S10 decision — ACCEPT, no retry needed (oracle gap closed)

Baseline: `78247be`. Candidate: `receiver/src/gateway.ts` (+3/-1) and `receiver/test/gateway.test.ts` (+51), nothing else, no worker commit.

Owner verified by reading the delta and re-running every oracle. `GATEWAY_TIMEOUT_MS = 10_000` is exported, `forwardToGateway` takes `opts: { timeoutMs?: number } = {}` and uses `opts.timeoutMs ?? GATEWAY_TIMEOUT_MS`, and `server.ts` was left untouched so production keeps the default. The response contract (`{ ok, status, body }`), the message framing and all headers are unchanged.

Owner oracles in the task checkout: `bun run typecheck` clean, `bun test test/gateway.test.ts` 5 pass / 15 assertions, full suite 207 pass / 411 assertions.

Oracle discrimination check (owner, disposable copy outside the candidate): keeping the export but making the call ignore `opts` — i.e. restoring the old hardcoded behaviour while the test file still compiles — makes the hanging-gateway test fail after its 5 s test budget, so the assertion detects an unbounded fetch rather than restating the implementation.

Test quality: the hanging case serves a promise that never resolves and asserts rejection within 2 s using the injected 50 ms budget, so the suite stays fast; a second case uses the default path against a fast stub; the pre-existing framing, idempotency-key and bearer assertions are untouched.

Owner integration: both files copied verbatim and md5-verified (two MATCH). Completion-side oracles: typecheck clean, 207 pass / 411 assertions, `bun run build` emits `dist/server.js` (23.43 KB).

Residual risks: the row proves the timeout shape, not that ten seconds is the right value for the Gateway, which is a runtime-tuning question for the deployment rows; and a timed-out forward surfaces as a rejection the drainer turns into a retry, so a permanently hanging Gateway now produces dead-lettered deliveries rather than an unbounded queue — that behaviour is covered by S12's tests, not by this row.

Worker lifecycle: the S10 worker settled `idle` at its prompt with its receipt written; workspace `w5Z` (label `stackot-s10`) was closed after integration and the task worktree is retained.

### S11 decision — oracle gap closed (owner-authored test)

Baseline: `067e7ce`. S11 was recorded as ACCEPT-WITH-GAP because the drain path existed and worked but no test pinned the retry schedule, and S11's named oracle was a fake-clock retry test. The owner added that assertion to `delivery.test.ts` (the row's own scope): after `outbox.retry(id, attempts)` for attempts 1 through 8, the stored `next_attempt_at` must be 2 s, 4 s, 8 s, 16 s, 32 s and then a flat 60 s. Real time is read by the production code, so the schedule is asserted from the stored timestamp instead of holding fake timers; the tolerance is 250 ms lower and 1 s upper to stay deterministic without being slack, and attempts are asserted to be recorded as given.

Discrimination check (owner, disposable copy): changing the exponent cap from 6 to 4 in `outbox.ts` fails the new test, so it pins the schedule rather than restating it. Full suite after the addition: 208 pass / 435 assertions, typecheck clean.

S11 is therefore ACCEPT rather than ACCEPT-WITH-GAP.

### S09B decision — ACCEPT, no retry needed

Baseline: `b5be3d0`..`067e7ce` lineage; task checkout `/Users/justn/dev/.worktrees/stackot-s09b-20260921` (workspace `w50`). Candidate: `receiver/src/server.ts` (+21/-7) and new `receiver/test/server.outbox.failure.integration.test.ts`, nothing else, no worker commit.

Owner verified by reading the delta and re-running every oracle. `outbox.has` and `outbox.enqueue` are each wrapped: a failure logs the delivery id and the reason server-side and answers `503 outbox unavailable` with no internals; the drain calls gained a rejection handler so a failing drain cannot become an unhandled rejection; the healthy path is untouched (`200 accepted` with the row committed before the ACK, `200 duplicate` for a repeat id).

Owner oracles in the task checkout: `bun run typecheck` clean, `bun test test/server.outbox.failure.integration.test.ts` 2 pass / 18 assertions, full suite 209 pass / 429 assertions.

Oracle discrimination check (owner, disposable copy outside the candidate) — this one is unusually informative: restoring the previous handler makes the test fail on its `expect(body).not.toContain("SQLiteError")` assertion, because Bun answered with its development error page containing the exception name, the receiver's absolute working directory and stack frames. So the explicit catch is load-bearing for two properties at once: a clean 5xx and no server-internal leakage to the caller. The pre-fix run failed in `has()` rather than `enqueue`, which also confirms the dedupe read needs the same protection the worker gave it.

Test quality: the failure is induced with the owner-verified recipe (the test even checkpoints the WAL first, with a comment explaining that deleting it before a checkpoint would drop committed rows and make the no-partial-row assertion meaningless); it then asserts a 5xx that is not 2xx, a body that is neither `accepted` nor `duplicate` nor an error page, `/healthz` still answering, no false ACK when the failed id is resent while the outbox is broken, no partial row, and it restores permissions in a `finally`.

Owner integration: both files copied verbatim and md5-verified (two MATCH). Completion-side oracles: typecheck clean, **210 pass / 453 assertions** across 17 files, `bun run build` emits `dist/server.js` (24.0 KB).

### Owner-observed finding from S09B — an outbox I/O failure is not recovered and not reflected in readiness

The worker's recovery probe is recorded rather than hidden, and the owner reproduced its meaning: after the induced write failure and after permissions are restored, the running receiver answers `503 outbox unavailable` for new deliveries (`post-restore webhook result: 503 outbox unavailable` in the receipt). The process is alive and `/healthz` still returns 200. `/readyz` calls `outbox.ready()`, which is a plain `SELECT 1` and can also keep succeeding on the broken connection.

Consequence: a transient outbox I/O error (filesystem hiccup, disk full, external checkpoint that removes the WAL) can leave a running receiver permanently unable to persist deliveries while both health endpoints keep reporting healthy, and GitHub's redeliveries are answered 5xx and retried. Nothing in M1 claims otherwise, but this is a real operational hole.

Proposed candidate row (owner, TODO): after an outbox failure the receiver must either reopen the database and resume, or fail readiness so a supervisor restarts it — with a test that induces the failure, restores permissions and asserts one of those two outcomes rather than a silent 503 loop. Keep it out of M1's scope statement.

## M1 close-out — reliable ingress (S01–S22)

Every row in the M1 range now has an owner decision, and each gap that M1 depended on has been closed or explicitly recorded:

- S01, S02, S03A, S03B, S03C1–C3 were accepted in wave-01 by the previous owner; their worktrees are gone but the accepted deltas are in this checkout and were re-verified in the retro table above.
- S03C4 was re-run as a fresh task (`0f53822`, ACCEPT) because its old branch held no work.
- S04A–C accepted; S04D fixed the lockfile layout (`0374d34`, ACCEPT).
- S05A, S05B, S06, S08A, S08B, S14 accepted in the retro table.
- S07's wave-01 REJECT is superseded: the repository-shape gate and its child-process test exist and pass, and the rejected candidate is unrecoverable.
- S09A's named oracle was written and now passes (`5484670`), S09B was implemented and tested (`ca6a9b0`).
- S10's missing oracle was closed with an injectable timeout plus a hanging-gateway test (`4ba3da9`), S11's backoff schedule was pinned (`5b47809`).
- S12 (`57be0b6`) and S13 (`47df399`) were implemented and proven against a real process; S15 declared the concurrency and durability policy (`7ee1c78`); S16 accepted; S17 (`49e1d94`), S18 (`f1be5f5`) and S19 (`bfefe5a`) hardened the reverse-link path; S20 (`74ebffc`), S21 (`b7254f8`) and S22 (`b5be3d0`) finished routing and documentation truth.

Evidence class for all of M1: local and synthetic process-level only. There is still **no** runtime, deployed or human-verified evidence — no live GitHub delivery, no OpenClaw Gateway, no Discord delivery, no deployed SHA, no restore or rollback drill. M1's claim is limited to "reliable ingress at the code and synthetic-process level".

Baseline at close-out: `ca6a9b0`, `bun test` 210 pass / 453 assertions across 17 files, `bun run typecheck` clean, `bun run build` emits 24.0 KB, CI green on every push.

Two candidate rows were opened from this wave and are **not** part of M1: persist-then-resolve so the ACK no longer waits on the GitHub lookup (from S21), and outbox-failure recovery or readiness failure (from S09B).

### S09B retry — platform-specific failure induction, found by CI

The candidate integrated as `ca6a9b0` induced the write failure by deleting the live `-wal`/`-shm` files and removing write permission. That recipe was verified on macOS (it produced `SQLiteError: disk I/O error`) and the owner's local run of the whole suite was green, but **CI failed on the same commit**: on the Linux runner the enqueue succeeded and the test failed on `Expected: >= 500, Received: 200` in 3.5 ms. The mechanism is that an unlinked file with an open descriptor keeps accepting writes on Linux, so removing the path never breaks the connection there.

Owner-applied retry (recorded as an owner delta rather than a worker turn: the accepted implementation in `server.ts` was never in question — only the test's failure-induction recipe was non-portable, and the owner had already diagnosed it):

- The failure is now induced by holding the SQLite write lock from a second connection (`BEGIN IMMEDIATE`, `busy_timeout = 0`) while the webhook is posted, so the server's own five-second busy timeout expires and the enqueue fails. This is portable, deterministic, and it exercises the production path rather than a filesystem quirk.
- The test also gained a recovery half that the old recipe could not assert: after the lock is released, the delivery id that failed is accepted (`200 accepted`) rather than answered as a duplicate, proving the failed attempt left no trace and that GitHub's redelivery of it works; a fresh id is then persisted normally.
- Discrimination re-verified against the previous handler in a disposable copy: it still fails, now on the leaked `SQLiteError: database is locked` development error page.

Evidence: `bun run typecheck` clean, the new file 2 pass / 16 assertions locally in 5.1 s (the busy timeout dominates), full suite 210 pass / 451 assertions, and CI run on `2042df6` **success** — the platform where the first attempt failed.

Lesson recorded for later rows: a failure-induction recipe must hold on the CI platform, and a green local run is not evidence for a mechanism that depends on filesystem or permission semantics. This is the second time this wave caught a defect only because CI ran on the pushed SHA.

### S09B retry, second correction — the holder must tolerate transient writes

The first corrected oracle passed twice on this machine and failed on the CI runner *before* posting any webhook: its own holder connection ran `BEGIN IMMEDIATE` with `busy_timeout = 0` and lost the race against the receiver's one-second drain timer, which takes the write lock briefly. Locally the timing never collided, so only CI caught it.

Fix (`edfd4b7`): the holder uses the same five-second busy timeout as production, so it waits out the receiver's transient writes and still holds the lock while the request is posted. Three consecutive local runs pass, and CI run on `edfd4b7` is **success** — the platform that exposed both defects in this test.

Combined lesson for the remaining rows, in two parts: a failure-induction recipe has to hold on the CI platform, and a test that deliberately owns a shared resource has to tolerate the production process's legitimate transient use of it. Neither defect was reachable from a local green run.

## S21b launch contract — persist before resolve (wave 03 opens)

Baseline: `f797ae7`. Task checkout `/Users/justn/dev/.worktrees/stackot-s21b-20260921`, branch `codex/stackot-s21b-20260921`, created with `herdr worktree create --label stackot-s21b --no-focus --trust-repository`; workspace and pane IDs are read back from the create result.

Owner-observed defect (from S21): the request path runs `await route(ev, deps)` before `outbox.enqueue`, and `route` reaches GitHub through the injected `resolveThreadId` for every follow-up event. The ACK and the persistence of the event are therefore coupled to a third-party API, and `fetchItem` sets no request timeout, so a hanging GitHub response can stall a drain indefinitely.

Owner envelope: `server.ts` (persist the unrouted event, move `route` into the drainer's forward callback, read `STACKOT_GITHUB_API_BASE` with the real API as default and pass it as `apiBase`), `mapping.ts` (an `opts.timeoutMs` with an exported `GITHUB_TIMEOUT_MS` default applied through `AbortSignal.timeout`), plus new tests in `mapping.test.ts` and a new `server.routing.integration.test.ts`. The API-base override exists so the routing path becomes process-testable without the live network, which the disposable integration environment will also need; unset, production behaviour is unchanged. Routing results are deliberately **not** persisted: the stored event stays unrouted so a retry re-resolves rather than replaying a stale destination.

The oracle is a local stub pair (GitHub + Gateway): a follow-up event must be ACKed with its row committed and no GitHub request yet made, then resolved to the stubbed backlink thread when it drains; an unmapped event must land on the admin channel; and with a GitHub stub that never answers, the ACK must still be immediate and the row committed while the drain remains a failure.

Status: contract written; launch follows.

## S21b (wave 03) — decision: ACCEPT, no retry needed

Baseline: `bdd7441`. Task checkout `/Users/justn/dev/.worktrees/stackot-s21b-20260921` (workspace `w61`), candidate limited to `server.ts`, `mapping.ts`, `mapping.test.ts` and a new `server.routing.integration.test.ts`; HEAD unchanged, no worker commit.

Owner verified by reading the delta and re-running every oracle. The request path now stores the **unrouted** normalized event (`outbox.enqueue(deliveryId, ev)`) and ACKs; the drainer's forward callback runs `route(job.event, deps)`, applies the decision and forwards. Routing results are never persisted, so a retry re-resolves. `fetchItem` gained `GITHUB_TIMEOUT_MS = 10_000` (injectable) applied through `AbortSignal.timeout` on the item, the first comments page and every paginated request, and `server.ts` reads `STACKOT_GITHUB_API_BASE` (default the real API) so the routing path is process-testable without the live network.

Owner oracles in the task checkout: `bun run typecheck` clean, `bun test test/mapping.test.ts test/server.routing.integration.test.ts` 25 pass / 70 assertions, full suite 216 pass / 478 assertions. Owner integration: four files copied verbatim and md5-verified (four MATCH); completion-side typecheck clean, **216 pass / 478 assertions**, `bun run build` emits `dist/server.js` (24.27 KB). CI on `76a27ed` is green, so the stub/gate design is portable — unlike S09B's original recipe, which only failed on the runner.

Discrimination check, done two ways because the first attempt was inconclusive (0/4 pass could have meant a broken copy):
1. Reverting the ordering in a disposable copy fails all four tests, **and** the copy boots normally (`healthz: ok`), so the failures are behavioural.
2. Direct probe on that same copy with a GitHub stub that never answers: the receiver boots, and the webhook POST does **not** return — the test client aborts it after 3 s. That is the defect in one line: with routing on the request path, a hanging GitHub API blocks the ACK. On the fixed code the same POST answers `200 accepted` immediately and the row stays pending for retry.

Test quality: the ordering is proven with a **held gate** in front of the GitHub stub rather than by timing — while the gate is held the drain's lookup is in flight and provably has not reached the stub, so `ghSeen` is empty at ACK time and the row is asserted unrouted at the moment the 200 was observed. The suite then releases the gate and asserts the drain resolves the stubbed backlink, forwards to that thread, and leaves the stored event unrouted; a second case covers the admin fallback for an unmapped item; a third covers the hanging lookup (ACK immediate, row still pending, gateway untouched).

Residual risks accepted with the row:
- Routing now runs on every delivery attempt, so a delivery that fails its forward issues another GitHub read per retry — bounded by `MAX_DELIVERY_ATTEMPTS` but real against the GitHub rate limit.
- A mapping failure is **not** a delivery failure: the router falls back to the admin channel, the delivery succeeds, and nothing in the delivery telemetry records that the backlink lookup failed. The only evidence is a `console.warn`. Turning that into a recorded fallback counter or log field belongs to the telemetry row (S42), not here.
- `STACKOT_GITHUB_API_BASE` is now a production knob: unset it keeps the real API, but a typo would silently point lookups at nothing and every follow-up would become an admin notice.
- The ACK no longer implies the destination was resolved; it implies the event is durably stored. That is the intended contract change and it is what S21b's completion condition asked for.

Worker lifecycle: the S21b worker settled with its receipt written; workspace `w61` (label `stackot-s21b`) was closed after integration and the task worktree is retained.

## S39 launch contract — redact secrets from logs and stored errors

Baseline: `9fa80cf` (S21b integrated). Task checkout `/Users/justn/dev/.worktrees/stackot-s39-20260921`, branch `codex/stackot-s39-20260921`, created with `herdr worktree create --label stackot-s39 --no-focus --trust-repository`; workspace and pane IDs are read back from the create result.

Owner-observed defect: nothing redacts secrets today. A hook token embedded in `openclawHooksUrl` (a shape operators do use) ends up inside the connection-failure message, and that message is both stored as the row's `last_error` and printed to stderr — so a configured secret can persist in the operator-visible database and logs.

Owner envelope: `redact.ts` + `redact.test.ts` as the row nominates, plus `server.ts` wiring and a new `server.redact.integration.test.ts`. The wiring is what makes the row load-bearing in two places at once: the forward callback redacts the error message **before rethrowing**, so the drainer stores a clean `last_error` without `delivery.ts` being touched, and the server's own error logs redact before printing. The integration test induces the leak with an unreachable gateway and a token-in-URL config, then asserts the secret is absent from both the child's stderr and the stored `last_error`.

Status: contract written; launch follows.

## S41 launch contract — separate readiness from dependency health

Row: `health.ts` + `health.test.ts`, completion condition "수신 queue 유지, dependency 경고", failure trigger "Gateway down 수신 중지".

Owner-observed defect: `/healthz` answers `ok` whenever the process runs and `/readyz` only checks `outbox.ready()`, so a dead Gateway is invisible while deliveries pile up as retries and dead letters. The inverse mistake is also in scope: if Gateway reachability were folded into readiness, an orchestrator would restart a healthy receiver and lose its queue.

Owner envelope: `health.ts` plus a unit suite and a process-level probe (`health.test.ts`, `server.health.integration.test.ts`) and `server.ts` wiring — the forward callback records gateway success or failure (with the message redacted as S39 requires), `/healthz`, `/readyz` and `/status` expose the three views, and the existing `/healthz` = `ok`, `/readyz` = `ready` contracts stay intact so the earlier integration suites keep passing. State is deliberately in-process only.

The decisive property the oracle must show: with the Gateway unreachable, `/readyz` stays 200 and webhooks keep being accepted and committed, while `/status` reports degraded with the last error; once the Gateway comes back and a delivery succeeds, `/status` returns to ok.

Status: contract written; launch follows S39.

### S39 decision — ACCEPT, no retry needed

Baseline: `e8c3fae`. Candidate: new `redact.ts`, new `redact.test.ts` and `server.redact.integration.test.ts`, plus `server.ts` wiring; nothing else, HEAD unchanged, no worker commit.

Owner verified by reading the delta and re-running every oracle. `redact` drops blank secrets, sorts by length descending, and replaces every occurrence with a fixed `[redacted]` token; `redactSecrets` returns the webhook secret, the hook token, the GitHub token **and the hooks URL** — the last one deliberately, because it can carry credentials the token fields never see and it is what fetch errors echo back. `describeError` inspects the whole error instead of only `.message`, which matters because Bun puts the request URL on the error's `path` property.

Wiring covers both leak paths: `resolveThreadId` masks before rethrowing so `router.ts`'s verbatim `console.warn` cannot leak it; the drainer's forward callback masks the failure, logs it and rethrows the masked text so `last_error` is clean without `delivery.ts` being touched; and the outbox error logs are masked too.

Owner oracles in the task checkout: `bun run typecheck` clean, focused 15 pass / 30 assertions, full suite **231 pass / 508 assertions** across 20 files.

Oracle discrimination check (owner, disposable copy with the pre-S39 `server.ts`): the integration test fails, and the reproduction is visible in the output — `path: "http://127.0.0.1:1/s39-gh-token-1a2b3c4d/repos/owner/repo/issues/7"` printed to stderr, and a `last_error` containing no `[redacted]` marker. So the row fixes a leak that really existed on both surfaces.

Owner integration: four files copied verbatim and md5-verified (four MATCH). Completion-side oracles: typecheck clean, 231 pass / 508 assertions, `bun run build` emits `dist/server.js` (25.25 KB). CI runs on the push.

Residual risks: redaction is substring-based on the configured values, so a secret that is partially transformed before being logged (URL-encoded, base64) would not match — the honest bound is "the exact configured values never appear"; `describeError`'s inspect dump is longer than a plain message, which is the price of catching property-carried values; and the router's own `console.warn` still prints the (now masked) message it received, so masking depends on callers handing it a masked error — which `resolveThreadId` does, and a future caller must.

Worker lifecycle: the S39 worker settled with its receipt written; workspace `w62` (label `stackot-s39`) was closed after integration and the task worktree is retained.

## S42 / S43 / S46 launch contracts — observability and recovery

Baselines follow S41's integration commit; each task checkout is created from the then-current HEAD with `herdr worktree create --label stackot-s4x --no-focus --trust-repository` and its prompt committed before the checkout exists.

**S42 — structured delivery telemetry.** Owner-observed: delivery outcomes are invisible; a failure leaves only a `last_error` column and scattered `console.error` lines, so nothing correlates one delivery's attempts. S21b made this worse in one specific way: when the reverse-link lookup fails the router falls back to the admin channel, the delivery succeeds, and the only trace is a `console.warn` from `router.ts` — a silent routing fallback. Envelope: new `telemetry.ts` + two test files + `server.ts` wiring, where the drainer's outbox is wrapped by a port-implementing decorator (so `delivery.ts` and `outbox.ts` stay untouched) and the router's decision `reason` drives a `routing.fallback` event. Every line is one JSON object with `deliveryId` and `attempts`, all text redacted via S39's helper, and the event body is never included. The oracle drives one delivery through failure → retry → success and asserts the lifecycle is readable from the log alone.

**S43 — queue metrics.** Owner-observed: nothing reports backlog; `due()` returns one row and `has()` a boolean, so an operator must open the SQLite file to see a growing queue. Envelope: new `metrics.ts` + test, an additive `Outbox.stats()` (one aggregate query, no schema/PRAGMA change), a `health.ts` extension so `/status` carries the queue numbers, and a periodic `queue.metrics` line from `server.ts`. The oracle seeds a known row population (including a deliberately aged pending row) and asserts exact counts with `oldestPendingAgeMs` as null only when nothing is pending — the failure trigger being a silently omitted state.

**S46 — consistent SQLite backup.** Owner-observed: there is no backup path, and under WAL a plain file copy can drop the most recent committed rows (the row's "WAL 누락" failure trigger). Envelope: new `backup.ts` + test only. The snapshot must come from SQLite's own consistent-snapshot mechanism (not `copyFile`), be a standalone file that opens without `-wal`/`-shm`, preserve state/attempts/last_error/event for every row state, fail loudly with no half-written destination, and expose the same CLI shape as `replay.ts` (exit 0/1/2). The oracle asserts `PRAGMA integrity_check` on the snapshot **and** that a row existing only in the WAL is present in it.

Status: contracts written; S42 launches after S41, then S43, then S46.

### S41 decision — ACCEPT, no retry needed

Baseline: `c82de3c`. Candidate: new `health.ts`, `health.test.ts`, `server.health.integration.test.ts`, plus `server.ts` wiring; nothing else, no worker commit.

Owner verified by reading the delta and re-running every oracle. `health.ts` documents and implements three separate questions: `liveness` always 200, `readiness` decided only by the outbox (the Gateway is explicitly ignored), and `statusReport` returning `ok` or `degraded` with the Gateway's masked `lastError`. `createGatewayHealth` starts optimistic so a fresh process is not reported degraded before it has attempted anything, and re-masks on `recordFailure` even though callers already pass masked text. `server.ts` records `recordSuccess` on an accepted forward and `recordFailure` with `gateway rejected delivery (status N)` otherwise, serves `/status` as JSON, and keeps `/healthz` = `ok` and `/readyz` = `ready`.

Owner oracles in the task checkout: `bun run typecheck` clean, focused 13 pass / 188 assertions, full suite **244 pass / 696 assertions** across 22 files.

Oracle discrimination check (owner, disposable copy with the pre-S41 `server.ts`): `/status` answers 404, so the new assertions fail — the row's operator view genuinely did not exist before, rather than being restated by the test.

Test quality: the integration suite drives the exact property the row exists for — with the Gateway held down, a webhook is still accepted and committed, `/readyz` and `/healthz` stay green, `/status` reports degraded with an error that provably does not contain the hook token, a second webhook is still accepted, and once the stub serves again `/status` returns to ok with a `lastSuccessAt`.

Owner integration: four files copied verbatim and md5-verified (four MATCH). Completion-side oracles: typecheck clean, 244 pass / 696 assertions, `bun run build` emits `dist/server.js` (26.75 KB). CI runs on the push.

Residual risks: the Gateway state is in-process only, so a restart reports "no attempt yet" and an operator must know that; a Gateway that accepts connections but never answers still shows `reachable: true` until a forward fails, since the signal is the drain outcome rather than an active probe; and `/status` reflects the last attempt, not a rolling window, so a flapping Gateway is only visible as the latest sample.

Worker lifecycle: the S41 worker settled with its receipt written; workspace `w63` (label `stackot-s41`) was closed after integration and the task worktree is retained.

### S42 decision — ACCEPT after one narrowed retry

Baseline: `0d56fdc`. First candidate implemented the contract correctly (whitelist JSON lines, redaction on every string field, decorator around the drainer's outbox so `delivery.ts`/`outbox.ts` stay untouched, `routing.fallback` for `unconfigured-repo`, `ci-alerts`, `followup-unresolved` and `unrouted`), but the owner rejected one shape: `server.ts` **mirrored** the retry backoff formula from `Outbox.retry`, and the test only asserted that `nextAttemptAt` was a number — a duplicated policy with no drift detector, the same defect the owner rejected in S12's first candidate. One narrowed retry was issued.

Corrected candidate — ACCEPT. `retryDelayMs` is exported from `outbox.ts` and used by `Outbox.retry` and by the telemetry decorator, so the schedule has one owner, and the integration test now asserts the reported `nextAttemptAt` is within 1 s of the row's persisted `next_attempt_at` after two consecutive failures — a direct drift detector, not a restatement.

Owner oracles after the retry: `bun run typecheck` clean, focused 12 pass / 156 assertions, full suite **256 pass / 854 assertions** across 24 files. Owner integration: five files copied verbatim and md5-verified (five MATCH); completion-side typecheck clean, 256 pass / 852 assertions, `bun run build` emits `dist/server.js` (29.21 KB). CI runs on the push.

Test quality: the suite reads the receiver's own stdout and correlates on `deliveryId` — failures 1..N then `delivered` in order, `dead_letter` at the cap with the gateway's status in the error, `routing.fallback` with reason/repo/item for an unresolved follow-up, no fallback line for normal routing, and no line containing a raw secret or event body text.

Residual risks: telemetry goes to stdout only, so a deployment must ship it somewhere (the observability rows in M3 own that); the decorator's in-memory `seenAttempts`/`targets` maps are keyed by delivery id and cleaned on delivered/dead-letter, so a permanently retrying row keeps a small entry until the cap; and `delivery.delivered` reports the attempts count from the last `due()`, i.e. prior failures, which is documented in the event type but worth remembering when reading logs.

Worker lifecycle: the S42 worker settled `done` after the retry; workspace `w64` (label `stackot-s42`) was closed after integration and the task worktree is retained.

### S43 decision — ACCEPT, no retry needed

Baseline: `0e8261c`. Candidate: new `metrics.ts` and `metrics.test.ts`, an additive `Outbox.stats()`, a `health.ts` extension so `/status` carries the queue numbers, and `server.ts` wiring; nothing else, no worker commit.

Owner verified by reading the delta and re-running every oracle. `stats()` is one aggregate query over the existing schema (no schema, PRAGMA or existing-method change), returns `oldestPendingAgeMs` as null when nothing is pending and clamps it at zero so clock skew cannot produce a negative age. `collectMetrics` normalizes hostile input to 0/null rather than trusting it. `server.ts` collects through a try/catch that logs a redacted error and yields null, emits one line at startup so a backlog from a previous run is visible immediately, emits on `METRICS_INTERVAL_MS`, and clears the timer on both signals.

Owner oracles in the task checkout: `bun run typecheck` clean, `bun test test/metrics.test.ts` 7 pass / 47 assertions, full suite **263 pass / 906 assertions** across 25 files.

Oracle discrimination check (owner, disposable copy with the pre-S43 `server.ts`): the six unit tests still pass and only the process-level test fails, timing out while waiting for a `queue.metrics` line — so the process test detects the missing wiring instead of restating the unit assertions.

Test quality: the unit half seeds a known population (including a deliberately aged pending row) and asserts exact counts with a tolerance on the age, covers the empty outbox and hostile inputs, and asserts the log line is parseable JSON with every field; the process half spawns the receiver, reads its stdout for the `queue.metrics` line and asserts `/status` reports the same numbers.

Owner integration: five files copied verbatim and md5-verified (five MATCH). Completion-side oracles: typecheck clean, 263 pass / 908 assertions, `bun run build` emits `dist/server.js` (30.95 KB). CI runs on the push.

Residual risks: counts are read live from SQLite, so on a large delivered history the aggregate scans the table on every interval — acceptable at current volume and the first thing to revisit with an index or a retention cutoff if the delivered set grows; the interval is a compile-time constant, so changing the cadence needs a rebuild; and the delivered count grows with traffic while the TTL sweep only removes delivered rows older than seven days.

Worker lifecycle: the S43 worker settled with its receipt written; workspace `w65` (label `stackot-s43`) was closed after integration and the task worktree is retained.
