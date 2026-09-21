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
