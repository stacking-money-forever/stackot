/**
 * S43 oracle — queue/dead-letter backlog metrics.
 *
 * Unit half: a real Outbox with a known row mix must report exact counts from
 * a single aggregate query, oldestPendingAgeMs tracks the manipulated
 * received_at, empty states report 0/null, and collectMetrics/toLogLine
 * produce a safe one-line JSON shape.
 *
 * Process half: a spawned receiver must emit a queue.metrics line on stdout
 * and serve the same numbers in /status. The server emits once at startup,
 * so the test never has to wait out METRICS_INTERVAL_MS.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_DELIVERY_ATTEMPTS, Outbox } from "../src/outbox.ts";
import { collectMetrics, toLogLine } from "../src/metrics.ts";

const event = { repo: "example/app", item: "issue #1", target: "1", targetKind: "channel" as const, summary: "x", url: "https://example.test" };

function withOutbox(fn: (outbox: Outbox, path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "stackot-s43-metrics-"));
  try {
    const path = join(dir, "outbox.sqlite");
    const outbox = new Outbox(path);
    try {
      fn(outbox, path);
    } finally {
      outbox.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Outbox.stats", () => {
  test("reports exact counts for a known row mix and the age of the oldest pending", () => {
    withOutbox((outbox, path) => {
      const ageMs = 3_600_000;
      expect(outbox.enqueue("s43-p-old", event)).toBe(true);
      expect(outbox.enqueue("s43-p-new", event)).toBe(true);
      const db = new Database(path);
      db.query("UPDATE outbox SET received_at = ? WHERE id = ?").run(Date.now() - ageMs, "s43-p-old");
      db.close();

      expect(outbox.enqueue("s43-dead", event)).toBe(true);
      outbox.fail("s43-dead", MAX_DELIVERY_ATTEMPTS, "gateway 502");

      for (const id of ["s43-done-1", "s43-done-2", "s43-done-3"]) {
        expect(outbox.enqueue(id, event)).toBe(true);
        outbox.delivered(id);
      }

      const stats = outbox.stats();
      expect(stats.pending).toBe(2);
      expect(stats.deadLetter).toBe(1);
      expect(stats.delivered).toBe(3);
      expect(stats.oldestPendingAgeMs).not.toBeNull();
      expect(stats.oldestPendingAgeMs!).toBeGreaterThanOrEqual(ageMs);
      expect(stats.oldestPendingAgeMs!).toBeLessThan(ageMs + 10_000);
    });
  });

  test("oldestPendingAgeMs is null when nothing is pending", () => {
    withOutbox((outbox) => {
      expect(outbox.enqueue("s43-only-done", event)).toBe(true);
      outbox.delivered("s43-only-done");
      const stats = outbox.stats();
      expect(stats.pending).toBe(0);
      expect(stats.delivered).toBe(1);
      expect(stats.deadLetter).toBe(0);
      expect(stats.oldestPendingAgeMs).toBeNull();
    });
  });

  test("empty outbox reports zeros and null, no missing fields", () => {
    withOutbox((outbox) => {
      expect(outbox.stats()).toEqual({ pending: 0, deadLetter: 0, delivered: 0, oldestPendingAgeMs: null });
    });
  });
});

describe("collectMetrics", () => {
  test("passes a well-formed stats object through", () => {
    expect(collectMetrics({ pending: 2, deadLetter: 1, delivered: 3, oldestPendingAgeMs: 42 }))
      .toEqual({ pending: 2, deadLetter: 1, delivered: 3, oldestPendingAgeMs: 42 });
  });

  test("negative and NaN inputs are clamped to 0 or null", () => {
    expect(collectMetrics({ pending: -3, deadLetter: NaN, delivered: -1, oldestPendingAgeMs: NaN }))
      .toEqual({ pending: 0, deadLetter: 0, delivered: 0, oldestPendingAgeMs: null });
    expect(collectMetrics({ pending: Infinity, deadLetter: 0, delivered: 0, oldestPendingAgeMs: -50 }))
      .toEqual({ pending: 0, deadLetter: 0, delivered: 0, oldestPendingAgeMs: 0 });
  });
});

describe("toLogLine", () => {
  test("emits one parseable JSON object with every required field", () => {
    const line = toLogLine({ pending: 2, deadLetter: 1, delivered: 3, oldestPendingAgeMs: 900 });
    expect(line).not.toContain("\n");
    const obj = JSON.parse(line) as Record<string, unknown>;
    expect(obj.event).toBe("queue.metrics");
    expect(typeof obj.ts).toBe("number");
    expect(typeof obj.at).toBe("number");
    expect(obj.pending).toBe(2);
    expect(obj.deadLetter).toBe(1);
    expect(obj.delivered).toBe(3);
    expect(obj.oldestPendingAgeMs).toBe(900);
    // Only `event` may be a string: the line carries no free text a secret could hide in.
    for (const [key, value] of Object.entries(obj)) {
      if (key !== "event") expect(typeof value === "number" || value === null).toBe(true);
    }
  });
});

describe("process-level queue metrics", () => {
  const secret = "s43-metrics-secret";
  const hookToken = "s43-hook-token";
  const receiverDir = join(import.meta.dir, "..");

  let port: number;
  let dir: string;
  let proc: Bun.Subprocess | undefined;
  const stdoutLines: string[] = [];

  function pump(stream: ReadableStream<Uint8Array>): void {
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
          stdoutLines.push(buf.slice(0, i));
          buf = buf.slice(i + 1);
          i = buf.indexOf("\n");
        }
      }
    })();
  }

  function reservePort(): number {
    const reservation = Bun.serve({ port: 0, fetch: () => new Response("reserved") });
    if (reservation.port === undefined) throw new Error("ephemeral port was not assigned");
    const p = reservation.port;
    reservation.stop(true);
    return p;
  }

  async function waitFor(check: () => boolean | Promise<boolean>, timeout = 10_000): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await check()) return;
      await Bun.sleep(50);
    }
    throw new Error("timed out");
  }

  function metricsLines(): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    for (const line of stdoutLines) {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (obj.event === "queue.metrics") out.push(obj);
      } catch {}
    }
    return out;
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "stackot-s43-server-"));
    const dbPath = join(dir, "outbox.sqlite");
    port = reservePort();
    const gwPort = reservePort();

    // Seed one pending and one dead_letter row; the pending row can never
    // deliver because the Gateway port is reserved but nothing listens.
    const seed = new Outbox(dbPath);
    seed.enqueue("s43-seed-pending", event);
    seed.enqueue("s43-seed-dead", event);
    seed.fail("s43-seed-dead", MAX_DELIVERY_ATTEMPTS, "gateway 502");
    seed.close();

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
    if (proc.stdout instanceof ReadableStream) pump(proc.stdout);

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
    if (proc) await Promise.race([proc.exited, Bun.sleep(2000)]);
    await rm(dir, { recursive: true, force: true });
  });

  test("the server emits a queue.metrics line and /status carries the same stats", async () => {
    await waitFor(() => metricsLines().length >= 1);
    const line = metricsLines()[0]!;
    expect(typeof line.ts).toBe("number");
    expect(line.pending).toBe(1);
    expect(line.deadLetter).toBe(1);
    expect(line.delivered).toBe(0);
    expect(typeof line.oldestPendingAgeMs).toBe("number");

    const res = await fetch(`http://127.0.0.1:${port}/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { queue?: { pending: number; deadLetter: number; delivered: number; oldestPendingAgeMs: number | null } };
    expect(body.queue).not.toBeUndefined();
    expect(body.queue!.pending).toBe(1);
    expect(body.queue!.deadLetter).toBe(1);
    expect(body.queue!.delivered).toBe(0);
    expect(typeof body.queue!.oldestPendingAgeMs).toBe("number");
    expect(body.queue!.oldestPendingAgeMs!).toBeGreaterThanOrEqual(0);
  });
});
