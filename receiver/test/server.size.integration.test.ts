import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const secret = "s08-size-secret";
let base: string;

async function waitReady(proc: { exited: Promise<number> }): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await Promise.race([proc.exited.then(() => true), Bun.sleep(50).then(() => false)])) throw new Error("receiver exited before ready");
    try { if ((await fetch(`${base}/healthz`)).ok) return; } catch {}
  }
  throw new Error("receiver did not become ready");
}

describe("POST /webhook body limit", () => {
  test("signed oversized body is 413 before dedupe", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stackot-s08-"));
    const dbPath = join(dir, "outbox.sqlite");
    const cfgPath = join(dir, "config.json");
    const reservation = Bun.serve({ port: 0, fetch: () => new Response("reserved") });
    if (reservation.port === undefined) throw new Error("ephemeral port was not assigned");
    const port = reservation.port;
    base = `http://127.0.0.1:${port}`;
    reservation.stop(true);
    await Bun.write(cfgPath, JSON.stringify({ host: "127.0.0.1", port, githubWebhookSecret: secret, openclawHooksUrl: "http://127.0.0.1:1/hooks", openclawHookToken: "t", githubToken: "g", repos: { "owner/repo": { issuesForumChannelId: "101", prsForumChannelId: "102" } }, ciAlertsChannelId: "103", adminChannelId: "104", agentId: "stackot" }));
    const proc = Bun.spawn([process.execPath, "src/server.ts"], { cwd: join(import.meta.dir, ".."), env: { ...process.env, STACKOT_CONFIG: cfgPath, STACKOT_OUTBOX_PATH: dbPath }, stdout: "pipe", stderr: "pipe" });
    try {
      await waitReady(proc);
      const body = "x".repeat(1_048_577);
      const mac = new Bun.CryptoHasher("sha256", secret); mac.update(body);
      const response = await fetch(`${base}/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${mac.digest("hex")}`, "X-GitHub-Delivery": "s08-oversized", "X-GitHub-Event": "issues" }, body });
      expect(response.status).toBe(413);
      const db = new Database(dbPath, { readonly: true });
      try { expect((db.query("SELECT COUNT(*) AS c FROM outbox").get() as { c: number }).c).toBe(0); } finally { db.close(); }
    } finally { proc.kill(); await proc.exited; await rm(dir, { recursive: true, force: true }); }
  });
});
