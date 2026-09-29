# S33 owner preparation — NOT ACCEPT

Checkoutstackot-s33-20260929, basefee28b6, ownedrootw80:p1, launch3c48755.
brgr49a604bb-65d7-47cb-a716-2061c2baa435 healthy local.devin/configured SWE-2
High; observed model/effort unavailable. Advice only, owner implements/verifies.
First777byte report rejected(700limit, invalid already-pushed commit requirement).
One narrowed second467byte report correctly identifies ambient same-UID Git/gh/
SSH authority; owner accepted adviceadc4bbfc-3ebd-49dd-8272-3720eeca7879.
Artifact digest383524f4b938afb484937a96a9a28919b2710cd30653f760591734c2b7ed9eec.
Brgr advice acceptance is not product/runtime acceptance.

Owner push adapter binds separate push request/current plan/target revision,
checks independent verifier and allowed target, consumes at dispatch and rechecks
current policy/cancel/plan/expiry after credential lookup. Token and provider
error text are never persisted. Unknown/consumed operations cannot blind retry.
Worker environment helper explicitly does not prove filesystem/keychain isolation.

Owner8targeted tests/56assertions, full gateway94tests/570assertions, typecheck/build
pass. Local real bare Git remote stays unchanged for pending approval, with zero
credential resolution/transport calls. Credential-before-approval mutation fails
the negative oracle. Controller/approval/broker dependencies remain synthetic(S).

Independent review/exact Linux CI pending. No deployed plugin change, worker,
real credential or GitHub write. Native controller wiring/real owner transport,
sealed revision verification integration and actual worker credential isolation
remain required for S33 R acceptance. Count remains57/81.

Owner transport continuation: git-push.ts exports verified objects into a fresh
owner bare repository before any auth exists, omits worker config/hooks/replace
refs, pins destination/branch/commit and returns exact Git ref readback. Canonical
production endpoint is GitHub HTTPS; explicit local fixtures stay inside owner
test root. Owner askpass helper has no credential contents; token only in owner
Git subprocess env, not argv/source/receipt/worker inputs. No same-UID isolation
claim. Generic bounded command failures never return Git/provider output.

Actual Git fixtures2tests/27assertions show source commit/config mutation and
worker hooks/URL rewrites cannot alter sealed push destination/SHA. Mutation
using worker Git config instead of sealed repository fails that oracle. Full
96tests/597assertions/typecheck/build pass. Synthetic authority/credential and
local remotes remain S only. New code/CI/review pending, no real GitHub push or
native controller/worker connection enabled.

Review272ef05 found unbounded retained sealed repositories and a128MiB pack
ceiling. Added explicit idempotent disposal of only generated owner storage and
cleanup on sealing failure; pack export/import now streams with backpressure,
no full-pack buffering. Actual132MiB random blob commit seals successfully;
failed seal and explicit disposal leave worker/remote fixtures intact. Targeted
Git4tests/51assertions; full98tests/621assertions/typecheck/build pass. Previous
272ef05 exact CI36504175668 green; corrected code still needs its exact CI/review.

Native attachment continuation adds code-only lazy owner factory on approved
push bindings after callback native principal/route/message/requester guards.
S27 approval commits before factory; push gate consumes before auth/transport.
No default factory/config/RPC injection or deployed push. Captured handler tests
3pass/14assertions verify negative predicates never call owner factory, only
approve+push can dispatch, consumption prevents replay and reply distinguishes
remote sent/uncertain. Fake contexts/broker remain S. Actual NativePushOwnerFactory
production instance, sealed verifier/broker/worker and GitHub proof still open.

Reviewe6edfa1 found factory/dispatch rejection could retain generic approval
success copy after storing the decision. Reply/audit now begin push_uncertain,
upgrade to push_sent only on confirmed transport result, hide provider exception
and do not re-dispatch. New targeted rejection fixture fails againste6edfa1.
Captured handler/broker tests4pass/22assertions; full102tests/643assertions,
typecheck/build clean. These remain S, not native/GitHub/worker runtime proof.
