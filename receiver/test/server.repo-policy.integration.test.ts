/**
 * B01 oracle — per-repo credentials are separated end to end.
 *
 * Each configured repo's reverse-link lookup must be authorized by that
 * repo's own token (or the shared token only when the repo has none), and a
 * lookup for one repo must never carry another repo's token. An unconfigured
 * repo must fall back to the admin channel without any GitHub call.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const secret = "b01-repo-policy-secret";
const receiverDir = join(import.meta.dir, "..");
const ADMIN_CHANNEL = "104";

const TOKEN_A = "repo-a-token";
const TOKEN_B = "repo-b-token";
const TOKEN_SHARED = "shared-token";

let port: number;
let dir: string;
let proc: Bun.Subprocess | undefined;

const ghSeen: { pathname: string; authorization: string | null }[] = [];
const gwSeen: { idem: string | null; message: string }[] = [];

let gh: ReturnType<typeof Bun.serve>;
let gw: ReturnType<typeof Bun.serve>;

function sign(body: string): string {
  const mac = new Bun.CryptoHasher("sha256", secret);
  mac.update(body);
  return `sha256=${mac.digest("hex")}`;
}

function commentPayload(repo: string, issue: number): string {
  return JSON.stringify({
    action: "created",
    repository: { full_name: repo },
    issue: { number: issue, title: "t", html_url: `https://example.test/${repo}/${issue}` },
    comment: { user: { login: "u1" }, body: "댓글", html_url: `https://example.test/${repo}/c/${issue}` },
  });
}

function postIssueComment(repo: string, issue: number, deliveryId: string): Promise<Response> {
  const body = commentPayload(repo, issue);
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

async function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await Bun.sleep(50);
  }
  return cond();
}

/** Authorization headers observed for requests under /repos/<repo>/. */
function authorizationsFor(repo: string): (string | null)[] {
  return ghSeen.filter((s) => s.pathname.startsWith(`/repos/${repo}/`)).map((s) => s.authorization);
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "stackot-b01-"));
  const dbPath = join(dir, "outbox.sqlite");

  gh = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      ghSeen.push({ pathname: url.pathname, authorization: req.headers.get("authorization") });
      const thread = { a: "777", b: "888", c: "999" }[url.pathname.match(/^\/repos\/owner\/([abc])\/issues\/\d+/)?.[1] ?? ""];
      if (url.pathname.endsWith("/comments")) {
        return Response.json(thread ? [{ body: `스레드: https://discord.com/channels/111/${thread}`, user: { login: "stackot-bot" } }] : []);
      }
      if (thread) return Response.json({ body: null, user: { login: "octocat" } });
      return new Response("not found", { status: 404 });
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
      githubToken: TOKEN_SHARED,
      repos: {
        "owner/a": { issuesForumChannelId: "201", prsForumChannelId: "202", githubToken: TOKEN_A },
        "owner/b": { issuesForumChannelId: "301", prsForumChannelId: "302", githubToken: TOKEN_B },
        "owner/c": { issuesForumChannelId: "401", prsForumChannelId: "402" },
      },
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
      STACKOT_GITHUB_API_BASE: `http://127.0.0.1:${gh.port}`,
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
  proc?.kill();
  if (proc) await Promise.race([proc.exited, Bun.sleep(2000)]);
  gh.stop(true);
  gw.stop(true);
  await rm(dir, { recursive: true, force: true });
});

describe("B01 per-repo credentials", () => {
  test("repo A lookups are authorized by repo A's token only", async () => {
    const res = await postIssueComment("owner/a", 7, "b01-a-1");
    expect(res.status).toBe(200);
    const ok = await waitFor(() => gwSeen.some((g) => g.idem === "stackot-b01-a-1"));
    expect(ok).toBe(true);
    expect(gwSeen.find((g) => g.idem === "stackot-b01-a-1")!.message).toContain("대상 스레드: 777");
    const auths = authorizationsFor("owner/a");
    expect(auths.length).toBeGreaterThan(0);
    for (const auth of auths) expect(auth).toBe(`Bearer ${TOKEN_A}`);
  });

  test("repo B lookups are authorized by repo B's token only", async () => {
    const res = await postIssueComment("owner/b", 8, "b01-b-1");
    expect(res.status).toBe(200);
    const ok = await waitFor(() => gwSeen.some((g) => g.idem === "stackot-b01-b-1"));
    expect(ok).toBe(true);
    expect(gwSeen.find((g) => g.idem === "stackot-b01-b-1")!.message).toContain("대상 스레드: 888");
    const auths = authorizationsFor("owner/b");
    expect(auths.length).toBeGreaterThan(0);
    for (const auth of auths) expect(auth).toBe(`Bearer ${TOKEN_B}`);
  });

  test("repo C without its own token uses the shared token", async () => {
    const res = await postIssueComment("owner/c", 9, "b01-c-1");
    expect(res.status).toBe(200);
    const ok = await waitFor(() => gwSeen.some((g) => g.idem === "stackot-b01-c-1"));
    expect(ok).toBe(true);
    expect(gwSeen.find((g) => g.idem === "stackot-b01-c-1")!.message).toContain("대상 스레드: 999");
    const auths = authorizationsFor("owner/c");
    expect(auths.length).toBeGreaterThan(0);
    for (const auth of auths) expect(auth).toBe(`Bearer ${TOKEN_SHARED}`);
  });

  test("an unconfigured repo falls back to admin with no GitHub call", async () => {
    const res = await postIssueComment("owner/unknown", 5, "b01-unknown-1");
    expect(res.status).toBe(200);
    const ok = await waitFor(() => gwSeen.some((g) => g.idem === "stackot-b01-unknown-1"));
    expect(ok).toBe(true);
    expect(gwSeen.find((g) => g.idem === "stackot-b01-unknown-1")!.message).toContain(`대상 스레드: ${ADMIN_CHANNEL}`);
    expect(authorizationsFor("owner/unknown").length).toBe(0);
  });

  test("cross-repo token use is zero across every observed request", () => {
    const expected: Record<string, string> = { "owner/a": TOKEN_A, "owner/b": TOKEN_B, "owner/c": TOKEN_SHARED };
    const foreign = [TOKEN_A, TOKEN_B, TOKEN_SHARED];
    for (const seen of ghSeen) {
      const repo = /^\/repos\/(owner\/[abc])\//.exec(seen.pathname)?.[1];
      expect(repo).toBeDefined();
      expect(seen.authorization).toBe(`Bearer ${expected[repo!]}`);
      for (const token of foreign.filter((t) => t !== expected[repo!])) {
        expect(seen.authorization).not.toBe(`Bearer ${token}`);
      }
    }
  });
});
