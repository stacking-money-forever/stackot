# S36 owner backlink-only recovery

Task branch `codex/stackot-s36-20260928`, base `e87e6da`, idle shell root `w6T:p1`.
Brgr `a974436a-b8da-4a08-8644-1c92f6f3f928`, local.devin configured SWE-2 High
(actual model/effort observation unavailable), no-tool supplied-facts proposal.
First rejected unsafe absent-marker resend; narrowed second still described
creating a Discord thread instead of a GitHub backlink. Final rejection decision
`300f3aac-01cb-4055-8d27-2cdf86b56e67`; sealed objective/artifact preserved.
No third revision, model change, source-read/execution claim or write-capability
invention. Codex owns actual implementation because registered writes unsupported.

Primary artifacts `gateway/src/backlink.ts` and `gateway/test/backlink.test.ts`.
Repository consumes accepted native S35 thread receipt; has no thread creator.
It records backlink intent/UUID/marker body with native numeric-revision CAS.
Only prepared→inflight winner sends; an empty/unavailable inflight lookup cannot
resend. A trusted provider's proven definitely-not-sent outcome may CAS-reset the
same operation to prepared. Generic exception/ambiguous ack stays inflight.
Reconciliation validates repo/item/expected author and exact owned marker binding
task/operation/forum plus guild/thread URL. Existing duplicates fail explicitly.
Unrelated state and original thread receipt stay unchanged.

9 tests / 44 assertions pass with typecheck. Full suite/build and target hash
replay/publication/Linux CI are next gates. Synthetic fixtures cover thread-ok /
backlink-definitely-not-sent retry, post-write receipt failure, ambiguous ack,
outage/empty lookup/late receipt, ten concurrent callers, forged marker bindings,
duplicate markers and changed scope. Thread backend called once, one effective
backlink marker after recovery. Actual Receiver findThreadId recognizes the
generated marker using its existing expected-recorder/guild trust contract.

Baseline has no backlink module; new suite fails import on that snapshot (feature
absence, not semantic historic bug). Labelled mutants permitting inflight empty
lookup resend and trusting any author both fail the suite in disposable copies.

Evidence S: MemoryStore/backend are test doubles; a fresh repository instance
is not a real process restart. Native flow persistence itself is established by
S25/S26/S35, not reclassified from these tests. Actual GitHub author metadata,
provider not-sent/idempotency guarantees and production controller integration
still require S49 live verification. Matching strings alone are not authentication;
caller/model cannot supply trusted provider capabilities. No actual account write,
Discord operation, worker, deployment or human evidence is claimed.
