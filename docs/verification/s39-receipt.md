# S39 candidate receipt — log/store secret masking

Candidate only. No commit, push, merge, deploy. Base: worktree HEAD `09230e6`.

## Changed files (scope-checked against contract)

- `receiver/src/redact.ts` — **new**. `redact(text, secrets)`, `redactSecrets(cfg)`, `describeError(error, secrets)`, `REDACTED = "[redacted]"`.
- `receiver/src/server.ts` — **modified**. Masking wired into the four error surfaces (details below).
- `receiver/test/redact.test.ts` — **new**. 13 unit tests.
- `receiver/test/server.redact.integration.test.ts` — **new**. 2 process tests.

`git status`: exactly the four files above. Nothing else touched; HEAD unchanged.

## Core design

`redact` is pure: filters out blank secrets, sorts the rest longest-first (so a short secret that prefixes a longer one can't leave a fragment), then literal `split`/`join` replacement — no regex, so secrets containing metacharacters are safe.

`describeError` serializes an unknown thrown value with `util.inspect` **before** masking. This is the load-bearing choice: Bun's fetch failure message is clean ("Unable to connect. Is the computer able to access the url?") but the error object carries the request URL on a `path` property, which `console.error(err)` dumps verbatim. Masking `.message` alone would miss the leak entirely; masking the inspect dump covers `path`, `code`, `errno`, `cause`, and any future extra properties.

`redactSecrets` returns `githubWebhookSecret`, `openclawHookToken`, `githubToken`, **plus `openclawHooksUrl` itself** — the contract scenario is a token embedded in the URL query, and the URL can carry credentials in forms the token fields never see (userinfo, other query params). Longest-first ordering means the whole URL masks before its embedded token.

## Masking wiring locations (server.ts)

1. **Forward callback** (`DeliveryDrainer` forwarder): wraps `route()` + `forwardToGateway`. On failure it logs `delivery <id> forward failed: <masked inspect dump>` to stderr and **rethrows `new Error(masked)`** — the drainer persists `error.message` into `last_error`, so the DB gets masked text without touching `delivery.ts`. The new `console.error` also fulfills gateway.ts's documented "failures are logged" intent (previously per-delivery failures were silent on stderr).
2. **`resolveThreadId`** (injected into `route`): catches `fetchItem`/`findThreadId` errors and rethrows a masked `Error`. `router.ts`'s `lookup()` logs the caught error verbatim via `console.warn` — uneditable — so the masking happens at the injection boundary, before router sees it.
3. **`logDrainError`**: `console.error("delivery drain failed:", describeError(...))`.
4. **Dedupe check + enqueue** `console.error` calls in the fetch handler: same `describeError` treatment. Response bodies unchanged (S09B contract held — still bare `503 "outbox unavailable"`).

## Test evidence notes

- Integration test 1 sets `openclawHooksUrl = http://127.0.0.1:1/hooks?token=<hookToken>` (contract shape), POSTs an `issues/opened` webhook → `200 accepted`, then forces `attempts=4, next_attempt_at=0` from a second SQLite connection so the next real drain tick records `dead_letter` + `last_error` in ~1s instead of ~30s of backoff (same technique the owner used in the S12 runtime proof). Asserts `last_error` and stderr contain `[redacted]` and no raw `hookToken`, `hooksUrl`, or `webhookSecret`.
- Integration test 2 (githubToken): the token travels in an `Authorization` header, so it can never appear in error text on its own — a pure absence check would be vacuous. The test instead sets `STACKOT_GITHUB_API_BASE=http://127.0.0.1:1/<githubToken>`, making the failed lookup's `path` embed the token; an `issue_comment/created` webhook triggers the reverse-link lookup. Asserts stderr contains the masked fragment `[redacted]/repos/owner/repo` (proof the token was in the error and got masked) and never contains the raw token.
- No real network: all endpoints are `127.0.0.1:1` (connection refused).

## Oracle output (verbatim)

```
$ cd receiver && bun run typecheck
$ tsc --noEmit
exit=0
```

```
$ cd receiver && bun test test/redact.test.ts test/server.redact.integration.test.ts
(pass) S39 secret masking > hook token in the hooks URL never reaches stderr or last_error [1008.43ms]
(pass) S39 secret masking > github token embedded in the mapping lookup URL never reaches stderr [103.62ms]
(pass) redact > replaces a single occurrence of one secret
(pass) redact > replaces every occurrence of one secret
(pass) redact > masks each secret when several are mixed in one text
(pass) redact > applies the longer secret first when secrets overlap
(pass) redact > ignores empty and whitespace-only secrets
(pass) redact > returns the input unchanged when the secret list is empty
(pass) redact > returns the input unchanged when no secret appears in it
(pass) redact > masks secrets across multiline text
(pass) redact > matches literally, not as a regex
(pass) redactSecrets > includes the webhook secret, hook token, and github token
(pass) redactSecrets > includes the hooks URL so query/userinfo credentials are masked
(pass) describeError > masks secrets carried on error properties, not just the message
(pass) describeError > handles non-Error thrown values

 15 pass
 0 fail
 30 expect() calls
Ran 15 tests across 2 files. [1183.00ms]
exit=0
```

```
$ cd receiver && bun test
…
 231 pass
 0 fail
 508 expect() calls
Ran 231 tests across 20 files. [9.75s]
exit=0
```

No regressions: all pre-existing tests pass unchanged, including the S09A/S09B/S21b oracles (200 accepted/duplicate, 503 outbox unavailable, routing).

## Residual risks

- **Startup config errors can still echo a raw `openclawHooksUrl`.** `config.ts` (outside the edit envelope) interpolates the URL into `loadConfig` error messages, which Bun prints unmasked when the process dies at startup. Narrow: it only fires when `new URL()` rejects the URL outright — a token-bearing URL parses fine, so the contract scenario is covered. Closing it fully needs a config.ts change (owner decision).
- **Uncaught throws inside `Bun.serve`'s fetch handler** would be printed by the Bun runtime unmasked. The request path never touches secret-bearing URLs (all fetches live in the drain path), so reachable errors there are SQLite/parse errors without secrets. No handler change made — keeping the diff minimal.
- **Still visible in logs by design:** delivery IDs, repo names, issue/PR numbers, channel IDs, host:port — non-secret correlation values needed for ops.
- **`last_error` content changed shape**: it now stores the masked inspect dump (message + `path`/`code`/`errno`) instead of bare `.message` — strictly more diagnostic info, masked. `replay.ts`'s `requeue` clears `last_error` as before.
- **Coverage is config-secrets only.** Secrets from other sources (e.g., an operator putting credentials in `STACKOT_GITHUB_API_BASE` without them being in cfg) are masked only when they coincide with a configured secret value — demonstrated by the apiBase test, but a wholly external secret would pass through.
