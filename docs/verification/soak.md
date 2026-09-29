# B09 24-hour beta observation — NOT ACCEPT

Canonical predecessors B02/B03/B04 are accepted. The chosen host is the user's
Mac at stackot.justn.me. The initial baseline had a degraded Gateway and queue
pending0/deadLetter3/delivered0. Current2026-09-29 readback is statusok,
Gateway reachable, pending0/deadLetter3/delivered1 after the reviewed approval
ingress connection. Generic model hooks remain disabled. Retained dead-letter
deliveries are evidence, not test data to delete or blindly replay.

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

The 6 Python tests validate sanitization, elapsed/interrupt rules, gap reporting,
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

## Observed wall-clock gaps — 2026-09-29

Latest read-only audit is `b09-current-baseline-audit.json`: the same actual
collector PID54300 is live, wall elapsed exceeds24hours, but monotonic coverage
is roughly12.8hours and13 clock-divergence intervals remain. Recorded probe
failures are0; this does not cover the missing wall intervals. There is no terminal
receipt, representative beta workload or measured recovery. B09 NOT ACCEPT.
The legacy JSONL is unchanged; no collector restart or replacement was performed.

At the earlier77sample checkpoint, recorded wall elapsed45665.23s
versus monotonic elapsed4568.48s; largest wall gap7116.76s while largest monotonic
gap60.15s. Thirteen intervals show clock divergence. Successful probes alone
do not prove availability during those missing intervals. These observations
identify timing/coverage gaps, not their cause.

`deploy/analyze-soak.py --input <private receipt>` audits both timelines without
changing/restarting the active collector. It distinguishes terminal-record
presence from beta acceptance, rejects malformed/backwards clock assumptions,
and reports wallCoverageContinuousThroughLastSample=false for the actual receipt. Five targeted
tests cover regular scheduling that conceals wall gaps, backward time and false
terminal/clock data. Existing raw receipts stay intact. B09 remains NOT ACCEPT:
this run is neither representative beta traffic nor continuous24h coverage.

Review additionally required separating readiness/status failures and terminal
coverage. The analyzer now reports each failed probe separately, names coverage
through the last sample explicitly and gives terminal coverage=null when legacy
end records have no wall timestamp. A known terminal wall gap is measured;
monotonic terminal gaps are reported independently. No clock value is inferred.
