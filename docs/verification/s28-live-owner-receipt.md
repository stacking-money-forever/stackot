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

## Owner continuation — 2026-09-28 authenticated UI recheck

User again instructed the owner to perform the clicks. The owner opened the
existing card in Aside, confirmed the active account display as 황준혁 /
justn_hyeok, opened the profile menu and then the actual `계정 관리` dialog.
The dialog lists only `justn_hyeok 활성 계정` and `계정 추가하기`; no second
stored authenticated Discord account is available through this UI. No logout,
credential extraction, new-account creation or impersonated callback occurred.
The UI's locator click initially timed out because a promotional dialog
interfered; after closing that dialog, the actual account-management button
worked. This distinguishes the resolved UI obstruction from the remaining
authentication dependency.

The already-approved card was not reset or clicked again. The missing oracle
is still a genuine second principal's denial against a fresh pending fixture,
followed by the requester's approval. S28 remains NOT ACCEPT; this account-state
observation does not add an actor event or human QA evidence.
