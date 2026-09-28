# S47 genuine pending restore/drain — owner receipt

Source: real GitHub issues.edited delivery65cd5010-bb09-11f1-9c73-fb0e8f26c548
ACK200 by deployed receiver4915f5b. During B04 supported replay, original
received_at1790578445366 was retained; readonly VACUUM INTO captured actual
pending with attempts5. No row seeding/backdating, no HTTP/provider doubles.
Private snapshot stays on selected Mac; it contains3 real rows (two existing
dead letters, one pending) and integrity_check=ok. Source never overwritten.

Dedicated task base1e5559b/rootw8Q:p1. Brgrf210ff20 advice rejected twice: both
oversize; first invented cross-restart exactly-once admission, second confused
outbox with approvals/manual delivered writes. Owner implements and verifies.
Per-task model/effort unavailable; no delegated mutation/credential access.

Oracle script: s47-probe.py. Fresh private host directory, no target DB initially;
copy standalone snapshot, verify all id/event/state/attempts/received_at tuples.
Run actual pinned Node24.21.0/OpenClaw2026.9.6 Gateway with OpenAI provider
catalog, explicit openai/gpt-5.6-sol, heartbeat0m/memorynone, all tools denied,
ACP absent and deliver=false. Normal runtime authentication is consumed by the
real software; owner does not copy/read/export user credential stores. Production
Gateway/config is unchanged. Receiver uses actual deployed bundle, its own
restored DB and private reduced-port config on loopback.

First trial passed restore integrity/equality but HTTP healthz did not warm native
readiness; receiver10s send timed out, actual pending became dead_letter. Failed
receipt retained s47-first-failure.json, private logs/state retained, owned
listeners closed. Corrected readiness uses authenticated native health and
models.list RPC before forwarding; no longer treats liveness as admission-ready.

Second trial actually delivered the row but could not correlate native runId
from a completion log while that run remained active. s47-warm-result.json is
NOT a pass (passed=false), despite delivered=true. Completion timing is not an
admission oracle. Final readonly network observer calls original fetch with
unchanged input and returns its original response; clone records only actual
HTTP200/ok/runId + Idempotency-Key delivery GUID. It never supplies responses,
changes requests/headers, persists credentials or fabricates terminal DB state.
S transparency fixture checks one request and original response/body; this is
explicitly S, distinct from live actual Gateway evidence.

Final s47-observed-result.json records genuine pending -> delivered, original
payload/received_at preservation, actual native run admission, receiver restart
preserving delivered and production replay CLI rejecting non-dead-letter row.
Observer count stays1 after restart: SQL delivered exclusion, not a warmed native
cache, prevents another dispatch. Both owned listeners stopped. Private config,
full logs and Gateway state remain outside Git; only safe metadata is committed.

Evidence D scope: selected deployment host, actual deployed receiver build,
genuine source/backup, real native Gateway admission and durable receiver row.
No model-completion, Discord message, worker, human or admit-to-commit crash-window
exactly-once claim. Native header cache is in-process and lost on Gateway restart;
S35/S36/S52 own external side-effect/recovery guarantees.

Run (owner-only credential input, no secrets in CLI arguments):

```sh
python3 docs/verification/s47-probe.py --runtime-root '<private runtime root>' \
  --snapshot '<private standalone snapshot>' \
  --delivery-id 65cd5010-bb09-11f1-9c73-fb0e8f26c548 --output '<safe receipt path>'
```

The first review command was issued after commit with --uncommitted and covered
only an untracked duplicate failure receipt; owner did not treat it as code review.
Correct independent review targets exact commitf3a7152. The duplicate failure
receipt is represented by committed s47-first-failure.json, not a new oracle.
Review found cleanup flag was set after writing receipt and CI did not exercise
process lifecycle. Owner moved failure before receipt persistence, nonzero exits
on surviving listener, and added portable s47-lifecycle-fixture.py: real receiver,
SQLite backup/restore/restart/replay and process cleanup with explicitly fake
Gateway. Its `--synthetic-provider-fixture` receipt is S/fakeProvider=true and
never replaces live D proof. Configured Bun path is portable; live run records
actual Node/OpenClaw versions, never fabricates provider/runtime versions.

Final code260bb3b was replayed on the selected host; `s47-final-result.json`
records evidenceClassD/fakeProvider=false, actual frozen runtime versions,
unchanged source bundle, genuine empty restore and native admission, restart
exclusion and both closed listeners. Linux source verification is CI36392488347;
the added lifecycle fixture runs the orchestration path with explicit S receipt.

**Owner ACCEPT:** exact task260bb3b CI36392488347 succeeded; integrated
ea597eab1d3006f3b3c0dc72208a66a9ddb9fa52 CI36392824869 succeeded in receiver,
runtime-config and ingress-contract. Owner target fixtures re-ran; real final
receipt/software versions/unchanged snapshot/source bundle/native admission and
closure inspected. Independent review of260bb3b found no actionable regression.
S47 accepted, total56/81 (M3 8/12); full goal remains incomplete.

Snapshot and
worktree must be retained. The production webhook remains inactive; this does not
activate the unfinished controller/worker pipeline.
