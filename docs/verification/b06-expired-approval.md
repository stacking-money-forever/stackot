# B06 expired approval guidance — preparation, NOT ACCEPT

Candidate copy:

> 이 승인 요청은 만료됐습니다. 기존 버튼은 재사용할 수 없습니다. 작업을 계속하려면 새 계획에 대한 승인 요청이 필요합니다.

The private native callback must pass authorization, account/guild/conversation/
parent/message binding and exact stored requester checks first. Only then can
the trusted ApprovalRepository's exact APPROVAL_EXPIRED error choose this text.
All other failures retain the generic denial. A lookup throwing that same error
before requester verification does not reveal expiry. No IDs/hashes/tokens/raw
provider errors enter replies. No approval is renewed, consumed or dispatched.

Owner fixture oracle:9callback tests, full gateway75tests/452assertions,
typecheck/build passed after frozen install. Same new test against original
callback at29f31aa fails on expired requester guidance, distinguishing the fix.
These are S fixtures, not native authentication/Discord response or human QA.

Full row still requires actual expired-button native delivery, a usable immutable
new-plan/approval re-request path and human confirmation of what to do next.
The existing publisher produces approve/deny only; no retry control/command is
invented by this copy. B06 is NOT ACCEPT and count stays57/81. Source change is
prepared separately from production plugin activation. Linux CI and independent
review are required before integration. Preserve all actor/expiry state; never
reset the old grant or treat synthetic clicks as H.

Native expiry-probe preparation adds server-configured QA approvalTtlMs within
1000..900000ms, default900000. QA RPCs still accept no parameters, no principal
injection or supplied clock. Default S28 fixture fingerprints stay compatible;
an explicit TTL changes the fingerprint and cannot reuse a previous fixture.
The test proves old-default status lookup survives and changed TTL is denied
without writes. New expiry probes use new fixture IDs and actual wall time.
This preparation has not published a new Discord card or deployed the plugin.

Review found a late persistence-ack boundary: decide may store approved before
reporting expiry. Guidance now re-reads the exact matched request and selects
the new-approval text only while it remains pending. Stored decisions or failed
reconciliation retain the generic reply; no new eligibility is returned. The
targeted late-ack fixture fails against the pre-reconciliationf5fe9d4 callback.
