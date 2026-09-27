import { afterEach, describe, expect, test } from "bun:test";
import { githubFetch } from "../src/github-client.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Response factories served in order; the last one repeats once the list runs out. */
function seq(steps: (() => Response)[]): () => Response {
  let i = 0;
  return () => {
    const step = steps[Math.min(i, steps.length - 1)]!;
    i++;
    return step();
  };
}

/** Replace global fetch with `handler`; returns the requested URLs in order. */
function stubFetch(handler: (url: string) => Response) {
  const urls: string[] = [];
  globalThis.fetch = (async (input: Request | URL | string) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    return handler(url);
  }) as typeof fetch;
  return urls;
}

/** Injectable sleep that records each instructed delay instead of waiting. */
function fakeSleep() {
  const sleeps: number[] = [];
  return { sleeps, sleep: async (ms: number) => void sleeps.push(ms) };
}

const rateLimited = (retryAfter?: string) => () =>
  new Response("limited", {
    status: 429,
    headers: retryAfter === undefined ? {} : { "Retry-After": retryAfter },
  });

describe("githubFetch Retry-After compliance", () => {
  test("429 + Retry-After seconds waits exactly that long, then retries", async () => {
    const urls = stubFetch(seq([rateLimited("2"), () => new Response("ok", { status: 200 })]));
    const { sleeps, sleep } = fakeSleep();
    const res = await githubFetch("https://api.github.com/x", {}, { sleep });
    expect(res.status).toBe(200);
    expect(sleeps).toEqual([2000]);
    expect(urls).toEqual(["https://api.github.com/x", "https://api.github.com/x"]);
  });

  test("Retry-After as HTTP-date waits the difference from now()", async () => {
    const t0 = Date.parse("Wed, 21 Oct 2026 07:28:00 GMT");
    const urls = stubFetch(
      seq([
        rateLimited(new Date(t0 + 3_000).toUTCString()),
        () => new Response("ok", { status: 200 }),
      ]),
    );
    const { sleeps, sleep } = fakeSleep();
    const res = await githubFetch("https://api.github.com/x", {}, { sleep, now: () => t0 });
    expect(res.status).toBe(200);
    expect(sleeps).toEqual([3000]);
    expect(urls.length).toBe(2);
  });

  test("an HTTP-date in the past waits the minimum, not a negative delay", async () => {
    const t0 = Date.parse("Wed, 21 Oct 2026 07:28:00 GMT");
    stubFetch(seq([rateLimited(new Date(t0 - 60_000).toUTCString()), () => new Response("ok", { status: 200 })]));
    const { sleeps, sleep } = fakeSleep();
    const res = await githubFetch("https://api.github.com/x", {}, { sleep, now: () => t0 });
    expect(res.status).toBe(200);
    expect(sleeps).toEqual([0]);
  });

  test("an instructed wait beyond maxRetryAfterMs is clamped to the cap", async () => {
    stubFetch(seq([rateLimited("3600"), rateLimited("3600"), () => new Response("ok", { status: 200 })]));
    const { sleeps, sleep } = fakeSleep();
    const res = await githubFetch("https://api.github.com/x", {}, { sleep });
    expect(res.status).toBe(200);
    expect(sleeps).toEqual([60_000, 60_000]);
  });

  test("a custom maxRetryAfterMs bounds the wait", async () => {
    stubFetch(seq([rateLimited("30"), () => new Response("ok", { status: 200 })]));
    const { sleeps, sleep } = fakeSleep();
    const res = await githubFetch("https://api.github.com/x", {}, { sleep, maxRetryAfterMs: 5_000 });
    expect(res.status).toBe(200);
    expect(sleeps).toEqual([5000]);
  });

  test("a missing Retry-After falls back to the default wait", async () => {
    stubFetch(seq([rateLimited(), () => new Response("ok", { status: 200 })]));
    const { sleeps, sleep } = fakeSleep();
    const res = await githubFetch("https://api.github.com/x", {}, { sleep });
    expect(res.status).toBe(200);
    expect(sleeps).toEqual([1000]);
  });

  test("an unparseable Retry-After falls back to the default wait", async () => {
    stubFetch(seq([rateLimited("soon"), () => new Response("ok", { status: 200 })]));
    const { sleeps, sleep } = fakeSleep();
    const res = await githubFetch("https://api.github.com/x", {}, { sleep });
    expect(res.status).toBe(200);
    expect(sleeps).toEqual([1000]);
  });

  test("persistent 429 returns the last response after maxRetries, never throws", async () => {
    const urls = stubFetch(seq([rateLimited("1")]));
    const { sleeps, sleep } = fakeSleep();
    const res = await githubFetch("https://api.github.com/x", {}, { sleep });
    expect(res.status).toBe(429);
    // 1 initial + 2 retries, each retry preceded by exactly one instructed wait.
    expect(urls.length).toBe(3);
    expect(sleeps).toEqual([1000, 1000]);
  });

  test("maxRetries bounds both retries and waits", async () => {
    const urls = stubFetch(seq([rateLimited("1")]));
    const { sleeps, sleep } = fakeSleep();
    const res = await githubFetch("https://api.github.com/x", {}, { sleep, maxRetries: 1 });
    expect(res.status).toBe(429);
    expect(urls.length).toBe(2);
    expect(sleeps).toEqual([1000]);
  });

  test("maxRetries: 0 never retries", async () => {
    const urls = stubFetch(seq([rateLimited("1")]));
    const { sleeps, sleep } = fakeSleep();
    const res = await githubFetch("https://api.github.com/x", {}, { sleep, maxRetries: 0 });
    expect(res.status).toBe(429);
    expect(urls.length).toBe(1);
    expect(sleeps).toEqual([]);
  });

  test.each([200, 404, 500])("status %i is returned immediately without retrying", async (status) => {
    const urls = stubFetch(seq([() => new Response(null, { status })]));
    const { sleeps, sleep } = fakeSleep();
    const res = await githubFetch("https://api.github.com/x", {}, { sleep });
    expect(res.status).toBe(status);
    expect(urls.length).toBe(1);
    expect(sleeps).toEqual([]);
  });

  test("403 with x-ratelimit-remaining: 0 is treated as rate limited", async () => {
    const urls = stubFetch(
      seq([
        () =>
          new Response("limited", {
            status: 403,
            headers: { "x-ratelimit-remaining": "0", "Retry-After": "4" },
          }),
        () => new Response("ok", { status: 200 }),
      ]),
    );
    const { sleeps, sleep } = fakeSleep();
    const res = await githubFetch("https://api.github.com/x", {}, { sleep });
    expect(res.status).toBe(200);
    expect(sleeps).toEqual([4000]);
    expect(urls.length).toBe(2);
  });

  test("403 without x-ratelimit-remaining: 0 is not retried", async () => {
    const urls = stubFetch(
      seq([
        () => new Response("forbidden", { status: 403, headers: { "x-ratelimit-remaining": "17" } }),
        () => new Response("ok", { status: 200 }),
      ]),
    );
    const { sleeps, sleep } = fakeSleep();
    const res = await githubFetch("https://api.github.com/x", {}, { sleep });
    expect(res.status).toBe(403);
    expect(urls.length).toBe(1);
    expect(sleeps).toEqual([]);
  });

  test("a second 429 after the first retry waits again — never a burst", async () => {
    const urls = stubFetch(seq([rateLimited("2"), rateLimited("3"), () => new Response("ok", { status: 200 })]));
    const { sleeps, sleep } = fakeSleep();
    const res = await githubFetch("https://api.github.com/x", {}, { sleep });
    expect(res.status).toBe(200);
    expect(sleeps).toEqual([2000, 3000]);
    expect(urls.length).toBe(3);
  });
});
