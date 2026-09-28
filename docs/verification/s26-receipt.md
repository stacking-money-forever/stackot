# S26 owner implementation and evidence

Base `8ce162cb7d3a8133e86162843a04659431385385`; task branch
`codex/stackot-s26-20260928`. Brgr task `2e0e46d4-2825-412b-a985-bd07f1af1c98`
used configured local.devin (SWE-2 High configuration, per-task observation
unavailable). Registered write capability is unavailable; the task was explicitly
no-tool supplied-facts advice, and Codex owns implementation and real oracles.
Both proposal revisions were rejected: the first invented SDK types; the narrowed
second still proposed a custom file/key store and S27 expiry-policy changes.
Status/result preserve the exact narrowed objective and sealed artifact. Final
brgr rejection decision `8ec35a45-ab14-4b35-b983-5ce2afd60ddd` is not a product-row
failure: owner implements the bounded native contract directly.

Artifacts: Gateway pending repository, native FlowStateStore facade, 11 tests,
reviewed native fixture and reproducible build helper, compatible S25 runner
extension, Linux CI wiring and required product/deployment documentation.
The facade uses native expectedRevision and setWaiting. It is for pending state;
it does not preserve a running flow's status or implement controller resumption.
Native persistence owns file atomicity; no custom storage or trust bypass exists.

Owner checks: typecheck/build pass; 11 unit tests, 53 assertions. Coverage includes
unrelated state preservation, exact string uint64 IDs, stable expiry after replay,
conflicting payload denial, bounded conflicts, concurrent record retention, native
owner/controller checks, stale revision mapping, real error propagation and corrupt
stored shape denial. Expiry eligibility, actor authentication and grant consumption
remain S27/S28. Unit MemoryStore is evidence S only.

Actual native fixture: process `87737 → 88002`, flow
`5b76599b-de47-4c07-b31e-882aa32e0167`, revision 1/waiting; pending record recovered
unchanged, second creation idempotent with original TTL, unrelated state retained.
The first process/listener stopped before restart, and both owned process groups
were stopped by cleanup. Synthetic request values, no model/worker/channel.
R evidence is limited to actual local native storage/restart, not authorization.
Compatible S25 baseline replay also passes with process `88325 → 88592`, flow
`680382a0-0c69-48a1-b48d-b11757d1cc3d`, stale denial and real keyed-store trust refusal.

Discrimination in disposable copies: the actual baseline lacks the new module,
so the new suite fails import there (feature absence, not semantic bug proof).
Explicit mutation controls for memory-only reported success and skipped stored
validation both fail the same suite. These are labelled mutations, not fabricated
pre-fix implementations. No source worktree changes were made by the controls.

Publication/exact-SHA Linux native restart still required before product ACCEPT.
No deployed, Discord actor, coding-run, push/PR or human evidence is claimed.
