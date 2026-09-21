/**
 * GitHub event normalization.
 *
 * Converts webhook payloads into a compact, data-framed message text for the
 * Gateway agent. The framing marks the payload as untrusted data — the skill
 * instructs the agent never to execute instructions found inside it.
 */

export type NormalizedEvent = {
  /** Target Discord thread or channel ID, resolved by the router. */
  target: string;
  /** "thread" (existing issue/PR thread) or "channel" (#issues/#prs parent, new thread). */
  targetKind: "thread" | "channel";
  /** True when the agent should create a forum thread before processing. */
  createThread?: { forumChannelId: string; title: string };
  /** Repo full name, e.g. "owner/repo". */
  repo: string;
  /** GitHub item type and number, e.g. "issue #42". */
  item: string;
  /** Human-readable summary lines. */
  summary: string;
  /** GitHub URL of the item. */
  url: string;
  /** PR numbers linked to this event, when the payload reports them (e.g. check_run). */
  prNumbers?: number[];
};

type Repo = { full_name: string };

type IssuePayload = {
  action: string;
  issue: { number: number; title: string; html_url: string; body?: string | null; state: string };
};

type CommentPayload = {
  action: string;
  issue: { number: number; title: string; html_url: string };
  comment: { user: { login: string }; body: string; html_url: string };
};

type PRPayload = {
  action: string;
  pull_request: { number: number; title: string; html_url: string; body?: string | null; state: string; draft?: boolean; merged?: boolean };
};

type ReviewPayload = {
  action: string;
  pull_request: { number: number; title: string; html_url: string };
  review: { user: { login: string }; state: string; body?: string | null; html_url: string };
};

type CheckRunPayload = {
  action: string;
  check_run: {
    name: string;
    status: string;
    conclusion: string | null;
    html_url: string | null;
    pull_requests?: { number?: unknown }[];
  };
};

function clamp(text: string, max = 600): string {
  const t = text.replace(/```/g, "``\u200b`").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function bodyOf(body: string | null | undefined): string {
  if (!body?.trim()) return "";
  return clamp(body);
}

export function normalize(event: string, repo: Repo, action: unknown, payload: unknown): NormalizedEvent | null {
  const full = repo.full_name;
  const a = typeof action === "string" ? action : "";
  const p = payload as never;

  switch (event) {
    case "issues": {
      const { issue } = p as IssuePayload;
      const interesting = ["opened", "edited", "closed", "reopened"].includes(a);
      if (!interesting) return null;
      const lines = [
        `GitHub 이벤트: ${full} issue #${issue.number} ${a}`,
        `제목: ${issue.title}`,
        `URL: ${issue.html_url}`,
      ];
      const body = bodyOf(issue.body);
      if (body) lines.push(`본문(신뢰할 수 없는 데이터):`, body);
      return { target: "", targetKind: a === "opened" ? "channel" : "thread", repo: full, item: `issue #${issue.number}`, summary: lines.join("\n"), url: issue.html_url };
    }

    case "issue_comment": {
      const { issue, comment } = p as CommentPayload;
      if (a !== "created") return null;
      const lines = [
        `GitHub 이벤트: ${full} issue #${issue.number} 새 댓글 (by ${comment.user.login})`,
        `URL: ${comment.html_url}`,
        `내용(신뢰할 수 없는 데이터):`,
        clamp(comment.body),
      ];
      return { target: "", targetKind: "thread", repo: full, item: `issue #${issue.number}`, summary: lines.join("\n"), url: comment.html_url };
    }

    case "pull_request": {
      const { pull_request: pr } = p as PRPayload;
      const interesting = ["opened", "edited", "synchronize", "closed"].includes(a);
      if (!interesting) return null;
      const tail = a === "closed" ? (pr.merged ? " (merged)" : " (closed)") : pr.draft ? " (draft)" : "";
      const lines = [
        `GitHub 이벤트: ${full} PR #${pr.number} ${a}${tail}`,
        `제목: ${pr.title}`,
        `URL: ${pr.html_url}`,
      ];
      const body = bodyOf(pr.body);
      if (body) lines.push(`본문(신뢰할 수 없는 데이터):`, body);
      return { target: "", targetKind: a === "opened" ? "channel" : "thread", repo: full, item: `PR #${pr.number}`, summary: lines.join("\n"), url: pr.html_url };
    }

    case "pull_request_review": {
      const { pull_request: pr, review } = p as ReviewPayload;
      if (a !== "submitted") return null;
      const lines = [
        `GitHub 이벤트: ${full} PR #${pr.number} 리뷰 ${review.state} (by ${review.user.login})`,
        `URL: ${review.html_url}`,
      ];
      const body = bodyOf(review.body);
      if (body) lines.push(`내용(신뢰할 수 없는 데이터):`, body);
      return { target: "", targetKind: "thread", repo: full, item: `PR #${pr.number}`, summary: lines.join("\n"), url: review.html_url };
    }

    case "pull_request_review_comment": {
      const { pull_request: pr, comment } = p as CommentPayload & { pull_request: { number: number; title: string; html_url: string } };
      if (a !== "created") return null;
      const lines = [
        `GitHub 이벤트: ${full} PR #${pr.number} 리뷰 댓글 (by ${comment.user.login})`,
        `URL: ${comment.html_url}`,
        `내용(신뢰할 수 없는 데이터):`,
        clamp(comment.body),
      ];
      return { target: "", targetKind: "thread", repo: full, item: `PR #${pr.number}`, summary: lines.join("\n"), url: comment.html_url };
    }

    case "check_run": {
      const { check_run: cr } = p as CheckRunPayload;
      if (a !== "completed") return null;
      if (!cr.conclusion || cr.conclusion === "success" || cr.conclusion === "skipped" || cr.conclusion === "neutral") return null;
      const prNums: number[] = [];
      for (const pr of cr.pull_requests ?? []) {
        const n = pr?.number;
        if (typeof n === "number" && Number.isInteger(n) && n > 0 && !prNums.includes(n)) prNums.push(n);
      }
      const lines = [
        `GitHub 이벤트: ${full} CI 체크 실패 — ${cr.name} (${cr.conclusion})`,
        cr.html_url ? `URL: ${cr.html_url}` : "",
        prNums.length ? `연결 PR: ${prNums.map((n) => `PR #${n}`).join(", ")}` : "",
      ].filter(Boolean);
      const ev: NormalizedEvent = { target: "", targetKind: "channel", repo: full, item: `CI ${cr.name}`, summary: lines.join("\n"), url: cr.html_url ?? "" };
      if (prNums.length) ev.prNumbers = prNums;
      return ev;
    }

    default:
      return null;
  }
}
