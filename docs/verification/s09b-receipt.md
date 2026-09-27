# S09B receipt — outbox write failure must not ACK

Candidate only; no commit/push/merge performed. Base: worktree HEAD `067e7ce`.

## Changed files

- `receiver/src/server.ts` (+22/-6)
- `receiver/test/server.outbox.failure.integration.test.ts` (new)

## Diff summary (`server.ts`)

- `outbox.has(deliveryId)` is wrapped in try/catch: on throw it logs
  `outbox dedupe check failed for delivery <id>:` + the error and returns
  `503 "outbox unavailable"`. Needed because the failure recipe also breaks
  reads — the live probe shows `has()` throwing `SQLiteError: disk I/O error`,
  which would otherwise escape `fetch` into Bun's default error response.
- `outbox.enqueue(deliveryId, routed)` is wrapped in try/catch: on throw it
  logs `outbox enqueue failed for delivery <id>:` + the error and returns
  `503 "outbox unavailable"`. Return-false still means `200 "duplicate"`;
  success still returns `200 "accepted"` after the synchronous commit.
- All three `void drainer.drain()` call sites (startup, 1s interval, post-ACK)
  now chain `.catch(logDrainError)`. During the broken-permissions window the
  drainer's `due()`/`fail()` calls throw every tick; without the catch those
  became unhandled rejections. `logDrainError` writes `delivery drain failed:`
  + error to stderr.
- Logs carry the delivery id (a GitHub GUID, not secret) and the Error object.
  No webhook secret, token, or request body is logged. Response bodies are
  short fixed phrases; no internals escape to the client.
- `outbox.ts` untouched; public API and behavior unchanged.

## Failure reproduction (owner recipe, used verbatim)

1. Spawn server normally; send one webhook → `200 accepted` (activates WAL).
2. `PRAGMA wal_checkpoint(TRUNCATE)` from a second connection so the committed
   row lives in the main DB file (see test note below).
3. Delete `outbox.sqlite-wal` and `outbox.sqlite-shm`; `chmod 0555` the dir,
   `chmod 0444` the db file.
4. New delivery id → server answers `503 outbox unavailable` (logged cause:
   `SQLiteError: disk I/O error`, errno 6922 `SQLITE_IOERR_VNODE`, thrown by
   `has()` at the dedupe check — the write never happens).
5. Cleanup: `chmod 0755` dir / `0644` db.

## Observed results

- Failed webhook: `503 outbox unavailable` — 5xx, never 2xx, body contains no
  internals (`SQLiteError` asserted absent).
- Resend of the failed id while still broken: `503` again — no false ACK.
- `/healthz` → `200` during the broken window and after the whole cycle —
  process survives; drain failures are caught and logged, not fatal.
- Post-restore DB check: no row for the failed delivery id; exactly one row
  total (the healthy one). No partial state.
- Recovery probe (new delivery id after `chmod 0755/0644`): **`503 outbox
  unavailable` — the connection does NOT recover.** `SQLITE_IOERR_VNODE`
  sticks to the deleted vnode for the life of the open connection on macOS;
  accepting webhooks again requires a process restart. Recorded as a finding,
  not weakened: the test asserts the no-false-ACK invariant (a 200 must be a
  real `accepted`, otherwise an explicit 5xx) and prints the observed status.

## Test implementation notes

- `PRAGMA wal_checkpoint(TRUNCATE)` before the break is required because in
  WAL mode committed rows live in `-wal` until a checkpoint; deleting it
  without one would drop the `outbox` table entirely and make the
  no-partial-row assertion vacuous.
- The post-restore row check uses a read-write `Database` open: a read-only
  connection cannot rebuild the deleted wal-index while the server holds the
  lock (`SQLITE_CANTOPEN`).
- Loopback only; gateway stubbed to `127.0.0.1:1`; no real network.

## Oracle output (verbatim)

```
$ cd receiver && bun run typecheck
$ tsc --noEmit
(clean)
```

```
$ cd receiver && bun test test/server.outbox.failure.integration.test.ts
bun test v1.4.0 (34cbb9a40)

test/server.outbox.failure.integration.test.ts:
(pass) S09B outbox write failure > healthy path regression: 200 accepted with the row committed at response time [3.42ms]
post-restore webhook result: 503 outbox unavailable
(pass) S09B outbox write failure > write failure returns an explicit 5xx, no ACK, no row, and the process survives [5.55ms]

 2 pass
 0 fail
 18 expect() calls
Ran 2 tests across 1 file. [74.00ms]
```

```
$ cd receiver && bun test
209 pass
 0 fail
429 expect() calls
Ran 209 tests across 17 files. [2.89s]
```

## Findings / residual risks

- **No self-recovery after permission restore.** `SQLITE_IOERR_VNODE` persists
  for the open connection; webhooks keep returning 503 until restart. This is
  fail-safe (never a false ACK) and `/healthz` stays up, so an operator can
  restart cleanly — but automated recovery would need reconnect logic, which
  is a separate owner decision and out of this row's scope.
- The drain catch logs once per tick while the outbox is broken (~1 line/sec),
  which is honest noise, not suppression.
- The recipe's break window is a few milliseconds of `rm`+`chmod`; a drain
  tick landing exactly in it could recreate `-wal`, but the subsequent
  `chmod` still fails the next write, so the outcome is unchanged.
