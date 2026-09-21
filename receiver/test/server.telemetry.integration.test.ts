/**
 * S42 oracle — a delivery's whole lifecycle must be traceable in stdout.
 *
 * The receiver is spawned as a real process against in-process stubs. The
 * correlation test drives one delivery through failed attempts 1..N and then a
 * success and asserts the ordered JSON lines carrying that deliveryId; a
 * second delivery is pushed past the retry cap for the dead_letter line; an
 * unresolved follow-up must emit routing.fallback. No line may contain a raw
 * secret or event body text.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const webhookSecret = "s42-webhook-secret-xq9";
const hookToken = "s42-hook-token-zz7";
const ghToken = "s42-gh-token-zz7";
const bodyMarker = "S42_BODY_MARKER_pq7";
const receiverDir = join(import.meta.dir, "..");

let port: number;
let dbPath: string;
let dir: string;
let hooksUrl: string;
let proc: Bun.Subprocess | undefined;
let testDb: Database;

const stdoutLines: string[] = [];
const stderrLines: string[] = [];

let gh: ReturnType<typeof Bun.serve>;
let gw: ReturnType<typeof Bun.serve>;
const gwAttempts = new Map<string, number>();

function sign(body: string): string {
  const mac = new Bun.CryptoHasher("sha256", webhookSecret);
  mac.update(body);
  return `sha256=${mac.digest("hex")}`;
}

const issuePayload = JSON.stringify({
  action: "opened",
  repository: { full_name: "owner/repo" },
  issue: { number: 7, title: "s42", html_url: "https://example.test/i/7", state: "open", body: `issue body ${bodyMarker}` },
});

const commentPayload = JSON.stringify({
  action: "created",
  repository: { full_name: "owner/repo" },
  issue: { number: 9, title: "s42", html_url: "https://example.test/i/9" },
  comment: { user: { login: "u1" }, body: `comment body ${bodyMarker}`, html_url: "https://example.test/c/9" },
});

function postWebhook(body: string, event: string, deliveryId: string): Promise<Response> {
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

function pump(stream: ReadableStream<Uint8Array>, into: string[]): void {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  void (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i = buf.indexOf("\n");
      while (i >= 0) {
        into.push(buf.slice(0, i));
        buf = buf.slice(i + 1);
        i = buf.indexOf("\n");
      }
    }
  })();
}

type TelemetryLine = { event: string; deliveryId?: string; attempts?: number } & Record<string, unknown>;

/** Parsed telemetry lines for one delivery, in emission order. */
function telemetryEvents(deliveryId: string): TelemetryLine[] {
  const out: TelemetryLine[] = [];
  for (const line of stdoutLines) {
    let obj: TelemetryLine;
    try {
      obj = JSON.parse(line) as TelemetryLine;
    } catch {
      continue;
    }
    if (typeof obj.event === "string" && obj.deliveryId === deliveryId) out.push(obj);
  }
  return out;
}

/** Pull a pending row's next_attempt_at to now so the next 1s drain tick retries immediately. */
function forceDue(deliveryId: string): void {
  try {
    testDb.run("UPDATE outbox SET next_attempt_at = 0 WHERE id = ? AND state = 'pending'", [deliveryId]);
  } catch {}
}

async function waitFor(cond: () => boolean, deliveryId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    forceDue(deliveryId);
    if (cond()) return true;
    await Bun.sleep(100);
  }
  return cond();
}

/** Wait for `count` events of one kind — never touches the DB, so the persisted schedule stays observable. */
async function waitForEventCount(deliveryId: string, event: string, count: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (telemetryEvents(deliveryId).filter((e) => e.event === event).length >= count) return true;
    await Bun.sleep(50);
  }
  return false;
}

/** The retry schedule the outbox actually persisted for this row. */
function dbNextAttemptAt(deliveryId: string): number | null {
  const row = testDb.query("SELECT next_attempt_at FROM outbox WHERE id = ?").get(deliveryId) as { next_attempt_at: number } | null;
  return row?.next_attempt_at ?? null;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "stackot-s42-"));
  dbPath = join(dir, "outbox.sqlite");

  gh = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      switch (url.pathname) {
        case "/repos/owner/repo/issues/9":
          return Response.json({ body: null, user: { login: "octocat" } });
        case "/repos/owner/repo/issues/9/comments":
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
        const idem = req.headers.get("Idempotency-Key") ?? "";
        const n = (gwAttempts.get(idem) ?? 0) + 1;
        gwAttempts.set(idem, n);
        if (idem === "stackot-s42-corr-1" && n <= 2) return new Response("flaky", { status: 500 });
        if (idem === "stackot-s42-dead-1") return new Response("down", { status: 500 });
        return Response.json({ ok: true });
      }
      return new Response("not found", { status: 404 });
    },
  });
  hooksUrl = `http://127.0.0.1:${gw.port}/hooks`;

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
      githubWebhookSecret: webhookSecret,
      openclawHooksUrl: hooksUrl,
      openclawHookToken: hookToken,
      githubToken: ghToken,
      repos: { "owner/repo": { issuesForumChannelId: "101", prsForumChannelId: "102" } },
      ciAlertsChannelId: "103",
      adminChannelId: "104",
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
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.stdout instanceof ReadableStream) pump(proc.stdout, stdoutLines);
  if (proc.stderr instanceof ReadableStream) pump(proc.stderr, stderrLines);

  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error("receiver did not start");
    await Bun.sleep(50);
  }

  testDb = new Database(dbPath);
  testDb.run("PRAGMA busy_timeout = 5000");
});

afterAll(async () => {
  proc?.kill();
  if (proc) await Promise.race([proc.exited, Bun.sleep(2000)]);
  gh.stop(true);
  gw.stop(true);
  try {
    testDb.close();
  } catch {}
  await rm(dir, { recursive: true, force: true });
});

describe("S42 structured delivery telemetry", () => {
  test("failed attempts 1..N then delivered correlate under one deliveryId", async () => {
    const res = await postWebhook(issuePayload, "issues", "s42-corr-1");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("accepted");

    // The first failure lands on the immediate post-enqueue drain. Wait without
    // forcing the row due so next_attempt_at is still the real backoff schedule
    // the outbox persisted — telemetry must report that same schedule (≤1s).
    const failed = () => telemetryEvents("s42-corr-1").filter((e) => e.event === "delivery.failed");
    expect(await waitForEventCount("s42-corr-1", "delivery.failed", 1, 10_000)).toBe(true);
    const storedAfterFirst = dbNextAttemptAt("s42-corr-1");
    expect(storedAfterFirst).not.toBeNull();
    expect(Math.abs((failed()[0]!.nextAttemptAt as number) - storedAfterFirst!)).toBeLessThanOrEqual(1000);

    forceDue("s42-corr-1");
    expect(await waitForEventCount("s42-corr-1", "delivery.failed", 2, 10_000)).toBe(true);
    const storedAfterSecond = dbNextAttemptAt("s42-corr-1");
    expect(storedAfterSecond).not.toBeNull();
    expect(Math.abs((failed()[1]!.nextAttemptAt as number) - storedAfterSecond!)).toBeLessThanOrEqual(1000);

    forceDue("s42-corr-1");
    expect(await waitForEventCount("s42-corr-1", "delivery.delivered", 1, 10_000)).toBe(true);

    const evs = telemetryEvents("s42-corr-1");
    expect(evs.map((e) => e.event)).toEqual(["delivery.failed", "delivery.failed", "delivery.delivered"]);
    expect(evs[0]!.attempts).toBe(1);
    expect(evs[1]!.attempts).toBe(2);
    expect(typeof evs[0]!.nextAttemptAt).toBe("number");
    expect(typeof evs[1]!.nextAttemptAt).toBe("number");
    // Normal routing (opened-issue) must not produce a fallback line.
    expect(evs.some((e) => e.event === "routing.fallback")).toBe(false);
  }, 30_000);

  test("a delivery that exhausts the retry cap emits delivery.dead_letter", async () => {
    const res = await postWebhook(issuePayload, "issues", "s42-dead-1");
    expect(res.status).toBe(200);

    const ok = await waitFor(() => telemetryEvents("s42-dead-1").some((e) => e.event === "delivery.dead_letter"), "s42-dead-1", 30_000);
    expect(ok).toBe(true);

    const evs = telemetryEvents("s42-dead-1");
    expect(evs.map((e) => e.event)).toEqual([
      "delivery.failed",
      "delivery.failed",
      "delivery.failed",
      "delivery.failed",
      "delivery.dead_letter",
    ]);
    expect(evs.map((e) => e.attempts)).toEqual([1, 2, 3, 4, 5]);
    const dead = evs[4]!;
    expect(dead.attempts).toBe(5);
    expect(typeof dead.error).toBe("string");
    expect(dead.error as string).toContain("status 500");
  }, 40_000);

  test("an unresolved follow-up emits routing.fallback with the reason", async () => {
    const res = await postWebhook(commentPayload, "issue_comment", "s42-fb-1");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("accepted");

    const ok = await waitFor(() => telemetryEvents("s42-fb-1").some((e) => e.event === "delivery.delivered"), "s42-fb-1", 15_000);
    expect(ok).toBe(true);

    const evs = telemetryEvents("s42-fb-1");
    expect(evs.map((e) => e.event)).toEqual(["routing.fallback", "delivery.delivered"]);
    const fb = evs[0]!;
    expect(fb.reason).toBe("followup-unresolved");
    expect(fb.repo).toBe("owner/repo");
    expect(fb.item).toBe("issue #9");
  }, 20_000);

  test("no stdout/stderr line carries a raw secret or event body text", async () => {
    await Bun.sleep(200);
    const forbidden = [webhookSecret, hookToken, ghToken, hooksUrl, bodyMarker];
    for (const line of [...stdoutLines, ...stderrLines]) {
      for (const needle of forbidden) {
        expect(line).not.toContain(needle);
      }
    }
    // Every telemetry-shaped line is one parseable JSON object.
    for (const line of stdoutLines) {
      if (!line.startsWith("{")) continue;
      const obj = JSON.parse(line) as TelemetryLine;
      expect(typeof obj.event).toBe("string");
      expect(typeof obj.at).toBe("number");
    }
  });
});
