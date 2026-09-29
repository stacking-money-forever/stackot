# B10 owner refreshed concrete governance plan — NOT APPLIED

Live readback on2026-09-28: public stacking-money-forever/stackot, ADMIN;
mainfd5ff804 unprotected404; rulesets[]; secret scanning/push protection disabled.
No prior rules to overwrite. Original audit is retained in commit5472990.

Owner correction: successful required checks may be selected from this repository
within7days; they need not have run on main. Sourceea597ea/CI36392824869 succeeded
in receiver/runtime-config/ingress-contract, GitHubActions app15368. Thus the old
"integration-only check is invalid for main" assertion is withdrawn. Old main
workflow still has receiver only: a candidate PR must carry the current reviewed
workflow to satisfy all three. This is a concrete policy consequence, not an
universal deadlock. Integration already contains that workflow.

Prepared exact requests in repo-protection-plan.json: main strict checks for
these3 app-bound names, admins enforced, no review-count rule, no force push or
deletion; enable only secret_scanning and secret_scanning_push_protection.
No merge/main push/release is part of apply. G boundary remains an explicit
owner governance choice; concrete plan is ready for that decision.

Classic protection supports `checks[{context,app_id}]`; rulesets are not required.
The narrowed brgr advice follows rejection of that unsupported ruleset-only claim.
The2026-09-29 actual API rejected simultaneous empty legacy contexts and explicit
checks with422 (overlapping schemas). The corrected body omits contexts entirely;
all three app-bound checks remain. Optional unspecified boolean fields are
omitted, not sent as unsupported nulls. Four required nullable fields
remain explicit. Open PR list is currently empty, so no existing PR is affected.

Readback plus a non-mutating evaluate/merge-state check must establish enforcement;
never try a successful real merge merely to prove a gate. Keep main untouched.
Existing dirty worker artifacts were retained/committed before refreshing these
owned plan files. No source code snapshot is asserted from the old B10 base.

Primary rule source: [GitHub required checks troubleshooting](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).
