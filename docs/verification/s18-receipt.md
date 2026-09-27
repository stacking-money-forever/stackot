# S18 receipt — 역링크 댓글 pagination

Base: `7bd0a3c` (worktree HEAD at launch). Worker made no commit/push; candidate is the working-tree delta.

## 변경 파일

- `receiver/src/mapping.ts`
- `receiver/test/mapping.test.ts`

`git status` shows exactly these two files modified; nothing else touched. (`bun install` was run once — `node_modules` was absent; `bun.lock` is gitignored and no new packages were added.)

## 핵심 diff 요약

### `receiver/src/mapping.ts`

- New export `MAX_COMMENT_PAGES = 10` — hard cap on comment pages fetched per item.
- New private helper `nextPageUrl(link)`: parses a GitHub `Link` header and returns the `rel="next"` URL, or `null`. The server-provided URL is used verbatim; no `page` parameter is guessed.
- `fetchItem` opts extended: `{ apiBase?: string; maxCommentPages?: number }` (cap defaults to `MAX_COMMENT_PAGES`). Signature stays backward-compatible — `server.ts` needs no change.
- Item body + first comments page are still fetched in parallel with the same URLs (`/${kind}/${number}` and `/${commentsKind}/${number}/comments?per_page=20`); the `commentsKind` issues-surface rule for PRs is unchanged.
- After page 1, a `for` loop follows `rel="next"` while `pages < maxPages && !findThreadId(result)`: each fetched page is appended, then the loop re-checks the accumulated body+comments before requesting the next page — so pagination stops immediately once the thread URL is found, and never exceeds the cap. A non-`ok` page response breaks the loop and returns what was collected (same graceful treatment as the original `commentsRes.ok ? … : []`).
- Every page request sends the same `headers` object including `Authorization: Bearer <token>`.
- `findThreadId` semantics unchanged.

### `receiver/test/mapping.test.ts`

- `stubGitHub` now accepts either a plain JSON body (existing shape, unchanged) or a `(url: URL) => Response` handler per route, so a stub can emit `Link` headers and branch on the query. No global `fetch` patching; no real network.
- All four S17 tests kept verbatim and still pass (path contract, `per_page=20`, issue regression, auth header).
- New tests:
  - **Later-page recovery**: page 1 has no thread URL and returns `Link: <…?per_page=20&cursor=opaque-page-2>; rel="next"` (a deliberately non-`page=` URL, proving the next URL is used verbatim rather than guessed); page 2 carries the thread URL → `findThreadId` returns `777`, exactly 2 comment requests observed, both with `Authorization: Bearer test-token`.
  - **Early termination**: page 1 contains the thread URL *and* advertises `rel="next"` → exactly 1 comment request; page 2 is never fetched.
  - **Cap**: `maxCommentPages: 3` against an infinite `rel="next"` chain with no thread URL → exactly 3 comment requests, 3 comments collected, `findThreadId` → `null` (normal return, existing fallback path preserved).
  - **No-Link regression**: plain array response with no `Link` header → exactly 1 comment request.

## 실행한 명령과 결과 (원문)

### `cd receiver && bun run typecheck`

```
$ tsc --noEmit
```

(exit 0, no output)

### `cd receiver && bun test test/mapping.test.ts`

```
bun test v1.4.0 (34cbb9a40)

test/mapping.test.ts:
(pass) fetchItem > PR lookup reads discussion comments from the issues surface [2.88ms]
(pass) fetchItem > thread URL in a PR discussion comment resolves to the thread id [0.81ms]
(pass) fetchItem > issue lookup still reads the issues surface [0.74ms]
(pass) fetchItem > follows Link rel=next and resolves a thread URL on a later page [2.09ms]
(pass) fetchItem > stops paginating once the thread URL is found [1.10ms]
(pass) fetchItem > stops at opts.maxCommentPages when the next chain outlasts the cap [1.57ms]
(pass) fetchItem > requests comments only once when the response has no Link header [0.98ms]
(pass) fetchItem > sends the Authorization header on every request [0.58ms]

 8 pass
 0 fail
 27 expect() calls
Ran 8 tests across 1 file. [17.00ms]
```

### `cd receiver && bun test`

```
bun test v1.4.0 (34cbb9a40)

test/mapping.test.ts:
(pass) fetchItem > PR lookup reads discussion comments from the issues surface [1.78ms]
(pass) fetchItem > thread URL in a PR discussion comment resolves to the thread id [0.60ms]
(pass) fetchItem > issue lookup still reads the issues surface [0.53ms]
(pass) fetchItem > follows Link rel=next and resolves a thread URL on a later page [0.90ms]
(pass) fetchItem > stops paginating once the thread URL is found [0.59ms]
(pass) fetchItem > stops at opts.maxCommentPages when the next chain outlasts the cap [0.74ms]
(pass) fetchItem > requests comments only once when the response has no Link header [0.52ms]
(pass) fetchItem > sends the Authorization header on every request [0.60ms]

test/server.restart.integration.test.ts:
(pass) Receiver restart recovery > 502 pending delivery is forwarded after restart with same idempotency key [2136.91ms]

test/server.repository.integration.test.ts:
(pass) POST /webhook repository shape > invalid repository shapes are 400 before dedupe [62.11ms]

test/server.malformed.integration.test.ts:
(pass) POST /webhook malformed JSON > 400 without reserving the delivery id; same id then accepted once [57.66ms]

test/normalize.test.ts:
(pass) normalize > issue opened → channel target with createThread marker [0.29ms]
(pass) normalize > issue labeled (uninteresting action) → null [0.02ms]
(pass) normalize > issue comment → thread target [0.03ms]
(pass) normalize > PR closed merged → merged tail [0.02ms]
(pass) normalize > failed check_run → channel target [0.02ms]
(pass) normalize > successful check_run → null [0.01ms]
(pass) routing classification (S16) > issues.opened → targetKind channel [0.02ms]
(pass) routing classification (S16) > issues.edited → targetKind thread
(pass) routing classification (S16) > issues.closed → targetKind thread
(pass) routing classification (S16) > issues.reopened → targetKind thread
(pass) routing classification (S16) > pull_request.opened → targetKind channel [0.02ms]
(pass) routing classification (S16) > pull_request.edited → targetKind thread
(pass) routing classification (S16) > pull_request.synchronize → targetKind thread
(pass) routing classification (S16) > pull_request.closed → targetKind thread
(pass) mapping > threadTitle clamps to 100 chars [0.03ms]
(pass) mapping > findThreadId reads body first, then comments [0.03ms]

test/server.size.integration.test.ts:
(pass) POST /webhook body limit > signed oversized body is 413 before dedupe [58.03ms]

test/ingress.test.ts:
(pass) readBodyWithinLimit > null stream returns empty bytes [0.18ms]
(pass) readBodyWithinLimit > accumulates chunks up to the exact limit [0.16ms]
(pass) readBodyWithinLimit > throws PayloadTooLargeError when a chunk would exceed the limit [0.11ms]
(pass) readBodyWithinLimit > rejects negative or non-finite maxBytes with RangeError [0.06ms]
(pass) requireDeliveryId > returns the delivery id and rejects missing or blank headers [0.06ms]

test/outbox.test.ts:
(pass) failed delivery survives restart and retains dedupe after success [7.11ms]
(pass) dedupe retention begins when a delayed delivery succeeds [7.58ms]
(pass) existing outbox schema gains delivery timestamp without losing pending events [3.90ms]
(pass) constructor creates missing nested parent directories for the database path [2.77ms]
(pass) fifth failure becomes dead_letter with last_error and is no longer due [2.36ms]
(pass) last_error migration preserves a pending legacy outbox row [3.06ms]
(pass) drainer dead-letters a permanently failing job and due() stays empty [2.80ms]
(pass) below-limit fail keeps the row pending, backs off, and returns to due() [2.09ms]
(pass) requeue moves only a dead_letter row back to pending [2.23ms]

test/replay.test.ts:
(pass) replays one dead_letter row by exact id: due() returns it with attempts preserved [2.35ms]
(pass) replaying the same id again reports a non-target result and changes nothing [2.22ms]
(pass) other dead_letter and delivered rows are untouched by a replay [2.29ms]
(pass) CLI replays by exact id: exit 0 on resume, exit 1 on non-target [48.15ms]

test/verify.test.ts:
(pass) verifySignature > accepts valid signature [0.06ms]
(pass) verifySignature > rejects wrong signature [0.01ms]
(pass) verifySignature > rejects missing or malformed header
(pass) verifySignature > rejects tampered body [0.01ms]
(pass) Dedupe > first sight true, duplicate false [1.95ms]
(pass) Dedupe > empty id passes through [1.28ms]

test/gateway.test.ts:
(pass) forwardToGateway > sends framed message with idempotency key [1.19ms]

test/server.delivery.integration.test.ts:
(pass) POST /webhook X-GitHub-Delivery > readyz stays ready while Gateway is unreachable [0.26ms]
(pass) POST /webhook X-GitHub-Delivery > missing header → 400 before dedupe [0.54ms]
(pass) POST /webhook X-GitHub-Delivery > whitespace header → 400 before dedupe [0.19ms]
(pass) POST /webhook X-GitHub-Delivery > rejected requests insert no delivery rows [0.59ms]

test/config.test.ts:
(pass) loadConfig > accepts multi-repo config with defaults [0.56ms]
(pass) loadConfig > rejects missing repos [0.25ms]
(pass) loadConfig > rejects empty repos [0.20ms]
(pass) loadConfig > rejects repo entry missing forum channel [0.31ms]
(pass) loadConfig > rejects malformed repo key [0.21ms]
(pass) loadConfig > rejects missing shared fields [0.22ms]
(pass) loadConfig > rejects githubWebhookSecret: missing [0.23ms]
(pass) loadConfig > rejects githubWebhookSecret: null [0.16ms]
(pass) loadConfig > rejects githubWebhookSecret: empty string [0.19ms]
(pass) loadConfig > rejects githubWebhookSecret: whitespace-only string [0.18ms]
(pass) loadConfig > rejects githubWebhookSecret: number [0.18ms]
(pass) loadConfig > rejects githubWebhookSecret: boolean [0.19ms]
(pass) loadConfig > rejects githubWebhookSecret: object [0.16ms]
(pass) loadConfig > preserves githubWebhookSecret bytes verbatim [0.21ms]
(pass) loadConfig > rejects githubWebhookSecret that is an angle-bracket placeholder after trim [0.34ms]
(pass) loadConfig > accepts githubWebhookSecret containing angle brackets as ordinary text [0.22ms]
(pass) loadConfig > rejects placeholder openclawHookToken [0.18ms]
(pass) loadConfig > accepts openclawHookToken containing angle brackets [0.30ms]
(pass) loadConfig > rejects githubToken that is a single placeholder [0.18ms]
(pass) loadConfig > accepts githubToken containing brackets as non-placeholder [0.17ms]
(pass) loadConfig > accepts githubToken '<a><b>' as non-placeholder [0.15ms]
(pass) loadConfig > rejects ciAlertsChannelId <...> placeholder [0.14ms]
(pass) loadConfig > accepts ciAlertsChannelId containing brackets as non-placeholder [0.28ms]
(pass) loadConfig > rejects adminChannelId placeholder [0.30ms]
(pass) loadConfig > accepts adminChannelId with brackets that is not a single placeholder [0.15ms]
(pass) loadConfig > preserves boundary ports 1 and 65535 [0.39ms]
(pass) loadConfig > rejects port: zero [0.16ms]
(pass) loadConfig > rejects port: negative [0.13ms]
(pass) loadConfig > rejects port: above max [0.18ms]
(pass) loadConfig > rejects port: fractional [0.14ms]
(pass) loadConfig > rejects port: string [0.13ms]
(pass) loadConfig > rejects port: boolean [0.14ms]
(pass) loadConfig > rejects port: null [0.15ms]
(pass) loadConfig > rejects port: object [0.14ms]
(pass) loadConfig > rejects port: array [0.20ms]
(pass) loadConfig > rejects openclawHooksUrl: missing [0.27ms]
(pass) loadConfig > rejects openclawHooksUrl: null [0.17ms]
(pass) loadConfig > rejects openclawHooksUrl: empty string [0.15ms]
(pass) loadConfig > rejects openclawHooksUrl: whitespace-only string [0.14ms]
(pass) loadConfig > rejects openclawHooksUrl: leading space [0.15ms]
(pass) loadConfig > rejects openclawHooksUrl: trailing tab [0.16ms]
(pass) loadConfig > rejects openclawHooksUrl: relative path [0.15ms]
(pass) loadConfig > rejects openclawHooksUrl: no scheme [0.15ms]
(pass) loadConfig > rejects openclawHooksUrl: bare host:port [0.14ms]
(pass) loadConfig > rejects openclawHooksUrl: scheme-like non-http [0.12ms]
(pass) loadConfig > rejects openclawHooksUrl: malformed [0.13ms]
(pass) loadConfig > rejects openclawHooksUrl: ftp protocol [0.14ms]
(pass) loadConfig > rejects openclawHooksUrl: file protocol [0.14ms]
(pass) loadConfig > rejects openclawHooksUrl: number [0.13ms]
(pass) loadConfig > rejects openclawHooksUrl: boolean [0.15ms]
(pass) loadConfig > rejects openclawHooksUrl: object [0.14ms]
(pass) loadConfig > rejects openclawHooksUrl: array [0.14ms]
(pass) loadConfig > preserves valid http loopback and https hooks URLs byte-for-byte [0.44ms]

test/delivery.test.ts:
(pass) delivers pending job once on successful forward [0.08ms]
(pass) fails rejected forward with incremented attempts and status detail [0.05ms]
(pass) fails thrown forward with incremented attempts and the error message [0.03ms]
(pass) fails rejected forward at the attempt limit with status detail [0.04ms]
(pass) fails thrown forward at the attempt limit with the error message [0.03ms]

 115 pass
 0 fail
 247 expect() calls
Ran 115 tests across 14 files. [2.50s]
```

## 남은 리스크

- **Cap-reached behaviour**: if the `rel="next"` chain outlasts `maxCommentPages` (default 10 = up to 200 comments) without a thread URL, `fetchItem` returns normally with the pages collected so far; `findThreadId` then yields `null` and the event takes the existing fallback to the admin channel. A thread URL recorded beyond page 10 is still missed — bounded by design, not a regression from the previous single-page behaviour.
- **First page is unconditional**: the item and page-1 comments requests are still issued in parallel, so `maxCommentPages` values below 1 cannot reduce below the single inherent comments request (cap semantics: total comment requests = `min(maxPages, chain length)`, minimum 1). The early-termination check runs before each *subsequent* page only, which is the only place a request can be skipped.
- **Non-`ok` later page**: a failed page ≥2 silently truncates the comment list and returns what was gathered (consistent with the pre-existing `commentsRes.ok ? … : []` treatment); no retry or error is raised.
- **Contract-level only** (carried from S17): `server.ts` calls `fetchItem` without `apiBase`, so the running receiver talks to the live GitHub API; the pagination path is verified against a local stub, not end-to-end with real credentials.
- `Link` header parsing matches the standard `<url>; rel="next"` comma-separated format; a malformed header is treated as "no next page" and stops pagination rather than erroring.
