# S41 receipt — health/readiness separation

Base: `72150cc` (worktree HEAD at launch). Candidate only — no commit/push/merge.

## Changed files

- `receiver/src/health.ts` (new) — `GatewayHealth` state model, `createGatewayHealth(secrets)` recorder, `liveness`, `readiness`, `statusReport`.
- `receiver/src/server.ts` — wires `gatewayHealth` into the drainer forward callback (`recordSuccess` on `result.ok`, `recordFailure` with the already-redacted `describeError` text otherwise); serves `/healthz`/`/readyz` through the new functions and adds `GET /status`.
- `receiver/test/health.test.ts` (new) — unit oracle for the three judgments + secret masking.
- `receiver/test/server.health.integration.test.ts` (new) — process oracle: degraded-while-accepting, second POST still accepted, recovery to ok via a late-bound Gateway stub.

No other files touched (`git status`: `M server.ts` + 3 new files).

## Key diff summary

- `createGatewayHealth()` starts optimistic (`reachable: true, lastError: null, lastSuccessAt: null`) so "no attempt yet" is distinct from "failing". `recordFailure` re-masks via `redact()` — the stored error can never hold a raw secret even if an upstream path slips.
- `readiness(outboxReady, gateway)` ignores `gateway` entirely: outbox ready → `200 "ready"`, else `503 "outbox unavailable"` (existing body contract preserved verbatim).
- `liveness(...)` always `200 "ok"`.
- `statusReport(...)` → `{ status, outboxReady, gateway: { reachable, lastError, lastSuccessAt } }`; `degraded` when `!outboxReady || !gateway.reachable`.
- Forward callback records reachability on both failure shapes: thrown fetch/route errors (redacted `describeError` text) and non-2xx Gateway responses (`gateway rejected delivery (status N)`).

## Endpoint contract

| Endpoint | Probe | Success | Failure | Gateway down effect |
|---|---|---|---|---|
| `GET /healthz` | none (process alive) | 200 `ok` | — | none |
| `GET /readyz` | `outbox.ready()` (`SELECT 1`) | 200 `ready` | 503 `outbox unavailable` | none — stays 200 |
| `GET /status` | outbox + in-memory gateway state | 200 JSON `{"status":"ok",...}` | 200 JSON `{"status":"degraded",...}` + `gateway.lastError` (masked) | `degraded`, `reachable:false` |
| `POST /webhook` | unchanged | 200 `accepted`/`duplicate`/`ignored` | 4xx/503 as before | still 200 `accepted`, row commits |

## Oracle output

`cd receiver && bun run typecheck`

```
$ tsc --noEmit
```
(exit 0, no diagnostics)

`cd receiver && bun test test/health.test.ts test/server.health.integration.test.ts`

```
bun test v1.4.0 (34cbb9a40)

test/server.health.integration.test.ts:
(pass) S41 health/readiness separation > status starts ok before any forward attempt, then degrades while intake continues [4.42ms]
(pass) S41 health/readiness separation > a second webhook is still accepted while the Gateway stays down [0.92ms]
(pass) S41 health/readiness separation > status returns to ok after the Gateway stub serves and retries succeed [2977.31ms]

test/health.test.ts:
(pass) liveness > is 200 for every outbox/Gateway combination [0.13ms]
(pass) readiness > is 503 when the outbox is not ready, whatever the Gateway state [0.04ms]
(pass) readiness > is 200 when the outbox is ready even while the Gateway is unreachable [0.02ms]
(pass) readiness is 200 when both the outbox and the Gateway are healthy
(pass) statusReport > initial state (no attempt yet) is ok and distinct from a failure state [0.03ms]
(pass) statusReport > a recorded failure degrades the report and carries the error [0.02ms]
(pass) statusReport > an unreachable Gateway never makes readiness fail while status shows degraded [0.04ms]
(pass) statusReport > a success returns the report to ok and stamps lastSuccessAt [0.04ms]
(pass) statusReport > outbox not ready is also reported as degraded [0.01ms]
(pass) statusReport > recordFailure masks configured secrets out of lastError [0.06ms]

 13 pass
 0 fail
 188 expect() calls
Ran 13 tests across 2 files. [3.06s]
```

`cd receiver && bun test`

```
 244 pass
 0 fail
 698 expect() calls
Ran 244 tests across 22 files. [12.86s]
```

All pre-existing tests (incl. S09A/S21b outbox/delivery/restart/redact contracts) pass unmodified. `bun install --frozen-lockfile` was run once (node_modules absent).

## Remaining risks

- Gateway health is process memory only — a restart resets to `reachable: true / lastError: null`, so `/status` reads `ok` until the next drain attempt proves otherwise (by design; nothing is persisted).
- `reachable` reflects the *last forward attempt*, not a probe: a quiet period shows the stale outcome, and a Gateway that 5xx's is recorded as unreachable even though TCP connected (spec treats any non-ok forward as failure).
- `/status` reports `degraded` on outbox failure too (`outboxReady: false`), a superset of the required Gateway signal.
- Retry backoff means `/status` recovery is observed on the next drain tick, not instantly when the Gateway returns.
