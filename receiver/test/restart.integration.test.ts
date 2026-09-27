import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("signed webhook survives Gateway 502 and Receiver restart without duplicate admission", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-restart-"));
  const dbPath = join(dir, "outbox.sqlite");
  const configPath = join(dir, "config.json");
  const deliveryId = "synthetic-restart-delivery";
  const secret = "synthetic-webhook-secret";
  const calls: string[] = [];
  let gatewayHealthy = false;
  const gateway = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      calls.push(req.headers.get("Idempotency-Key") ?? "");
      await req.text();
      return new Response(gatewayHealthy ? "admitted" : "unavailable", { status: gatewayHealthy ? 200 : 502 });
    },
  });
  // Reserve an ephemeral port, then release it for the child Receiver.
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("reserved") });
  const receiverPort = reservation.port;
  reservation.stop(true);
  await Bun.write(configPath, JSON.stringify({
    host: "127.0.0.1", port: receiverPort, githubWebhookSecret: secret,
    openclawHooksUrl: `http://127.0.0.1:${gateway.port}/hooks`,
    openclawHookToken: "synthetic-hook-token", githubToken: "synthetic-github-token",
    repos: { "example/app": { issuesForumChannelId: "101", prsForumChannelId: "102" } },
    ciAlertsChannelId: "103", adminChannelId: "104", agentId: "stackot",
  }));
  const baseUrl = `http://127.0.0.1:${receiverPort}`;
  const receiverDir = join(import.meta.dir, "..");
  let child: ReturnType<typeof Bun.spawn> | undefined;

  async function startReceiver() {
    child = Bun.spawn([process.execPath, "run", "src/server.ts"], {
      cwd: receiverDir,
      env: { ...process.env, STACKOT_CONFIG: configPath, STACKOT_OUTBOX_PATH: dbPath },
      stdout: "ignore", stderr: "ignore",
    });
    await waitFor(async () => (await fetch(`${baseUrl}/healthz`)).ok);
  }
  async function stopReceiver() {
    if (!child) return;
    child.kill("SIGTERM");
    await child.exited;
    child = undefined;
  }
  function state(): { state: string; attempts: number } | null {
    const db = new Database(dbPath);
    try {
      return db.query("SELECT state, attempts FROM outbox WHERE id = ?").get(deliveryId) as { state: string; attempts: number } | null;
    } finally { db.close(); }
  }
  async function sendWebhook() {
    const body = JSON.stringify({
      action: "opened", repository: { full_name: "example/app" },
      issue: { number: 42, title: "Synthetic test", html_url: "https://example.invalid/42", body: "test", state: "open" },
    });
    const hasher = new Bun.CryptoHasher("sha256", secret);
    hasher.update(body);
    const response = await fetch(`${baseUrl}/webhook`, {
      method: "POST", body,
      headers: {
        "X-Hub-Signature-256": `sha256=${hasher.digest("hex")}`,
        "X-GitHub-Delivery": deliveryId,
        "X-GitHub-Event": "issues",
        "Content-Type": "application/json",
      },
    });
    return { status: response.status, body: await response.text() };
  }

  try {
    await startReceiver();
    expect(await sendWebhook()).toEqual({ status: 200, body: "accepted" });
    await waitFor(() => state()?.attempts === 1);
    expect(state()?.state).toBe("pending");
    expect(calls).toHaveLength(1);

    await stopReceiver();
    gatewayHealthy = true;
    await startReceiver();
    await waitFor(() => state()?.state === "delivered");
    expect(await sendWebhook()).toEqual({ status: 200, body: "duplicate" });
    expect(calls).toEqual([`stackot-${deliveryId}`, `stackot-${deliveryId}`]);
    console.info("receipt: synthetic webhook accepted=200, after-502=pending, after-restart=delivered, redelivery=duplicate, gateway-calls=2, idempotency-key=same");
  } finally {
    await stopReceiver();
    gateway.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);

async function waitFor(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch { /* service or database not ready */ }
    await Bun.sleep(50);
  }
  throw new Error("timed out waiting for Receiver or outbox state");
}
