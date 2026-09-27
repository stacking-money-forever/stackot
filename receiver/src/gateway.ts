/**
 * OpenClaw Gateway hook forwarding.
 *
 * Posts normalized events to POST /hooks/agent. Admission (HTTP 200) means the
 * run was accepted — delivery to Discord happens inside the Gateway session.
 * Failures are logged, never thrown into the webhook path: GitHub redelivers
 * on 5xx only, and replaying an accepted event is worse than a lost notice.
 */
import type { ReceiverConfig } from "./config.ts";
import type { NormalizedEvent } from "./normalize.ts";
import { threadTitle } from "./mapping.ts";

export async function forwardToGateway(cfg: ReceiverConfig, ev: NormalizedEvent, deliveryId: string): Promise<{ ok: boolean; status: number; body: string }> {
  const forumChannelId = ev.createThread?.forumChannelId;
  const message = [
    ev.createThread ? `새 포럼 스레드 필요: 채널 ${forumChannelId}, 제목 "${ev.createThread.title}"` : `대상 스레드: ${ev.target}`,
    ...(ev.noticeChannelId ? [`CI 알림 채널: ${ev.noticeChannelId}`] : []),
    "",
    ev.summary,
  ].join("\n");

  const res = await fetch(`${cfg.openclawHooksUrl}/agent`, {
    signal: AbortSignal.timeout(10_000),
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.openclawHookToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `stackot-${deliveryId}`,
    },
    body: JSON.stringify({
      message,
      name: `stackot ${ev.repo} ${ev.item}`,
      agentId: cfg.agentId,
      deliver: false,
    }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

export function buildThreadCreation(ev: NormalizedEvent, forumChannelId: string): NormalizedEvent {
  const number = /#(\d+)/.exec(ev.item)?.[1];
  return {
    ...ev,
    targetKind: "channel",
    createThread: {
      forumChannelId,
      title: number ? threadTitle(ev.repo, Number(number), ev.item.replace(/^(issue|PR) #\d+\s*/, "")) : ev.item,
    },
  };
}
