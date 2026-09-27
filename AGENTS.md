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
- `receiver/` — the only custom code so far: GitHub webhook ingress, durable outbox, routing, observability.

## Execution rules

1. **One row at a time, owner-verified.** Follow the execution contract in the ledger: one bounded
   worker task per row (`devin --model swe-2`, one narrowed retry), owner inspects the diff, re-runs
   the oracle, and records ACCEPT/REJECT with residual risks in `docs/verification/`.
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
