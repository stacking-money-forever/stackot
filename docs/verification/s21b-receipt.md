# S21b — persist-then-resolve (candidate receipt)

Base: `bdd7441` (worktree HEAD at launch). Candidate only — no commit/push/merge/deploy.

## Changed files (inside allowed scope only)

- `receiver/src/server.ts` — routing moved out of the request path into the drainer.
- `receiver/src/mapping.ts` — `fetchItem` gained `opts.timeoutMs`; new export `GITHUB_TIMEOUT_MS = 10_000`.
- `receiver/test/mapping.test.ts` — added `fetchItem timeout (S21b)` block (default constant, hung-stub rejection).
- `receiver/test/server.routing.integration.test.ts` — new; stub GitHub + stub Gateway + hold/release HTTP gate, child process spawned with `STACKOT_GITHUB_API_BASE`.

No other files touched. `git status` shows exactly `M src/mapping.ts`, `M src/server.ts`, `M test/mapping.test.ts`, `?? test/server.routing.integration.test.ts` under `receiver/`.

## Key diff summary

**`server.ts`**
- Request path: `await route(ev, …)` + `routed` assembly deleted; `outbox.enqueue(deliveryId, ev)` now stores the normalized event as-is and returns `200 accepted` immediately after commit. No GitHub call can occur before the ACK.
- Delivery path: the `DeliveryDrainer` forward callback now calls `route(job.event, { cfg, resolveThreadId })`, applies `target`/`targetKind`/`createThread`/`noticeChannelId` onto a copy of the stored event, and passes it to `forwardToGateway`. The routing decision is never written back to the outbox.
- `resolveThreadId` passes `{ apiBase: githubApiBase }` to `fetchItem`, where `githubApiBase = process.env.STACKOT_GITHUB_API_BASE ?? "https://api.github.com"`. Production behavior is unchanged when the variable is unset.
- Header docblock updated to describe persist-then-resolve (step 4 persist, step 5 route at drain).

**`mapping.ts`**
- `export const GITHUB_TIMEOUT_MS = 10_000`.
- `fetchItem` accepts `opts.timeoutMs`; a single `AbortSignal.timeout(opts.timeoutMs ?? GITHUB_TIMEOUT_MS)` is attached to the item fetch, the comments fetch, and every `rel="next"` page fetch — so the whole lookup (including pagination) is bounded and surfaces as a rejection.

## Where routing moved

Before: `route()` ran inside `Bun.serve`'s `fetch` handler, before `outbox.enqueue` — ACK and persistence were gated on GitHub reverse-link latency.

After: `route()` runs inside `DeliveryDrainer`'s `forward` callback (`new DeliveryDrainer(outbox, async (job) => { route → apply → forwardToGateway })` in `server.ts`). `router.ts` itself is untouched; its internal lookup failure still falls back to the admin channel, so only real `route()` throws or gateway failures produce retry/dead-letter via `outbox.fail`.

## Oracle commands and results

All three oracles run from `receiver/`; raw output attached below.

- `bun run typecheck` → exit 0.
- `bun test test/mapping.test.ts test/server.routing.integration.test.ts` → 25 pass / 0 fail.
- `bun test` → 216 pass / 0 fail across 18 files.

## Test design notes

- The integration test places a re-armable hold/release HTTP gate in front of the GitHub stub and points `STACKOT_GITHUB_API_BASE` at the gate. While held, the child's in-flight lookup cannot reach the stub, making "no GitHub call before ACK" and "hanging lookup still ACKs + commits" deterministic rather than racy. No real network is used.
- Case coverage: (1) 200 accepted + committed row stores the unrouted event (`target: ""`, no `noticeChannelId`) + stub untouched; (2) after release, drain resolves backlink → Gateway receives `대상 스레드: 777`, stored event still unrouted; (3) no-backlink follow-up lands on the admin channel; (4) held gate → still 200 + committed row, row stays `pending`/`delivered_at NULL` with nothing forwarded.

## Remaining risks

- **Re-routing per attempt.** A retry re-runs `route()` (and its GitHub lookup) on every drain attempt. A thread resolved on attempt 1 may resolve differently later; backlink churn between attempts can change the destination. Cost: one lookup per attempt for follow-up/CI events.
- **Stored events are pre-routing.** `outbox.event` now always holds the normalized-but-unrouted payload (`target: ""`, `targetKind` as normalize classified it). Consumers that previously read `target`/`noticeChannelId`/`createThread` from the row (e.g. inspection tooling, `replay.ts` — which only requeues and is unaffected) will see empty targets. Replay actually benefits: a resumed dead-letter is re-resolved against current GitHub state.
- **Route throw semantics preserved but repositioned.** A `route()` exception now fails the delivery job (retry/dead-letter) rather than the request. Lookup failures inside `route` remain admin-fallback, not delivery failures — unchanged.
- **`STACKOT_GITHUB_API_BASE` is process-wide** and read once at startup; it is a test/diagnostic seam, not per-request.
- Drain still waits up to `GITHUB_TIMEOUT_MS` per lookup; a hanging GitHub delays that job by up to 10 s per attempt (previously unbounded).

## Oracle output (verbatim)
```
$ bun run typecheck
$ tsc --noEmit
exit=0

$ bun test test/mapping.test.ts test/server.routing.integration.test.ts
bun test v1.4.0 (34cbb9a40)

test/mapping.test.ts:
(pass) fetchItem > PR lookup reads discussion comments from the issues surface [1.54ms]
(pass) fetchItem > thread URL in a PR discussion comment resolves to the thread id [0.71ms]
(pass) fetchItem > issue lookup still reads the issues surface [0.55ms]
(pass) fetchItem > follows Link rel=next and resolves a thread URL on a later page [0.74ms]
(pass) fetchItem > stops paginating once the thread URL is found [0.53ms]
(pass) fetchItem > stops at opts.maxCommentPages when the next chain outlasts the cap [0.62ms]
(pass) fetchItem > requests comments only once when the response has no Link header [0.57ms]
(pass) fetchItem > sends the Authorization header on every request [0.51ms]
(pass) fetchItem > thread URL in a recorder-authored item body resolves to the thread id [0.53ms]
(pass) fetchItem > a forged body link is skipped and a later recorder comment link is adopted [0.35ms]
(pass) fetchItem timeout (S21b) > GITHUB_TIMEOUT_MS defaults the lookup budget to 10 seconds
(pass) fetchItem timeout (S21b) > rejects promptly against a server that never responds [52.45ms]
(pass) findThreadId backlink trust > accepts a recorder-authored comment link in the configured guild [0.05ms]
(pass) findThreadId backlink trust > accepts a recorder-authored body link in the configured guild [0.01ms]
(pass) findThreadId backlink trust > ignores a link to the same thread id under a different guild
(pass) findThreadId backlink trust > ignores a non-recorder comment link in the configured guild
(pass) findThreadId backlink trust > ignores a non-recorder comment link in another guild [0.01ms]
(pass) findThreadId backlink trust > ignores a recorder-authored link under a different guild
(pass) findThreadId backlink trust > adopts a later valid link when a forged link comes first
(pass) findThreadId backlink trust > matches the recorder login case-insensitively
(pass) findThreadId backlink trust > ignores texts whose author is unknown [0.02ms]

test/server.routing.integration.test.ts:
(pass) S21b persist-then-resolve > ACK persists the unrouted event before any GitHub call [3.31ms]
(pass) S21b persist-then-resolve > drain resolves the backlink and forwards to the mapped thread [51.05ms]
(pass) S21b persist-then-resolve > a follow-up with no backlink is delivered to the admin channel [52.75ms]
(pass) S21b persist-then-resolve > a hanging GitHub lookup still ACKs and commits, leaving the row for retry [403.50ms]

 25 pass
 0 fail
 70 expect() calls
Ran 25 tests across 2 files. [634.00ms]
exit=0

$ bun test
bun test v1.4.0 (34cbb9a40)

test/mapping.test.ts:
(pass) fetchItem > PR lookup reads discussion comments from the issues surface [1.71ms]
(pass) fetchItem > thread URL in a PR discussion comment resolves to the thread id [0.87ms]
(pass) fetchItem > issue lookup still reads the issues surface [0.63ms]
(pass) fetchItem > follows Link rel=next and resolves a thread URL on a later page [0.93ms]
(pass) fetchItem > stops paginating once the thread URL is found [0.60ms]
(pass) fetchItem > stops at opts.maxCommentPages when the next chain outlasts the cap [0.77ms]
(pass) fetchItem > requests comments only once when the response has no Link header [0.52ms]
(pass) fetchItem > sends the Authorization header on every request [0.47ms]
(pass) fetchItem > thread URL in a recorder-authored item body resolves to the thread id [0.52ms]
(pass) fetchItem > a forged body link is skipped and a later recorder comment link is adopted [0.46ms]
(pass) fetchItem timeout (S21b) > GITHUB_TIMEOUT_MS defaults the lookup budget to 10 seconds [0.03ms]
(pass) fetchItem timeout (S21b) > rejects promptly against a server that never responds [52.10ms]
(pass) findThreadId backlink trust > accepts a recorder-authored comment link in the configured guild [0.08ms]
(pass) findThreadId backlink trust > accepts a recorder-authored body link in the configured guild [0.02ms]
(pass) findThreadId backlink trust > ignores a link to the same thread id under a different guild [0.01ms]
(pass) findThreadId backlink trust > ignores a non-recorder comment link in the configured guild
(pass) findThreadId backlink trust > ignores a non-recorder comment link in another guild [0.01ms]
(pass) findThreadId backlink trust > ignores a recorder-authored link under a different guild
(pass) findThreadId backlink trust > adopts a later valid link when a forged link comes first [0.01ms]
(pass) findThreadId backlink trust > matches the recorder login case-insensitively [0.01ms]
(pass) findThreadId backlink trust > ignores texts whose author is unknown [0.02ms]

test/server.outbox.failure.integration.test.ts:
(pass) S09B outbox write failure > healthy path regression: 200 accepted with the row committed at response time [6.73ms]
(pass) S09B outbox write failure > a contended write returns an explicit 5xx with no ACK and no row, then recovers [5007.17ms]

test/server.restart.integration.test.ts:
(pass) Receiver restart recovery > 502 pending delivery is forwarded after restart with same idempotency key [2168.18ms]

test/server.outbox.integration.test.ts:
(pass) S09A outbox before ACK > a 200 accepted response means the delivery row is already committed [3.94ms]
(pass) S09A outbox before ACK > the same delivery id is answered as a duplicate without a second row [1.48ms]

test/server.repository.integration.test.ts:
(pass) POST /webhook repository shape > invalid repository shapes are 400 before dedupe [62.65ms]

test/server.malformed.integration.test.ts:
(pass) POST /webhook malformed JSON > 400 without reserving the delivery id; same id then accepted once [60.80ms]

test/routing.test.ts:
(pass) check_run linked PR preservation (S20) > failed check_run with linked PR keeps prNumbers, item, and summary ref [0.06ms]
(pass) check_run linked PR preservation (S20) > multiple linked PRs preserve order and dedupe [0.03ms]
(pass) check_run linked PR preservation (S20) > missing pull_requests → prNumbers unset, still channel target [0.02ms]
(pass) check_run linked PR preservation (S20) > empty pull_requests array → prNumbers unset or empty, still channel target [0.02ms]
(pass) check_run linked PR preservation (S20) > malformed number entries are dropped [0.03ms]
(pass) check_run linked PR preservation (S20) > conclusion success → null [0.01ms]
(pass) check_run linked PR preservation (S20) > conclusion skipped → null
(pass) check_run linked PR preservation (S20) > conclusion neutral → null
(pass) check_run linked PR preservation (S20) > missing conclusion → null
(pass) check_run linked PR preservation (S20) > non-completed action → null
(pass) route() decision table (S21) > opened issue on configured repo → issues forum createThread [0.31ms]
(pass) route() decision table (S21) > opened PR on configured repo → prs forum createThread [0.01ms]
(pass) route() decision table (S21) > issue follow-up resolved → mapped thread [0.08ms]
(pass) route() decision table (S21) > PR follow-up resolved → mapped thread
no thread mapping for a/repo issue #42
(pass) route() decision table (S21) > follow-up unresolved → admin channel [0.02ms]
(pass) route() decision table (S21) > CI + linked PR thread resolved → PR thread + ci-alerts notice
(pass) route() decision table (S21) > CI + linked PR thread unresolved → ci-alerts channel
(pass) route() decision table (S21) > CI + no linked PR → ci-alerts channel, no lookup
repo not configured: ghost/repo
(pass) route() decision table (S21) > unconfigured repo → admin channel
(pass) route() decision table (S21) > repos do not cross: each event uses its own forums and lookups [0.17ms]
mapping lookup failed for a/repo issues #42: warn: github api down
      at boom (/Users/justn/dev/.worktrees/stackot-s21b-20260921/receiver/test/routing.test.ts:234:17)
      at lookup (/Users/justn/dev/.worktrees/stackot-s21b-20260921/receiver/src/router.ts:40:23)
      at route (/Users/justn/dev/.worktrees/stackot-s21b-20260921/receiver/src/router.ts:83:28)
      at <anonymous> (/Users/justn/dev/.worktrees/stackot-s21b-20260921/receiver/test/routing.test.ts:236:28)

no thread mapping for a/repo issue #42
mapping lookup failed for a/repo pulls #17: warn: github api down
      at boom (/Users/justn/dev/.worktrees/stackot-s21b-20260921/receiver/test/routing.test.ts:234:17)
      at lookup (/Users/justn/dev/.worktrees/stackot-s21b-20260921/receiver/src/router.ts:40:23)
      at route (/Users/justn/dev/.worktrees/stackot-s21b-20260921/receiver/src/router.ts:60:30)
      at <anonymous> (/Users/justn/dev/.worktrees/stackot-s21b-20260921/receiver/test/routing.test.ts:238:22)

(pass) route() decision table (S21) > resolveThreadId throwing falls back without crashing [0.20ms]
(pass) gateway notice channel line (S21) > noticeChannelId adds a CI 알림 채널 line [1.54ms]
(pass) gateway notice channel line (S21) > absent noticeChannelId leaves the message unchanged [0.69ms]

test/normalize.test.ts:
(pass) normalize > issue opened → channel target with createThread marker [0.04ms]
(pass) normalize > issue labeled (uninteresting action) → null [0.01ms]
(pass) normalize > issue comment → thread target [0.02ms]
(pass) normalize > PR closed merged → merged tail [0.02ms]
(pass) normalize > failed check_run → channel target [0.03ms]
(pass) normalize > failed check_run with pull_requests → prNumbers preserved [0.03ms]
(pass) normalize > successful check_run → null [0.01ms]
(pass) routing classification (S16) > issues.opened → targetKind channel [0.02ms]
(pass) routing classification (S16) > issues.edited → targetKind thread
(pass) routing classification (S16) > issues.closed → targetKind thread
(pass) routing classification (S16) > issues.reopened → targetKind thread
(pass) routing classification (S16) > pull_request.opened → targetKind channel [0.01ms]
(pass) routing classification (S16) > pull_request.edited → targetKind thread
(pass) routing classification (S16) > pull_request.synchronize → targetKind thread
(pass) routing classification (S16) > pull_request.closed → targetKind thread
(pass) mapping > threadTitle clamps to 100 chars [0.03ms]
(pass) mapping > findThreadId reads body first, then comments [0.06ms]

test/server.size.integration.test.ts:
(pass) POST /webhook body limit > signed oversized body is 413 before dedupe [59.26ms]

test/server.routing.integration.test.ts:
(pass) S21b persist-then-resolve > ACK persists the unrouted event before any GitHub call [4.35ms]
(pass) S21b persist-then-resolve > drain resolves the backlink and forwards to the mapped thread [52.15ms]
(pass) S21b persist-then-resolve > a follow-up with no backlink is delivered to the admin channel [52.62ms]
(pass) S21b persist-then-resolve > a hanging GitHub lookup still ACKs and commits, leaving the row for retry [406.37ms]

test/ingress.test.ts:
(pass) readBodyWithinLimit > null stream returns empty bytes [0.39ms]
(pass) readBodyWithinLimit > accumulates chunks up to the exact limit [0.31ms]
(pass) readBodyWithinLimit > throws PayloadTooLargeError when a chunk would exceed the limit [0.29ms]
(pass) readBodyWithinLimit > rejects negative or non-finite maxBytes with RangeError [0.17ms]
(pass) requireDeliveryId > returns the delivery id and rejects missing or blank headers [0.12ms]

test/outbox.test.ts:
(pass) failed delivery survives restart and retains dedupe after success [11.02ms]
(pass) dedupe retention begins when a delayed delivery succeeds [13.63ms]
(pass) existing outbox schema gains delivery timestamp without losing pending events [9.27ms]
(pass) constructor creates missing nested parent directories for the database path [7.15ms]
(pass) fifth failure becomes dead_letter with last_error and is no longer due [5.80ms]
(pass) last_error migration preserves a pending legacy outbox row [5.09ms]
(pass) drainer dead-letters a permanently failing job and due() stays empty [4.87ms]
(pass) below-limit fail keeps the row pending, backs off, and returns to due() [3.63ms]
(pass) requeue moves only a dead_letter row back to pending [3.19ms]
(pass) two connections racing the same delivery id produce exactly one row [3.46ms]
(pass) enqueue waits out a briefly held write lock instead of throwing SQLITE_BUSY [116.32ms]
(pass) a pending row is still due after close and reopen [7.20ms]

test/replay.test.ts:
(pass) replays one dead_letter row by exact id: due() returns it with attempts preserved [3.01ms]
(pass) replaying the same id again reports a non-target result and changes nothing [2.80ms]
(pass) other dead_letter and delivered rows are untouched by a replay [2.98ms]
(pass) CLI replays by exact id: exit 0 on resume, exit 1 on non-target [48.75ms]

test/verify.test.ts:
(pass) verifySignature > accepts valid signature [0.06ms]
(pass) verifySignature > rejects wrong signature [0.01ms]
(pass) verifySignature > rejects missing or malformed header [0.01ms]
(pass) verifySignature > rejects tampered body
(pass) Dedupe > first sight true, duplicate false [2.27ms]
(pass) Dedupe > empty id passes through [1.67ms]

test/gateway.test.ts:
(pass) forwardToGateway > sends framed message with idempotency key [1.04ms]
(pass) forwardToGateway > exposes the default timeout as GATEWAY_TIMEOUT_MS
(pass) forwardToGateway > rejects a hanging gateway in bounded time (timeoutMs: 50) [52.77ms]
(pass) forwardToGateway > returns ok:false on 502 without throwing [1.28ms]
(pass) forwardToGateway > uses the default timeout when opts are omitted [0.94ms]

test/server.delivery.integration.test.ts:
(pass) POST /webhook X-GitHub-Delivery > readyz stays ready while Gateway is unreachable [0.33ms]
(pass) POST /webhook X-GitHub-Delivery > missing header → 400 before dedupe [0.92ms]
(pass) POST /webhook X-GitHub-Delivery > whitespace header → 400 before dedupe [0.26ms]
(pass) POST /webhook X-GitHub-Delivery > rejected requests insert no delivery rows [0.86ms]

test/config.test.ts:
(pass) loadConfig > accepts multi-repo config with defaults [1.06ms]
(pass) loadConfig > rejects missing repos [0.37ms]
(pass) loadConfig > rejects empty repos [0.33ms]
(pass) loadConfig > rejects repo entry missing forum channel [0.60ms]
(pass) loadConfig > rejects malformed repo key [0.37ms]
(pass) loadConfig > rejects repos issuesForumChannelId: missing [0.36ms]
(pass) loadConfig > rejects repos prsForumChannelId: missing [0.34ms]
(pass) loadConfig > rejects repos issuesForumChannelId: empty string [0.26ms]
(pass) loadConfig > rejects repos prsForumChannelId: empty string [0.28ms]
(pass) loadConfig > rejects repos issuesForumChannelId: whitespace-only string [0.36ms]
(pass) loadConfig > rejects repos prsForumChannelId: whitespace-only string [0.26ms]
(pass) loadConfig > rejects repos issuesForumChannelId: number [0.29ms]
(pass) loadConfig > rejects repos prsForumChannelId: number [0.26ms]
(pass) loadConfig > rejects repos issuesForumChannelId: boolean [0.28ms]
(pass) loadConfig > rejects repos prsForumChannelId: boolean [0.23ms]
(pass) loadConfig > rejects repos issuesForumChannelId: null [0.23ms]
(pass) loadConfig > rejects repos prsForumChannelId: null [0.23ms]
(pass) loadConfig > rejects repos issuesForumChannelId: object [0.21ms]
(pass) loadConfig > rejects repos prsForumChannelId: object [0.23ms]
(pass) loadConfig > rejects repos issuesForumChannelId: array [0.25ms]
(pass) loadConfig > rejects repos prsForumChannelId: array [0.46ms]
(pass) loadConfig > rejects repos issuesForumChannelId: single placeholder [0.39ms]
(pass) loadConfig > rejects repos prsForumChannelId: single placeholder [0.24ms]
(pass) loadConfig > rejects repos issuesForumChannelId: padded placeholder [0.24ms]
(pass) loadConfig > rejects repos prsForumChannelId: padded placeholder [0.31ms]
(pass) loadConfig > rejects repo entry where both forum channel IDs are placeholders [0.29ms]
(pass) loadConfig > error names the offending repo and key among multiple repos [0.31ms]
(pass) loadConfig > accepts real-looking forum channel IDs and non-single-placeholder brackets [0.82ms]
(pass) loadConfig > rejects missing shared fields [0.31ms]
(pass) loadConfig > rejects githubWebhookSecret: missing [0.32ms]
(pass) loadConfig > rejects githubWebhookSecret: null [0.23ms]
(pass) loadConfig > rejects githubWebhookSecret: empty string [0.24ms]
(pass) loadConfig > rejects githubWebhookSecret: whitespace-only string [0.24ms]
(pass) loadConfig > rejects githubWebhookSecret: number [0.20ms]
(pass) loadConfig > rejects githubWebhookSecret: boolean [0.35ms]
(pass) loadConfig > rejects githubWebhookSecret: object [0.37ms]
(pass) loadConfig > preserves githubWebhookSecret bytes verbatim [0.27ms]
(pass) loadConfig > rejects githubWebhookSecret that is an angle-bracket placeholder after trim [0.49ms]
(pass) loadConfig > accepts githubWebhookSecret containing angle brackets as ordinary text [0.24ms]
(pass) loadConfig > rejects placeholder openclawHookToken [0.23ms]
(pass) loadConfig > accepts openclawHookToken containing angle brackets [0.42ms]
(pass) loadConfig > rejects githubToken that is a single placeholder [0.22ms]
(pass) loadConfig > accepts githubToken containing brackets as non-placeholder [0.23ms]
(pass) loadConfig > accepts githubToken '<a><b>' as non-placeholder [0.22ms]
(pass) loadConfig > rejects ciAlertsChannelId <...> placeholder [0.22ms]
(pass) loadConfig > accepts ciAlertsChannelId containing brackets as non-placeholder [0.42ms]
(pass) loadConfig > rejects adminChannelId placeholder [0.45ms]
(pass) loadConfig > accepts adminChannelId with brackets that is not a single placeholder [0.23ms]
(pass) loadConfig > preserves boundary ports 1 and 65535 [0.49ms]
(pass) loadConfig > rejects port: zero [0.26ms]
(pass) loadConfig > rejects port: negative [0.34ms]
(pass) loadConfig > rejects port: above max [0.35ms]
(pass) loadConfig > rejects port: fractional [0.24ms]
(pass) loadConfig > rejects port: string [0.21ms]
(pass) loadConfig > rejects port: boolean [0.23ms]
(pass) loadConfig > rejects port: null [0.24ms]
(pass) loadConfig > rejects port: object [0.39ms]
(pass) loadConfig > rejects port: array [0.27ms]
(pass) loadConfig > rejects openclawHooksUrl: missing [0.55ms]
(pass) loadConfig > rejects openclawHooksUrl: null [0.28ms]
(pass) loadConfig > rejects openclawHooksUrl: empty string [0.37ms]
(pass) loadConfig > rejects openclawHooksUrl: whitespace-only string [0.32ms]
(pass) loadConfig > rejects openclawHooksUrl: leading space [0.26ms]
(pass) loadConfig > rejects openclawHooksUrl: trailing tab [0.24ms]
(pass) loadConfig > rejects openclawHooksUrl: relative path [0.26ms]
(pass) loadConfig > rejects openclawHooksUrl: no scheme [0.24ms]
(pass) loadConfig > rejects openclawHooksUrl: bare host:port [0.32ms]
(pass) loadConfig > rejects openclawHooksUrl: scheme-like non-http [0.23ms]
(pass) loadConfig > rejects openclawHooksUrl: malformed [0.20ms]
(pass) loadConfig > rejects openclawHooksUrl: ftp protocol [0.22ms]
(pass) loadConfig > rejects openclawHooksUrl: file protocol [0.20ms]
(pass) loadConfig > rejects openclawHooksUrl: number [0.21ms]
(pass) loadConfig > rejects openclawHooksUrl: boolean [0.19ms]
(pass) loadConfig > rejects openclawHooksUrl: object [0.19ms]
(pass) loadConfig > rejects openclawHooksUrl: array [0.20ms]
(pass) loadConfig > preserves valid http loopback and https hooks URLs byte-for-byte [0.70ms]
(pass) loadConfig > rejects discordGuildId: missing [0.22ms]
(pass) loadConfig > rejects discordGuildId: null [0.20ms]
(pass) loadConfig > rejects discordGuildId: empty string [0.20ms]
(pass) loadConfig > rejects discordGuildId: whitespace-only string [0.18ms]
(pass) loadConfig > rejects discordGuildId: placeholder [0.19ms]
(pass) loadConfig > rejects discordGuildId: padded placeholder [0.19ms]
(pass) loadConfig > rejects discordGuildId: non-numeric [0.18ms]
(pass) loadConfig > rejects discordGuildId: mixed alphanumeric [0.43ms]
(pass) loadConfig > rejects discordGuildId: decimal string [0.20ms]
(pass) loadConfig > rejects discordGuildId: padded digits [0.19ms]
(pass) loadConfig > rejects discordGuildId: number [0.17ms]
(pass) loadConfig > rejects discordGuildId: boolean [0.21ms]
(pass) loadConfig > accepts a long numeric discordGuildId verbatim [0.25ms]
(pass) loadConfig > rejects githubBacklinkLogin: missing [0.26ms]
(pass) loadConfig > rejects githubBacklinkLogin: null [0.20ms]
(pass) loadConfig > rejects githubBacklinkLogin: empty string [0.21ms]
(pass) loadConfig > rejects githubBacklinkLogin: whitespace-only string [0.18ms]
(pass) loadConfig > rejects githubBacklinkLogin: placeholder [0.19ms]
(pass) loadConfig > rejects githubBacklinkLogin: padded placeholder [0.31ms]
(pass) loadConfig > rejects githubBacklinkLogin: with space [0.20ms]
(pass) loadConfig > rejects githubBacklinkLogin: with @ [0.18ms]
(pass) loadConfig > rejects githubBacklinkLogin: with slash [0.20ms]
(pass) loadConfig > rejects githubBacklinkLogin: number [0.21ms]
(pass) loadConfig > rejects githubBacklinkLogin: boolean [0.20ms]
(pass) loadConfig > accepts regular and app-style githubBacklinkLogin values [0.67ms]

test/delivery.test.ts:
(pass) delivers pending job once on successful forward [0.10ms]
(pass) fails rejected forward with incremented attempts and status detail [0.06ms]
(pass) fails thrown forward with incremented attempts and the error message [0.05ms]
(pass) fails rejected forward at the attempt limit with status detail [0.05ms]
(pass) fails thrown forward at the attempt limit with the error message [0.04ms]
(pass) outbox.retry schedules exponential backoff capped at one minute [5.96ms]

 216 pass
 0 fail
 478 expect() calls
Ran 216 tests across 18 files. [8.56s]
exit=0
```
