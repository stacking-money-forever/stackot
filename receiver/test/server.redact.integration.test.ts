/**
 * S39 oracle — config secrets must never reach stderr or outbox `last_error`
 * in raw form.
 *
 * Two leak paths are exercised against a real child process:
 *
 *   1. `openclawHooksUrl` carries the hook token in its query (an operator
 *      shape the contract calls out). Bun's fetch failure puts the request
 *      URL on the error's `path` property, so an unmasked log/persist of that
 *      error leaks the token. The test forces the delivery to `dead_letter`
 *      and asserts both stderr and `last_error` are masked.
 *
 *   2. `githubToken` is embedded in the GitHub API base URL via
 *      STACKOT_GITHUB_API_BASE so a mapping-lookup failure produces an error
 *      whose `path` contains the token. The token travels in a header in
 *      production, so this is the only way to make it appear in error text —
 *      it proves the masking covers the githubToken value, not just the hook
 *      token.
 *
 * No real network: every endpoint is 127.0.0.1:1 (connection refused).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const webhookSecret = "s39-webhook-secret";
const hookToken = "s39-hook-token-9f8e7d6c";
const githubToken = "s39-gh-token-1a2b3c4d";
const hooksUrl = `http://127.0.0.1:1/hooks?token=${hookToken}`;
const receiverDir = join(import.meta.dir, "..");

let port: number;
let dir: string;
let dbPath: string;
let proc: Bun.Subprocess | undefined;
let stderrText = "";

const openedPayload = JSON.stringify({
  action: "opened",
  repository: { full_name: "owner/repo" },
  issue: { number: 7, title: "leak check", html_url: "https://example.test/7", state: "open" },
});

const commentPayload = JSON.stringify({
  action: "created",
  repository: { full_name: "owner/repo" },
  issue: { number: 7, title: "leak check", html_url: "https://example.test/7" },
  comment: { user: { login: "someone" }, body: "ping", html_url: "https://example.test/7#c1" },
});

function sign(body: string): string {
  const mac = new Bun.CryptoHasher("sha256", webhookSecret);
  mac.update(body);
  return `sha256=${mac.digest("hex")}`;
}

function postWebhook(deliveryId: string, event: string, body: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": sign(body),
      "X-GitHub-Delivery": deliveryId,
      "X-GitHub-Event": event,
    },
    body,
  });
}

type OutboxRow = { state: string; last_error: string | null };

function rowFor(db: Database, deliveryId: string): OutboxRow | null {
  return db.query("SELECT state, last_error FROM outbox WHERE id = ?").get(deliveryId) as OutboxRow | null;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "stackot-s39-"));
  dbPath = join(dir, "outbox.sqlite");
  const cfgPath = join(dir, "config.json");
  const reservation = Bun.serve({ port: 0, fetch: () => new Response("reserved") });
  if (reservation.port === undefined) throw new Error("ephemeral port was not assigned");
  port = reservation.port;
  reservation.stop(true);
  await Bun.write(cfgPath, JSON.stringify({
    host: "127.0.0.1", port, githubWebhookSecret: webhookSecret,
    openclawHooksUrl: hooksUrl, openclawHookToken: hookToken, githubToken,
    repos: { "owner/repo": { issuesForumChannelId: "101", prsForumChannelId: "102" } },
    ciAlertsChannelId: "103", adminChannelId: "104", agentId: "stackot",
    discordGuildId: "111", githubBacklinkLogin: "stackot-bot",
  }));
  proc = Bun.spawn([process.execPath, "src/server.ts"], {
    cwd: receiverDir,
    env: {
      ...process.env,
      STACKOT_CONFIG: cfgPath,
      STACKOT_OUTBOX_PATH: dbPath,
      // Embeds githubToken in the lookup URL so a failed mapping fetch carries
      // the token on the error's `path` property — see the file header.
      STACKOT_GITHUB_API_BASE: `http://127.0.0.1:1/${githubToken}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const decoder = new TextDecoder();
  void (async () => {
    for await (const chunk of proc!.stderr as ReadableStream<Uint8Array>) {
      stderrText += decoder.decode(chunk, { stream: true });
    }
  })();
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

describe("S39 secret masking", () => {
  test("hook token in the hooks URL never reaches stderr or last_error", async () => {
    const deliveryId = "s39-hook-leak";
    const res = await postWebhook(deliveryId, "issues", openedPayload);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("accepted");

    // `last_error` is only persisted at dead_letter (attempts >= 5). Force the
    // row to the brink on every poll — the server's 1s drain tick then records
    // the final masked failure within a couple of seconds instead of ~30s of
    // real backoff.
    const db = new Database(dbPath);
    db.run("PRAGMA busy_timeout = 5000");
    try {
      const deadline = Date.now() + 20_000;
      for (;;) {
        db.run("UPDATE outbox SET attempts = 4, next_attempt_at = 0 WHERE id = ? AND state = 'pending'", [deliveryId]);
        const row = rowFor(db, deliveryId);
        if (row?.state === "dead_letter") break;
        if (Date.now() > deadline) throw new Error(`delivery never reached dead_letter (row: ${JSON.stringify(row)})`);
        await Bun.sleep(250);
      }
      const row = rowFor(db, deliveryId);
      expect(row?.last_error).toBeTruthy();
      expect(row!.last_error!).not.toContain(hookToken);
      expect(row!.last_error!).not.toContain(hooksUrl);
      expect(row!.last_error!).toContain("[redacted]");
    } finally {
      db.close();
    }

    // stderr: the masked forward-failure line is emitted on every attempt, so
    // by dead_letter time it must already be there.
    expect(stderrText).toContain("[redacted]");
    expect(stderrText).not.toContain(hookToken);
    expect(stderrText).not.toContain(hooksUrl);
    expect(stderrText).not.toContain(webhookSecret);
  }, 30_000);

  test("github token embedded in the mapping lookup URL never reaches stderr", async () => {
    const res = await postWebhook("s39-gh-token", "issue_comment", commentPayload);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("accepted");

    // The comment event needs a reverse-link lookup; the fetch fails fast and
    // router.ts warns with the sanitized error. Wait for the masked path —
    // `…:1/<token>/repos/…` must surface as `…:1/[redacted]/repos/…`.
    const deadline = Date.now() + 10_000;
    while (!stderrText.includes("[redacted]/repos/owner/repo")) {
      if (Date.now() > deadline) throw new Error(`masked lookup error never logged; stderr:\n${stderrText}`);
      await Bun.sleep(100);
    }
    expect(stderrText).not.toContain(githubToken);
  }, 15_000);
});
