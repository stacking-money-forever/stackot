# Discord forum tags — asset setup, not S49 acceptance

User resumed the full Stackot checklist on2026-09-29. The existing named
Stackot forums were configured through the authorized, serial Aside user
session. No role, permission, other channel, message or approval was changed.

Authenticated Discord API readback verifies the exact two type15 forums:
- stackot-issues1553998789675843594: bug, feature, question, triage,
  in-progress, blocked, resolved, wont-fix.
- stackot-prs1553999143997935767: draft, review, changes-requested,
  ci-failed, approved, merged, closed.

All15 tags are unmoderated and have no configured emoji, matching the existing
deploy/README.md contract. Safe metadata only is in forum-tags-live.json.
The private browser transcript is not copied into Git or progress evidence.
This closes the tag-configuration gap; actual GitHub/forum/backlink E2E,
two-user approval, worker execution and human QA remain separate. Count57/81.
