# B03 candidate receipt — GitHub 429 Retry-After 준수

Base: worktree HEAD `43cc112` (`codex/stackot-b03-20260921`). Worker made no commit/push/merge; the tree below is the candidate changeset.

## Changed files (scope check)

- `receiver/src/github-client.ts` — NEW. `githubFetch(url, init, opts)` + `GithubFetchOptions` (`maxRetries`, `maxRetryAfterMs`, injectable `sleep`, injectable `now`).
- `receiver/src/mapping.ts` — `fetchItem` routes all three request sites (item, comments, `rel="next"` pagination) through `githubFetch`; new optional `opts.githubFetchOpts` is forwarded so tests can inject `sleep`/`now`. `apiBase`, `token`, `timeoutMs` (AbortSignal.timeout), `maxCommentPages`, URL contract, and `findThreadId` untouched.
- `receiver/test/github-client.test.ts` — NEW. 16 tests, fake clock only.
- `receiver/test/mapping.test.ts` — NEW `describe("fetchItem rate limit (B03)")` with 2 tests; all existing assertions unchanged.

`git status --short` shows exactly these four paths; nothing outside the envelope was touched.

## Core diff summary

- `githubFetch` fetches once, then loops `attempt < maxRetries` while the response is rate-limited (429, or 403 with `x-ratelimit-remaining: 0`). Each iteration: compute wait from `Retry-After`, clamp to `maxRetryAfterMs`, cancel the dropped response body, `sleep(waitMs)`, then one sequential refetch. Exhausted retries return the last `Response` — never throws. No exponential backoff added; `Retry-After` is the authority.
- `mapping.ts`: `fetch(...)` → `githubFetch(..., ghOpts)` at lines ~105–106 (parallel item+comments) and ~124 (pagination). Error path unchanged: `!itemRes.ok` → `throw new Error("github api <status> for <repo> <kind> #<n>")` — no token in the message.

## Retry-After interpretation rules

| Header value | Wait |
|---|---|
| `Retry-After: <digits>` (delta-seconds) | `digits × 1000` ms |
| `Retry-After: <HTTP-date>` | `max(0, date − now())` ms |
| absent / empty / unparseable | `1000` ms (safe default) |
| any of the above | clamped to `maxRetryAfterMs` (default `60_000` ms) |

Rate-limit detection: `status === 429` OR (`status === 403` AND `x-ratelimit-remaining: 0`). All other statuses return immediately, no retry, no sleep.

## Oracle output (verbatim)

`cd receiver && bun run typecheck`
```
$ tsc --noEmit
TYPECHECK_EXIT=0
```

`cd receiver && bun test test/github-client.test.ts test/mapping.test.ts`
```
bun test v1.4.0 (34cbb9a40)

test/mapping.test.ts:
(pass) fetchItem > PR lookup reads discussion comments from the issues surface
(pass) fetchItem > thread URL in a PR discussion comment resolves to the thread id
(pass) fetchItem > issue lookup still reads the issues surface
(pass) fetchItem > follows Link rel=next and resolves a thread URL on a later page
(pass) fetchItem > stops paginating once the thread URL is found
(pass) fetchItem > stops at opts.maxCommentPages when the next chain outlasts the cap
(pass) fetchItem > requests comments only once when the response has no Link header
(pass) fetchItem > sends the Authorization header on every request
(pass) fetchItem > thread URL in a recorder-authored item body resolves to the thread id
(pass) fetchItem > a forged body link is skipped and a later recorder comment link is adopted
(pass) fetchItem rate limit (B03) > a 429 + Retry-After on the comments request is waited out and retried
(pass) fetchItem rate limit (B03) > a persistent 429 still fails the lookup after retries are exhausted
(pass) fetchItem timeout (S21b) > GITHUB_TIMEOUT_MS defaults the lookup budget to 10 seconds
(pass) fetchItem timeout (S21b) > rejects promptly against a server that never responds
(pass) findThreadId backlink trust > accepts a recorder-authored comment link in the configured guild
(pass) findThreadId backlink trust > accepts a recorder-authored body link in the configured guild
(pass) findThreadId backlink trust > ignores a link to the same thread id under a different guild
(pass) findThreadId backlink trust > ignores a non-recorder comment link in the configured guild
(pass) findThreadId backlink trust > ignores a non-recorder comment link in another guild
(pass) findThreadId backlink trust > ignores a recorder-authored link under a different guild
(pass) findThreadId backlink trust > adopts a later valid link when a forged link comes first
(pass) findThreadId backlink trust > matches the recorder login case-insensitively
(pass) findThreadId backlink trust > ignores texts whose author is unknown

test/github-client.test.ts:
(pass) githubFetch Retry-After compliance > 429 + Retry-After seconds waits exactly that long, then retries
(pass) githubFetch Retry-After compliance > Retry-After as HTTP-date waits the difference from now()
(pass) githubFetch Retry-After compliance > an HTTP-date in the past waits the minimum, not a negative delay
(pass) githubFetch Retry-After compliance > an instructed wait beyond maxRetryAfterMs is clamped to the cap
(pass) githubFetch Retry-After compliance > a custom maxRetryAfterMs bounds the wait
(pass) githubFetch Retry-After compliance > a missing Retry-After falls back to the default wait
(pass) githubFetch Retry-After compliance > an unparseable Retry-After falls back to the default wait
(pass) githubFetch Retry-After compliance > persistent 429 returns the last response after maxRetries, never throws
(pass) githubFetch Retry-After compliance > maxRetries bounds both retries and waits
(pass) githubFetch Retry-After compliance > maxRetries: 0 never retries
(pass) githubFetch Retry-After compliance > status 200 is returned immediately without retrying
(pass) githubFetch Retry-After compliance > status 404 is returned immediately without retrying
(pass) githubFetch Retry-After compliance > status 500 is returned immediately without retrying
(pass) githubFetch Retry-After compliance > 403 with x-ratelimit-remaining: 0 is treated as rate limited
(pass) githubFetch Retry-After compliance > 403 without x-ratelimit-remaining: 0 is not retried
(pass) githubFetch Retry-After compliance > a second 429 after the first retry waits again — never a burst

 39 pass
 0 fail
 98 expect() calls
Ran 39 tests across 2 files. [76.00ms]
```

`cd receiver && bun test`
```
 316 pass
 0 fail
 1109 expect() calls
Ran 316 tests across 29 files. [49.53s]
```

Setup note: `node_modules` was absent; `bun install --frozen-lockfile` was run once (6 packages) as permitted.

## Remaining risks

- **Cap means under-waiting on long limits.** If GitHub instructs `Retry-After` beyond `maxRetryAfterMs` (default 60 s), the retry fires early, will likely draw another 429, and `maxRetries` (default 2) can exhaust inside a sustained-limit window — the lookup then fails exactly as before this change (last 429 returned → `fetchItem` throws → admin fallback). That is deliberate (no unbounded waits in the drain path), but during long primary-limit resets the rescue only helps the first ~2 minutes of the window.
- **No cross-request coordination.** The parallel item+comments requests each retry independently; a simultaneous 429 on both can produce two waits/retries for one lookup. Sequential per-request, never a burst, but there is no shared "GitHub is limited" circuit across calls or across events.
- **Retry waits are not covered by `timeoutMs`.** `AbortSignal.timeout` bounds each fetch attempt; the injected `sleep` between retries is not abortable, so worst-case lookup latency is roughly `timeoutMs × (maxRetries+1) + maxRetryAfterMs × maxRetries` (~2 min 30 s at defaults). Accepted per contract — the alternative was letting the signal cancel mid-wait.
- **`Retry-After` fractional/negative delta-seconds** (non-spec) parse as unparseable → 1 s default, not the literal value.
