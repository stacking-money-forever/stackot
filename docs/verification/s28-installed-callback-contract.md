# S28 installed callback contract — owner source inspection

Pinned OpenClaw/Discord 2026.9.6, reused read-only from the retained S23 isolated
installation. S28 checkout base `d9de98c`, branch `codex/stackot-s28-20260928`,
non-focused idle root `w6V:p1`. No account operation or actual callback submitted.

Actual public API: registerInteractiveHandler({channel,namespace,handler}), from
runtime-api-CkahAQr_.d.ts lines 33622 and 49366. Discord uses channel=discord,
interactiveKey=interaction through createChannelInteractiveDispatcher. Its
registered handler receives native channel, accountId, conversationId,
parentConversationId, guildId, senderId, auth.isAuthorizedSender, interaction
kind/messageId/values/fields plus original data, parsed namespace and payload.
Provider senderId comes from interactionCtx.userId; generic callback payload
does not supply the principal. conversationId is channel:<channelId> in a guild.

Owner inspected installed Discord dist/.setup/provider-iOf73HW-.mjs at 9159–9169
and 9255–9289 and public plugin-runtime.d.ts at 132–183. Installed native
plugin-runtime-DqNQQ_pL.mjs at 83–126 builds the actual handler context.
Critical predicate: factory **still calls registration.handler when
auth.isAuthorizedSender is false**; it only withholds pluginRoot from binding
helpers. Product handler must explicitly deny auth=false before state lookup/
decision. Native command authorization is not task requester authorization.

Implementation must register only through this native plugin API and derive
actor solely from senderId, not username/model/text/interaction.payload. A
server-owned callback registry must bind token to native owner/session/flow,
request ID, account/guild/channel/parent/message and action/current plan; callback
text cannot choose owner/flow/principal or bypass persisted S27 predicates.
Reject missing/foreign native context, account/guild/channel/message mismatch,
wrong actor, expired/changed plan and replay. Do not expose a generic HTTP/RPC
endpoint that lets caller-supplied objects impersonate a native callback.

Evidence: installed types/source only, not runtime, deployed or human proof.
S28 remains open until a real native two-user approval probe demonstrates denial
outside UI filtering. Existing guild has no required forums/operations channels;
actual account/channel setup and human principals remain live-probe prerequisites.
No synthetic context or handler unit test may upgrade this gate.
