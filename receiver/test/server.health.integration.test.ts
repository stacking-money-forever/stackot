/**
 * S41 process oracle — health/readiness separation against a live receiver.
 *
 * The receiver is configured with a Gateway URL on a reserved port where
 * nothing listens yet: every forward attempt fails fast (ECONNREFUSED).
 * Intake must keep answering 200 "accepted", /readyz must stay "ready", and
 * /status must show "degraded". Binding a stub to that same port later lets
 * the retry drainer succeed and /status must return to "ok" — proof that
 * degraded reflects Gateway reachability, not receiver health.
 *
 * The hooks URL carries a token in its query on purpose: the surfaced
 * lastError must show the masked form, never the raw secret.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const secret = "s41-health-secret";
const hookToken = "s41-it-hook-token";
const receiverDir = join(import.meta.dir, "..");

type StatusBody = {
  status: "ok" | "degraded";
  outboxReady: boolean;
  gateway: { reachable: boolean; lastError: string | null; lastSuccessAt: number | null };
};

let port: number;
let gwPort: number;
let dbPath: string;
let dir: string;
let proc: ReturnType<typeof Bun.spawn> | undefined;
let gateway: ReturnType<typeof Bun.serve> | undefined;

const payload = JSON.stringify({
  action: "opened",
  repository: { full_name: "owner/repo" },
  issue: { number: 41, title: "health separation", html_url: "https://example.test/41", state: "open" },
});

function sign(body: string): string {
  const mac = new Bun.CryptoHasher("sha256", secret);
  mac.update(body);
  return `sha256=${mac.digest("hex")}`;
}

async function waitFor(check: () => boolean | Promise<boolean>, timeout = 10_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(50);
  }
  throw new Error("timed out");
}

function reservePort(): number {
  const reservation = Bun.serve({ port: 0, fetch: () => new Response("reserved") });
  if (reservation.port === undefined) throw new Error("ephemeral port was not assigned");
  const p = reservation.port;
  reservation.stop(true);
  return p;
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

async function statusBody(): Promise<StatusBody> {
  const res = await fetch(`http://127.0.0.1:${port}/status`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/json");
  return (await res.json()) as StatusBody;
}

function rowState(deliveryId: string): string | null {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.query("SELECT state FROM outbox WHERE id = ?").get(deliveryId) as { state: string } | null;
    return row?.state ?? null;
  } finally {
    db.close();
  }
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "stackot-s41-"));
  dbPath = join(dir, "outbox.sqlite");
  port = reservePort();
  gwPort = reservePort();
  const cfgPath = join(dir, "config.json");
  await Bun.write(cfgPath, JSON.stringify({
    host: "127.0.0.1",
    port,
    githubWebhookSecret: secret,
    openclawHooksUrl: `http://127.0.0.1:${gwPort}/hooks?key=${hookToken}`,
    openclawHookToken: hookToken,
    githubToken: "g",
    repos: { "owner/repo": { issuesForumChannelId: "101", prsForumChannelId: "102" } },
    ciAlertsChannelId: "103",
    adminChannelId: "104",
    agentId: "stackot",
    discordGuildId: "111",
    githubBacklinkLogin: "stackot-bot",
  }));
  proc = Bun.spawn([process.execPath, "src/server.ts"], {
    cwd: receiverDir,
    env: { ...process.env, STACKOT_CONFIG: cfgPath, STACKOT_OUTBOX_PATH: dbPath },
    stdout: "pipe",
    stderr: "pipe",
  });
  await waitFor(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/healthz`)).ok;
    } catch {
      return false;
    }
  });
});

afterAll(async () => {
  proc?.kill();
  if (proc) await proc.exited;
  gateway?.stop(true);
  await rm(dir, { recursive: true, force: true });
});

describe("S41 health/readiness separation", () => {
  test("status starts ok before any forward attempt, then degrades while intake continues", async () => {
    const initial = await statusBody();
    expect(initial.status).toBe("ok");
    expect(initial.gateway.reachable).toBe(true);
    expect(initial.gateway.lastError).toBeNull();
    expect(initial.gateway.lastSuccessAt).toBeNull();

    const res = await postWebhook("s41-first");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("accepted");
    expect(rowState("s41-first")).toBe("pending");

    await waitFor(async () => (await statusBody()).status === "degraded");
    const degraded = await statusBody();
    expect(degraded.gateway.reachable).toBe(false);
    expect(typeof degraded.gateway.lastError).toBe("string");
    expect(degraded.gateway.lastError!.length).toBeGreaterThan(0);
    expect(degraded.gateway.lastError).not.toContain(hookToken);

    const readyz = await fetch(`http://127.0.0.1:${port}/readyz`);
    expect(readyz.status).toBe(200);
    expect(await readyz.text()).toBe("ready");

    const healthz = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(healthz.status).toBe(200);
    expect(await healthz.text()).toBe("ok");
  });

  test("a second webhook is still accepted while the Gateway stays down", async () => {
    const res = await postWebhook("s41-second");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("accepted");
    expect(rowState("s41-second")).toBe("pending");

    const readyz = await fetch(`http://127.0.0.1:${port}/readyz`);
    expect(readyz.status).toBe(200);
    expect(await readyz.text()).toBe("ready");

    const healthz = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(healthz.status).toBe(200);
  });

  test("status returns to ok after the Gateway stub serves and retries succeed", async () => {
    gateway = Bun.serve({ port: gwPort, fetch: () => new Response("ok") });

    await waitFor(async () => (await statusBody()).status === "ok", 30_000);
    const recovered = await statusBody();
    expect(recovered.gateway.reachable).toBe(true);
    expect(recovered.gateway.lastError).toBeNull();
    expect(recovered.gateway.lastSuccessAt).toBeGreaterThan(0);

    await waitFor(() => rowState("s41-first") === "delivered" && rowState("s41-second") === "delivered");

    const readyz = await fetch(`http://127.0.0.1:${port}/readyz`);
    expect(readyz.status).toBe(200);
    expect(await readyz.text()).toBe("ready");

    const healthz = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(healthz.status).toBe(200);
    expect(await healthz.text()).toBe("ok");
  }, 40_000);
});
