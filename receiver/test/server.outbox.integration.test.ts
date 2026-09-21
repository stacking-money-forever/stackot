/**
 * S09A oracle — the outbox row must be committed before the webhook ACK.
 *
 * The receiver answers 200 "accepted" only after enqueue commits, so a client
 * that reads the outbox immediately after the response must already see the
 * delivery row. The gateway is deliberately unreachable so the row stays
 * pending and cannot be explained by a successful delivery.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const secret = "s09a-ack-secret";
const deliveryId = "s09a-ack-before-response";
const receiverDir = join(import.meta.dir, "..");

let port: number;
let dbPath: string;
let dir: string;
let proc: Bun.Subprocess | undefined;

const payload = JSON.stringify({
  action: "opened",
  repository: { full_name: "owner/repo" },
  issue: { number: 7, title: "ack durability", html_url: "https://example.test/7", state: "open" },
});

function sign(body: string): string {
  const mac = new Bun.CryptoHasher("sha256", secret);
  mac.update(body);
  return `sha256=${mac.digest("hex")}`;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "stackot-s09a-"));
  dbPath = join(dir, "outbox.sqlite");
  const cfgPath = join(dir, "config.json");
  const reservation = Bun.serve({ port: 0, fetch: () => new Response("reserved") });
  if (reservation.port === undefined) throw new Error("ephemeral port was not assigned");
  port = reservation.port;
  reservation.stop(true);
  await Bun.write(cfgPath, JSON.stringify({
    host: "127.0.0.1", port, githubWebhookSecret: secret,
    openclawHooksUrl: "http://127.0.0.1:1/hooks", openclawHookToken: "t", githubToken: "g",
    repos: { "owner/repo": { issuesForumChannelId: "101", prsForumChannelId: "102" } },
    ciAlertsChannelId: "103", adminChannelId: "104", agentId: "stackot",
    discordGuildId: "111", githubBacklinkLogin: "stackot-bot",
  }));
  proc = Bun.spawn([process.execPath, "src/server.ts"], {
    cwd: receiverDir,
    env: { ...process.env, STACKOT_CONFIG: cfgPath, STACKOT_OUTBOX_PATH: dbPath },
    stdout: "pipe", stderr: "pipe",
  });
  const deadline = Date.now() + 10_000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return; } catch {}
    if (Date.now() > deadline) throw new Error("receiver did not start");
    await Bun.sleep(50);
  }
});

afterAll(async () => {
  proc?.kill();
  if (proc) await proc.exited;
  await rm(dir, { recursive: true, force: true });
});

describe("S09A outbox before ACK", () => {
  test("a 200 accepted response means the delivery row is already committed", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sign(payload),
        "X-GitHub-Delivery": deliveryId,
        "X-GitHub-Event": "issues",
      },
      body: payload,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("accepted");

    // No sleep: the row must exist at the moment the ACK was observed.
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.query("SELECT id, state, delivered_at FROM outbox WHERE id = ?").get(deliveryId) as
        { id: string; state: string; delivered_at: number | null } | null;
      expect(row).not.toBeNull();
      expect(row?.state).toBe("pending");
      expect(row?.delivered_at).toBeNull();
      expect((db.query("SELECT COUNT(*) AS c FROM outbox").get() as { c: number }).c).toBe(1);
    } finally {
      db.close();
    }
  });

  test("the same delivery id is answered as a duplicate without a second row", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sign(payload),
        "X-GitHub-Delivery": deliveryId,
        "X-GitHub-Event": "issues",
      },
      body: payload,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("duplicate");
    const db = new Database(dbPath, { readonly: true });
    try {
      expect((db.query("SELECT COUNT(*) AS c FROM outbox").get() as { c: number }).c).toBe(1);
    } finally {
      db.close();
    }
  });
});
