import { describe, expect, test } from "bun:test";
import { fetchItem, findThreadId, GITHUB_TIMEOUT_MS } from "../src/mapping.ts";
import type { ReceiverConfig } from "../src/config.ts";

const cfg = {
  githubToken: "test-token",
  discordGuildId: "111",
  githubBacklinkLogin: "GitHubBot",
} as ReceiverConfig;

type SeenRequest = { pathname: string; search: string; authorization: string | null };

type StubRoute = unknown | ((url: URL) => Response);

/** Local GitHub API stub: serves `routes` keyed by pathname, records every request. */
function stubGitHub(routes: Record<string, StubRoute>) {
  const seen: SeenRequest[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      seen.push({ pathname: url.pathname, search: url.search, authorization: req.headers.get("authorization") });
      const route = routes[url.pathname];
      if (route === undefined) return new Response("not found", { status: 404 });
      return typeof route === "function" ? (route as (u: URL) => Response)(url) : Response.json(route);
    },
  });
  return { seen, apiBase: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

const COMMENTS = "/repos/example/app/issues/9/comments";

describe("fetchItem", () => {
  test("PR lookup reads discussion comments from the issues surface", async () => {
    const gh = stubGitHub({
      "/repos/example/app/pulls/7": { body: "pr body" },
      "/repos/example/app/issues/7/comments": [],
      // /repos/example/app/pulls/7/comments deliberately unmapped → 404
    });
    try {
      await fetchItem(cfg, "example/app", "pulls", 7, { apiBase: gh.apiBase });
      const paths = gh.seen.map((s) => s.pathname);
      expect(paths).toContain("/repos/example/app/pulls/7");
      expect(paths).toContain("/repos/example/app/issues/7/comments");
      expect(paths.some((p) => p.startsWith("/repos/example/app/pulls/7/comments"))).toBe(false);
      expect(gh.seen.length).toBe(2);
      const commentsReq = gh.seen.find((s) => s.pathname === "/repos/example/app/issues/7/comments");
      expect(commentsReq?.search).toBe("?per_page=20");
    } finally {
      gh.stop();
    }
  });

  test("thread URL in a PR discussion comment resolves to the thread id", async () => {
    const gh = stubGitHub({
      "/repos/example/app/pulls/7": { body: "pr body" },
      "/repos/example/app/issues/7/comments": [
        { body: "스레드: https://discord.com/channels/111/555", user: { login: "GitHubBot" } },
      ],
    });
    try {
      const item = await fetchItem(cfg, "example/app", "pulls", 7, { apiBase: gh.apiBase });
      expect(item.body).toBe("pr body");
      expect(item.author).toBeNull();
      expect(item.comments[0]?.author).toBe("GitHubBot");
      expect(findThreadId(item, cfg)).toBe("555");
    } finally {
      gh.stop();
    }
  });

  test("issue lookup still reads the issues surface", async () => {
    const gh = stubGitHub({
      "/repos/example/app/issues/42": { body: null },
      "/repos/example/app/issues/42/comments": [
        { body: "https://discord.com/channels/111/333", user: { login: "GitHubBot" } },
      ],
    });
    try {
      const item = await fetchItem(cfg, "example/app", "issues", 42, { apiBase: gh.apiBase });
      const paths = gh.seen.map((s) => s.pathname);
      expect(paths).toContain("/repos/example/app/issues/42");
      expect(paths).toContain("/repos/example/app/issues/42/comments");
      expect(gh.seen.length).toBe(2);
      expect(findThreadId(item, cfg)).toBe("333");
    } finally {
      gh.stop();
    }
  });

  test("follows Link rel=next and resolves a thread URL on a later page", async () => {
    const gh = stubGitHub({
      "/repos/example/app/issues/9": { body: "issue body" },
      [COMMENTS]: (url: URL) => {
        if (!url.searchParams.has("cursor")) {
          const next = `${url.origin}${COMMENTS}?per_page=20&cursor=opaque-page-2`;
          return Response.json(
            [{ body: "forged https://discord.com/channels/999/111", user: { login: "mallory" } }],
            {
              headers: { Link: `<${next}>; rel="next", <${url.origin}${COMMENTS}?per_page=20&cursor=opaque-end>; rel="last"` },
            },
          );
        }
        return Response.json([{ body: "스레드: https://discord.com/channels/111/777", user: { login: "GitHubBot" } }]);
      },
    });
    try {
      const item = await fetchItem(cfg, "example/app", "issues", 9, { apiBase: gh.apiBase });
      expect(findThreadId(item, cfg)).toBe("777");
      const commentsReqs = gh.seen.filter((s) => s.pathname === COMMENTS);
      expect(commentsReqs.length).toBe(2);
      expect(commentsReqs[0]?.search).toBe("?per_page=20");
      expect(commentsReqs[1]?.search).toBe("?per_page=20&cursor=opaque-page-2");
      for (const req of commentsReqs) {
        expect(req.authorization).toBe("Bearer test-token");
      }
    } finally {
      gh.stop();
    }
  });

  test("stops paginating once the thread URL is found", async () => {
    const gh = stubGitHub({
      "/repos/example/app/issues/9": { body: null },
      [COMMENTS]: (url: URL) =>
        Response.json([{ body: "https://discord.com/channels/111/888", user: { login: "GitHubBot" } }], {
          headers: { Link: `<${url.origin}${COMMENTS}?per_page=20&page=2>; rel="next"` },
        }),
    });
    try {
      const item = await fetchItem(cfg, "example/app", "issues", 9, { apiBase: gh.apiBase });
      expect(findThreadId(item, cfg)).toBe("888");
      const commentsReqs = gh.seen.filter((s) => s.pathname === COMMENTS);
      expect(commentsReqs.length).toBe(1);
    } finally {
      gh.stop();
    }
  });

  test("stops at opts.maxCommentPages when the next chain outlasts the cap", async () => {
    const gh = stubGitHub({
      "/repos/example/app/issues/9": { body: null },
      [COMMENTS]: (url: URL) => {
        const page = Number(url.searchParams.get("page") ?? "1");
        const next = `${url.origin}${COMMENTS}?per_page=20&page=${page + 1}`;
        return Response.json([{ body: `comment page ${page}` }], {
          headers: { Link: `<${next}>; rel="next"` },
        });
      },
    });
    try {
      const item = await fetchItem(cfg, "example/app", "issues", 9, { apiBase: gh.apiBase, maxCommentPages: 3 });
      const commentsReqs = gh.seen.filter((s) => s.pathname === COMMENTS);
      expect(commentsReqs.length).toBe(3);
      expect(item.comments.length).toBe(3);
      expect(findThreadId(item, cfg)).toBeNull();
    } finally {
      gh.stop();
    }
  });

  test("requests comments only once when the response has no Link header", async () => {
    const gh = stubGitHub({
      "/repos/example/app/issues/9": { body: null },
      [COMMENTS]: [{ body: "plain comment" }],
    });
    try {
      await fetchItem(cfg, "example/app", "issues", 9, { apiBase: gh.apiBase });
      const commentsReqs = gh.seen.filter((s) => s.pathname === COMMENTS);
      expect(commentsReqs.length).toBe(1);
      expect(commentsReqs[0]?.search).toBe("?per_page=20");
    } finally {
      gh.stop();
    }
  });

  test("sends the Authorization header on every request", async () => {
    const gh = stubGitHub({
      "/repos/example/app/pulls/7": { body: null },
      "/repos/example/app/issues/7/comments": [],
    });
    try {
      await fetchItem(cfg, "example/app", "pulls", 7, { apiBase: gh.apiBase });
      expect(gh.seen.length).toBeGreaterThan(0);
      for (const req of gh.seen) {
        expect(req.authorization).toBe("Bearer test-token");
      }
    } finally {
      gh.stop();
    }
  });

  test("thread URL in a recorder-authored item body resolves to the thread id", async () => {
    const gh = stubGitHub({
      "/repos/example/app/issues/5": {
        body: "스레드: https://discord.com/channels/111/666",
        user: { login: "GitHubBot" },
      },
      "/repos/example/app/issues/5/comments": [],
    });
    try {
      const item = await fetchItem(cfg, "example/app", "issues", 5, { apiBase: gh.apiBase });
      expect(item.author).toBe("GitHubBot");
      expect(findThreadId(item, cfg)).toBe("666");
    } finally {
      gh.stop();
    }
  });

  test("a forged body link is skipped and a later recorder comment link is adopted", async () => {
    const gh = stubGitHub({
      "/repos/example/app/issues/6": {
        body: "https://discord.com/channels/111/777",
        user: { login: "mallory" },
      },
      "/repos/example/app/issues/6/comments": [
        { body: "https://discord.com/channels/111/888", user: { login: "GitHubBot" } },
      ],
    });
    try {
      const item = await fetchItem(cfg, "example/app", "issues", 6, { apiBase: gh.apiBase });
      expect(item.author).toBe("mallory");
      expect(findThreadId(item, cfg)).toBe("888");
    } finally {
      gh.stop();
    }
  });
});

describe("fetchItem rate limit (B03)", () => {
  /** Injectable sleep that records instructed waits; no real clock involved. */
  function fakeSleep() {
    const sleeps: number[] = [];
    return { sleeps, sleep: async (ms: number) => void sleeps.push(ms) };
  }

  test("a 429 + Retry-After on the comments request is waited out and retried", async () => {
    let commentsHits = 0;
    const gh = stubGitHub({
      "/repos/example/app/issues/9": { body: "issue body" },
      [COMMENTS]: () => {
        commentsHits++;
        if (commentsHits === 1) {
          return new Response("limited", { status: 429, headers: { "Retry-After": "5" } });
        }
        return Response.json([
          { body: "스레드: https://discord.com/channels/111/888", user: { login: "GitHubBot" } },
        ]);
      },
    });
    const { sleeps, sleep } = fakeSleep();
    try {
      const item = await fetchItem(cfg, "example/app", "issues", 9, {
        apiBase: gh.apiBase,
        githubFetchOpts: { sleep },
      });
      expect(findThreadId(item, cfg)).toBe("888");
      expect(commentsHits).toBe(2);
      expect(sleeps).toEqual([5000]);
      const commentsReqs = gh.seen.filter((s) => s.pathname === COMMENTS);
      expect(commentsReqs.length).toBe(2);
    } finally {
      gh.stop();
    }
  });

  test("a persistent 429 still fails the lookup after retries are exhausted", async () => {
    const gh = stubGitHub({
      "/repos/example/app/issues/9": () =>
        new Response("limited", { status: 429, headers: { "Retry-After": "2" } }),
      [COMMENTS]: [],
    });
    const { sleeps, sleep } = fakeSleep();
    try {
      const err = await fetchItem(cfg, "example/app", "issues", 9, {
        apiBase: gh.apiBase,
        githubFetchOpts: { sleep },
      }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("github api 429 for example/app issues #9");
      expect((err as Error).message).not.toContain("test-token");
      // 1 initial + 2 retries, each preceded by one instructed wait — no burst.
      expect(sleeps).toEqual([2000, 2000]);
      const itemReqs = gh.seen.filter((s) => s.pathname === "/repos/example/app/issues/9");
      expect(itemReqs.length).toBe(3);
    } finally {
      gh.stop();
    }
  });
});

describe("fetchItem timeout (S21b)", () => {
  test("GITHUB_TIMEOUT_MS defaults the lookup budget to 10 seconds", () => {
    expect(GITHUB_TIMEOUT_MS).toBe(10_000);
  });

  test("rejects promptly against a server that never responds", async () => {
    const hung = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Promise<Response>(() => {}),
    });
    try {
      const started = Date.now();
      await expect(
        fetchItem(cfg, "example/app", "issues", 9, { apiBase: `http://127.0.0.1:${hung.port}`, timeoutMs: 50 }),
      ).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      hung.stop(true);
    }
  });
});

describe("findThreadId backlink trust", () => {
  const trust = { discordGuildId: "111", githubBacklinkLogin: "GitHubBot" };

  test("accepts a recorder-authored comment link in the configured guild", () => {
    const item = {
      body: null,
      comments: [{ body: "https://discord.com/channels/111/555", author: "GitHubBot" }],
    };
    expect(findThreadId(item, trust)).toBe("555");
  });

  test("accepts a recorder-authored body link in the configured guild", () => {
    const item = {
      body: "스레드: https://discord.com/channels/111/222",
      author: "GitHubBot",
      comments: [],
    };
    expect(findThreadId(item, trust)).toBe("222");
  });

  test("ignores a link to the same thread id under a different guild", () => {
    const item = {
      body: null,
      comments: [
        { body: "https://discord.com/channels/999/555", author: "GitHubBot" },
        { body: "https://discord.com/channels/1111/555", author: "GitHubBot" },
      ],
    };
    expect(findThreadId(item, trust)).toBeNull();
  });

  test("ignores a non-recorder comment link in the configured guild", () => {
    const item = {
      body: null,
      comments: [{ body: "https://discord.com/channels/111/555", author: "mallory" }],
    };
    expect(findThreadId(item, trust)).toBeNull();
  });

  test("ignores a non-recorder comment link in another guild", () => {
    const item = {
      body: null,
      comments: [{ body: "https://discord.com/channels/999/555", author: "mallory" }],
    };
    expect(findThreadId(item, trust)).toBeNull();
  });

  test("ignores a recorder-authored link under a different guild", () => {
    const item = {
      body: "https://discord.com/channels/999/222",
      author: "GitHubBot",
      comments: [{ body: "https://discord.com/channels/999/333", author: "GitHubBot" }],
    };
    expect(findThreadId(item, trust)).toBeNull();
  });

  test("adopts a later valid link when a forged link comes first", () => {
    const item = {
      body: "forged body https://discord.com/channels/111/001",
      author: "mallory",
      comments: [
        { body: "forged comment https://discord.com/channels/111/002", author: "mallory" },
        { body: "real https://discord.com/channels/111/888", author: "GitHubBot" },
      ],
    };
    expect(findThreadId(item, trust)).toBe("888");
  });

  test("matches the recorder login case-insensitively", () => {
    const item = {
      body: "https://discord.com/channels/111/444",
      author: "githubbot",
      comments: [{ body: "https://discord.com/channels/111/445", author: "GITHUBBOT" }],
    };
    expect(findThreadId(item, trust)).toBe("444");
  });

  test("ignores texts whose author is unknown", () => {
    expect(
      findThreadId({ body: "https://discord.com/channels/111/222", comments: [] }, trust),
    ).toBeNull();
    expect(
      findThreadId(
        { body: null, comments: [{ body: "https://discord.com/channels/111/222" }] },
        trust,
      ),
    ).toBeNull();
  });
});
