import { describe, expect, test } from "bun:test";
import { fetchItem, findThreadId } from "../src/mapping.ts";
import type { ReceiverConfig } from "../src/config.ts";

const cfg = { githubToken: "test-token" } as ReceiverConfig;

type SeenRequest = { pathname: string; search: string; authorization: string | null };

/** Local GitHub API stub: serves `routes` keyed by pathname, records every request. */
function stubGitHub(routes: Record<string, unknown>) {
  const seen: SeenRequest[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      seen.push({ pathname: url.pathname, search: url.search, authorization: req.headers.get("authorization") });
      const body = routes[url.pathname];
      return body === undefined ? new Response("not found", { status: 404 }) : Response.json(body);
    },
  });
  return { seen, apiBase: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

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
        { body: "스레드: https://discord.com/channels/111/555" },
      ],
    });
    try {
      const item = await fetchItem(cfg, "example/app", "pulls", 7, { apiBase: gh.apiBase });
      expect(item.body).toBe("pr body");
      expect(findThreadId(item)).toBe("555");
    } finally {
      gh.stop();
    }
  });

  test("issue lookup still reads the issues surface", async () => {
    const gh = stubGitHub({
      "/repos/example/app/issues/42": { body: null },
      "/repos/example/app/issues/42/comments": [
        { body: "https://discord.com/channels/111/333" },
      ],
    });
    try {
      const item = await fetchItem(cfg, "example/app", "issues", 42, { apiBase: gh.apiBase });
      const paths = gh.seen.map((s) => s.pathname);
      expect(paths).toContain("/repos/example/app/issues/42");
      expect(paths).toContain("/repos/example/app/issues/42/comments");
      expect(gh.seen.length).toBe(2);
      expect(findThreadId(item)).toBe("333");
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
});
