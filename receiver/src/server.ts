/**
 * Stackot Receiver — GitHub webhook ingress for the OpenClaw Gateway.
 *
 * Pipeline per POST /webhook:
 *   1. HMAC verify (X-Hub-Signature-256)        → 401 on mismatch
 *   2. Delivery dedupe (X-GitHub-Delivery)      → 200 no-op on duplicate
 *   3. Normalize event                          → 200 no-op on uninteresting
 *   4. Persist the unrouted event               → 200 accepted once committed
 *   5. Route at drain time (router.ts)          — never on the request path
 *      - issue/PR opened → createThread in #issues/#pull-requests
 *      - comment/review  → thread ID from GitHub reverse link
 *      - CI failure      → linked PR thread + #ci-alerts notice, else #ci-alerts
 *      - unresolved      → admin notice (spec: never guess)
 *   6. Forward to Gateway /hooks/agent
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
import { describeError, redactSecrets } from "./redact.ts";

const cfg: ReceiverConfig = await loadConfig();
const secrets = redactSecrets(cfg);
const githubApiBase = process.env.STACKOT_GITHUB_API_BASE ?? "https://api.github.com";
const outbox = new Outbox(process.env.STACKOT_OUTBOX_PATH ?? new URL("../var/outbox.sqlite", import.meta.url).pathname);

/** GitHub reverse-link lookup, injected into the router so routing stays pure. */
async function resolveThreadId(input: { repo: string; kind: "issues" | "pulls"; number: number }): Promise<string | null> {
  try {
    const item = await fetchItem(cfg, input.repo, input.kind, input.number, { apiBase: githubApiBase });
    return findThreadId(item, cfg);
  } catch (error) {
    // router.ts logs the caught error verbatim — hand it a masked message so a
    // credential-bearing fetch URL cannot reach stderr.
    throw new Error(describeError(error, secrets));
  }
}

const drainer = new DeliveryDrainer(outbox, async (job) => {
  try {
    const decision = await route(job.event, { cfg, resolveThreadId });
    const routed: NormalizedEvent = {
      ...job.event,
      target: decision.target,
      targetKind: decision.targetKind,
      createThread: decision.createThread,
      noticeChannelId: decision.noticeChannelId,
    };
    return await forwardToGateway(cfg, routed, job.id);
  } catch (error) {
    // The drainer persists the thrown message as `last_error`, so both stderr
    // and the DB must get the masked text — never the raw fetch error whose
    // `path` property can carry credentials embedded in the request URL.
    const detail = describeError(error, secrets);
    console.error(`delivery ${job.id} forward failed:`, detail);
    throw new Error(detail);
  }
});
/** A drain failure (e.g. outbox I/O error) must not become an unhandled rejection. */
function logDrainError(error: unknown): void {
  console.error("delivery drain failed:", describeError(error, secrets));
}
const retryTimer = setInterval(() => { void drainer.drain().catch(logDrainError); }, 1000);
void drainer.drain().catch(logDrainError);

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

    let seen: boolean;
    try {
      seen = outbox.has(deliveryId);
    } catch (error) {
      console.error(`outbox dedupe check failed for delivery ${deliveryId}:`, describeError(error, secrets));
      return new Response("outbox unavailable", { status: 503 });
    }
    if (seen) return new Response("duplicate", { status: 200 });

    const ev = normalize(event, { full_name: repo.full_name }, (payload as { action?: unknown }).action, payload);
    if (!ev) return new Response("ignored", { status: 200 });

    let enqueued: boolean;
    try {
      enqueued = outbox.enqueue(deliveryId, ev);
    } catch (error) {
      console.error(`outbox enqueue failed for delivery ${deliveryId}:`, describeError(error, secrets));
      return new Response("outbox unavailable", { status: 503 });
    }
    if (!enqueued) return new Response("duplicate", { status: 200 });
    void drainer.drain().catch(logDrainError);

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
