# S29 start authority preparation — NOT ACCEPT

The user waived only S28's remaining second-account scenario. S29 still requires
actual native Codex/ACP execution after authentic start approval. This retained
checkout starts at integrationf81c409; no no-op grant or fake principal is reused.

Owner implemented StartAuthority with fixed coding target, positive execution
eligibility, native actor/plan/action/TTL revalidation and atomic grant/admission
CAS. Only the confirmed winner calls an owner executor, which must check current
authorization at the physical boundary. Unknown storage/spawn acknowledgement
remains unrepeatable inflight/uncertain. QA/no-op state is rejected before factory
lookup. New pending grant and prepared intent also commit together, avoiding
orphan intents from invalid/conflicting input.

Authenticated B06 renewal lineage may supersede only expired pending/unadmitted
intents; old records/grants are preserved. Fresh grants cannot clear inflight,
started or uncertain admissions. The registered code-only stackotGatewayPlugin
builder captures startOwner and routes it through native callback discovery;
owner preparation of coding/renewed intent is a separate prerequisite. Default
bootstrap remains inactive and no deployment/model/login/push/PR is changed.

Local gateway155tests/1108assertions, typecheck and standalone build pass. Seven
disposable-copy oracles fail: pre-fix callback omits start, missing atomic
admission, late validation leaves an orphan, expired renewal is blocked, missing
full-plan binding, stranded known pre-dispatch recovery and missing prepublication
preparation. Approved but unadmitted coding grants may also renew after expiry;
admitted/uncertain operations cannot. Existing noncoding/QA renewals stay unchanged.
These are S, not actual worker R. Receipts: s29-start-negative.json.

Independent reviews identified missing registered owner wiring, orphan preparation
blocked renewal, unbound task text, outage recovery and publication timing. All
have targeted corrections/tests. Final independent review found no clear regression
or approval bypass; actual ACP remains outside this preparation review. Exact
source Linux publication still precedes any row acceptance.
The full row remains NOT ACCEPT;59accepted/1skipped/21required.

brgr5ad8a2ab local.devin configured SWE-2 High:2199bytes exceeded2000, rejected;
the one narrowed revision1681bytes exceeded1200 and proposed unsafe new-grant
retry without reconciliation, also rejected. A revise admission initially lacked
the original workspace and was corrected before its only actual revision launch.
Sealed result/decisions retained in s29-start-brgr.json. Actual model/effort
observation unavailable. Owner code/oracles, not worker claims, support preparation.

Pinned SDK research found public openclaw/plugin-sdk/acp-runtime exports
getAcpSessionManager with initializeSession/runTurn implementation. Native
managedFlows.runTask only projects supplied runtime/run metadata; it must not
fabricate actual execution. The actual contained acpx binding, coding login and
live before/after approval remain the next mandatory work, not an assumed API.
