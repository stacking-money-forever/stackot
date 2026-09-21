/**
 * Stackot Receiver — GitHub webhook ingress for the OpenClaw Gateway.
 *
 * Pipeline per POST /webhook:
 *   1. HMAC verify (X-Hub-Signature-256)        → 401 on mismatch
 *   2. Delivery dedupe (X-GitHub-Delivery)      → 200 no-op on duplicate
 *   3. Normalize event                          → 200 no-op on uninteresting
 *   4. Resolve Discord target
 *      - issue/PR opened → createThread in #issues/#pull-requests
 *      - comment/review  → thread ID from GitHub reverse link
 *      - CI failure      → #ci-alerts
 *      - unresolved      → 200 no-op + admin notice (spec: never guess)
 *   5. Forward to Gateway /hooks/agent
 */
import { loadConfig, type ReceiverConfig } from "./config.ts";
import { verifySignature } from "./verify.ts";
import { PayloadTooLargeError, readBodyWithinLimit, requireDeliveryId } from "./ingress.ts";
import { Outbox } from "./outbox.ts";
import { DeliveryDrainer } from "./delivery.ts";
import { normalize, type NormalizedEvent } from "./normalize.ts";
import { findThreadId, fetchItem } from "./mapping.ts";
import { forwardToGateway } from "./gateway.ts";

const cfg: ReceiverConfig = await loadConfig();
const outbox = new Outbox(process.env.STACKOT_OUTBOX_PATH ?? new URL("../var/outbox.sqlite", import.meta.url).pathname);
const drainer = new DeliveryDrainer(outbox, async (job) => forwardToGateway(cfg, job.event, job.id));
const retryTimer = setInterval(() => { void drainer.drain(); }, 1000);
void drainer.drain();

async function resolveTarget(ev: NormalizedEvent): Promise<NormalizedEvent> {
  const repoCfg = cfg.repos[ev.repo];
  if (!repoCfg) {
    // Unlisted repo: webhook pointed here but no routing configured. Admin notice.
    console.warn(`repo not configured: ${ev.repo}`);
    return { ...ev, target: cfg.adminChannelId };
  }

  // New items: create a forum thread in that repo's parent channel.
  if (ev.targetKind === "channel") {
    if (ev.item.startsWith("issue")) return { ...ev, createThread: { forumChannelId: repoCfg.issuesForumChannelId, title: titleFrom(ev) } };
    if (ev.item.startsWith("PR")) return { ...ev, createThread: { forumChannelId: repoCfg.prsForumChannelId, title: titleFrom(ev) } };
    if (ev.item.startsWith("CI")) return { ...ev, target: cfg.ciAlertsChannelId };
    return ev;
  }

  // Follow-ups: resolve the thread via the GitHub reverse link.
  const number = Number(/#(\d+)/.exec(ev.item)?.[1]);
  const kind = ev.item.startsWith("issue") ? "issues" : "pulls";
  try {
    const item = await fetchItem(cfg, ev.repo, kind, number);
    const threadId = findThreadId(item, cfg);
    if (threadId) return { ...ev, target: threadId };
  } catch (err) {
    console.warn(`mapping lookup failed for ${ev.repo} ${ev.item}:`, err);
  }

  // Unresolved: never guess (spec §5). Route to #ci-alerts follow-ups or admin.
  console.warn(`no thread mapping for ${ev.repo} ${ev.item}`);
  return { ...ev, target: ev.item.startsWith("CI") ? cfg.ciAlertsChannelId : cfg.adminChannelId };
}

function titleFrom(ev: NormalizedEvent): string {
  const number = /#(\d+)/.exec(ev.item)?.[1] ?? "";
  const subject = /^제목: (.+)$/m.exec(ev.summary)?.[1] ?? ev.item;
  return `[${ev.repo}#${number}] ${subject}`.slice(0, 100);
}

Bun.serve({
  hostname: cfg.host,
  port: cfg.port,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/healthz") {
      return new Response("ok");
    }

    if (req.method === "GET" && url.pathname === "/readyz") {
      try {
        outbox.ready();
        return new Response("ready");
      } catch {
        return new Response("outbox unavailable", { status: 503 });
      }
    }

    if (req.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("not found", { status: 404 });
    }

    let raw: Uint8Array;
    try {
      raw = await readBodyWithinLimit(req.body, 1_048_576);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return new Response("payload too large", { status: 413 });
      throw error;
    }
    const sig = req.headers.get("X-Hub-Signature-256");
    if (!verifySignature(cfg.githubWebhookSecret, raw, sig)) {
      return new Response("invalid signature", { status: 401 });
    }

    let deliveryId: string;
    try {
      deliveryId = requireDeliveryId(req.headers);
    } catch {
      return new Response("missing delivery id", { status: 400 });
    }
    const event = req.headers.get("X-GitHub-Event") ?? "";
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return new Response("bad json", { status: 400 });
    }
    const repo = (payload as { repository?: { full_name?: unknown } }).repository;
    if (!repo || typeof repo.full_name !== "string" || repo.full_name.trim() === "") {
      return new Response("invalid repository", { status: 400 });
    }

    if (outbox.has(deliveryId)) {
      return new Response("duplicate", { status: 200 });
    }

    const ev = normalize(event, { full_name: repo.full_name }, (payload as { action?: unknown }).action, payload);
    if (!ev) return new Response("ignored", { status: 200 });

    const routed = await resolveTarget(ev);
    if (!outbox.enqueue(deliveryId, routed)) return new Response("duplicate", { status: 200 });
    void drainer.drain();

    return new Response("accepted", { status: 200 });
  },
});

console.log(`stackot receiver listening on ${cfg.host}:${cfg.port}`);

process.on("SIGTERM", () => {
  clearInterval(retryTimer);
  outbox.close();
  process.exit(0);
});
process.on("SIGINT", () => {
  clearInterval(retryTimer);
  outbox.close();
  process.exit(0);
});
