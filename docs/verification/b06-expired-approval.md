# B06 expired approval guidance — preparation, NOT ACCEPT

Candidate copy:

> 이 승인 요청은 만료됐습니다. 기존 버튼은 재사용할 수 없습니다. 작업을 계속하려면 새 계획에 대한 승인 요청이 필요합니다.

The private native callback must pass authorization, account/guild/conversation/
parent/message binding and exact stored requester checks first. Only then can
the trusted ApprovalRepository's local ApprovalExpiredError choose this text.
All other failures retain the generic denial. A lookup throwing that same error
before requester verification does not reveal expiry. No IDs/hashes/tokens/raw
provider errors enter replies. No approval is renewed, consumed or dispatched.

Owner fixture oracle:10callback tests, full gateway76tests/455assertions,
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

Follow-up review found an unexpired storage error sharing the expiry message
could select misleading copy. Only the locally generated expiry error class is
now classified; a plain storage Error with the same message remains generic.
Native auth/binding gates still precede classification. The error type is not
authentication. Existing error messages and S27 denial predicates are unchanged.

## Retry-control source preparation

Fresh card intents now bind a third `승인 재요청` token to the same trusted
requester/route/message. Legacy intents without this token retain their original
cards. Native bootstrap attaches the server issuer; no RPC accepts an alleged
actor. Handler checks precede renewal and its audit says requested, not approved.

Issuer requires an expired pending original, matching requester and active
planned/waiting task (running is permitted for push/PR, not duplicate start);
rechecks at every read/CAS/publication. It stores one durable
new request ID per original and uses the current full plan/hash/version. Original
approval/expiry stay unchanged; new approval is pending with normal24h TTL.
Replay/concurrency/restart use the same ID and existing plan/card publication
intents; uncertain send acknowledgements never blind-resend. Cancellation,
running tasks, decided originals and changed prepared intents fail closed.

Owner86tests/514assertions/typecheck/build pass. Eight renewal fixtures cover
distinct immutable issuance, negative gates, concurrency, current-plan binding,
state races and unknown acknowledgement. Callback tests ensure wrong native
auth/requester never reach issuer. A random renewal-ID mutation fails the replay
oracle. These tests are S; new native button/renewal behavior and H are pending.

Review found an old retry could point at an already-expired renewed approval.
Issuer now follows the durable expired lineage to a fresh pending request,
without changing prior grants, and checks expiry again after publication before
reporting success. Replays share the latest recorded generation. Cycles/deep
corrupt lineage are rejected rather than looping or blindly issuing requests.
