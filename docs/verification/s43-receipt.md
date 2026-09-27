# S43 receipt — queue/dead-letter metrics (wave 03 candidate)

Base: `0e8261cddb6215b6ba787496efc328317abb7d06` (worktree HEAD at launch). Candidate only — no commit, push, merge, deploy.

## Changed files

| File | Change |
|---|---|
| `receiver/src/outbox.ts` | Added `OutboxStats` type + `stats()` method only. One aggregate `SELECT` computes pending/dead_letter/delivered counts and `MIN(received_at)` of pending rows; no rows are pulled into JS. `oldestPendingAgeMs` is `null` when nothing is pending and clamped at 0 against clock skew. No schema, column, PRAGMA, or existing-method change. |
| `receiver/src/metrics.ts` | New. `QueueMetrics` type, `collectMetrics(stats)` shape normalizer (negative/NaN → 0, non-finite/null age → null), `toLogLine(metrics)` one-line JSON, `METRICS_INTERVAL_MS = 60_000`. |
| `receiver/src/health.ts` | `statusReport(outboxReady, gateway, queue?)` takes optional `QueueMetrics`; `StatusReport` gains `queue: QueueMetrics \| null` (null = stats probe failed). Existing fields and semantics unchanged. |
| `receiver/src/server.ts` | `queueMetrics()` wraps `collectMetrics(outbox.stats())` in try/catch — a failed probe logs through `describeError` (redacted) and returns null, never kills the process. `emitQueueMetrics()` runs once at startup and on a `METRICS_INTERVAL_MS` `setInterval`, both cleared in the SIGTERM/SIGINT handlers. `GET /status` passes `queueMetrics()` into `statusReport`. |
| `receiver/test/metrics.test.ts` | New. 7 tests: 3 `stats()` unit, 2 `collectMetrics`, 1 `toLogLine`, 1 process-level. |

## Metric fields

| Field | Type | Source | Notes |
|---|---|---|---|
| `pending` | number | `COUNT(state='pending')` | All pending rows, due or backed-off — this is the backlog. |
| `deadLetter` | number | `COUNT(state='dead_letter')` | Rows that exhausted `MAX_DELIVERY_ATTEMPTS`. |
| `delivered` | number | `COUNT(state='delivered')` | Retained for the 7-day TTL dedupe window. |
| `oldestPendingAgeMs` | number \| null | `now − MIN(received_at)` over pending | `null` when `pending = 0`; clamped ≥ 0. |

Log shape: `{"ts":<ms>, "at":<ms>, "event":"queue.metrics", "pending":N, "deadLetter":N, "delivered":N, "oldestPendingAgeMs":N|null}`. Every field except `event` is number-or-null — no string field exists for a secret to ride in. `at` duplicates `ts` deliberately: the S42 oracle (`server.telemetry.integration.test.ts`) asserts every `{`-prefixed stdout line is JSON with `event: string` **and** `at: number`, so omitting `at` would regress that suite without touching it.

## Process-level test method and rationale

`server.ts` emits one `queue.metrics` line at startup (before the interval timer starts). The test therefore never waits out `METRICS_INTERVAL_MS`: it seeds `outbox.sqlite` with 1 pending + 1 dead_letter row, spawns the real server against a dead Gateway port, pumps stdout until a `queue.metrics` JSON line appears, then fetches `/status` and asserts `body.queue` reports the same counts. Rationale: startup emission is operationally useful in its own right (a backlog left by a crashed run is visible immediately, not after one silent minute) and keeps the test deterministic without an env-var interval override.

## Oracle output (verbatim)

`cd receiver && bun install --frozen-lockfile` (node_modules was absent; one allowed run):

```
+ @types/bun@1.4.2
+ typescript@7.0.2
6 packages installed [13.00ms]
```

`cd receiver && bun run typecheck`:

```
$ tsc --noEmit
(exit 0, no output)
```

`cd receiver && bun test test/metrics.test.ts`:

```
bun test v1.4.0 (34cbb9a40)

test/metrics.test.ts:
(pass) Outbox.stats > reports exact counts for a known row mix and the age of the oldest pending [14.78ms]
(pass) Outbox.stats > oldestPendingAgeMs is null when nothing is pending [3.83ms]
(pass) Outbox.stats > empty outbox reports zeros and null, no missing fields [2.92ms]
(pass) collectMetrics > passes a well-formed stats object through [0.06ms]
(pass) collectMetrics > negative and NaN inputs are clamped to 0 or null [0.01ms]
(pass) toLogLine > emits one parseable JSON object with every required field [0.11ms]
(pass) process-level queue metrics > the server emits a queue.metrics line and /status carries the same stats [0.40ms]

 7 pass
 0 fail
 47 expect() calls
Ran 7 tests across 1 file. [90.00ms]
```

`cd receiver && bun test` (tail):

```
 263 pass
 0 fail
 906 expect() calls
Ran 263 tests across 25 files. [18.30s]
```

No regressions: `/healthz`=`ok`, `/readyz`=`ready`/503, S41 degraded/ok status transitions, and all S42 telemetry-shape assertions (including the `at` pin described above) still pass. `git status` shows exactly the five allowed paths.

## Residual risks

- `queue` in `/status` is `null` only when `stats()` itself throws (e.g. disk I/O); readiness is unaffected — `outboxReady` already covers that case as degraded. No dedicated test simulates a stats-probe failure (requires breaking the DB under a live server); the try/catch is one level deep and straightforward.
- `delivered` grows only within the 7-day TTL window and is purged at `Outbox` construction; a long-running process does not re-purge, matching pre-existing behavior (unchanged by this row).
- `pending` counts backed-off retries, not just currently-due rows — intentional (backlog, not due-now), but worth noting for an operator reading the number as "work ready this second".
- `ts`/`at` duplication is a deliberate compat shim for the S42 stdout schema; if S42's pin is ever relaxed, `at` can be dropped.
