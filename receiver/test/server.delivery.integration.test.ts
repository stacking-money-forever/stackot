import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const secret = "s05b-test-secret";
const receiverDir = join(import.meta.dir, "..");

let port: number;
let dbPath: string;
let proc: ReturnType<typeof Bun.spawn>;

function sign(body: string): string {
  const mac = new Bun.CryptoHasher("sha256", secret);
  mac.update(body);
  return `sha256=${mac.digest("hex")}`;
}

const issuePayload = JSON.stringify({
  action: "opened",
  issue: { number: 42, title: "로그인 오류", html_url: "https://github.com/example/app/issues/42" },
  repository: { full_name: "example/app" },
});

beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), "stackot-s05b-"));
  dbPath = join(tmp, "outbox.sqlite");

  const probe = Bun.serve({ port: 0, fetch: () => new Response("x") });
  if (probe.port === undefined) throw new Error("ephemeral port was not assigned");
  port = probe.port;
  probe.stop(true);

  const cfgPath = join(tmp, "config.json");
  await Bun.write(
    cfgPath,
    JSON.stringify({
      host: "127.0.0.1",
      port,
      githubWebhookSecret: secret,
      openclawHooksUrl: "http://127.0.0.1:9/hooks",
      openclawHookToken: "tok",
      githubToken: "ghp_test",
      repos: { "example/app": { issuesForumChannelId: "1", prsForumChannelId: "2" } },
      ciAlertsChannelId: "3",
      adminChannelId: "4",
      agentId: "stackot",
      discordGuildId: "111",
      githubBacklinkLogin: "stackot-bot",
    }),
  );

  proc = Bun.spawn(["bun", "src/server.ts"], {
    cwd: receiverDir,
    env: { ...process.env, STACKOT_CONFIG: cfgPath, STACKOT_OUTBOX_PATH: dbPath },
    stdout: "ignore",
    stderr: "pipe",
  });

  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (res.ok) return;
    } catch {}
    if (Date.now() > deadline) {
      throw new Error("receiver did not start");
    }
    await Bun.sleep(50);
  }
});

afterAll(async () => {
  proc?.kill();
  await Promise.race([proc.exited, Bun.sleep(2000)]);
});

function postWebhook(headers: Record<string, string>): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/webhook`, {
    method: "POST",
    headers: {
      "X-Hub-Signature-256": sign(issuePayload),
      "X-GitHub-Event": "issues",
      "Content-Type": "application/json",
      ...headers,
    },
    body: issuePayload,
  });
}

describe("POST /webhook X-GitHub-Delivery", () => {
  test("readyz stays ready while Gateway is unreachable", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/readyz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ready");
  });

  test("missing header → 400 before dedupe", async () => {
    const res = await postWebhook({});
    expect(res.status).toBe(400);
  });

  test("whitespace header → 400 before dedupe", async () => {
    const res = await postWebhook({ "X-GitHub-Delivery": "   " });
    expect(res.status).toBe(400);
  });

  test("rejected requests insert no delivery rows", () => {
    const db = new Database(dbPath, { readonly: true });
    const row = db.query("SELECT COUNT(*) AS c FROM outbox").get() as { c: number };
    db.close();
    expect(row.c).toBe(0);
  });
});
