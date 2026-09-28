# B09 24-hour beta observation — NOT ACCEPT

Canonical predecessors B02/B03/B04 are accepted. The chosen host is the user's
Mac at stackot.justn.me. Current receiver status is truthful degraded state:
outboxReady true, pending0/deadLetter3/delivered0; Gateway hook forwarding was
disabled intentionally pending controller verification. Existing retained
dead-letter deliveries are evidence, not test data to delete or blindly replay.

`deploy/observe-soak.py` performs bounded read-only GET /readyz and /status on
loopback9377. It writes a new private mode0600 JSONL receipt, flushes/fsyncs each
sample, records wall/monotonic timing, deployment revision/bundle SHA, bundle
changes and sampling gaps, and omits provider errors/raw body. No credentials,
webhooks, DB rows, Gateway config or remote settings are changed. Interrupted
or short runs cannot become completed24h observations. A completed observation
still has betaAcceptance=false and recoveryTimeMeasured=false.

This collector starts a **host baseline**, not a substitute beta workload.
The actual B09 row needs a representative ingest/delivery workload and measured
SLO/recovery. Those observations cannot be inferred from readiness samples,
pending counts, synthetic fixtures or degraded status. Thresholds/workload are
not invented here. Actual model/Discord/worker execution remains unverified.

Before accepting B09: record a bounded real workload's source/mix/rate and exact
host revision; run it for actual24h; link delivered/dead-letter/incident receipts
and recovery measurements; report gaps/deployment switches and compare measured
SLOs with the chosen workload contract. An unavailable representative workload
keeps the row incomplete, even if baseline observations continue successfully.

The 5 Python tests validate sanitization, elapsed/interrupt rules, gap reporting,
failed observation coverage and independent status diagnosis after readiness503
only(S). Both reviewed defective behaviors fail their targeted mutation oracle.
They do not simulate the24h beta or establish deployment.

An initial2-second actual baseline recorded two valid readiness/status samples,
the deployed4915f5b bundle hash and degraded Gateway state. First24h candidate
was interrupted deliberately after review found ambiguous completion flags and
503 short-circuiting; its private receipt remains intact and is not24h proof.
Fixed summaries distinguish elapsedWindowComplete/scheduleContinuous from
hasSuccessfulStatusSample/allStatusProbesSucceeded. Actual missing diagnostics
stay unavailable; queue=null retains other valid status fields without guessing.
The fixed24h baseline will use a new receipt, never append to the old run.
