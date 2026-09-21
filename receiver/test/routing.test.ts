import { describe, expect, test } from "bun:test";
import { normalize } from "../src/normalize.ts";

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
