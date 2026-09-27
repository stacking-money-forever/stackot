import { describe, expect, test } from "bun:test";
import { forwardToGateway, GATEWAY_TIMEOUT_MS } from "../src/gateway.ts";
import type { ReceiverConfig } from "../src/config.ts";
import type { NormalizedEvent } from "../src/normalize.ts";

const ev: NormalizedEvent = {
  target: "thread-1",
  targetKind: "channel",
  repo: "example/app",
  item: "issue #42",
  summary: "GitHub 이벤트: example/app issue #42 opened",
  url: "https://github.com/example/app/issues/42",
};

function cfgFor(port: number): ReceiverConfig {
  return {
    openclawHooksUrl: `http://127.0.0.1:${port}/hooks`,
    openclawHookToken: "tok",
    agentId: "stackot",
  } as ReceiverConfig;
}

describe("forwardToGateway", () => {
  test("sends framed message with idempotency key", async () => {
    const { promise: capturedReady, resolve: captureDone } = Promise.withResolvers<void>();
    let captured: { headers: Headers; body: string } | null = null;
    const server = Bun.serve({
      port: 9398,
      async fetch(req) {
        // Await the body: a fire-and-forget req.text() races stop(true) and
        // the abort surfaces as a top-level AbortError in Bun.
        const body = await req.text();
        captured = { headers: req.headers, body };
        captureDone();
        return Response.json({ ok: true, runId: "r1" });
      },
    });
    const cfg = {
      openclawHooksUrl: "http://127.0.0.1:9398/hooks",
      openclawHookToken: "tok",
      agentId: "stackot",
    } as ReceiverConfig;
    const res = await forwardToGateway(
      cfg,
      {
        target: "",
        targetKind: "channel",
        createThread: { forumChannelId: "101", title: "[example/app#42] 로그인 오류" },
        repo: "example/app",
        item: "issue #42",
        summary: "GitHub 이벤트: example/app issue #42 opened",
        url: "https://github.com/example/app/issues/42",
      },
      "delivery-abc",
    );
    await capturedReady;
    server.stop(true);
    expect(res.ok).toBe(true);
    const body = JSON.parse(captured!.body);
    expect(body.message).toContain("[example/app#42] 로그인 오류");
    expect(body.agentId).toBe("stackot");
    expect(body.deliver).toBe(false);
    expect(captured!.headers.get("Idempotency-Key")).toBe("stackot-delivery-abc");
    expect(captured!.headers.get("Authorization")).toBe("Bearer tok");
  });

  test("exposes the default timeout as GATEWAY_TIMEOUT_MS", () => {
    expect(GATEWAY_TIMEOUT_MS).toBe(10_000);
  });

  test("rejects a hanging gateway in bounded time (timeoutMs: 50)", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Promise<Response>(() => {});
      },
    });
    const start = performance.now();
    const err = await forwardToGateway(cfgFor(server.port!), ev, "delivery-timeout", { timeoutMs: 50 }).then(
      () => null,
      (e: unknown) => e,
    );
    const elapsed = performance.now() - start;
    server.stop(true);
    expect(err).toBeInstanceOf(Error);
    expect(elapsed).toBeLessThan(2000);
    const e = err as Error;
    expect(`${e.name} ${e.message}`).toMatch(/timeout|abort/i);
  });

  test("returns ok:false on 502 without throwing", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("bad gateway", { status: 502 });
      },
    });
    const res = await forwardToGateway(cfgFor(server.port!), ev, "delivery-502", { timeoutMs: 1000 });
    server.stop(true);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(502);
    expect(res.body).toBe("bad gateway");
  });

  test("uses the default timeout when opts are omitted", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ ok: true });
      },
    });
    const res = await forwardToGateway(cfgFor(server.port!), ev, "delivery-default");
    server.stop(true);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
  });
});
