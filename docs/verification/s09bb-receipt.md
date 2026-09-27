# S09Bb receipt — outbox failure recovery and honest readiness

Candidate only — no commit, push, merge, or deploy performed. Base: worktree HEAD (`6853df9`).

## Changed files (edit scope respected — nothing else touched)

- `receiver/src/outbox.ts` — write-health tracking, honest `ready()`, `recover()`.
- `receiver/src/health.ts` — `StatusReport`/`statusReport` carry outbox health.
- `receiver/src/server.ts` — `/readyz` 503 + bounded self-repair, `/status` outbox state, `/healthz` cheap.
- `receiver/test/outbox.test.ts` — two new tests (unhealthy tracking, recover path); all prior tests untouched.
- `receiver/test/server.outbox.failure.integration.test.ts` — strengthened with readiness/status/recovery assertions.

## Core diff summary

- `Outbox` gained a `state: { ok, lastError }` tracker plus a private `write()` wrapper. Every mutating method (`enqueue`, `delivered`, `retry`, `fail`, `requeue`) runs through it: a thrown write marks `ok=false` and stores the **masked** message (`redact` with the config secrets); a successful write flips `ok=true` and clears the error. `health()` returns a copy of the tracker.
- `ready(): boolean` (was `void` + `SELECT 1`): returns `false` immediately while unhealthy — no probe, so a broken database does not re-wait out `busy_timeout` on every readiness check — and otherwise runs a real write probe: `BEGIN IMMEDIATE` then `ROLLBACK`. A failed probe marks the tracker unhealthy.
- `recover(): boolean` closes the connection, re-runs the constructor's `open()` (mkdir, `new Database`, same pragmas, same schema/TTL sweep — nothing changed), then verifies with the same probe. Never throws; failure stays in `health().lastError`; safe to repeat.
- `statusReport(outboxReady, gateway, queue?, outbox?)` — appended optional param so the 2-arg calls in `health.test.ts` still compile; `report.outbox` defaults to `{ ok: outboxReady, lastError: null }` when not supplied. `/status` passes `outbox.health()` so the report carries `ok`/`lastError`.
- `server.ts` `/readyz`: probe → if false, `attemptRecovery()` (max one `recover()` per `RECOVERY_INTERVAL_MS = 1000`, wrapped so a handler never dies) → re-probe → `readiness()` answers 503 `outbox unavailable` or 200 `ready`.
- `/healthz` and `/status` now read `outbox.health().ok` instead of probing — a contended `BEGIN IMMEDIATE` probe waits out `busy_timeout` (5 s) and would stall liveness.

## Recovery procedure and triggers

- **Trigger 1 — write self-heal:** any successful write (`enqueue` from a webhook, `delivered`/`retry`/`fail`/`requeue` from the drainer) clears the unhealthy flag automatically.
- **Trigger 2 — `/readyz`-driven `recover()`:** when the tracker is unhealthy or the live probe fails, the readiness handler attempts `recover()` at most once per second, then re-probes, so a healed outbox answers 200 within the same request.
- **If recovery keeps failing:** `/readyz` stays 503 `outbox unavailable`, `/status` stays `degraded` with the masked `lastError`, `/healthz` stays 200, and webhooks keep returning 503 with no row committed (S09B). The supervisor sees an honest not-ready signal instead of a lying green check.

## Commands run (oracle output)

```
$ cd receiver && bun install --frozen-lockfile
6 packages installed [32.00ms]   # node_modules was absent; one allowed install

$ cd receiver && bun run typecheck
$ tsc --noEmit
# clean, exit 0

$ cd receiver && bun test test/outbox.test.ts test/server.outbox.failure.integration.test.ts
(pass) S09B outbox write failure > healthy path regression: 200 accepted with the row committed at response time
(pass) S09B outbox write failure > a contended write returns an explicit 5xx with no ACK and no row, then recovers [25043.36ms]
(pass) failed delivery survives restart and retains dedupe after success
(pass) dedupe retention begins when a delayed delivery succeeds
(pass) existing outbox schema gains delivery timestamp without losing pending events
(pass) constructor creates missing nested parent directories for the database path
(pass) fifth failure becomes dead_letter with last_error and is no longer due
(pass) last_error migration preserves a pending legacy outbox row
(pass) drainer dead-letters a permanently failing job and due() stays empty
(pass) below-limit fail keeps the row pending, backs off, and returns to due()
(pass) requeue moves only a dead_letter row back to pending
(pass) two connections racing the same delivery id produce exactly one row
(pass) enqueue waits out a briefly held write lock instead of throwing SQLITE_BUSY [117.07ms]
(pass) a contended write failure marks the outbox unhealthy until a successful write clears it [7252.22ms]
(pass) recover() reopens the connection and restores readiness, and is safe to repeat [13833.41ms]
(pass) a pending row is still due after close and reopen
 16 pass / 0 fail / 95 expect() calls — 46.42s

$ cd receiver && bun test
 273 pass / 0 fail / 970 expect() calls across 26 files — 54.27s
```

## What the strengthened oracle proves

- While the lock holder forces the enqueue failure: webhook → 5xx (no `accepted`/`duplicate`, no `SQLiteError`, no row), `/readyz` → **503** (previously 200), `/status` → `degraded` + `outbox.ok=false` + masked `lastError`, `/healthz` → 200.
- After the lock is released: `/readyz` recovers to 200 `ready` via the bounded `recover()` path, the previously failed delivery id is accepted as new (no trace), and a fresh delivery commits.

## Remaining risks

- **Recovery never succeeding:** by design — `/readyz` keeps answering 503 and the tracker keeps the last masked error; nothing restarts the process automatically. That decision belongs to the supervisor, which now finally has a true signal.
- **Probe cost:** `BEGIN IMMEDIATE` + `ROLLBACK` is cheap uncontended, but under a held write lock a probe (or `recover()`) waits out `busy_timeout` (5 s) synchronously on the event loop, stalling all handlers — including `/healthz`, which still answers 200 once served, just late. Once unhealthy, the tracker short-circuits further probes so at most one 5 s stall happens per failure plus one per recovery attempt (≥1 s apart).
- **`/status` is tracked state, not a live probe:** between the moment a fault appears and the next failed write, `outbox.ok` can read `true`. `/readyz` remains the live answer; `/status` reflects the last observed outcome.
- **In-process state only:** a restart resets the tracker to healthy and lets the next probe/write re-derive the truth — same convention as the Gateway health tracker.
- **`recover()` swaps the connection object** while the drainer holds the `Outbox` instance; because every method resolves `this.db` per call and JS is single-threaded, the swap is safe — but an in-flight forward that then calls `delivered()` writes to the *new* connection (same file, same rows).
- `secrets` is an optional second constructor arg (`new Outbox(path, secrets)`); all existing 1-arg call sites — tests, `replay.ts` — compile unchanged and simply store unmasked messages, which only matters when secrets can appear in SQLite error text (they cannot in the current paths; the server passes `secrets` anyway for defense in depth).
