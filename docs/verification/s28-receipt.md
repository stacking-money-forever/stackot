# S28 independent preparation — row NOT ACCEPT

Base `d9de98c`, branch `codex/stackot-s28-20260928`. Owner inspected actual pinned
native API/factory/Discord source (s28-installed-callback-contract.md). Factory
does not prevent handler invocation for auth=false: explicit product denial is
necessary. Brgr `2e5131a6-2e91-42a8-8dc0-db404d806b75` first advice rejected for
nonexistent data.action and forged-object origin inference. Narrowed correction
accepted as advice, decision `e71e7e21-b8b2-4480-a7cf-8e0e3f441b9b`; not row acceptance.
Exact sealed result/status retained. local.devin configured SWE-2 High, actual
observation unavailable; no tools/mutation advice; actual code/oracles owner-owned.

Artifacts: private native registration helper `gateway/src/callback.ts`, plus
FlowCallbackRegistry in callback-registry.ts. Helper denies auth=false/invalid
sender before lookup, checks native account/guild/channel/parent/message against
server binding, takes principal only from native senderId and action/plan only
from server binding, then calls S27 decide. It does not consume or spawn. No public
HTTP/RPC context injection endpoint. Object shape/token is not origin proof.
Registry records fixed token/route/message/request/decision under server-resolved
flow state with CAS, preserves unrelated state, refuses token rebinding and only
binds real stored pending requests. Callback text cannot choose the native store.

11 new tests / 58 assertions, typecheck and callback/registry builds pass.
Test inputs, captured registration API, MemoryStore and principals are synthetic
S only. Fresh registry over the same backend is not process restart evidence.
Native false-auth bypass and ignored message-binding labelled mutants fail the
helper suite; actual baseline lacks the new helper. No authentic callback was
submitted or accepted. Source/type facts are not real actor-auth proof.

Remaining S28 executable work: native plugin bootstrap, server-owned route/flow
registry discovery after restart, real pending-message/component producer and
actual two-user native probe. Required actual forum/account setup and principals
must be prepared before the live probe. New helpers alone do not activate the
production path and do not satisfy S28. No fake RPC actor injection, TS brand or
synthetic UI filtering may replace that runtime evidence. Count remains 54/81.
