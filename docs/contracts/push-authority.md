# S33 owner push authority — preparation, NOT ACCEPT

PushAuthority is a server-only owner adapter, not a public RPC or native actor
authentication implementation. Controller must derive actorId from authentic
native ingress; typed contexts and injected dependencies do not prove identity.

Prepare requires action=push, server-allowed repo/task branch/pinned commit and
an independent owner revision verifier. Durable intent binds request/task/plan/
version to that target; changing it cannot reuse an approval. Pending/expired/
wrong-actor/stale-plan requests are denied before credential or transport access.
After independent verification, S27 consumption rechecks current eligibility.
Credentials are resolved by owner-only broker for one repo, never stored or
passed to worker inputs. Just before dispatch, cancellation/current plan/target/
consumed operation/expiry are checked again. Successful remote SHA must match.

Consumed/inflight/sent/uncertain states never authorize a fresh dispatch here.
Loss between consume and intent update, or after remote write, needs explicit
owner reconciliation; no exactly-once claim. Generic errors omit broker/provider
text and credentials. This module does not implement the real GitHub transport
or activate push from the existing approval callback.

OwnerGitPush prepares actual Git transport separately. Before any credential is
provided, owner verification approves a pinned commit and Git exports reachable
objects through an owner-configured reader into a fresh sealed bare repository.
The sealed repository has no worker alternates/config/hooks; replacements and
global/system config are disabled. Worker source/config is not used for push.
Transport pins one repo/branch/commit, uses canonical GitHub HTTPS with redirects
disabled, owner askpass reads a per-operation private0600 credential file,
only the file path in environment, no token in argv/environment/helper/source/state,
and exact remote-ref readback. Main/master are rejected. Explicit owner-local
fixture remotes are limited to test root; they do not prove GitHub delivery.
Command output/errors stay private, bounded diagnostics/time and owner process group.
Object packs stream with backpressure between export/import rather than a128MiB
memory ceiling. Caller persists receipt then explicitly disposes generated owner
storage; failed sealing also disposes it. Task worktrees/remote refs stay intact.
Owner directories are not a same-UID sandbox; real worker isolation remains open.
Credential files are deleted after success or failure. The transport truncates
the original credential descriptor before removal. If cleanup fails,
the transport is disabled and a fixed diagnostic is emitted; a confirmed remote
receipt is preserved. Abrupt process/host termination can retain private files;
startup reconciliation remains required before production activation. The
real Mac fixture probe
found other same-UID process environment bytes readable despite the tested
Seatbelt profile. Removing token bytes from Git subprocess environments closes
that specific leak; it does not prove worker filesystem/Keychain isolation.
`gateway/scripts/probe-worker-isolation.py` returns a failing boundary verdict
for that expanded native probe. Linux `--control-only` never claims native proof.

WorkerEnvironment minimizes inherited values and disables global Git-helper
inheritance. It is not a sandbox or same-UID filesystem/keychain boundary; HOME,
coding-agent login, local Git config, gh/keychain and SSH state need actual S29
worker isolation proof. Do not upgrade this map to unavailable credentials.

Owner fixtures8push-gate tests/56assertions and full gateway98tests/621assertions pass,
typecheck/build clean. Real local Git bare-remote denial retains unchanged refs,
zero credential lookups/transport calls. The approval/controller/broker are
synthetic: evidence S only. Early-credential mutation fails the negative oracle.
Four additional actual-Git tests seal a commit, modify worker content/config and
install a worker pre-push hook; push reaches only the intended local bare remote
with the original pinned SHA, no worker hook/rewrite/later commit. Protected or
wrong targets and failed owner verification do not push. These fixtures use fake
authority/credentials and are S. No production push broker is activated.
Switching the transport back to worker Git config fails the actual local-remote
test, proving URL-rewrite exclusion is observed rather than a declared flag.
S33 R oracle remains actual SDK/controller/worker boundary with real credential
broker and remote readback; prepared code is not runtime acceptance.

Native attachment preparation: nativeCallbackRegistry accepts an owner-code-only
factory; no JSON config or RPC accepts broker/actor/function objects. Factory
lookup is lazy: handler must pass native auth/account/guild/conversation/parent/
message/requester predicates and commit its separate push approval first.
Only approve+actionpush gains the dispatch closure; start/deny/PR do not.
PushAuthority then consumes/revalidates before credentials/transport. Sent and
uncertain results have distinct private copy/audit, with no replay dispatch.
Default plugin bootstrap supplies no factory and enables no push. Captured
context/fake-broker tests are S, not native-origin authentication or live push.
If owner lookup/dispatch rejects after approval storage, reply/audit explicitly
say approval saved but push completion unconfirmed, rather than treating that
exception as remote success or proven failure. Provider exceptions remain private.
