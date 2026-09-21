/**
 * Thread mapping — spec.md §3 title convention.
 *
 * Forward direction is implicit: forum thread title is "[owner/repo#123] …".
 * Reverse lookup resolves repo+number → thread ID by scanning the GitHub item
 * body and comments for a Discord thread URL the bot recorded earlier.
 */
import type { ReceiverConfig } from "./config.ts";

/** Trust inputs for the reverse-link check — the two ReceiverConfig keys. */
export type BacklinkTrust = Pick<ReceiverConfig, "discordGuildId" | "githubBacklinkLogin">;

export function threadTitle(repo: string, number: number, title: string): string {
  const t = `[${repo}#${number}] ${title}`.slice(0, 100);
  return t;
}

export type GitHubItem = {
  body: string | null;
  /** Login of the item's author (GitHub `user.login`); absent when unknown. */
  author?: string | null;
  comments: {
    body: string;
    /** Login of the comment's author (GitHub `user.login`); absent when unknown. */
    author?: string | null;
  }[];
};

function isRecorder(author: string | null | undefined, login: string): boolean {
  return typeof author === "string" && author.toLowerCase() === login.toLowerCase();
}

/**
 * Extract the thread ID recorded in the item body or its comments, if any.
 *
 * A URL counts only when its guild segment equals `discordGuildId` exactly AND
 * the containing text was written by the `githubBacklinkLogin` account
 * (case-insensitive) — anything else is a forged backlink and ignored.
 */
export function findThreadId(item: GitHubItem, trust: BacklinkTrust): string | null {
  const urlRe = new RegExp(`https://discord\\.com/channels/${trust.discordGuildId}/(\\d+)`);
  const texts = [
    { text: item.body ?? "", author: item.author },
    ...item.comments.map((c) => ({ text: c.body, author: c.author })),
  ];
  for (const { text, author } of texts) {
    if (!isRecorder(author, trust.githubBacklinkLogin)) continue;
    const m = urlRe.exec(text);
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
  type ApiUser = { login?: string | null } | null;
  type ApiComment = { body?: string | null; user?: ApiUser };
  const toComment = (c: ApiComment) => ({ body: c.body ?? "", author: c.user?.login ?? null });
  const item = (await itemRes.json()) as { body?: string | null; user?: ApiUser };
  const result: GitHubItem = {
    body: item.body ?? null,
    author: item.user?.login ?? null,
    comments: commentsRes.ok ? ((await commentsRes.json()) as ApiComment[]).map(toComment) : [],
  };

  // Follow the server-provided rel="next" chain until the thread URL appears or
  // the page cap is hit — never guess a page parameter.
  const maxPages = opts.maxCommentPages ?? MAX_COMMENT_PAGES;
  let next = commentsRes.ok ? nextPageUrl(commentsRes.headers.get("link")) : null;
  for (let pages = 1; next && pages < maxPages && !findThreadId(result, cfg); pages++) {
    const pageRes = await fetch(next, { headers });
    if (!pageRes.ok) break;
    result.comments.push(...((await pageRes.json()) as ApiComment[]).map(toComment));
    next = nextPageUrl(pageRes.headers.get("link"));
  }
  return result;
}

