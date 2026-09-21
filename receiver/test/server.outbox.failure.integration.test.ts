/**
 * S09B oracle — an outbox write failure must not be ACKed.
 *
 * The receiver must answer an explicit 5xx (never 2xx) when the enqueue commit
 * fails, leave no partial row behind, and keep the process alive.
 *
 * The failure is induced portably by holding the SQLite write lock from a second
 * connection: the server's enqueue waits out its busy timeout and then fails.
 * An earlier recipe that deleted the live -wal/-shm files and removed write
 * permission worked on macOS but not on Linux, where the open file descriptors
 * keep writing to the unlinked inodes and the request succeeds — and every row
 * in this project must hold on the CI platform.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const secret = "s09b-write-failure-secret";
const receiverDir = join(import.meta.dir, "..");

let port: number;
let dbPath: string;
let dir: string;
let proc: Bun.Subprocess | undefined;

const payload = JSON.stringify({
  action: "opened",
  repository: { full_name: "owner/repo" },
  issue: { number: 7, title: "write failure", html_url: "https://example.test/7", state: "open" },
});

function sign(body: string): string {
  const mac = new Bun.CryptoHasher("sha256", secret);
  mac.update(body);
  return `sha256=${mac.digest("hex")}`;
}

function postWebhook(deliveryId: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": sign(payload),
      "X-GitHub-Delivery": deliveryId,
      "X-GitHub-Event": "issues",
    },
    body: payload,
  });
}

function rowCountFor(deliveryId: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (db.query("SELECT COUNT(*) AS c FROM outbox WHERE id = ?").get(deliveryId) as { c: number }).c;
  } finally {
    db.close();
  }
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "stackot-s09b-"));
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

describe("S09B outbox write failure", () => {
  test("healthy path regression: 200 accepted with the row committed at response time", async () => {
    const res = await postWebhook("s09b-healthy");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("accepted");
    expect(rowCountFor("s09b-healthy")).toBe(1);
  });

  test("a contended write returns an explicit 5xx with no ACK and no row, then recovers", async () => {
    const failedId = "s09b-write-fails";

    // Hold the SQLite write lock for the whole attempt: the server's enqueue
    // waits out its busy timeout and then fails, which is the production path
    // this row protects.
    const holder = new Database(dbPath);
    holder.run("PRAGMA busy_timeout = 0");
    holder.run("BEGIN IMMEDIATE");
    try {
      const res = await postWebhook(failedId);
      const body = await res.text();
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(res.status).toBeLessThan(600);
      expect(body).not.toBe("accepted");
      expect(body).not.toBe("duplicate");
      expect(body).not.toContain("SQLiteError");
      expect(rowCountFor(failedId)).toBe(0);

      // The process survives a failed commit.
      expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
    } finally {
      holder.run("ROLLBACK");
      holder.close();
    }

    // Recovery: once the lock is gone the receiver persists again, and the
    // delivery id that failed was never recorded, so GitHub's redelivery of it
    // is accepted rather than answered as a duplicate.
    const recovered = await postWebhook(failedId);
    expect(recovered.status).toBe(200);
    expect(await recovered.text()).toBe("accepted");
    expect(rowCountFor(failedId)).toBe(1);

    const fresh = await postWebhook("s09b-after-recovery");
    expect(fresh.status).toBe(200);
    expect(await fresh.text()).toBe("accepted");
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
  }, 30_000);
});
