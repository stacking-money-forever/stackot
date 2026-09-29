# S29 start authority preparation

`StartAuthority` prepares an owner-fixed codex task/workspace/timeout intent.
New pending grant and prepared intent commit atomically. Existing pending grants
are attached only against unchanged validated data; invalid/conflicting requests
leave no orphan intent that could block later valid preparation.
Authenticated renewal lineage may replace an expired pending or approved but
unadmitted coding intent; an approved grant also needs intact decision metadata
and an owner preparation hook. Existing noncoding/QA renewal rules stay unchanged.
the old intent is retained as superseded and its original grant is unchanged.
Inflight/started/uncertain admissions cannot be replaced by a new grant. Owner
preparation binds renewed coding requests before publishing their cards; missing
preparation refuses publication. An immediate click cannot beat intent creation.
Only a native-authenticated callback can supply the actor; the context type itself
is not authentication. task/requester/plan/action/TTL are checked against durable
approval state. Before an approved grant, backend readiness/spawn are not called.
The actual worker task text must equal the displayed full plan and its SHA256 at
preparation, execution admission and the final physical authorization check.
Missing coding login, isolation or backing API must make owner `ready` false.
Known factory/readiness unavailability leaves the grant approved and unadmitted.
The same authenticated button may resume that exact still-valid grant after
native/S27 revalidation; decision time/TTL are not renewed. Consumed, denied,
expired or changed-plan grants cannot use this recovery path. Typed availability
errors show retry guidance; unknown dispatch outcomes retain no-retry guidance.

Grant consumption and inflight admission are one native CAS. Only its confirmed
winner can invoke the executor. The owner-only executor must recheck the supplied
authorization function immediately before the physical side effect. Unknown
persistence or spawn acknowledgement stays inflight/uncertain and never retries,
even after owner reconstruction or a different operation ID. A new grant alone
cannot clear the existing task admission. Reconciliation remains an owner task.

Only explicit `executionPolicy: coding` state is eligible. Synthetic/QA markers
and stackot-qa task IDs are refused, including before native factory lookup.
Existing no-op QA and ingress approvals lack coding eligibility and remain no-op.
No callbacks/RPC/model parameters can supply an executor, target or operation ID.

`attachNativeStart` runs after native auth/route/message/requester checks and
approval persistence. `nativeCallbackRegistry` accepts an optional code-only
fourth owner factory. `stackotGatewayPlugin({startOwner,prepareStart})` captures
both trusted functions and passes them through the registered callback path; the
owner must first call `StartAuthority.prepare` on the coding task's bound store.
Its default bootstrap provides none. Source preparation
therefore does not activate worker execution in the deployment. The interface
is local owner code, not a claimed OpenClaw API. Actual pinned ACP binding,
isolated coding authentication, live before/after approval and Linux CI remain
separate evidence before S29 ACCEPT. S28's user waiver does not waive these.
