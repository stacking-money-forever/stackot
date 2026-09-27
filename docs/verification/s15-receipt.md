# S15 — SQLite busy/durability policy receipt

Base: worktree HEAD `ee19025` (uncommitted candidate; no commit/push performed).

## Changed files

- `receiver/src/outbox.ts` (+14)
- `receiver/test/outbox.test.ts` (+88, -1)

No other files touched. No schema/column changes; public API unchanged.

## Diff summary

### `receiver/src/outbox.ts`

- New exported constant `BUSY_TIMEOUT_MS = 5000`, documented as the concurrency
  policy: a writer waits up to that long for the SQLite write lock before
  `SQLITE_BUSY` surfaces — nonzero so short WAL write-lock overlap resolves by
  waiting, finite so a stuck peer can never block a writer forever.
- Constructor now runs, in order:
  1. `PRAGMA busy_timeout = 5000` — set **before** `journal_mode` so the WAL
     switch itself can wait out a held lock.
  2. `PRAGMA journal_mode = WAL` (unchanged).
  3. `PRAGMA synchronous = FULL` — fsyncs the WAL on every commit, so a pending
     row written before the webhook ACK, and `delivered`/`dead_letter` updates
     that gate dedupe, survive a process crash and even power loss. `NORMAL`
     would only survive a process crash (WAL frames sit in the OS page cache
     until the next checkpoint fsync); `OFF` can lose committed rows.
- `enqueue` is unchanged: `INSERT OR IGNORE` on the `id` PRIMARY KEY already
  returns `changes > 0`, so under contention exactly one caller gets `true` and
  exactly one row exists; `busy_timeout` turns would-be `SQLITE_BUSY` throws
  into waits.

### `receiver/test/outbox.test.ts`

- Import extended with `BUSY_TIMEOUT_MS`.
- New test `two connections racing the same delivery id produce exactly one
  row`: two `Outbox` connections on one path,
  `Promise.all([a.enqueue(id, ev), b.enqueue(id, ev)])` → `[false, true]`,
  `COUNT(*) = 1`.
- New test `enqueue waits out a briefly held write lock instead of throwing
  SQLITE_BUSY`: asserts `BUSY_TIMEOUT_MS` is finite and > 0, then spawns a
  `bun -e` child process that holds `BEGIN IMMEDIATE` for ~100ms (stdout
  `locked` handshake before the main thread enqueues). `enqueue` returns `true`
  after waiting (>0ms, < `BUSY_TIMEOUT_MS`); row count is 1. Test completes in
  ~110ms.
- New test `a pending row is still due after close and reopen`: enqueue →
  `close()` → new `Outbox` → row still `due()` with the same event; then
  `delivered` → `close()` → reopen keeps `has()`, empty `due()`, and a repeat
  `enqueue` returns `false`.

## Chosen values and rationale

- `busy_timeout = 5000` ms: finite, nonzero. Webhook-rate writers contend for
  milliseconds; 5s is far above real contention yet bounded so a stuck writer
  fails fast instead of hanging the request path. Exported as
  `BUSY_TIMEOUT_MS` for tests/consumers.
- `synchronous = FULL`: WAL + FULL fsyncs each commit, covering the stated
  criterion (pending/delivered state survives process crash + restart) and the
  stronger power-loss case. `NORMAL` technically meets the process-crash
  criterion but can roll back recent commits on power loss — unacceptable when
  a lost `delivered` mark silently re-delivers or a lost pending row drops an
  ACKed delivery. Cost is one fsync per commit, fine at webhook rates.

## Oracle output (verbatim)

### `cd receiver && bun run typecheck`

```
$ tsc --noEmit
```
(exit 0, no output beyond the command echo)

### `cd receiver && bun test test/outbox.test.ts`

```
bun test v1.4.0 (34cbb9a40)

test/outbox.test.ts:
(pass) failed delivery survives restart and retains dedupe after success [12.41ms]
(pass) dedupe retention begins when a delayed delivery succeeds [6.12ms]
(pass) existing outbox schema gains delivery timestamp without losing pending events [3.71ms]
(pass) constructor creates missing nested parent directories for the database path [2.75ms]
(pass) fifth failure becomes dead_letter with last_error and is no longer due [2.60ms]
(pass) last_error migration preserves a pending legacy outbox row [3.07ms]
(pass) drainer dead-letters a permanently failing job and due() stays empty [3.32ms]
(pass) below-limit fail keeps the row pending, backs off, and returns to due() [2.64ms]
(pass) requeue moves only a dead_letter row back to pending [2.50ms]
(pass) two connections racing the same delivery id produce exactly one row [3.25ms]
(pass) enqueue waits out a briefly held write lock instead of throwing SQLITE_BUSY [111.56ms]
(pass) a pending row is still due after close and reopen [4.67ms]

 12 pass
 0 fail
 48 expect() calls
Ran 12 tests across 1 file. [167.00ms]
```

### `cd receiver && bun test`

```
bun test v1.4.0 (34cbb9a40)

test/mapping.test.ts:
(pass) fetchItem > PR lookup reads discussion comments from the issues surface [1.88ms]
(pass) fetchItem > thread URL in a PR discussion comment resolves to the thread id [1.01ms]
(pass) fetchItem > issue lookup still reads the issues surface [0.62ms]
(pass) fetchItem > follows Link rel=next and resolves a thread URL on a later page [0.92ms]
(pass) fetchItem > stops paginating once the thread URL is found [0.54ms]
(pass) fetchItem > stops at opts.maxCommentPages when the next chain outlasts the cap [0.87ms]
(pass) fetchItem > requests comments only once when the response has no Link header [0.60ms]
(pass) fetchItem > sends the Authorization header on every request [0.51ms]
(pass) fetchItem > thread URL in a recorder-authored item body resolves to the thread id [0.50ms]
(pass) fetchItem > a forged body link is skipped and a later recorder comment link is adopted [0.46ms]
(pass) findThreadId backlink trust > accepts a recorder-authored comment link in the configured guild [0.03ms]
(pass) findThreadId backlink trust > accepts a recorder-authored body link in the configured guild [0.01ms]
(pass) findThreadId backlink trust > ignores a link to the same thread id under a different guild [0.05ms]
(pass) findThreadId backlink trust > ignores a non-recorder comment link in the configured guild
(pass) findThreadId backlink trust > ignores a non-recorder comment link in another guild [0.01ms]
(pass) findThreadId backlink trust > ignores a recorder-authored link under a different guild
(pass) findThreadId backlink trust > adopts a later valid link when a forged link comes first [0.01ms]
(pass) findThreadId backlink trust > matches the recorder login case-insensitively [0.01ms]
(pass) findThreadId backlink trust > ignores texts whose author is unknown

test/server.restart.integration.test.ts:
(pass) Receiver restart recovery > 502 pending delivery is forwarded after restart with same idempotency key [2174.29ms]

test/server.outbox.integration.test.ts:
(pass) S09A outbox before ACK > a 200 accepted response means the delivery row is already committed [2.06ms]
(pass) S09A outbox before ACK > the same delivery id is answered as a duplicate without a second row [0.53ms]

test/server.repository.integration.test.ts:
(pass) POST /webhook repository shape > invalid repository shapes are 400 before dedupe [58.39ms]

test/server.malformed.integration.test.ts:
(pass) POST /webhook malformed JSON > 400 without reserving the delivery id; same id then accepted once [58.96ms]

test/routing.test.ts:
(pass) check_run linked PR preservation (S20) > failed check_run with linked PR keeps prNumbers, item, and summary ref [0.04ms]
(pass) check_run linked PR preservation (S20) > multiple linked PRs preserve order and dedupe [0.02ms]
(pass) check_run linked PR preservation (S20) > missing pull_requests → prNumbers unset, still channel target [0.01ms]
(pass) check_run linked PR preservation (S20) > linked PRs preserve order and dedupe [0.02ms]
(pass) check_run linked PR preservation (S20) > empty pull_requests array → prNumbers unset or empty, still channel target [0.02ms]
(pass) check_run linked PR preservation (S20) > malformed number entries are dropped [0.02ms]
(pass) check_run linked PR preservation (S20) > conclusion success → null
(pass) check_run linked PR preservation (S20) > conclusion skipped → null
(pass) check_run linked PR preservation (S20) > conclusion neutral → null
(pass) check_run linked PR preservation (S20) > missing conclusion → null
(pass) check_run linked PR preservation (S20) > non-completed action → null
(pass) route() decision table (S21) > opened issue on configured repo → issues forum createThread [0.23ms]
(pass) route() decision table (S21) > opened PR on configured repo → prs forum createThread
(pass) route() decision table (S21) > issue follow-up resolved → mapped thread [0.06ms]
(pass) route() decision table (S21) > PR follow-up resolved → mapped thread
no thread mapping for a/repo issue #42
(pass) route() decision table (S21) > follow-up unresolved → admin channel [0.01ms]
(pass) route() decision table (S21) > CI + linked PR thread resolved → PR thread + ci-alerts notice
(pass) route() decision table (S21) > CI + linked PR thread unresolved → ci-alerts channel
(pass) route() decision table (S21) > CI + no linked PR → ci-alerts channel, no lookup
repo not configured: ghost/repo
(pass) route() decision table (S21) > unconfigured repo → admin channel
(pass) route() decision table (S21) > repos do not cross: each event uses its own forums and lookups [0.12ms]
mapping lookup failed for a/repo issues #42: warn: github api down
      at boom (/Users/justn/dev/.worktrees/stackot-s15-20260921/receiver/test/routing.test.ts:234:17)
      at lookup (/Users/justn/dev/.worktrees/stackot-s15-20260921/receiver/src/router.ts:40:23)
      at route (/Users/justn/dev/.worktrees/stackot-s15-20260921/receiver/src/router.ts:83:28)
      at <anonymous> (/Users/justn/dev/.worktrees/stackot-s15-20260921/receiver/test/routing.test.ts:236:28)

no thread mapping for a/repo issue #42
mapping lookup failed for a/repo pulls #17: warn: github api down
      at boom (/Users/justn/dev/.worktrees/stackot-s15-20260921/receiver/test/routing.test.ts:234:17)
      at lookup (/Users/justn/dev/.worktrees/stackot-s15-20260921/receiver/src/router.ts:40:23)
      at route (/Users/justn/dev/.worktrees/stackot-s15-20260921/receiver/src/router.ts:60:30)
      at <anonymous> (/Users/justn/dev/.worktrees/stackot-s15-20260921/receiver/test/routing.test.ts:238:22)

(pass) route() decision table (S21) > resolveThreadId throwing falls back without crashing [0.15ms]
(pass) gateway notice channel line (S21) > noticeChannelId adds a CI 알림 채널 line [1.58ms]
(pass) gateway notice channel line (S21) > absent noticeChannelId leaves the message unchanged [0.74ms]

test/normalize.test.ts:
(pass) normalize > issue opened → channel target with createThread marker [0.03ms]
(pass) normalize > issue labeled (uninteresting action) → null [0.01ms]
(pass) normalize > issue comment → thread target [0.02ms]
(pass) normalize > PR closed merged → merged tail [0.01ms]
(pass) normalize > failed check_run → channel target [0.02ms]
(pass) normalize > failed check_run with pull_requests → prNumbers preserved [0.02ms]
(pass) normalize > successful check_run → null
(pass) routing classification (S16) > issues.opened → targetKind channel [0.01ms]
(pass) routing classification (S16) > issues.edited → targetKind thread
(pass) routing classification (S16) > issues.closed → targetKind thread
(pass) routing classification (S16) > issues.reopened → targetKind thread
(pass) routing classification (S16) > pull_request.opened → targetKind channel [0.01ms]
(pass) routing classification (S16) > pull_request.edited → targetKind thread
(pass) routing classification (S16) > pull_request.synchronize → targetKind thread
(pass) routing classification (S16) > pull_request.closed → targetKind thread
(pass) mapping > threadTitle clamps to 100 chars [0.03ms]
(pass) mapping > findThreadId reads body first, then comments [0.05ms]

test/server.size.integration.test.ts:
(pass) POST /webhook body limit > signed oversized body is 413 before dedupe [57.18ms]

test/ingress.test.ts:
(pass) readBodyWithinLimit > null stream returns empty bytes [0.13ms]
(pass) readBodyWithinLimit > accumulates chunks up to the exact limit [0.12ms]
(pass) readBodyWithinLimit > throws PayloadTooLargeError when a chunk would exceed the limit [0.09ms]
(pass) readBodyWithinLimit > rejects negative or non-finite maxBytes with RangeError [0.05ms]
(pass) requireDeliveryId > returns the delivery id and rejects missing or blank headers [0.04ms]

test/outbox.test.ts:
(pass) failed delivery survives restart and retains dedupe after success [4.62ms]
(pass) dedupe retention begins when a delayed delivery succeeds [20.74ms]
(pass) existing outbox schema gains delivery timestamp without losing pending events [5.07ms]
(pass) constructor creates missing nested parent directories for the database path [3.19ms]
(pass) fifth failure becomes dead_letter with last_error and is no longer due [3.03ms]
(pass) last_error migration preserves a pending legacy outbox row [3.36ms]
(pass) drainer dead-letters a permanently failing job and due() stays empty [3.36ms]
(pass) below-limit fail keeps the row pending, backs off, and returns to due() [2.88ms]
(pass) requeue moves only a dead_letter row back to pending [2.65ms]
(pass) two connections racing the same delivery id produce exactly one row [3.57ms]
(pass) enqueue waits out a briefly held write lock instead of throwing SQLITE_BUSY [111.38ms]
(pass) a pending row is still due after close and reopen [4.90ms]

test/replay.test.ts:
(pass) replays one dead_letter row by exact id: due() returns it with attempts preserved [3.43ms]
(pass) replaying the same id again reports a non-target result and changes nothing [3.06ms]
(pass) other dead_letter and delivered rows are untouched by a replay [3.41ms]
(pass) CLI replays by exact id: exit 0 on resume, exit 1 on non-target [53.82ms]

test/verify.test.ts:
(pass) verifySignature > accepts valid signature [0.06ms]
(pass) verifySignature > rejects wrong signature [0.01ms]
(pass) verifySignature > rejects missing or malformed header
(pass) verifySignature > rejects tampered body
(pass) Dedupe > first sight true, duplicate false [1.43ms]
(pass) Dedupe > empty id passes through [1.08ms]

test/gateway.test.ts:
(pass) forwardToGateway > sends framed message with idempotency key [1.16ms]

test/server.delivery.integration.test.ts:
(pass) POST /webhook X-GitHub-Delivery > readyz stays ready while Gateway is unreachable [0.25ms]
(pass) POST /webhook X-GitHub-Delivery > missing header → 400 before dedupe [0.56ms]
(pass) POST /webhook X-GitHub-Delivery > whitespace header → 400 before dedupe [0.14ms]
(pass) POST /webhook X-GitHub-Delivery > rejected requests insert no delivery rows [0.54ms]

test/config.test.ts:
(pass) loadConfig > accepts multi-repo config with defaults [0.64ms]
(pass) loadConfig > rejects missing repos [0.20ms]
(pass) loadConfig > rejects empty repos [0.23ms]
(pass) loadConfig > rejects repo entry missing forum channel [0.30ms]
(pass) loadConfig > rejects malformed repo key [0.23ms]
(pass) loadConfig > rejects repos issuesForumChannelId: missing [0.25ms]
(pass) loadConfig > rejects repos prsForumChannelId: missing [0.22ms]
(pass) loadConfig > rejects repos issuesForumChannelId: empty string [0.20ms]
(pass) loadConfig > rejects repos issuesForumChannelId: whitespace-only string [0.17ms]
(pass) loadConfig > rejects repos issuesForumChannelId: whitespace-only string [0.15ms]
(pass) loadConfig > rejects repos issuesForumChannelId: number [0.16ms]
(pass) loadConfig > rejects repos issuesForumChannelId: boolean [0.16ms]
(pass) loadConfig > rejects repos issuesForumChannelId: null [0.16ms]
(pass) loadConfig > rejects repos issuesForumChannelId: object [0.14ms]
(pass) loadConfig > rejects repos issuesForumChannelId: array [0.16ms]
(pass) loadConfig > rejects repos issuesForumChannelId: single placeholder [0.15ms]
(pass) loadConfig > rejects repos issuesForumChannelId: single placeholder [0.18ms]
(pass) loadConfig > rejects repos issuesForumChannelId: padded placeholder [0.15ms]
(pass) loadConfig > rejects repo entry where both forum channel IDs are placeholders [0.20ms]
(pass) loadConfig > error names the offending repo and key among multiple repos [0.17ms]
(pass) loadConfig > accepts real-looking forum channel IDs and non-single-placeholder brackets [0.50ms]
(pass) loadConfig > rejects missing shared fields [0.20ms]
(pass) loadConfig > rejects githubWebhookSecret: missing [0.17ms]
(pass) loadConfig > rejects githubWebhookSecret: null [0.16ms]
(pass) loadConfig > rejects githubWebhookSecret: empty string [0.20ms]
(pass) loadConfig > rejects githubWebhookSecret: whitespace-only string [0.18ms]
(pass) loadConfig > rejects githubWebhookSecret: number [0.15ms]
(pass) loadConfig > rejects githubWebhookSecret: boolean [0.16ms]
(pass) loadConfig > rejects githubWebhookSecret: object [0.14ms]
(pass) loadConfig > preserves githubWebhookSecret bytes verbatim [0.16ms]
(pass) loadConfig > rejects githubWebhookSecret that is an angle-bracket placeholder after trim [0.33ms]
(pass) loadConfig > accepts githubWebhookSecret containing angle brackets as ordinary text [0.16ms]
(pass) loadConfig > rejects placeholder openclawHookToken [0.21ms]
(pass) loadConfig > accepts openclawHookToken containing angle brackets [0.29ms]
(pass) loadConfig > rejects githubToken that is a single placeholder [0.15ms]
(pass) loadConfig > accepts githubToken containing brackets as non-placeholder [0.15ms]
(pass) loadConfig > accepts githubToken '<a><b>' as non-placeholder [0.14ms]
(pass) loadConfig > rejects ciAlertsChannelId <...> placeholder [0.20ms]
(pass) loadConfig > accepts ciAlertsChannelId containing brackets as non-placeholder [0.73ms]
(pass) loadConfig > rejects adminChannelId placeholder [0.41ms]
(pass) loadConfig > accepts adminChannelId with brackets that is not a single placeholder [0.23ms]
(pass) loadConfig > preserves boundary ports 1 and 65535 [0.40ms]
(pass) loadConfig > rejects port: zero [0.20ms]
(pass) loadConfig > rejects port: negative [0.18ms]
(pass) loadConfig > rejects port: above max [0.18ms]
(pass) loadConfig > rejects port: fractional [0.18ms]
(pass) loadConfig > rejects port: string [0.19ms]
(pass) loadConfig > rejects port: boolean [0.33ms]
(pass) loadConfig > rejects port: null [0.23ms]
(pass) loadConfig > rejects port: array [0.26ms]
(pass) loadConfig > rejects port: object [0.25ms]
(pass) loadConfig > rejects openclawHooksUrl: missing [0.23ms]
(pass) loadConfig > rejects openclawHooksUrl: null [0.23ms]
(pass) loadConfig > rejects openclawHooksUrl: whitespace-only string [0.30ms]
(pass) loadConfig > rejects openclawHooksUrl: leading space [0.15ms]
(pass) loadConfig > rejects openclawHooksUrl: trailing tab [0.19ms]
(pass) loadConfig > rejects openclawHooksUrl: relative path [0.33ms]
(pass) loadConfig > rejects openclawHooksUrl: no scheme [0.30ms]
(pass) loadConfig > rejects openclawHooksUrl: bare host:port [0.16ms]
(pass) loadConfig > rejects openclawHooksUrl: scheme-like non-http [0.16ms]
(pass) loadConfig > rejects openclawHooksUrl: file protocol [0.16ms]
(pass) loadConfig > rejects openclawHooksUrl: ftp protocol [0.16ms]
(pass) loadConfig > rejects openclawHooksUrl: number [0.17ms]
(pass) loadConfig > rejects openclawHooksUrl: boolean [0.17ms]
(pass) loadConfig > rejects openclawHooksUrl: array [0.21ms]
(pass) loadConfig > preserves valid http loopback and https hooks URLs byte-for-byte [0.57ms]
(pass) loadConfig > rejects discordGuildId: missing [0.19ms]
(pass) loadConfig > rejects discordGuildId: null [0.17ms]
(pass) loadConfig > rejects discordGuildId: empty string [0.22ms]
(pass) loadConfig > rejects discordGuildId: placeholder [0.24ms]
(pass) loadConfig > rejects discordGuildId: padded placeholder [0.16ms]
(pass) loadConfig > rejects discordGuildId: non-numeric [0.14ms]
(pass) loadConfig > rejects discordGuildId: mixed alphanumeric [0.13ms]
(pass) loadConfig > rejects discordGuildId: decimal string [0.14ms]
(pass) loadConfig > rejects discordGuildId: padded digits [0.13ms]
(pass) loadConfig > rejects discordGuildId: number [0.12ms]
(pass) loadConfig > rejects discordGuildId: boolean [0.17ms]
(pass) loadConfig > accepts a long numeric discordGuildId verbatim [0.20ms]
(pass) loadConfig > rejects githubBacklinkLogin: missing [0.13ms]
(pass) loadConfig > rejects githubBacklinkLogin: null [0.13ms]
(pass) loadConfig > rejects githubBacklinkLogin: placeholder [0.17ms]
(pass) loadConfig > rejects githubBacklinkLogin: padded placeholder [0.16ms]
(pass) loadConfig > rejects githubBacklinkLogin: with space [0.15ms]
(pass) loadConfig > rejects githubBacklinkLogin: with @ [0.16ms]
(pass) loadConfig > rejects githubBacklinkLogin: with slash [0.14ms]
(pass) loadConfig > rejects githubBacklinkLogin: padded [0.16ms]
(pass) loadConfig > accepts regular and app-style githubBacklinkLogin values [0.53ms]

test/delivery.test.ts:
(pass) delivers pending job once on successful forward [0.07ms]
(pass) fails rejected forward with incremented attempts and status detail [0.05ms]
(pass) fails thrown forward with incremented attempts and the error message [0.04ms]
(pass) fails rejected forward at the attempt limit with status detail [0.04ms]
(pass) fails thrown forward at the attempt limit with the error message [0.03ms]

 203 pass
 0 fail
 402 expect() calls
Ran 203 tests across 16 files. [2.75s]
```

## Remaining risks

- Contention longer than 5s still surfaces `SQLITE_BUSY` to the caller — by
  design (bounded wait), but the webhook path does not retry it; the client
  would see a 5xx and redeliver, which `INSERT OR IGNORE` still dedupes.
- `synchronous=FULL` adds an fsync per commit; negligible at webhook rates but
  would matter if the outbox were ever put on a high-frequency path.
- The lock-contention test depends on `bun -e` subprocess startup (~50–100ms);
  on a heavily loaded machine the ~100ms hold plus handshake could tighten the
  margin before the 5s timeout — still orders of magnitude of headroom.
- The concurrent-duplicate test serializes in practice (bun:sqlite is
  synchronous per connection on one thread); real two-writer contention is
  proven by the subprocess lock test, not by `Promise.all` parallelism.
