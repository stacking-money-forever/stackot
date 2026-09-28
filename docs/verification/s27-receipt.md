# S27 owner guard implementation

Task branch `codex/stackot-s27-20260928`, accepted S26 base
`ae9a69ea601866ec34fef98ec1b50c89b749847b`; managed root `w6S:p1` is an idle shell,
not a direct agent. Brgr task `9e2f11b3-8a0e-47d8-a613-642035ad1464`, healthy
local.devin, configured SWE-2 High (per-task observation unavailable), no-tool
supplied-facts advice. Write capability unavailable, so owner implements/tests.
First result rejected for pending→consumed shortcut and pre-auth metadata return.
Narrowed result rejected for invented requesterHash/requestVersion and a manual
rev inside stateJson; actual native revision is metadata. Final decision
`dc6b9272-28d4-4709-b895-fcdc6bd008ab`; no third revision or model substitution.
Sealed objective/artifact retained as status/result JSON. Product decision separate.

Owner extends actual S26 record shape. decide requires pending; consume requires
approved and durable server operationId. Both check supplied actor, exact binding,
current task status (planned/waiting/running only), plan hash/version, sane clock
and inclusive expiry denial, with fresh reads/predicates on up to four CAS retries.
Pending cannot be consumed; denied/used requests cannot renew. Corrupt decision
metadata and real storage errors fail closed. Slow storage ack crossing expiry
returns no eligibility; committed marker remains for trusted reconciliation.

Owner typecheck/build and 21 tests / 184 assertions pass, including 10 new guard
tests. Thirteen wrong actor/task/action/plan/version/inactive-state cases are
checked at both stages without mutation. Other cases include exact expiry,
clock regression, consume race, conflict-time plan/cancel/expiry change, storage
failure, consumed write-ack loss, no grant renewal and expiry during ack.
MemoryStore and actor context are synthetic S evidence, not runtime authentication.

In disposable copies, new guard tests fail against the actual accepted S26 module
from the base SHA, which has no decide/consume methods. Labelled mutants skipping
actor checks, permitting reused grants or changing expiry to exclusive also fail.
These mutants are safety discrimination, not fabricated historic code.

Limit: CAS permits one eligibility return per record, not exactly-once external
effects. Dispatch/receipt reconciliation and a last actual-action predicate check
belong to the trusted future controller (S29 onward). API context types cannot
authenticate callers; actual Discord two-user actor/context enforcement is S28.
Target hash/replay and exact-SHA Linux CI required before product acceptance.
