/**
 * Thread mapping — spec.md §3 title convention.
 *
 * Forward direction is implicit: forum thread title is "[owner/repo#123] …".
 * Reverse lookup resolves repo+number → thread ID by scanning the GitHub item
 * body and comments for a Discord thread URL the bot recorded earlier.
 */
import type { ReceiverConfig } from "./config.ts";

const THREAD_URL_RE = /https:\/\/discord\.com\/channels\/\d+\/(\d+)/;

export function threadTitle(repo: string, number: number, title: string): string {
  const t = `[${repo}#${number}] ${title}`.slice(0, 100);
  return t;
}

export type GitHubItem = {
  body: string | null;
  comments: { body: string }[];
};

/** Extract the thread ID recorded in the item body or its comments, if any. */
export function findThreadId(item: GitHubItem): string | null {
  const texts = [item.body ?? "", ...item.comments.map((c) => c.body)];
  for (const text of texts) {
    const m = THREAD_URL_RE.exec(text);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Hard cap on comment pages fetched per item, so a long thread URL search stays bounded. */
export const MAX_COMMENT_PAGES = 10;

/** Pull the `rel="next"` URL out of a GitHub `Link` header, if present. */
function nextPageUrl(link: string | null): string | null {
  if (!link) return null;
  for (const entry of link.split(",")) {
    const m = /^\s*<([^>]+)>\s*;\s*rel="next"\s*$/.exec(entry);
    if (m?.[1]) return m[1];
  }
  return null;
}

/**
 * Fetch an issue/PR with its comments, for reverse-link resolution.
 *
 * GitHub serves a PR's general discussion comments on the issues surface
 * (`/issues/{n}/comments`); `/pulls/{n}/comments` is the inline review-comment
 * surface, where the bot never records thread URLs. The item body itself comes
 * from the surface that actually provides it (`/pulls/{n}` for PRs).
 */
export async function fetchItem(
  cfg: ReceiverConfig,
  repo: string,
  kind: "issues" | "pulls",
  number: number,
  opts: { apiBase?: string; maxCommentPages?: number } = {},
): Promise<GitHubItem> {
  const base = `${opts.apiBase ?? "https://api.github.com"}/repos/${repo}`;
  const commentsKind = kind === "pulls" ? "issues" : kind;
  const headers = {
    Authorization: `Bearer ${cfg.githubToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const [itemRes, commentsRes] = await Promise.all([
    fetch(`${base}/${kind}/${number}`, { headers }),
    fetch(`${base}/${commentsKind}/${number}/comments?per_page=20`, { headers }),
  ]);
  if (!itemRes.ok) throw new Error(`github api ${itemRes.status} for ${repo} ${kind} #${number}`);
  const item = (await itemRes.json()) as { body?: string | null };
  const result: GitHubItem = {
    body: item.body ?? null,
    comments: commentsRes.ok ? ((await commentsRes.json()) as { body: string }[]) : [],
  };

  // Follow the server-provided rel="next" chain until the thread URL appears or
  // the page cap is hit — never guess a page parameter.
  const maxPages = opts.maxCommentPages ?? MAX_COMMENT_PAGES;
  let next = commentsRes.ok ? nextPageUrl(commentsRes.headers.get("link")) : null;
  for (let pages = 1; next && pages < maxPages && !findThreadId(result); pages++) {
    const pageRes = await fetch(next, { headers });
    if (!pageRes.ok) break;
    result.comments.push(...((await pageRes.json()) as { body: string }[]));
    next = nextPageUrl(pageRes.headers.get("link"));
  }
  return result;
}

