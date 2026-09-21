/**
 * Stackot Receiver — GitHub webhook ingress for the OpenClaw Gateway.
 *
 * Pipeline per POST /webhook:
 *   1. HMAC verify (X-Hub-Signature-256)        → 401 on mismatch
 *   2. Delivery dedupe (X-GitHub-Delivery)      → 200 no-op on duplicate
 *   3. Normalize event                          → 200 no-op on uninteresting
 *   4. Route to a Discord target (router.ts)
 *      - issue/PR opened → createThread in #issues/#pull-requests
 *      - comment/review  → thread ID from GitHub reverse link
 *      - CI failure      → linked PR thread + #ci-alerts notice, else #ci-alerts
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
import { route } from "./router.ts";
import { forwardToGateway } from "./gateway.ts";

const cfg: ReceiverConfig = await loadConfig();
const outbox = new Outbox(process.env.STACKOT_OUTBOX_PATH ?? new URL("../var/outbox.sqlite", import.meta.url).pathname);
const drainer = new DeliveryDrainer(outbox, async (job) => forwardToGateway(cfg, job.event, job.id));
const retryTimer = setInterval(() => { void drainer.drain(); }, 1000);
void drainer.drain();

/** GitHub reverse-link lookup, injected into the router so routing stays pure. */
async function resolveThreadId(input: { repo: string; kind: "issues" | "pulls"; number: number }): Promise<string | null> {
  const item = await fetchItem(cfg, input.repo, input.kind, input.number);
  return findThreadId(item, cfg);
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

    const decision = await route(ev, { cfg, resolveThreadId });
    const routed: NormalizedEvent = {
      ...ev,
      target: decision.target,
      targetKind: decision.targetKind,
      createThread: decision.createThread,
      noticeChannelId: decision.noticeChannelId,
    };
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
