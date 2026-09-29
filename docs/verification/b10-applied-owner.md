# B10 ACCEPT — actual GitHub governance configuration readback

Owner order: user selected the existing81-row ap checklist as the goal and
explicitly said go on2026-09-29. B10 in that reviewed checklist names required
checks/secret scanning application; this continues the prepared scoped plan.
No main merge/push, release, review-count requirement or paid plan was included.

Fresh preflight: public repo, admin permission, mainfd5ff804 unprotected,
no protection/rulesets/open PRs. All three exact named checks succeeded on
059b9bce52cfe5c636e33e722fef2d16e2d22d6d from GitHubActions app15368.
Actual first PUT returned422 because simultaneous empty legacy contexts and
explicit checks matched overlapping schemas. Readback confirmed no protection
mutation. The narrowed correction omits contexts and retains all app-bound
checks; failed-request evidence remains in b10-failed-request.json.

Successful PUT/PATCH and independent GET readback on2026-09-29 verify:
- main protected; strict receiver/runtime-config/ingress-contract checks,
  exactly from GitHubActions15368.
- Admin enforcement enabled; force pushes and branch deletion disabled.
- secret_scanning and secret_scanning_push_protection enabled.
- Main SHA unchanged; no parent/repo ruleset introduced.

Core DAG oracle is GitHub settings readback with supported features enforced.
These are actual service settings, not worker assertions or fixtures. ACCEPT
at that D configuration contract. No successful/failed merge or real/fake
credential-injection test is claimed or required by the canonical row oracle.
All other security settings are preserved. Safe before/after JSON is retained.

Residual: older main workflow lacks two names. Future PRs must carry the current
reviewed integration workflow, which already runs all three. Configuration
readback does not prove all possible bypass behavior. Original universal
merge-attempt bar in the preparatory plan is not promoted into the canonical
oracle and must not cause an unauthorized merge merely to obtain evidence.

Primary semantics: [GitHub branch protection API](https://docs.github.com/en/rest/branches/branch-protection),
[push protection](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/prevent-future-leaks/enable-push-protection).
Count becomes58/81 after this owner decision; actual worker/actor/H/deployment
gates remain incomplete.
