# S12 receipt — dead-letter 확정 저장 (wave 02 candidate, retry 1/1)

Base: `codex/stackot-s12-20260921` @ db95b2a. Candidate only — no commit/push/merge/deploy performed. HEAD unchanged.

Retry-1 scope applied per owner direction: the drainer no longer imports `outbox.ts`, the `DeliveryOutbox` port is `due`/`delivered`/`fail` only, and the catch path always calls `fail`. The limit policy (dead_letter at `MAX_DELIVERY_ATTEMPTS`, retry below) lives solely in `Outbox.fail`; `outbox.ts` is unmodified.

## Changed files

- `receiver/src/delivery.ts` — modified
- `receiver/test/delivery.test.ts` — modified
- `receiver/test/outbox.test.ts` — modified
- `receiver/src/outbox.ts` — **not modified**: `fail()` already implements `attempts >= MAX_DELIVERY_ATTEMPTS → dead_letter + last_error`, below-limit → `retry` backoff, and `due()` already filters `state = 'pending'`.

`git status` shows only the three modified files plus untracked `docs/verification/s12-launch.txt` (pre-existing) and this receipt. `receiver/node_modules/` was populated by copying from the main checkout (`/Users/justn/dev/stackot/receiver/node_modules`, identical devDependencies, tsc 7.0.2) so the oracles could run without any network call; it is gitignored.

## Core diff summary

- `DeliveryOutbox` port = `due(): PendingDelivery | null`, `delivered(id): void`, `fail(id, attempts, error): void`. The `retry` member was removed per retry-1; the drainer never schedules retries itself.
- `DeliveryForwarder` return widened to `{ ok: boolean; status?: number }` — compatible with `forwardToGateway` in `server.ts` (`{ ok, status, body }`), which needed no change.
- `DeliveryDrainer.drain()` catch path is a single unconditional call:
  `this.outbox.fail(job.id, job.attempts + 1, message);`
  where `message` is `error instanceof Error ? error.message : String(error)`. The `{ ok: false }` branch throws `gateway rejected delivery (status <n|unknown>)`, so rejections carry the HTTP status into `last_error`.
- `delivery.test.ts`: all mocks expose `{ due, delivered, fail }` only. Cases: success → `fail` unreachable; `{ ok: false }` at `attempts=2` → `fail(id, 3, msg)` with `"gateway rejected delivery"` in the message; thrown `Error("timeout")` at `attempts=0` → `fail(id, 1, "timeout")`; `attempts = MAX-1` → `fail(id, MAX, msg)` for both rejection (`"502"` in message) and throw paths.
- `outbox.test.ts`: kept the end-to-end test (real `Outbox` + `DeliveryDrainer` + permanently failing forwarder → `dead_letter`, `attempts=MAX`, non-empty `last_error`, `due()` null). Added below-limit `fail` policy test: `fail(id, 1, "boom")` leaves `state='pending'`, `attempts=1`, `due()` immediately null, and after `next_attempt_at` is reset to 0 the row is due again.

## Oracle output (verbatim)

### `cd receiver && bun run typecheck`

```
$ tsc --noEmit

(exit 0, no output)
```

### `cd receiver && bun test test/delivery.test.ts test/outbox.test.ts`

```
bun test v1.4.0 (34cbb9a40)

test/outbox.test.ts:
(pass) failed delivery survives restart and retains dedupe after success [15.32ms]
(pass) dedupe retention begins when a delayed delivery succeeds [5.39ms]
(pass) existing outbox schema gains delivery timestamp without losing pending events [3.44ms]
(pass) constructor creates missing nested parent directories for the database path [2.67ms]
(pass) fifth failure becomes dead_letter with last_error and is no longer due [2.60ms]
(pass) last_error migration preserves a pending legacy outbox row [3.25ms]
(pass) drainer dead-letters a permanently failing job and due() stays empty [2.69ms]
(pass) below-limit fail keeps the row pending, backs off, and returns to due() [2.15ms]
(pass) requeue moves only a dead_letter row back to pending [2.04ms]

test/delivery.test.ts:
(pass) delivers pending job once on successful forward [0.10ms]
(pass) fails rejected forward with incremented attempts and status detail [0.07ms]
(pass) fails thrown forward with incremented attempts and the error message [0.05ms]
(pass) fails rejected forward at the attempt limit with status detail [0.04ms]
(pass) fails thrown forward at the attempt limit with the error message [0.03ms]

 14 pass
 0 fail
 45 expect() calls
Ran 14 tests across 2 files. [49.00ms]
```

### `cd receiver && bun test`

```
 103 pass
 0 fail
 198 expect() calls
Ran 103 tests across 12 files. [2.50s]
```

(Full per-test listing omitted for brevity; all 12 files passed with 0 failures, including the 5 server integration suites.)

## Contract conformance quotes

`DeliveryOutbox` port (delivery.ts):

```ts
export type DeliveryOutbox = {
  due(): PendingDelivery | null;
  delivered(id: string): void;
  fail(id: string, attempts: number, error: string): void;
};
```

Catch path (delivery.ts):

```ts
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.outbox.fail(job.id, job.attempts + 1, message);
        }
```

## Remaining risks

- `Outbox.fail`'s below-limit → `retry` delegation is now the single owner of retry scheduling; it is exercised by the new below-limit policy test and the end-to-end drain test.
- A non-Error throw is stringified via `String(error)`; `last_error` quality for exotic throws is untested.
- `status` absent on `{ ok: false }` renders `(status unknown)` in the message.
- No live/server-level proof: `server.ts` wiring is typechecked but the dead-letter path was not exercised end-to-end against a running gateway.
