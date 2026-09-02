import { describe, expect, test } from "bun:test";
import { forwardToGateway } from "../src/gateway.ts";
import type { ReceiverConfig } from "../src/config.ts";

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
});
