# S28 live requester/replay receipt — NOT ACCEPT

Approved thread1554001284066189343 under claw-control1544593083587493898.
Actual native QA info resolved agent:stackot:discord:channel:1554001284066189343.
Native sessions.create returned runStarted=false, session270f72bb-36e8-43d2-a91c-d32e0ebf6917.
Real SDK published full plan then message1554001810652536853, flowdd290a5f-c82a-41a6-a53d-90bafd10db01.
SyntheticPlan=true and workerDispatched=false throughout.

User explicitly instructed owner to click through the logged-in Aside account.
Serial non-isolated UI clicked approval as actual requester1112741808162734110.
Native audit authorized=true, exact guild/thread/message, outcomeapproved.
Native stored statusapproved, decidedBy1112741808162734110, revision10.
Immediate real UI replay outcome denied; stored revision/status unchanged.
After owned Gateway restart, stored approval survived; another real UI replay
invoked the private handler with authorized=true and outcome denied. SDK
callback registration survived, not merely the product's state JSON.

Safe artifacts: s28-live-{thread,info,session,status,replay,restart,audit}.json
and s28-live-publication.txt. No credentials/raw callback tokens retained.
These are actual R actor ingress/persistence observations on the deployed Mac;
the plan itself is synthetic. Agent-operated account clicks are not human QA.

Wrong actor534692447561842698 has existing Administrator role and channel access,
but no authenticated client session for that account is available to the owner.
Its genuine pending-grant click is still missing. Current fixture is already
approved; a later wrong-actor-first oracle must use a fresh immutable fixture,
never reset this grant or claim replay denial proves requester enforcement.
No S28 acceptance, no worker/push/PR integration, accepted count remains54/81.
