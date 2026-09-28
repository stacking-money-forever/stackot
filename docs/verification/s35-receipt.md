# S35 owner implementation and evidence

Task branch `codex/stackot-s35-20260928`, base
`8ce162cb7d3a8133e86162843a04659431385385`. Brgr
`90fcede4-2815-4213-b6ef-32662a22e0b9` ran through healthy local.devin with configured
SWE-2 High; actual per-task model/effort observation is unavailable. First proposal
rejected unsafe lease takeover. Narrowed second sealed review accepted as advice,
decision `90027a73-3bbf-42ea-83a3-1175af1b50e5`. It does not accept the product row.
Codex owns implementation/runtime execution because registered write capability
is unavailable. Retained brgr status/result contain the exact objective/artifact.

Owner qualification: a declared **unproven** capability never permits resubmission.
The trusted eventual backend must prove provider idempotency and verify the marker's
actual bot author/context, not merely matching receipt strings. Until then default
durableIdempotency=false. Live Discord/provider integration remains S49. No caller
or model may set provider capability. Receipt fixtures do not prove authentication.

Artifact `gateway/src/thread-receipt.ts` stores durable prepared→inflight→created
intent with native CAS. Only the prepared→inflight CAS winner makes the initial
create. Inflight has no lease/expiry takeover: unavailable/empty lookup returns
uncertain; owned operation receipt reconciles; proven provider idempotency alone
permits resubmit of the same operation. Created receipt is durable before success,
unrelated state is preserved, changed task/forum/bot scope conflicts and contradictory
receipts fail closed. Receipt-commit failure leaves inflight for reconciliation.

Shared input from owner S26: FlowStateStore SHA-256
`435e5ff0b377d8d41a91e90ac752e68a728fb2e54c897dc22ff8ec1b129e7aad`.
It is consumed unchanged, not independently authored by S35. Package/tsconfig/lock
are recorded build inputs. Runner extends the S26 compatible restart oracle;
integration must preserve the S25/S26 branches and re-run them through CI.

11 unit tests / 34 assertions and typecheck/build passed. Tests cover post-create
commit failure, ambiguous success, empty/unavailable lookup, lost inflight-write
ack before create, late provider landing, ten concurrent callers, scope/receipt
denial and same-operation capability-gated resubmission. MemoryStore/backend are
test doubles, evidence S. Actual baseline lacks this new module; new tests fail
import on that snapshot (feature absence only). Explicit mutation allowing create
after every empty lookup fails the safety matrix; it is not a historical pre-fix.

Real native storage with synthetic provider: Gateway `96535 → 96755`, flow
`784bc6e7-6979-46e4-8f01-b954ad277130`. Initial durable inflight revision 2 remains
after injected failure between synthetic external success and receipt commit.
New Gateway reconciles fake external marker into created revision 3, then reuses
the same thread/operation; total synthetic provider create calls=1. Unrelated state
preserved. Owned listener/process groups stopped. Actual native storage/restart is
bounded R evidence; thread creation/reconciliation remains S, not real Discord.

Target hash/replay, exact-SHA Linux CI and product-row decision remain required.
No backlink, account write, worker, deployment or human acceptance is claimed.
