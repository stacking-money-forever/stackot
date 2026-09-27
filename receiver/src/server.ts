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
import { Outbox, MAX_DELIVERY_ATTEMPTS, retryDelayMs } from "./outbox.ts";
import { DeliveryDrainer, type DeliveryOutbox, type PendingDelivery } from "./delivery.ts";
import { normalize, type NormalizedEvent } from "./normalize.ts";
import { findThreadId, fetchItem } from "./mapping.ts";
import { route } from "./router.ts";
import { forwardToGateway } from "./gateway.ts";
import { describeError, redactSecrets } from "./redact.ts";
import { createGatewayHealth, liveness, readiness, statusReport } from "./health.ts";
import { createTelemetry } from "./telemetry.ts";
import { collectMetrics, METRICS_INTERVAL_MS, toLogLine, type QueueMetrics } from "./metrics.ts";

const cfg: ReceiverConfig = await loadConfig();
const secrets = redactSecrets(cfg);
const githubApiBase = process.env.STACKOT_GITHUB_API_BASE ?? "https://api.github.com";
const outbox = new Outbox(process.env.STACKOT_OUTBOX_PATH ?? new URL("../var/outbox.sqlite", import.meta.url).pathname, secrets);
/** Process-local Gateway reachability for /status — never persisted. */
const gatewayHealth = createGatewayHealth(secrets);

/**
 * /readyz probes the outbox for real (BEGIN IMMEDIATE + ROLLBACK); /status
 * and /healthz read the tracked health instead so they never take the write
 * lock — a contended probe waits out busy_timeout and would stall them.
 */
function isOutboxReady(): boolean {
  try {
    return outbox.ready();
  } catch {
    return false;
  }
}

/**
 * Bound on self-repair attempts: an unhealthy outbox gets at most one
 * recover() per interval so a down database cannot turn /readyz traffic
 * into a reconnect storm. recover() itself never throws.
 */
const RECOVERY_INTERVAL_MS = 1000;
let lastRecoveryAt = 0;
function attemptRecovery(): void {
  const now = Date.now();
  if (now - lastRecoveryAt < RECOVERY_INTERVAL_MS) return;
  lastRecoveryAt = now;
  try {
    if (!outbox.recover()) {
      console.error("outbox recovery failed:", outbox.health().lastError);
    }
  } catch (error) {
    console.error("outbox recovery threw:", describeError(error, secrets));
  }
}

/**
 * S43 backlog snapshot for /status and the periodic line. A failed probe
 * must not kill the process or the /status handler — the error is logged
 * through describeError (redacted) and the caller gets null.
 */
function queueMetrics(): QueueMetrics | null {
  try {
    return collectMetrics(outbox.stats());
  } catch (error) {
    console.error("queue metrics collection failed:", describeError(error, secrets));
    return null;
  }
}

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

const telemetry = createTelemetry((line) => console.log(line), secrets);

/** Route reasons that landed on the admin or #ci-alerts channel instead of the normal target. */
const ROUTING_FALLBACK_REASONS = new Set(["unconfigured-repo", "ci-alerts", "followup-unresolved", "unrouted"]);

/**
 * DeliveryOutbox decorator that mirrors each state transition as a structured
 * telemetry line. delivery.ts/outbox.ts stay untouched: the drainer sees this
 * wrapper, which delegates to the real outbox and emits after each successful
 * write so a line always reflects persisted state.
 */
class TelemetryOutbox implements DeliveryOutbox {
  /** `attempts` value the most recent due() returned per delivery, for correlation. */
  private readonly seenAttempts = new Map<string, number>();
  /** Routed target recorded by the forwarder, so `delivered` can name the destination. */
  private readonly targets = new Map<string, string>();

  constructor(private readonly inner: DeliveryOutbox) {}

  /** Called by the forwarder once route() resolves the destination for this delivery. */
  noteTarget(id: string, target: string): void {
    this.targets.set(id, target);
  }

  due(): PendingDelivery | null {
    const job = this.inner.due();
    if (job) this.seenAttempts.set(job.id, job.attempts);
    return job;
  }

  delivered(id: string): void {
    this.inner.delivered(id);
    telemetry.delivered({
      deliveryId: id,
      attempts: this.seenAttempts.get(id) ?? 0,
      target: this.targets.get(id) ?? "",
    });
    this.seenAttempts.delete(id);
    this.targets.delete(id);
  }

  fail(id: string, attempts: number, error: string): void {
    this.inner.fail(id, attempts, error);
    if (attempts >= MAX_DELIVERY_ATTEMPTS) {
      telemetry.deadLettered({ deliveryId: id, attempts, error });
      this.seenAttempts.delete(id);
      this.targets.delete(id);
      return;
    }
    telemetry.failed({ deliveryId: id, attempts, error, nextAttemptAt: Date.now() + retryDelayMs(attempts) });
  }
}

const telemetryOutbox = new TelemetryOutbox(outbox);

const drainer = new DeliveryDrainer(telemetryOutbox, async (job) => {
  try {
    const decision = await route(job.event, { cfg, resolveThreadId });
    telemetryOutbox.noteTarget(job.id, decision.target || decision.createThread?.forumChannelId || "");
    if (ROUTING_FALLBACK_REASONS.has(decision.reason)) {
      telemetry.routingFallback({ deliveryId: job.id, repo: job.event.repo, item: job.event.item, reason: decision.reason });
    }
    const routed: NormalizedEvent = {
      ...job.event,
      target: decision.target,
      targetKind: decision.targetKind,
      createThread: decision.createThread,
      noticeChannelId: decision.noticeChannelId,
    };
    const result = await forwardToGateway(cfg, routed, job.id);
    if (result.ok) {
      gatewayHealth.recordSuccess();
    } else {
      gatewayHealth.recordFailure(`gateway rejected delivery (status ${result.status})`);
    }
    return result;
  } catch (error) {
    // The drainer persists the thrown message as `last_error`, so both stderr
    // and the DB must get the masked text — never the raw fetch error whose
    // `path` property can carry credentials embedded in the request URL. The
    // same masked text is what /status reports as the Gateway failure.
    const detail = describeError(error, secrets);
    gatewayHealth.recordFailure(detail);
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

/** One queue.metrics line per interval, plus one at startup so a backlog left by a previous run is visible immediately. */
function emitQueueMetrics(): void {
  const metrics = queueMetrics();
  if (metrics) console.log(toLogLine(metrics));
}
const metricsTimer = setInterval(emitQueueMetrics, METRICS_INTERVAL_MS);
emitQueueMetrics();

Bun.serve({
  hostname: cfg.host,
  port: cfg.port,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/healthz") {
      const res = liveness(outbox.health().ok, gatewayHealth);
      return new Response(res.body, { status: res.status });
    }

    if (req.method === "GET" && url.pathname === "/readyz") {
      let ready = isOutboxReady();
      if (!ready) {
        // Self-repair: bounded by RECOVERY_INTERVAL_MS, then re-probed so a
        // healed outbox answers 200 within the same request.
        attemptRecovery();
        ready = isOutboxReady();
      }
      const res = readiness(ready, gatewayHealth);
      return new Response(res.body, { status: res.status });
    }

    if (req.method === "GET" && url.pathname === "/status") {
      const health = outbox.health();
      return Response.json(statusReport(health.ok, gatewayHealth, queueMetrics(), health));
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
  clearInterval(metricsTimer);
  outbox.close();
  process.exit(0);
});
process.on("SIGINT", () => {
  clearInterval(retryTimer);
  clearInterval(metricsTimer);
  outbox.close();
  process.exit(0);
});
