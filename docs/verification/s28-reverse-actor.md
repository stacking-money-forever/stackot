# S28 live wrong-requester denial — partial R, NOT ACCEPT

Authorized QA scope: existing claw-control thread1554001284066189343, no code,
push, PR or deployment dispatch. Deployed package b9cc8d7 remains unchanged;
its source-identical code was covered by Linux CI36501125563 on5aa7d51.
Only the opt-in QA fixture was temporarily changed. Hooks stayed disabled,
tools deny all stayed active; original private configuration was restored.

Fresh fixture6d46f7eb-2e6b-4151-986d-706b49328113 assigns requester
534692447561842698 and permits both actual IDs on UI controls. Card:
https://discord.com/channels/1544592589666127953/1554001284066189343/1554317554305208441
Actual flow7557d2e7-aabb-4add-83b4-25a7e4bd3c26 starts pending at revision10,
requestedAt1790648581145/expiresAt1790649481145 (15 minutes, actual clock).

Aside used the user's existing authenticated 황준혁 session, non-isolated.
Target-card snapshot and locator identified the exact message; one click
reached the native handler with sender1112741808162734110, authorized=true,
matching guild/thread/message and outcome=denied. Actual private reply:
“이 승인 요청을 처리할 수 없습니다. 최신 요청을 확인해 주세요.”
Before/after JSON receipts are identical: pending, revision10, no decidedBy,
same TTL. This proves the server per-request actor guard; native auth or UI
restriction alone does not explain the denial. Source plan is synthetic,
actual interaction/SDK/persistence is R; agent operation is not H.

Restoring the exact previous configuration and restarting the owned Gateway
changed PID3592→9715; qa.info again resolves fixture d9411d1a and requester111.
The new pending flow remains byte-identical in the selected safe state fields
after restart. No approval/card/TTL was reset. Safe artifacts:
s28-reverse-{publication,before,after,audit,postrestart}.json.

## Erroneous first selection, preserved honestly

A global button nth selection hit the previous B06 renewal card1554284192773447811
before the target-specific click. Native flow d0fdd78b-dfdf-4e76-a253-3bd79708833e
revision21→22; renew-30250ba4-b26e-41fe-946f-bab099887b0d changed pending→approved
by1112741808162734110. The original expired approval remained pending/unchanged.
Both are no-op QA cards; no worker/push/PR is attached. This prior click is not
the new denial oracle and does not provide B06 human comprehension evidence.
No grant was silently reverted to hide the action. Subsequent click used the
exact snapshot-bound target locator rather than a repeated button index.

## Remaining row condition

The genuine second principal534692447561842698 has not authenticated/clicked.
Its normal acceptance and the complete two-user scenario remain unverified.
S28 is NOT ACCEPT; S29 dependencies are unchanged and total remains57/81.
