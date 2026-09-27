/**
 * Stackot Receiver — GitHub webhook ingress for the OpenClaw Gateway.
 *
 * Pipeline per POST /webhook:
 *   1. HMAC verify (X-Hub-Signature-256)        → 401 on mismatch
 *   2. Durable delivery lookup                  → 200 no-op on duplicate
 *   3. Normalize event                          → 200 no-op on uninteresting
 *   4. Resolve Discord target
 *      - issue/PR opened → createThread in #issues/#pull-requests
 *      - comment/review  → thread ID from GitHub reverse link
 *      - CI failure      → #ci-alerts
 *      - unresolved      → 200 no-op + admin notice (spec: never guess)
 *   5. Persist in SQLite outbox, then acknowledge GitHub
 *   6. Retry Gateway /hooks/agent until admission succeeds
 */
import { loadConfig, type ReceiverConfig } from "./config.ts";
import { verifySignature } from "./verify.ts";
import { Outbox } from "./outbox.ts";
import { normalize, type NormalizedEvent } from "./normalize.ts";
import { findThreadId, fetchItem } from "./mapping.ts";
import { forwardToGateway } from "./gateway.ts";

const cfg: ReceiverConfig = await loadConfig();
const outbox = new Outbox(process.env.STACKOT_OUTBOX_PATH ?? new URL("../var/outbox.sqlite", import.meta.url).pathname);

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
    const threadId = findThreadId(item);
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

let forwarding = false;
async function drain(): Promise<void> {
  if (forwarding) return;
  forwarding = true;
  try {
    let job;
    while ((job = outbox.due())) {
      try {
        const result = await forwardToGateway(cfg, job.event, job.id);
        if (!result.ok) throw new Error(`gateway status ${result.status}`);
        outbox.delivered(job.id);
        console.log(`forwarded delivery ${job.id}`);
      } catch (err) {
        outbox.retry(job.id, job.attempts + 1);
        console.error(`gateway forward failed for delivery ${job.id}:`, err);
      }
    }
  } finally {
    forwarding = false;
  }
}
const retryTimer = setInterval(() => { void drain(); }, 1000);
void drain();

Bun.serve({
  hostname: cfg.host,
  port: cfg.port,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/healthz") {
      return new Response("ok");
    }

    if (req.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("not found", { status: 404 });
    }

    const raw = new Uint8Array(await req.arrayBuffer());
    const sig = req.headers.get("X-Hub-Signature-256");
    if (!verifySignature(cfg.githubWebhookSecret, raw, sig)) {
      return new Response("invalid signature", { status: 401 });
    }

    const deliveryId = req.headers.get("X-GitHub-Delivery") || crypto.randomUUID();
    if (outbox.has(deliveryId)) {
      return new Response("duplicate", { status: 200 });
    }

    const event = req.headers.get("X-GitHub-Event") ?? "";
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return new Response("bad json", { status: 400 });
    }
    const repo = (payload as { repository?: { full_name?: string } }).repository;
    if (!repo?.full_name) return new Response("no repo", { status: 200 });

    const ev = normalize(event, { full_name: repo.full_name }, (payload as { action?: unknown }).action, payload);
    if (!ev) return new Response("ignored", { status: 200 });

    const routed = await resolveTarget(ev);
    // Acknowledge GitHub only after the event is durable. Startup and timer replay failures.
    if (!outbox.enqueue(deliveryId, routed)) return new Response("duplicate", { status: 200 });
    void drain();

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
