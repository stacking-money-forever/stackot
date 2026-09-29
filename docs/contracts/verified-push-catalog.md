# Verified owner push catalog composition — preparation

`verifiedPushOwner(policy)` composes the server-only catalog, isolated revision
verifier and existing owner push factory. A trusted owner bootstrap may pass it
to `nativeCallbackRegistry(api, agentId, verifiedPushOwner(policy))`. The module
is packaged as a standalone entry. Default plugin registration stays inactive:
there is no real S30 lease provider configured and none is fabricated here.

`resolveLease` must read server-observed task/workspace/common-Git/base-SHA and
worker-execution data, never requester/worker JSON. Task/requester/plan hash and
version must match both native binding and current flow task. Cancellation,
inactive task, mismatched execution, nonzero worker exit or unconfirmed cleanup
reject before verifier/credential access. Missing lease returns no candidate.

Target comes only from the prepared owner push intent and fixed repo policy.
Owner freezes the test command; isolated verification receives no coding auth
or network. The returned operation ID binds execution and push request.
Credentials remain in fixed repo policy, unresolved during catalog construction.
Existing native handler/PushAuthority guards still control actor authentication,
separate approval, consumption, fresh policy checks and remote receipt.

Tests use synthetic lease/store/verifier evidence and assert zero credential
lookups for missing/mismatched runtime data. These are S/L preparation, not an
actual worker lease, authenticated actor or GitHub push. R acceptance still needs
the real owner lease provider and deployed callback/model/Git chain.
