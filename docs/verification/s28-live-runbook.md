# S28 real-actor probe

This is a native callback actor test with a synthetic no-op plan. It is not
coding, push, PR, deployed, or whole-forum-workflow evidence. The retained JSON
plan names the exact existing guild/channel and two real members observed via
authenticated read-only preflight. User explicitly authorized the named thread
and card publication. Bot GET for the exact claw-control channel returned 403;
access correction/alternate channel request is pending. Do not retry authorization
or create elsewhere without the user's channel choice. No write was attempted.

Exact denial diagnosis: Discord returned code 50001 Missing Access. Parent
category 작업실 and claw-control both deny permission bit 1024 (ViewChannel) to
everyone; bot has only the 스태콧 role with no channel-specific allow. Guild-level
ViewChannel therefore does not give it access here. Grant ViewChannel to that
role for this channel; keep the everyone denial. The bot has no management
permission and cannot elevate itself or change these overwrites.
No resource or message has been created by this plan.

Preflight: bot authentication works; guild `1544592589666127953` has two human
members, zero forums/threads and no Community feature. Bot's actual guild mask,
interpreted with installed discord-api-types PermissionFlagsBits, grants ViewChannel,
SendMessages, SendMessagesInThreads, CreatePublicThreads, ManageThreads and
ReadMessageHistory, but not Administrator or ManageChannels. Per-channel effective
permissions still must be read before attempting the named thread.

Forum creation requires Community per [Discord's official FAQ](https://support.discord.com/hc/en-us/articles/6208479917079-Forum-Channels-FAQ).
Enabling Community changes server verification/moderation requirements; this plan
does not change that server setting or grant bot permissions. A text-thread actor
probe exercises the actual native parent/channel/account/user predicates, while
product forums and S49 deployment remain unproved.

After confirmation and successful channel-specific readback, create only the
named standalone public thread under claw-control, with one-hour auto-archive.
Use an isolated owner Gateway state, official pinned Discord plugin, Stackot
plugin and compatible Node. Restrict Discord ingress to that QA thread and the
two IDs; no model turn/worker runs are needed. Set heartbeat off and memory slot
none. Keep existing user service/config separate.

Enable QA only in this isolated state via plugins.entries.stackot-gateway.config.qa:
enabled=true, fixtureId/IDs from the plan, accountId=default, threadId=actual new
thread ID, forumId=parentChannelId (this field stores native parent ID; the probe
does not claim the parent is a forum). Server config is authoritative. The
operator.admin QA RPCs reject **all** parameters and cannot accept an alleged
native actor/context object.

1. Call stackotgateway.qa.info; obtain the **actual native routing** sessionKey.
2. Native sessions.create with that key, agentId=stackot and label=s28-actor-qa;
   prove runStarted=false before publishing.
3. Call stackotgateway.qa.publish with empty params. It creates a native managed
   flow/no-op pending request, sends the complete plan first, then the card.
   Product token bindings persist in the receipt hook before SDK component
   registration. Both IDs may click UI controls so UI filtering cannot explain
   the wrong-user denial. No direct actor-injection surface exists.
4. Second member clicks first. Capture the actual interaction audit (safe numeric
   sender/route/message IDs, native auth boolean and denied outcome), ephemeral
   denial, and qa.status still pending. A native auth=false/UI-blocked result
   alone does not prove the per-task actor check.
5. Requester clicks. Capture native audit plus qa.status approved/decidedBy and
   actual message/flow/revision. Replay must not grant a second decision/use.
6. Stop only owned Gateway group and prove listener closed. Preserve state,
   SDK component-registration receipts and task artifacts; never delete worktrees.

Unknown send acknowledgement stays uncertain and is never a new create.
Delivered card/failed registration with a known message ID repairs via edit of
that exact message, reusing the same product tokens. A partial-plan failure shows
no approval card. These fixture tests do not prove provider guarantees live.
S28 remains open until the authentic two-user oracle and same-SHA Linux evidence
pass; do not accept from template, schema, constructor or synthetic audit lines.
