import { describe, expect, test } from "bun:test";
import { normalize } from "../src/normalize.ts";
import { threadTitle, findThreadId } from "../src/mapping.ts";

const repo = { full_name: "example/app" };

describe("normalize", () => {
  test("issue opened → channel target with createThread marker", () => {
    const ev = normalize(
      "issues",
      repo,
      "opened",
      { issue: { number: 42, title: "로그인 오류", html_url: "https://github.com/example/app/issues/42", body: "재현 단계…", state: "open" } },
    );
    expect(ev).not.toBeNull();
    expect(ev!.targetKind).toBe("channel");
    expect(ev!.item).toBe("issue #42");
    expect(ev!.summary).toContain("issue #42 opened");
    expect(ev!.summary).toContain("신뢰할 수 없는 데이터");
  });

  test("issue labeled (uninteresting action) → null", () => {
    const ev = normalize("issues", repo, "labeled", { issue: { number: 1, title: "t", html_url: "u" } });
    expect(ev).toBeNull();
  });

  test("issue comment → thread target", () => {
    const ev = normalize(
      "issue_comment",
      repo,
      "created",
      { issue: { number: 42, title: "t", html_url: "u" }, comment: { user: { login: "justn" }, body: "확인 부탁", html_url: "u2" } },
    );
    expect(ev!.targetKind).toBe("thread");
    expect(ev!.summary).toContain("justn");
  });

  test("PR closed merged → merged tail", () => {
    const ev = normalize("pull_request", repo, "closed", {
      pull_request: { number: 7, title: "fix", html_url: "u", state: "closed", merged: true },
    });
    expect(ev!.summary).toContain("(merged)");
  });

  test("failed check_run → channel target", () => {
    const ev = normalize("check_run", repo, "completed", {
      check_run: { name: "build", status: "completed", conclusion: "failure", html_url: "u3" },
    });
    expect(ev!.item).toContain("CI");
    expect(ev!.summary).toContain("failure");
  });

  test("successful check_run → null", () => {
    const ev = normalize("check_run", repo, "completed", {
      check_run: { name: "build", status: "completed", conclusion: "success", html_url: "u3" },
    });
    expect(ev).toBeNull();
  });
});

describe("mapping", () => {
  test("threadTitle clamps to 100 chars", () => {
    const long = "제".repeat(120);
    const t = threadTitle("example/app", 42, long);
    expect(t.length).toBeLessThanOrEqual(100);
    expect(t.startsWith("[example/app#42]")).toBe(true);
  });

  test("findThreadId reads body first, then comments", () => {
    const inBody = findThreadId({ body: "작업실: https://discord.com/channels/111/222", comments: [] });
    expect(inBody).toBe("222");
    const inComment = findThreadId({ body: null, comments: [{ body: "https://discord.com/channels/111/333" }] });
    expect(inComment).toBe("333");
    expect(findThreadId({ body: null, comments: [] })).toBeNull();
  });
});
