import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const secret = "restart-secret";
const deliveryId = "restart-delivery";
let healthy = false;
const gatewayKeys: string[] = [];

function waitFor(check: () => boolean | Promise<boolean>, timeout = 8000): Promise<void> {
  return (async () => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await check()) return; await Bun.sleep(50); } throw new Error("timed out"); })();
}

describe("Receiver restart recovery", () => {
  test("502 pending delivery is forwarded after restart with same idempotency key", async () => {
    const gateway = Bun.serve({ port: 0, async fetch(req) { gatewayKeys.push(req.headers.get("Idempotency-Key") ?? ""); await req.text(); return new Response(healthy ? "ok" : "down", { status: healthy ? 200 : 502 }); } });
    const dir = await mkdtemp(join(tmpdir(), "stackot-restart-"));
    const outboxPath = join(dir, "outbox.sqlite");
    const reservation = Bun.serve({ port: 0, fetch: () => new Response("reserved") });
    if (reservation.port === undefined) throw new Error("ephemeral port was not assigned");
    const receiverPort = reservation.port;
    reservation.stop(true);
    const cfgPath = join(dir, "config.json");
    await Bun.write(cfgPath, JSON.stringify({ host: "127.0.0.1", port: receiverPort, githubWebhookSecret: secret, openclawHooksUrl: `http://127.0.0.1:${gateway.port}/hooks`, openclawHookToken: "tok", githubToken: "g", repos: { "owner/repo": { issuesForumChannelId: "1", prsForumChannelId: "2" } }, ciAlertsChannelId: "3", adminChannelId: "4", agentId: "stackot", discordGuildId: "111", githubBacklinkLogin: "stackot-bot" }));
    let proc: ReturnType<typeof Bun.spawn> | undefined;
    const start = async () => { proc = Bun.spawn([process.execPath, "src/server.ts"], { cwd: join(import.meta.dir, ".."), env: { ...process.env, STACKOT_CONFIG: cfgPath, STACKOT_OUTBOX_PATH: outboxPath }, stdout: "pipe", stderr: "pipe" }); await waitFor(async () => { try { return (await fetch(`http://127.0.0.1:${receiverPort}/healthz`)).ok; } catch { return false; } }); };
    const stop = async () => { proc?.kill(); if (proc) await proc.exited; proc = undefined; };
    const state = () => { const db = new Database(outboxPath); try { return db.query("SELECT state, attempts FROM outbox WHERE id = ?").get(deliveryId) as { state: string; attempts: number } | null; } finally { db.close(); } };
    try {
      await start();
      const body = JSON.stringify({ action: "opened", repository: { full_name: "owner/repo" }, issue: { number: 1, title: "x", html_url: "https://example.test/1", state: "open" } });
      const mac = new Bun.CryptoHasher("sha256", secret); mac.update(body);
      const response = await fetch(`http://127.0.0.1:${receiverPort}/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${mac.digest("hex")}`, "X-GitHub-Delivery": deliveryId, "X-GitHub-Event": "issues" }, body });
      expect(response.status).toBe(200);
      await waitFor(() => state()?.attempts === 1);
      expect(state()?.state).toBe("pending");
      await stop();
      healthy = true;
      await start();
      await waitFor(() => state()?.state === "delivered");
      expect(gatewayKeys).toEqual([`stackot-${deliveryId}`, `stackot-${deliveryId}`]);
    } finally { await stop(); gateway.stop(true); await rm(dir, { recursive: true, force: true }); healthy = false; gatewayKeys.length = 0; }
  }, 20_000);
});
