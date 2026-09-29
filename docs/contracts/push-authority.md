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

WorkerEnvironment minimizes inherited values and disables global Git-helper
inheritance. It is not a sandbox or same-UID filesystem/keychain boundary; HOME,
coding-agent login, local Git config, gh/keychain and SSH state need actual S29
worker isolation proof. Do not upgrade this map to unavailable credentials.

Owner fixtures8push tests/56assertions and full gateway94tests/570assertions pass,
typecheck/build clean. Real local Git bare-remote denial retains unchanged refs,
zero credential lookups/transport calls. The approval/controller/broker are
synthetic: evidence S only. Early-credential mutation fails the negative oracle.
S33 R oracle remains actual SDK/controller/worker boundary with real credential
broker and remote readback; prepared code is not runtime acceptance.
