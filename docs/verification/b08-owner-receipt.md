# B08 owner drill — ACCEPT

Source implementation895cfbece1a8963ce6f23fd0e8f345d1e6eea5c3 passed exact
Linux run36396368749. Protected regular-file credentials and per-forward reload
never relax the mandatory config credential or introduce retired fallback.

Owner local oracle:351pass/0fail/1247assertions, typecheck and build passed.
New real receiver/SQLite integration test uses an explicitly fake Gateway(S):
old401 pending → atomic replacement → new admission; missing file produces no
Gateway request and recovers when restored; credential-echoing HTTP401 response
values stay out of logs and persisted dead-letter errors. Same receiver process.
The same test against baseline1a4bd38 server/config in a disposable copy failed
at delivery after replacement, proving the dynamic-read assertion distinguishes
the old code. No production DB was modified by this synthetic regression.

Two independent review issues in the original native probe were corrected:
ignored ping traffic became supported signed issues with committed-row checks;
the old-token retry is now observed by persisted attempts plus exact-ID401
post-write telemetry before changing the file. A follow-up reviewer required
source/bundle linkage: the probe now builds from this worktree before launch,
records23source/manifests hashes and Git revision and checks no source drift.

Actual rerun `b08-built-result.json` passed. It records exact bundle SHA256,
Gateway36477/receiver36910 listener PIDs unchanged, retired token401/current
token200/native runId, controlled pending401 retry recovered, three supported
intake ACKs all persisted and ultimately delivered, no token values in logs or
DB errors and all owned listeners closed. Real pinned native runtime; no fake
provider, production Gateway mutation, ACP worker or outbound delivery.

Evidence is selected-host native admission/rotation and durable controlled
traffic. It does not establish genuine GitHub-origin delivery, model completion,
Discord flow, human QA, exactly-once downstream execution or production rollout.
Private credentials/logs remain outside Git; all earlier result receipts retained.

Owner ACCEPT: test/probe/doc26703cfebcb9d4734e4cac415d7e19c235f08085 passed
Linux run36410587906(receiver/runtime-config/ingress-contract all success).
Independent exact-commit review found no actionable defect. Integration commits
fc311cd/df9c1f3 preserve17files byte-for-byte; owner re-ran351tests/1247assertions,
typecheck/build successfully. Exact integration SHA
df9c1f39a3c237c36a82783c294a1d17e4cfdb38 passed Linux run36411296403(all3checks).
Product count57/81, M5 5/11. brgr candidate results remain rejected as recorded;
no worker report is used as evidence. Acceptance covers native selected-host
rotation/drain only; production activation/downstream/H remain unproven.
