import { describe, expect, test } from "bun:test";
import { normalize, type NormalizedEvent } from "../src/normalize.ts";
import { route, type RouteDecision } from "../src/router.ts";
import { forwardToGateway } from "../src/gateway.ts";
import type { ReceiverConfig } from "../src/config.ts";

const repo = { full_name: "example/app" };

const checkRun = (over: Record<string, unknown> = {}) => ({
  check_run: { name: "build", status: "completed", conclusion: "failure", html_url: "u3", ...over },
});

describe("check_run linked PR preservation (S20)", () => {
  test("failed check_run with linked PR keeps prNumbers, item, and summary ref", () => {
    const ev = normalize("check_run", repo, "completed", checkRun({ pull_requests: [{ number: 17 }] }));
    expect(ev).not.toBeNull();
    expect(ev!.prNumbers).toEqual([17]);
    expect(ev!.item).toBe("CI build");
    expect(ev!.summary).toContain("PR #17");
    expect(ev!.target).toBe("");
    expect(ev!.targetKind).toBe("channel");
  });

  test("multiple linked PRs preserve order and dedupe", () => {
    const ev = normalize("check_run", repo, "completed", checkRun({
      pull_requests: [{ number: 9 }, { number: 3 }, { number: 9 }, { number: 3 }],
    }));
    expect(ev!.prNumbers).toEqual([9, 3]);
    expect(ev!.summary).toContain("PR #9");
    expect(ev!.summary).toContain("PR #3");
  });

  test("missing pull_requests → prNumbers unset, still channel target", () => {
    const ev = normalize("check_run", repo, "completed", checkRun());
    expect(ev!.targetKind).toBe("channel");
    expect(ev!.prNumbers ?? []).toEqual([]);
    expect(ev!.summary).not.toContain("PR #");
  });

  test("empty pull_requests array → prNumbers unset or empty, still channel target", () => {
    const ev = normalize("check_run", repo, "completed", checkRun({ pull_requests: [] }));
    expect(ev!.prNumbers ?? []).toEqual([]);
    expect(ev!.targetKind).toBe("channel");
    expect(ev!.summary).not.toContain("PR #");
  });

  test("malformed number entries are dropped", () => {
    const ev = normalize("check_run", repo, "completed", checkRun({
      pull_requests: [
        { number: 5 },
        {},
        { number: "7" },
        { number: NaN },
        { number: Infinity },
        { number: 0 },
        { number: -2 },
        { number: 1.5 },
        null,
      ],
    }));
    expect(ev!.prNumbers).toEqual([5]);
    expect(ev!.summary).toContain("PR #5");
    expect(ev!.summary).not.toContain("PR #7");
  });

  test.each(["success", "skipped", "neutral"] as const)("conclusion %s → null", (conclusion) => {
    expect(normalize("check_run", repo, "completed", checkRun({ conclusion, pull_requests: [{ number: 1 }] }))).toBeNull();
  });

  test("missing conclusion → null", () => {
    expect(normalize("check_run", repo, "completed", checkRun({ conclusion: null }))).toBeNull();
  });

  test("non-completed action → null", () => {
    expect(normalize("check_run", repo, "rerequested", checkRun({ status: "in_progress", conclusion: null }))).toBeNull();
  });
});

// --- S21: route() decision module -----------------------------------------

const cfg = {
  repos: {
    "a/repo": { issuesForumChannelId: "101", prsForumChannelId: "102" },
    "b/repo": { issuesForumChannelId: "201", prsForumChannelId: "202" },
  },
  ciAlertsChannelId: "ci-alerts",
  adminChannelId: "admin",
} as unknown as ReceiverConfig;

type ResolveInput = { repo: string; kind: "issues" | "pulls"; number: number };

function stubResolver(threads: Record<string, string> = {}) {
  const calls: ResolveInput[] = [];
  const resolveThreadId = async (input: ResolveInput) => {
    calls.push(input);
    return threads[`${input.repo} ${input.kind}#${input.number}`] ?? null;
  };
  return { calls, resolveThreadId };
}

const issueOpened = (full: string, number = 42) =>
  normalize("issues", { full_name: full }, "opened", {
    issue: { number, title: "로그인 오류", html_url: `https://github.com/${full}/issues/${number}`, state: "open", body: null },
  })!;

const prOpened = (full: string, number = 7) =>
  normalize("pull_request", { full_name: full }, "opened", {
    pull_request: { number, title: "기능 추가", html_url: `https://github.com/${full}/pull/${number}`, state: "open", draft: false },
  })!;

const issueComment = (full: string, number = 42) =>
  normalize("issue_comment", { full_name: full }, "created", {
    issue: { number, title: "t", html_url: "u" },
    comment: { user: { login: "u1" }, body: "댓글", html_url: "u2" },
  })!;

const prReview = (full: string, number = 9) =>
  normalize("pull_request_review", { full_name: full }, "submitted", {
    pull_request: { number, title: "t", html_url: "u" },
    review: { user: { login: "u2" }, state: "approved", body: null, html_url: "u3" },
  })!;

const ciFailed = (full: string, prs?: number[]) =>
  normalize("check_run", { full_name: full }, "completed", {
    check_run: {
      name: "build", status: "completed", conclusion: "failure", html_url: "u3",
      pull_requests: prs?.map((number) => ({ number })),
    },
  })!;

describe("route() decision table (S21)", () => {
  const cases: { name: string; ev: NormalizedEvent; threads?: Record<string, string>; want: RouteDecision; calls?: ResolveInput[] }[] = [
    {
      name: "opened issue on configured repo → issues forum createThread",
      ev: issueOpened("a/repo"),
      want: {
        target: "", targetKind: "channel",
        createThread: { forumChannelId: "101", title: "[a/repo#42] 로그인 오류" },
        reason: "opened-issue",
      },
      calls: [],
    },
    {
      name: "opened PR on configured repo → prs forum createThread",
      ev: prOpened("a/repo"),
      want: {
        target: "", targetKind: "channel",
        createThread: { forumChannelId: "102", title: "[a/repo#7] 기능 추가" },
        reason: "opened-pr",
      },
      calls: [],
    },
    {
      name: "issue follow-up resolved → mapped thread",
      ev: issueComment("a/repo"),
      threads: { "a/repo issues#42": "thr-42" },
      want: { target: "thr-42", targetKind: "thread", reason: "followup-resolved" },
      calls: [{ repo: "a/repo", kind: "issues", number: 42 }],
    },
    {
      name: "PR follow-up resolved → mapped thread",
      ev: prReview("a/repo"),
      threads: { "a/repo pulls#9": "thr-9" },
      want: { target: "thr-9", targetKind: "thread", reason: "followup-resolved" },
      calls: [{ repo: "a/repo", kind: "pulls", number: 9 }],
    },
    {
      name: "follow-up unresolved → admin channel",
      ev: issueComment("a/repo"),
      want: { target: "admin", targetKind: "channel", reason: "followup-unresolved" },
      calls: [{ repo: "a/repo", kind: "issues", number: 42 }],
    },
    {
      name: "CI + linked PR thread resolved → PR thread + ci-alerts notice",
      ev: ciFailed("a/repo", [17]),
      threads: { "a/repo pulls#17": "thr-17" },
      want: { target: "thr-17", targetKind: "thread", noticeChannelId: "ci-alerts", reason: "ci-linked-pr-thread" },
      calls: [{ repo: "a/repo", kind: "pulls", number: 17 }],
    },
    {
      name: "CI + linked PR thread unresolved → ci-alerts channel",
      ev: ciFailed("a/repo", [17]),
      want: { target: "ci-alerts", targetKind: "channel", reason: "ci-alerts" },
      calls: [{ repo: "a/repo", kind: "pulls", number: 17 }],
    },
    {
      name: "CI + no linked PR → ci-alerts channel, no lookup",
      ev: ciFailed("a/repo"),
      want: { target: "ci-alerts", targetKind: "channel", reason: "ci-alerts" },
      calls: [],
    },
    {
      name: "unconfigured repo → admin channel",
      ev: issueOpened("ghost/repo"),
      want: { target: "admin", targetKind: "channel", reason: "unconfigured-repo" },
      calls: [],
    },
  ];

  for (const c of cases) {
    test(c.name, async () => {
      const { calls, resolveThreadId } = stubResolver(c.threads);
      const decision = await route(c.ev, { cfg, resolveThreadId });
      expect(decision).toEqual(c.want);
      expect(calls).toEqual(c.calls ?? []);
    });
  }

  test("repos do not cross: each event uses its own forums and lookups", async () => {
    const { calls, resolveThreadId } = stubResolver({
      "a/repo issues#1": "ta-1",
      "b/repo issues#2": "tb-2",
      "a/repo pulls#3": "ta-3",
      "b/repo pulls#4": "tb-4",
    });
    expect((await route(issueOpened("a/repo", 1), { cfg, resolveThreadId })).createThread?.forumChannelId).toBe("101");
    expect((await route(issueOpened("b/repo", 2), { cfg, resolveThreadId })).createThread?.forumChannelId).toBe("201");
    expect((await route(prOpened("a/repo", 3), { cfg, resolveThreadId })).createThread?.forumChannelId).toBe("102");
    expect((await route(prOpened("b/repo", 4), { cfg, resolveThreadId })).createThread?.forumChannelId).toBe("202");
    expect((await route(issueComment("a/repo", 1), { cfg, resolveThreadId })).target).toBe("ta-1");
    expect((await route(issueComment("b/repo", 2), { cfg, resolveThreadId })).target).toBe("tb-2");
    expect((await route(prReview("a/repo", 3), { cfg, resolveThreadId })).target).toBe("ta-3");
    expect((await route(prReview("b/repo", 4), { cfg, resolveThreadId })).target).toBe("tb-4");
    expect(calls).toEqual([
      { repo: "a/repo", kind: "issues", number: 1 },
      { repo: "b/repo", kind: "issues", number: 2 },
      { repo: "a/repo", kind: "pulls", number: 3 },
      { repo: "b/repo", kind: "pulls", number: 4 },
    ]);
  });

  test("resolveThreadId throwing falls back without crashing", async () => {
    const boom = async () => {
      throw new Error("github api down");
    };
    const followup = await route(issueComment("a/repo"), { cfg, resolveThreadId: boom });
    expect(followup).toEqual({ target: "admin", targetKind: "channel", reason: "followup-unresolved" });
    const ci = await route(ciFailed("a/repo", [17]), { cfg, resolveThreadId: boom });
    expect(ci).toEqual({ target: "ci-alerts", targetKind: "channel", reason: "ci-alerts" });
  });
});

describe("gateway notice channel line (S21)", () => {
  const gatewayCfg = (url: string) =>
    ({ openclawHooksUrl: `${url}/hooks`, openclawHookToken: "tok", agentId: "stackot" }) as unknown as ReceiverConfig;

  async function captureMessage(ev: NormalizedEvent): Promise<string> {
    const { promise, resolve } = Promise.withResolvers<string>();
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        // Await the body before resolving: a fire-and-forget req.text() races
        // stop(true) and the abort surfaces as a top-level AbortError in Bun.
        const body = await req.text();
        resolve(JSON.parse(body).message);
        return Response.json({ ok: true });
      },
    });
    await forwardToGateway(gatewayCfg(server.url.origin), ev, "d1");
    server.stop(true);
    return promise;
  }

  const ciOnThread: NormalizedEvent = {
    target: "thr-17", targetKind: "thread", noticeChannelId: "ci-alerts",
    repo: "a/repo", item: "CI build", summary: "s", url: "u",
  };

  test("noticeChannelId adds a CI 알림 채널 line", async () => {
    const message = await captureMessage(ciOnThread);
    expect(message).toBe("대상 스레드: thr-17\nCI 알림 채널: ci-alerts\n\ns");
  });

  test("absent noticeChannelId leaves the message unchanged", async () => {
    const message = await captureMessage({ ...ciOnThread, noticeChannelId: undefined });
    expect(message).toBe("대상 스레드: thr-17\n\ns");
  });
});
