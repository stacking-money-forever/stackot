# B04 aged-pending alert

`alerts.yaml` uses the JSON subset of YAML1.2; no YAML dependency is needed.
Defaults: receiver-computed pending age >=300000ms and pending>0, poll60s,
reminder30min. Invalid/missing/inconsistent source is a monitor fault, never
invented backlog. Source is loopback and must match the private receiver config.

One bounded `alerts.py` invocation reads actual `/status`, holds an exclusive
file lock, persists intent/inflight before sending and a known Discord receipt
before cooldown. The recipient is the configured text `ciAlertsChannelId` in
the configured guild; tokens remain in private0600 inputs. The monitor receives
only Discord bot credentials and a reduced route config, never GitHub credentials. No raw event bodies,
mentions, model, worker, push or PR actions. Output contains trusted outcome/IDs
and error class only. Atomic state replacement uses file and directory fsync.

Discord `enforce_nonce=true` covers only the provider's short uniqueness window,
not indefinite exactly-once delivery. Unknown send/ack persistence remains
inflight/uncertain and fails subsequent runs without blind resend. Operator
reconciles the persisted nonce against actual channel history before changing
state; do not erase the intent. 429 records next-attempt time and reuses nonce.
Other explicit refusal is retried no sooner than60s. Failed source/send yields
nonzero exit plus private structured log; provider outage can still prevent any
Discord notification. This availability boundary is explicit.

Stage via `macos/install-alerts.py --root <private runtime root>`. Validate plist,
then bootstrap owned `me.justn.stackot.alerts` as a login job. Scheduled jobs emit
an outcome per invocation; a stopped/failed monitor must be observed via launchd
and its logs. System migration of the original four services does not migrate
this later job automatically. No login/reboot survival proof follows from a plist.

Live oracle must use a genuine source delivery and actual elapsed receiver age,
then verify the real channel/message receipt and restart cooldown. A shorter
explicitly recorded drill threshold is allowed without changing the production
300s rule; backdated fixture rows are only S. Actual delivery/readback is separate
from unit mocks, injected 429 and acknowledgment-loss tests.

Source: [Discord Create Message](https://docs.discord.com/developers/resources/message#create-message).
