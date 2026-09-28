# B10 receipt — repo protection readback + plan (2026-09-28 ~01:28Z)

Scope kept: `gh api` GET only, repo stacking-money-forever/stackot. No
mutations, commits, pushes, subagents, MCP, secret-scanning alerts, or
auth/token reads. Owned files only; nothing else touched.

Readback (sanitized):
- Repo public, org-owned; token permissions admin=true.
- main @ fd5ff804a26931adb338b11a9a2e96e451772cb9 — protected:false,
  protection GET 404, rulesets [] (incl. parents).
- security_and_analysis: secret_scanning and
  secret_scanning_push_protection disabled (supported, unconfigured).
- Check-runs on main HEAD: `receiver` x2 (push+PR, success); combined
  status empty. Workflows on main: receiver-ci, job `receiver` only.
- Integration ref codex/stackot-completion-20260921 ci.yml adds job
  `runtime-config` — integration-only, invalid context for main today.

Findings: main fully unprotected; only `receiver` is a valid required
context; secret scanning + push protection enableable via PATCH (public
repo, no plan limit seen). No existing rules to preserve.

Artifacts:
- docs/verification/repo-protection.md — timestamps, endpoints/statuses,
  readback, findings, limits.
- docs/verification/repo-protection-plan.json — exact PUT protection
  (contexts [receiver], strict, enforce_admins flagged as owner choices)
  + PATCH security_and_analysis payloads; stale-plan conditions;
  post-apply readback steps. NOT applied — admin access != authz.

Residual: plan is bound to main SHA fd5ff804; contexts must be re-derived
after any workflow merge to main. GET readback proves configuration
only; enforcement needs a real blocked-merge attempt post-apply.
