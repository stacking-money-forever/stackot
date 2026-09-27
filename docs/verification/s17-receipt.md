# S17 receipt — PR general-comment backlink lookup

Worker candidate. No commit/push/merge performed. HEAD unchanged at `00f5fb2`.

## Changed files

- `receiver/src/mapping.ts` (modified)
- `receiver/test/mapping.test.ts` (new)
- `docs/verification/s17-receipt.md` (this file)

`git status --short` in the task checkout shows exactly ` M receiver/src/mapping.ts` and `?? receiver/test/mapping.test.ts` before this receipt was written. `bun install` was run once (no `node_modules` existed); it resolved `@types/bun@1.4.2` and `typescript@7.0.2` from cache. `receiver/bun.lock` and `node_modules` are gitignored, so no stray tracked files.

## Core diff summary

`fetchItem(cfg, repo, kind, number, opts?)` in `mapping.ts`:

- Comments request now uses `commentsKind = kind === "pulls" ? "issues" : kind`, so a PR's **general discussion comments** are read from `/repos/<repo>/issues/<n>/comments?per_page=20`. GitHub serves PR discussion comments on the issues surface; `/pulls/<n>/comments` is the inline review-comment surface where the bot never records thread URLs.
- The item body is still fetched from the surface that provides it: `/pulls/<n>` for PRs, `/issues/<n>` for issues — unchanged.
- Exactly one comments request per lookup (still a single `Promise.all` of two fetches); the two comment surfaces are never both queried or merged.
- New optional trailing parameter `opts: { apiBase?: string }` (default `https://api.github.com`) so tests can point at a local stub. The `server.ts` call site `fetchItem(cfg, ev.repo, kind, number)` is untouched and unchanged in behavior.
- `findThreadId` semantics unchanged: body first, then comments, first Discord thread URL wins.

`test/mapping.test.ts` (new, 4 tests / 14 assertions) uses a `Bun.serve` stub on `127.0.0.1:0` that records the pathname, search, and Authorization header of every request. No real network, no fetch monkey-patching:

1. **URL contract** — PR lookup: stub receives `/repos/example/app/pulls/7` and `/repos/example/app/issues/7/comments` (with `?per_page=20`); asserts no request hits `/pulls/7/comments` and exactly 2 requests total. Under the old code this fails: the issues-comments path is never requested.
2. **Behavior** — a Discord thread URL (`…/channels/111/555`) in a PR discussion comment is recovered: `findThreadId(await fetchItem(…, "pulls", 7, …)) === "555"`, and `item.body === "pr body"` from the pulls surface.
3. **Issue regression** — `kind: "issues"` still hits `/issues/42` + `/issues/42/comments` (2 requests) and resolves the comment-recorded thread id `333`.
4. **Auth** — every recorded request carries `Authorization: Bearer test-token`.

## Oracle output (verbatim)

### `cd receiver && bun run typecheck`

```
$ tsc --noEmit
```

(exit 0, no output)

### `cd receiver && bun test test/mapping.test.ts`

```
bun test v1.4.0 (34cbb9a40)

test/mapping.test.ts:
(pass) fetchItem > PR lookup reads discussion comments from the issues surface [1.93ms]
(pass) fetchItem > thread URL in a PR discussion comment resolves to the thread id [0.72ms]
(pass) fetchItem > issue lookup still reads the issues surface [0.71ms]
(pass) fetchItem > sends the Authorization header on every request [0.54ms]

 4 pass
 0 fail
 14 expect() calls
Ran 4 tests across 1 file. [8.00ms]
```

### `cd receiver && bun test`

```
bun test v1.4.0 (34cbb9a40)

test/mapping.test.ts:
(pass) fetchItem > PR lookup reads discussion comments from the issues surface [2.05ms]
(pass) fetchItem > thread URL in a PR discussion comment resolves to the thread id [0.79ms]
(pass) fetchItem > issue lookup still reads the issues surface [0.81ms]
(pass) fetchItem > sends the Authorization header on every request [0.64ms]

test/server.restart.integration.test.ts:
(pass) Receiver restart recovery > 502 pending delivery is forwarded after restart with same idempotency key [2181.30ms]

test/server.repository.integration.test.ts:
(pass) POST /webhook repository shape > invalid repository shapes are 400 before dedupe [57.27ms]

test/server.malformed.integration.test.ts:
(pass) POST /webhook malformed JSON > 400 without reserving the delivery id; same id then accepted once [56.92ms]

test/normalize.test.ts:
(pass) normalize > issue opened → channel target with createThread marker [0.15ms]
(pass) normalize > issue labeled (uninteresting action) → null
(pass) normalize > issue comment → thread target [0.01ms]
(pass) normalize > PR closed merged → merged tail
(pass) normalize > failed check_run → channel target [0.03ms]
(pass) normalize > successful check_run → null
(pass) routing classification (S16) > issues.opened → targetKind channel [0.01ms]
(pass) routing classification (S16) > issues.edited → targetKind thread
(pass) routing classification (S16) > issues.closed → targetKind thread
(pass) routing classification (S16) > issues.reopened → targetKind thread
(pass) routing classification (S16) > pull_request.opened → targetKind channel [0.01ms]
(pass) routing classification (S16) > pull_request.edited → targetKind thread
(pass) routing classification (S16) > pull_request.synchronize → targetKind thread
(pass) routing classification (S16) > pull_request.closed → targetKind thread
(pass) mapping > threadTitle clamps to 100 chars [0.02ms]
(pass) mapping > findThreadId reads body first, then comments [0.02ms]

test/server.size.integration.test.ts:
(pass) POST /webhook body limit > signed oversized body is 413 before dedupe [57.16ms]

test/ingress.test.ts:
(pass) readBodyWithinLimit > null stream returns empty bytes [0.13ms]
(pass) readBodyWithinLimit > accumulates chunks up to the exact limit [0.12ms]
(pass) readBodyWithinLimit > throws PayloadTooLargeError when a chunk would exceed the limit [0.08ms]
(pass) readBodyWithinLimit > rejects negative or non-finite maxBytes with RangeError [0.04ms]
(pass) requireDeliveryId > returns the delivery id and rejects missing or blank headers [0.04ms]

test/outbox.test.ts:
(pass) failed delivery survives restart and retains dedupe after success [5.63ms]
(pass) dedupe retention begins when a delayed delivery succeeds [6.51ms]
(pass) existing outbox schema gains delivery timestamp without losing pending events [3.51ms]
(pass) constructor creates missing nested parent directories for the database path [2.85ms]
(pass) fifth failure becomes dead_letter with last_error and is no longer due [2.28ms]
(pass) last_error migration preserves a pending legacy outbox row [3.17ms]
(pass) drainer dead-letters a permanently failing job and due() stays empty [3.14ms]
(pass) below-limit fail keeps the row pending, backs off, and returns to due() [2.33ms]
(pass) requeue moves only a dead_letter row back to pending [2.17ms]

test/replay.test.ts:
(pass) replays one dead_letter row by exact id: due() returns it with attempts preserved [2.48ms]
(pass) replaying the same id again reports a non-target result and changes nothing [2.24ms]
(pass) other dead_letter and delivered rows are untouched by a replay [2.33ms]
(pass) CLI replays by exact id: exit 0 on resume, exit 1 on non-target [48.26ms]

test/verify.test.ts:
(pass) verifySignature > accepts valid signature [0.07ms]
(pass) verifySignature > rejects wrong signature [0.01ms]
(pass) verifySignature > rejects missing or malformed header
(pass) verifySignature > rejects tampered body [0.01ms]
(pass) Dedupe > first sight true, duplicate false [1.42ms]
(pass) Dedupe > empty id passes through [0.91ms]

test/gateway.test.ts:
(pass) forwardToGateway > sends framed message with idempotency key [1.28ms]

test/server.delivery.integration.test.ts:
(pass) POST /webhook X-GitHub-Delivery > readyz stays ready while Gateway is unreachable [0.25ms]
(pass) POST /webhook X-GitHub-Delivery > missing header → 400 before dedupe [0.63ms]
(pass) POST /webhook X-GitHub-Delivery > whitespace header → 400 before dedupe [0.23ms]
(pass) POST /webhook X-GitHub-Delivery > rejected requests insert no delivery rows [0.63ms]

test/config.test.ts:
(pass) loadConfig > accepts multi-repo config with defaults [0.66ms]
(pass) loadConfig > rejects missing repos [0.25ms]
(pass) loadConfig > rejects empty repos [0.22ms]
(pass) loadConfig > rejects repo entry missing forum channel [0.27ms]
(pass) loadConfig > rejects malformed repo key [0.22ms]
(pass) loadConfig > rejects missing shared fields [0.22ms]
(pass) loadConfig > rejects githubWebhookSecret: missing [0.21ms]
(pass) loadConfig > rejects githubWebhookSecret: null [0.14ms]
(pass) loadConfig > rejects githubWebhookSecret: empty string [0.21ms]
(pass) loadConfig > rejects githubWebhookSecret: whitespace-only string [0.20ms]
(pass) loadConfig > rejects githubWebhookSecret: number [0.16ms]
(pass) loadConfig > rejects githubWebhookSecret: boolean [0.20ms]
(pass) loadConfig > rejects githubWebhookSecret: object [0.30ms]
(pass) loadConfig > preserves githubWebhookSecret bytes verbatim [0.43ms]
(pass) loadConfig > rejects githubWebhookSecret that is an angle-bracket placeholder after trim [0.41ms]
(pass) loadConfig > accepts githubWebhookSecret containing angle brackets as ordinary text [0.22ms]
(pass) loadConfig > rejects placeholder openclawHookToken [0.27ms]
(pass) loadConfig > accepts openclawHookToken containing angle brackets [0.38ms]
(pass) loadConfig > rejects githubToken that is a single placeholder [0.18ms]
(pass) loadConfig > accepts githubToken containing brackets as non-placeholder [0.19ms]
(pass) loadConfig > accepts githubToken '<a><b>' as non-placeholder [0.15ms]
(pass) loadConfig > rejects ciAlertsChannelId <...> placeholder [0.15ms]
(pass) loadConfig > accepts ciAlertsChannelId containing brackets as non-placeholder [0.27ms]
(pass) loadConfig > rejects adminChannelId placeholder [0.32ms]
(pass) loadConfig > accepts adminChannelId with brackets that is not a single placeholder [0.16ms]
(pass) loadConfig > preserves boundary ports 1 and 65535 [0.35ms]
(pass) loadConfig > rejects port: zero [0.15ms]
(pass) loadConfig > rejects port: negative [0.13ms]
(pass) loadConfig > rejects port: above max [0.14ms]
(pass) loadConfig > rejects port: fractional [0.14ms]
(pass) loadConfig > rejects port: string [0.13ms]
(pass) loadConfig > rejects port: boolean [0.13ms]
(pass) loadConfig > rejects port: null [0.14ms]
(pass) loadConfig > rejects port: object [0.13ms]
(pass) loadConfig > rejects port: array [0.14ms]
(pass) loadConfig > rejects openclawHooksUrl: missing [0.15ms]
(pass) loadConfig > rejects openclawHooksUrl: null [0.17ms]
(pass) loadConfig > rejects openclawHooksUrl: empty string [0.19ms]
(pass) loadConfig > rejects openclawHooksUrl: whitespace-only string [0.19ms]
(pass) loadConfig > rejects openclawHooksUrl: leading space [0.15ms]
(pass) loadConfig > rejects openclawHooksUrl: trailing tab [0.14ms]
(pass) loadConfig > rejects openclawHooksUrl: relative path [0.13ms]
(pass) loadConfig > rejects openclawHooksUrl: no scheme [0.15ms]
(pass) loadConfig > rejects openclawHooksUrl: bare host:port [0.14ms]
(pass) loadConfig > rejects openclawHooksUrl: scheme-like non-http [0.14ms]
(pass) loadConfig > rejects openclawHooksUrl: malformed [0.17ms]
(pass) loadConfig > rejects openclawHooksUrl: ftp protocol [0.15ms]
(pass) loadConfig > rejects openclawHooksUrl: file protocol [0.14ms]
(pass) loadConfig > rejects openclawHooksUrl: number [0.14ms]
(pass) loadConfig > rejects openclawHooksUrl: boolean [0.15ms]
(pass) loadConfig > rejects openclawHooksUrl: object [0.14ms]
(pass) loadConfig > rejects openclawHooksUrl: array [0.14ms]
(pass) loadConfig > preserves valid http loopback and https hooks URLs byte-for-byte [0.61ms]

test/delivery.test.ts:
(pass) delivers pending job once on successful forward [0.08ms]
(pass) fails rejected forward with incremented attempts and status detail [0.05ms]
(pass) fails thrown forward with incremented attempts and the error message [0.04ms]
(pass) fails rejected forward at the attempt limit with status detail [0.04ms]
(pass) fails thrown forward at the attempt limit with the error message [0.03ms]

 111 pass
 0 fail
 234 expect() calls
Ran 111 tests across 14 files. [2.53s]
```



## Remaining risks

- The comments fetch is still capped at `per_page=20` (pre-existing); a thread URL pushed beyond the first page of discussion comments would be missed. Unchanged by this fix.
- If the comments request fails (`!commentsRes.ok`), `fetchItem` still degrades to `comments: []` rather than throwing — pre-existing tolerance, unchanged.
- Review comments recorded *only* on the pulls review surface remain unsearched by design; the contract explicitly forbids querying both surfaces.
- `server.ts` was not touched; the `kind` derivation (`"issues"` vs `"pulls"` from `ev.item`) is unchanged and routes PR follow-ups through the corrected path automatically.
