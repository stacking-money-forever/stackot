/**
 * S09B oracle — an outbox write failure must not be ACKed.
 *
 * The receiver must answer an explicit 5xx (never 2xx) when the enqueue commit
 * fails, leave no partial row behind, and keep the process alive. The failure
 * is induced with the owner-verified recipe: chmod alone does not work (an
 * already-open fd keeps write access), so the live -wal/-shm files are deleted
 * first and only then are the directory and database file made unwritable.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmod, mkdtemp, rm } from "node:fs/promises";
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
  // Restore writability before removing the temp dir; rm fails inside a 0555 dir.
  await chmod(dbPath, 0o644).catch(() => {});
  await chmod(dir, 0o755).catch(() => {});
  await rm(dir, { recursive: true, force: true });
});

describe("S09B outbox write failure", () => {
  test("healthy path regression: 200 accepted with the row committed at response time", async () => {
    const res = await postWebhook("s09b-healthy");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("accepted");

    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.query("SELECT id, state FROM outbox WHERE id = ?").get("s09b-healthy") as
        { id: string; state: string } | null;
      expect(row).not.toBeNull();
      expect(row?.state).toBe("pending");
    } finally {
      db.close();
    }
  });

  test("write failure returns an explicit 5xx, no ACK, no row, and the process survives", async () => {
    const failedId = "s09b-write-fails";

    // Checkpoint WAL into the main database file first: committed rows live in
    // -wal until a checkpoint, so deleting it without one would drop the table
    // itself and make the no-partial-row assertion meaningless.
    const setup = new Database(dbPath);
    try {
      setup.run("PRAGMA busy_timeout = 5000");
      setup.run("PRAGMA wal_checkpoint(TRUNCATE)");
      expect(setup.query("SELECT 1 FROM outbox WHERE id = ?").get("s09b-healthy")).not.toBeNull();
    } finally {
      setup.close();
    }

    // Owner-verified recipe: delete the live WAL/SHM first (an open fd keeps
    // write access, so chmod alone never fails), then remove write permission.
    await rm(`${dbPath}-wal`, { force: true });
    await rm(`${dbPath}-shm`, { force: true });
    await chmod(dir, 0o555);
    await chmod(dbPath, 0o444);
    try {
      const res = await postWebhook(failedId);
      const body = await res.text();
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(res.status).toBeLessThan(600);
      expect(body).not.toBe("accepted");
      expect(body).not.toBe("duplicate");
      expect(body).not.toContain("SQLiteError");

      // The process survives the failed commit.
      const health = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(health.status).toBe(200);

      // While the outbox is still broken, resending the failed delivery id
      // must not be answered with a 2xx ACK.
      const resent = await postWebhook(failedId);
      expect(resent.status).toBeGreaterThanOrEqual(500);
      expect(resent.status).toBeLessThan(600);
    } finally {
      await chmod(dir, 0o755);
      await chmod(dbPath, 0o644);
    }

    // A failed commit leaves no partial row. The check runs after permissions
    // are restored and uses a read-write open: with the wal-index deleted, a
    // read-only connection cannot rebuild it while the server holds the lock.
    const db = new Database(dbPath);
    try {
      expect(db.query("SELECT 1 FROM outbox WHERE id = ?").get(failedId)).toBeNull();
      expect((db.query("SELECT COUNT(*) AS c FROM outbox").get() as { c: number }).c).toBe(1);
    } finally {
      db.close();
    }

    // Recovery probe: with permissions restored, a new delivery id is sent and
    // the observed result is recorded in the S09B receipt. The contract-safe
    // invariant is "no false ACK": a 200 must be a real "accepted", anything
    // else must remain an explicit 5xx.
    const recovered = await postWebhook("s09b-after-restore");
    const recoveredBody = await recovered.text();
    console.log(`post-restore webhook result: ${recovered.status} ${recoveredBody}`);
    if (recovered.status === 200) {
      expect(recoveredBody).toBe("accepted");
    } else {
      expect(recovered.status).toBeGreaterThanOrEqual(500);
      expect(recovered.status).toBeLessThan(600);
    }

    // The process is still alive after the whole failure/restore cycle.
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
  }, 15_000);
});
