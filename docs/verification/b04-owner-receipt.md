# B04 owner receipt — actual aged-pending operator delivery

Scope: `deploy/alerts.yaml`, bounded monitor, macOS login-job staging and tests.
Base38901cb; retained checkout stackot-b04-20260928, Herdr rootw8G:p1.
Brgr35d15b3a-efee-4ca8-996f-83dcd83f2b72 local.devin advice rejected twice:
oversize/incorrect nonce claim, then oversize/incorrect age interpretation.
No delegated writes or observed task model/effort; owner owns implementation.

Actual source: existing dedicated GitHub hook686936824 temporarily subscribed
only to issues and active-readback checked. Own QA issue2 was edited; actual
GitHub delivery2704e9a0-bb05-11f1-92f0-eb9658ed3a96 returned200 to deployed HMAC
receiver4915f5b. Original opened event was not observed after immediate disabling;
no receipt was invented. Narrowed edit held the hook active until real intake.
Hook was then restored inactive with original six events. No Gateway hooks,
worker, push or PR pipeline enabled.

Live monitor used explicitly recorded threshold5000ms/poll2s. Receiver-computed
age (Date.now minus stored received_at) rose1537→3603→5675→7745ms; no row seeded
or backdated. Actual Discord message1554015771594592369 in ci-alerts
1553999331198238840, authored by bot1544612489981984818, matched sampled count1
and age7s. Independent message readback/historical content match confirmed one
delivery. GET omitted nonce; no claim of an observed nonce echo. Safe receipts
are b04-live-monitor.json, b04-discord-readback.json and b04-github-deliveries.json.

Second genuine edit: message1554019482077495417, native alert job bootout/bootstrap
while actual pending count1 persisted. Cooldown observed after restart and
actual channel query found zero further bot alerts after that receipt. Receipt:
b04-live-restart.json. These are D observations, not unit/mock promotions.

Own QA issue2 closed with marker verification; original hook remains inactive;
production300000ms threshold,1800000ms reminder and60s polling restored. Actual
receiver rows/failed-delivery evidence retained, not deleted. Cleanup receipt is
b04-live-cleanup.json. Scheduled login job is active, last exit0 and logs outcomes.
No system/reboot guarantee: this later job remains login-dependent and is not
automatically included in the original four-service privileged migration.

S oracles:12tests cover exact threshold, actual file restart/cooldown, ambiguous
ack, pre-send persistence failure, wrong channel ack, rate-limit nonce/backoff,
post-send receipt persistence loss, response-time cooldown/backoff, retry sample refresh, conflicting installation,
interrupted immutable staging retry and native file-lock collision. Initial
1e5329a fails preservation/current-values tests (only isolated-login-dir test
adapter changes interface). All production sources unchanged by that adapter.

Independent serial codex reviews found/corrected preflight mutation, stale retry
content, legacy adoption/retry and concurrent staging. Versioned immutable
script/target files, pending install fingerprints, exclusive installer flock and
unique staging paths now protect those boundaries. Runtime message/nonce state
is separate. Provider nonce dedupe is short-window only; unknown ack stays
uncertain with nonzero failure/no blind resend. Provider outage can prevent
Discord delivery; explicit local failure/logs remain, not a second-channel claim.

Final code e68fdaa uses response completion time for cooldown/backoff. It was
actually deployed (alert sourceSHA2561873641ce4dd3538e622a3947d18e6bce0f61403f8f427a3461646b6b9e7e867),
and replayed against another genuine source edit on closed own QA issue2.
Message1554023450291478633 readback matches; new log bytes after native job
restart show cooldown while pending remains1; zero later bot alerts after that
receipt. `b04-final-live.json` preserves the evidence. Production rules restored.

**Owner ACCEPT:** codee68fdaa Linux CI36388625338 succeeded; integrated
e3a960d361c31e5aa9c937e94f6fc9486bf355b8 CI36389522688 succeeded in receiver,
runtime-config and ingress-contract. Target owner re-ran12 tests; deployed
immutable script equals owned source bytes. B04 accepted, total55/81.

Production300s threshold also observed against genuine delivery65cd5010-bb09-11f1-9c73-fb0e8f26c548:
supported replay retained its actual original received_at, no backdating or fixture
seeding. Brief owned receiver maintenance yielded a consistent pending snapshot,
then real `/status` age>=300000 produced message1554026966481510456 with actual
author/content/channel readback. Root receiver returned to loopback listener and
unsigned public401; production rules remain300s/poll60s. Evidence is
`b04-production-threshold.json`; pending snapshot retained privately for S47.

Receiver346 and Gateway71 baselines unchanged; alert12 tests are S and live
delivery/restart/readback is D. No system/reboot or full pipeline proof claimed.
