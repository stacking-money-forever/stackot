# Stackot — agent instructions

## Completion condition

**`CHECKLIST.md` is this project's definition of done.** The work is not complete —
and must not be described as complete — until every item in that file is checked
with evidence. A green test suite is *not* completion: it is local/synthetic
evidence only. Never upgrade a synthetic result to runtime, deployed or human
evidence; test doubles do not raise an evidence class.

Read `CHECKLIST.md` before starting any task here, then `docs/verification/wave-*.md`
for the per-row decisions and `docs/atomic-completion.md` for the row DAG
(scope, oracle, evidence class, boundary).

## Where things are

- `docs/atomic-completion.md` — canonical 81-row task DAG; one row = one changeset = one oracle.
- `docs/verification/wave-*.md` — launch contracts, owner ACCEPT/REJECT decisions, residual risks.
- `docs/verification/owner-state.md` — current continuation state and what is blocked on what.
- `docs/spec.md` — product spec. `deploy/README.md` — receiver + gateway deployment. `deploy/vm/` — single-VM runtime artifacts and runbook.
- `receiver/` — GitHub webhook ingress, durable outbox, routing, observability.
- `gateway/` — S26 native flow facade and pending approval persistence. Later callback/controller/worker guards remain separate checklist rows.

## Execution rules

1. **One bounded brgr task per row, owner-verified.** Follow the execution contract in the ledger:
   run registered harnesses through brgr; preserve the selected model, allow up to two independent
   sibling tasks, and use at most one narrowed revision. The owner inspects sealed results/diffs,
   re-runs the oracle, makes an explicit brgr accept/reject decision, and records the row decision
   with residual risks in `docs/verification/`. Brgr task acceptance alone is not product-row acceptance.
2. **Do not trust a worker's report.** Compare file hashes, re-run the oracle yourself, and prove the
   new tests fail against the pre-fix code in a disposable copy. An oracle that passes on both the
   old and new implementation proves nothing.
3. **Push before calling a row accepted.** Anything touching process control, filesystem semantics or
   timing must pass CI on the Linux runner; local green is not evidence for those. This repository has
   already seen three local-only successes break on the runner.
4. **Preserve evidence.** Task worktrees, launch prompts and receipts are committed on their row
   branches; never delete a worktree. The integration branch is `codex/stackot-completion-20260921`.
5. **Secrets never enter the repository.** Receiver configuration fails startup on a missing, blank or
   `<...>` placeholder value — that is intended behaviour, not a bug to relax.
6. **Keep documents true.** If behaviour changes, update `docs/spec.md`, `deploy/README.md` and
   `deploy/vm/README.md` in the same change. Unsupported event claims and stale paths have shipped here
   before.
7. **Blocked rows stay blocked honestly.** If a row needs a host, credentials or a human, record exactly
   what is missing and finish the independent work instead of producing a plausible substitute.
