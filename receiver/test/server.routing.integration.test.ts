/**
 * S21b oracle — persist-then-resolve.
 *
 * The webhook request path must ACK and commit the unrouted event without
 * touching GitHub; the reverse-link lookup happens inside the drain, just
 * before the Gateway forward. A held HTTP gate in front of the GitHub stub
 * proves the ordering deterministically: while the gate is held the child's
 * lookup request is in flight but cannot reach the stub, so `ghSeen` stays
 * empty and a stuck lookup can never delay the ACK.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { NormalizedEvent } from "../src/normalize.ts";

const secret = "s21b-test-secret";
const receiverDir = join(import.meta.dir, "..");
const THREAD_ID = "777";
const ADMIN_CHANNEL = "104";

let port: number;
let dbPath: string;
let dir: string;
let proc: Bun.Subprocess | undefined;

const ghSeen: string[] = [];
const gwSeen: { idem: string | null; message: string }[] = [];

let gh: ReturnType<typeof Bun.serve>;
let gw: ReturnType<typeof Bun.serve>;
let gate: ReturnType<typeof Bun.serve>;

let holdPromise: Promise<void> | null = null;
let releaseHold: () => void = () => {};
function holdGate(): void {
  const { promise, resolve } = Promise.withResolvers<void>();
  holdPromise = promise;
  releaseHold = resolve;
}
function releaseGate(): void {
  holdPromise = null;
  releaseHold();
}

function sign(body: string): string {
  const mac = new Bun.CryptoHasher("sha256", secret);
  mac.update(body);
  return `sha256=${mac.digest("hex")}`;
}

function commentPayload(issue: number): string {
  return JSON.stringify({
    action: "created",
    repository: { full_name: "owner/repo" },
    issue: { number: issue, title: "t", html_url: `https://example.test/i/${issue}` },
    comment: { user: { login: "u1" }, body: "댓글", html_url: `https://example.test/c/${issue}` },
  });
}

function postIssueComment(issue: number, deliveryId: string): Promise<Response> {
  const body = commentPayload(issue);
  return fetch(`http://127.0.0.1:${port}/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": sign(body),
      "X-GitHub-Delivery": deliveryId,
      "X-GitHub-Event": "issue_comment",
    },
    body,
  });
}

function readRow(id: string) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.query("SELECT id, event, state, delivered_at, attempts FROM outbox WHERE id = ?").get(id) as
      { id: string; event: string; state: string; delivered_at: number | null; attempts: number } | null;
  } finally {
    db.close();
  }
}

async function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await Bun.sleep(50);
  }
  return cond();
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "stackot-s21b-"));
  dbPath = join(dir, "outbox.sqlite");

  gh = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      ghSeen.push(`${url.pathname}${url.search}`);
      switch (url.pathname) {
        case "/repos/owner/repo/issues/7":
          return Response.json({ body: "issue body", user: { login: "octocat" } });
        case "/repos/owner/repo/issues/7/comments":
          return Response.json([
            { body: `스레드: https://discord.com/channels/111/${THREAD_ID}`, user: { login: "stackot-bot" } },
          ]);
        case "/repos/owner/repo/issues/8":
          return Response.json({ body: null, user: { login: "octocat" } });
        case "/repos/owner/repo/issues/8/comments":
          return Response.json([{ body: "no link here", user: { login: "octocat" } }]);
        default:
          return new Response("not found", { status: 404 });
      }
    },
  });

  gw = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/hooks/agent") {
        const body = (await req.json()) as { message?: string };
        gwSeen.push({ idem: req.headers.get("Idempotency-Key"), message: body.message ?? "" });
        return Response.json({ ok: true });
      }
      return new Response("not found", { status: 404 });
    },
  });

  const ghBase = `http://127.0.0.1:${gh.port}`;
  gate = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const hold = holdPromise;
      if (hold) await hold;
      const url = new URL(req.url);
      return fetch(`${ghBase}${url.pathname}${url.search}`, {
        method: req.method,
        headers: req.headers,
        body: req.body ?? undefined,
      });
    },
  });

  const reservation = Bun.serve({ port: 0, fetch: () => new Response("reserved") });
  if (reservation.port === undefined) throw new Error("ephemeral port was not assigned");
  port = reservation.port;
  reservation.stop(true);

  const cfgPath = join(dir, "config.json");
  await Bun.write(
    cfgPath,
    JSON.stringify({
      host: "127.0.0.1",
      port,
      githubWebhookSecret: secret,
      openclawHooksUrl: `http://127.0.0.1:${gw.port}/hooks`,
      openclawHookToken: "tok",
      githubToken: "ghp_test",
      repos: { "owner/repo": { issuesForumChannelId: "101", prsForumChannelId: "102" } },
      ciAlertsChannelId: "103",
      adminChannelId: ADMIN_CHANNEL,
      agentId: "stackot",
      discordGuildId: "111",
      githubBacklinkLogin: "stackot-bot",
    }),
  );

  proc = Bun.spawn([process.execPath, "src/server.ts"], {
    cwd: receiverDir,
    env: {
      ...process.env,
      STACKOT_CONFIG: cfgPath,
      STACKOT_OUTBOX_PATH: dbPath,
      STACKOT_GITHUB_API_BASE: `http://127.0.0.1:${gate.port}`,
    },
    stdout: "ignore",
    stderr: "pipe",
  });

  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return;
    } catch {}
    if (Date.now() > deadline) throw new Error("receiver did not start");
    await Bun.sleep(50);
  }
});

afterAll(async () => {
  releaseGate();
  proc?.kill();
  if (proc) await Promise.race([proc.exited, Bun.sleep(2000)]);
  gh.stop(true);
  gw.stop(true);
  gate.stop(true);
  await rm(dir, { recursive: true, force: true });
});

describe("S21b persist-then-resolve", () => {
  test("ACK persists the unrouted event before any GitHub call", async () => {
    holdGate();
    const res = await postIssueComment(7, "s21b-followup-1");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("accepted");

    // No sleep: the row must be committed at the moment the ACK was observed.
    const row = readRow("s21b-followup-1");
    expect(row).not.toBeNull();
    const ev = JSON.parse(row!.event) as NormalizedEvent;
    expect(ev.target).toBe("");
    expect(ev.noticeChannelId).toBeUndefined();
    expect(ev.createThread).toBeUndefined();
    // The gate is held, so the in-flight drain lookup cannot have reached GitHub.
    expect(ghSeen.length).toBe(0);
  });

  test("drain resolves the backlink and forwards to the mapped thread", async () => {
    releaseGate();
    const ok = await waitFor(() => gwSeen.some((g) => g.idem === "stackot-s21b-followup-1"));
    expect(ok).toBe(true);
    const hit = gwSeen.find((g) => g.idem === "stackot-s21b-followup-1")!;
    expect(hit.message).toContain(`대상 스레드: ${THREAD_ID}`);
    expect(ghSeen).toContain("/repos/owner/repo/issues/7");
    expect(ghSeen.some((p) => p.startsWith("/repos/owner/repo/issues/7/comments"))).toBe(true);

    // Routing is never persisted: the stored event stays in its unrouted form.
    // The row flips to delivered only after the forward returns, so wait for that
    // state instead of sampling it in the same tick the gateway recorded the hit
    // (a loaded runner lost that race on CI).
    const delivered = await waitFor(() => readRow("s21b-followup-1")?.state === "delivered");
    expect(delivered).toBe(true);
    const row = readRow("s21b-followup-1");
    expect(row?.state).toBe("delivered");
    const ev = JSON.parse(row!.event) as NormalizedEvent;
    expect(ev.target).toBe("");
    expect(ev.noticeChannelId).toBeUndefined();
  });

  test("a follow-up with no backlink is delivered to the admin channel", async () => {
    const res = await postIssueComment(8, "s21b-followup-2");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("accepted");
    const ok = await waitFor(() => gwSeen.some((g) => g.idem === "stackot-s21b-followup-2"));
    expect(ok).toBe(true);
    const hit = gwSeen.find((g) => g.idem === "stackot-s21b-followup-2")!;
    expect(hit.message).toContain(`대상 스레드: ${ADMIN_CHANNEL}`);
  });

  test("a hanging GitHub lookup still ACKs and commits, leaving the row for retry", async () => {
    holdGate();
    const res = await postIssueComment(7, "s21b-followup-3");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("accepted");
    expect(readRow("s21b-followup-3")).not.toBeNull();

    // Give the drainer room to run: the lookup is stuck behind the held gate,
    // so the row must remain pending for retry instead of landing anywhere.
    await Bun.sleep(400);
    const stuck = readRow("s21b-followup-3");
    expect(stuck?.state).toBe("pending");
    expect(stuck?.delivered_at).toBeNull();
    expect(gwSeen.some((g) => g.idem === "stackot-s21b-followup-3")).toBe(false);
    releaseGate();
  });
});
