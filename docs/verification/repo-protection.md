# B10 — repository protection readback (stacking-money-forever/stackot)

Auditor: B10 (sibling worker; S25 runs elsewhere). Read-only audit: every
GitHub access was `gh api` GET. No settings changed, no commits/pushes,
no secret-scanning alerts, tokens, or `gh auth` output touched.

## Queries (all 2026-09-28 UTC)

| Time | Endpoint | Result |
|------|----------|--------|
| 01:27:54 | GET /repos/stacking-money-forever/stackot | 200 |
| 01:27:54 | GET /repos/.../rulesets?includes_parents=true | 200 `[]` |
| 01:28:02 | GET /repos/.../branches/main | 200 |
| 01:28:02 | GET /repos/.../branches/main/protection | 404 "Branch not protected" |
| 01:28:06 | GET /repos/.../commits/fd5ff804/check-runs?per_page=100 | 200 (2 runs) |
| 01:28:06 | GET /repos/.../commits/fd5ff804/status | 200 |
| 01:28:17 | GET /repos/.../actions/workflows | 200 (1 workflow) |
| 01:28:17 | GET /repos/.../contents/.github/workflows/ci.yml?ref=main | 200 |
| 01:28:25 | GET /repos/.../contents/.github/workflows + ci.yml?ref=codex/stackot-completion-20260921 | 200 |

## Sanitized readback

- Repo: public, org-owned (`stacking-money-forever`), not archived.
  Token repo permissions: admin/maintain/push/pull/triage all true.
- Default branch `main` @ `fd5ff804a26931adb338b11a9a2e96e451772cb9`;
  `protected:false`; protection endpoint 404.
- Rulesets: none at repo level; `includes_parents=true` still `[]`, so
  no org rulesets apply either.
- `security_and_analysis` — every flag `disabled`: secret_scanning,
  secret_scanning_push_protection, secret_scanning_non_provider_patterns,
  secret_scanning_validity_checks, dependabot_security_updates.
- Check-runs on main HEAD: `receiver` (github-actions, completed,
  success) listed twice — push + pull_request triggers of one job; a
  single required-check context.
- Combined status on main HEAD: `pending`, zero contexts — no
  third-party status contexts exist to require.
- Workflows on main: one — `receiver-ci` (.github/workflows/ci.yml),
  triggers push+pull_request, jobs: `receiver` only.
- On ref `codex/stackot-completion-20260921`, ci.yml adds a second job
  `runtime-config` (no `if`); it emits no check-run on `main` today.

## Findings

1. `main` is entirely unprotected: no branch protection, no rulesets.
2. Valid required-check contexts on main today: `receiver` only.
   `runtime-config` is integration-branch-only — requiring it on main
   now would deadlock merges. It becomes valid only after the
   integration ci.yml merges to main AND the context appears in
   check-runs on a main SHA; re-derive then, don't reuse this list.
3. Secret scanning + push protection: supported-but-unconfigured
   (`disabled`). Public repo + admin token means PATCH /repos can
   enable them — no permission or plan limit observed. (Non-provider
   patterns, validity checks, Dependabot security updates are equally
   unconfigured but out of B10 scope; not planned.)
4. Nothing exists to preserve: no protection object, no rulesets.

## Remediation and limits

Exact payloads for required-status-check enforcement and secret
scanning/push protection are in `repo-protection-plan.json` with
stale-plan conditions and post-apply readback. Nothing was applied;
admin access is not authorization.

Two explicit policy choices inside the payload, flagged not hidden:
`strict:true` (branches must be current before merge) and
`enforce_admins:true` (checks bind admins). Either may be flipped to
`false` by the owner; everything else is null = "no rule", so no review
quota, merge policy, or unrelated feature is invented.

GETs prove configuration, not enforcement. After any authorized apply,
enforcement evidence still requires a real merge attempt lacking the
check — a GET-only oracle can confirm the settings but not the gate.
