import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const secret = "s06-malformed-secret";
const deliveryId = "s06-delivery-malformed-then-valid";
let port: number;
let base: string;

function sign(body: string): string {
  const mac = new Bun.CryptoHasher("sha256", secret);
  mac.update(body);
  return `sha256=${mac.digest("hex")}`;
}

function webhookHeaders(body: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Hub-Signature-256": sign(body),
    "X-GitHub-Delivery": deliveryId,
    "X-GitHub-Event": "issues",
  };
}

async function waitReady(proc: { exited: Promise<number> }): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await Promise.race([proc.exited.then(() => true), Bun.sleep(50).then(() => false)])) {
      throw new Error("receiver exited before ready");
    }
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) return;
    } catch {}
  }
  throw new Error("receiver did not become ready");
}

describe("POST /webhook malformed JSON", () => {
  test("400 without reserving the delivery id; same id then accepted once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stackot-s06-"));
    const cfgPath = join(dir, "config.json");
    const outboxPath = join(dir, "outbox.sqlite");
    await Bun.write(cfgPath, JSON.stringify({
      host: "127.0.0.1", port: 0, githubWebhookSecret: secret,
      openclawHooksUrl: "http://127.0.0.1:1/hooks", openclawHookToken: "t", githubToken: "g",
      repos: { "owner/repo": { issuesForumChannelId: "101", prsForumChannelId: "102" } },
      ciAlertsChannelId: "103", adminChannelId: "104", agentId: "stackot",
      discordGuildId: "111", githubBacklinkLogin: "stackot-bot",
    }));
    const reservation = Bun.serve({ port: 0, fetch: () => new Response("reserved") });
    if (reservation.port === undefined) throw new Error("ephemeral port was not assigned");
    port = reservation.port;
    base = `http://127.0.0.1:${port}`;
    reservation.stop(true);
    const config = JSON.parse(await Bun.file(cfgPath).text()) as Record<string, unknown>;
    config.port = port;
    await Bun.write(cfgPath, JSON.stringify(config));
    const proc = Bun.spawn([process.execPath, "src/server.ts"], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, STACKOT_CONFIG: cfgPath, STACKOT_OUTBOX_PATH: outboxPath },
      stdout: "pipe", stderr: "pipe",
    });
    try {
      await waitReady(proc);
      const malformed = "{ not json";
      const bad = await fetch(`${base}/webhook`, { method: "POST", headers: webhookHeaders(malformed), body: malformed });
      expect(bad.status).toBe(400);
      await bad.text();
      const valid = JSON.stringify({ action: "opened", repository: { full_name: "owner/repo" }, issue: { number: 7, title: "dedupe poison check", html_url: "https://github.com/owner/repo/issues/7", state: "open", body: "hello" } });
      const good = await fetch(`${base}/webhook`, { method: "POST", headers: webhookHeaders(valid), body: valid });
      expect(good.status).toBe(200);
      expect(await good.text()).toBe("accepted");
      const db = new Database(outboxPath, { readonly: true });
      try {
        const rows = db.query("SELECT id, state FROM outbox").all() as { id: string; state: string }[];
        expect(rows).toHaveLength(1);
        expect(rows[0]!.id).toBe(deliveryId);
        expect(rows[0]!.state).toBe("pending");
      } finally { db.close(); }
    } finally {
      proc.kill();
      await proc.exited;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
