/**
 * Routing decision — spec.md §4 sync rules.
 *
 * Pure destination logic for normalized events: which Discord target a message
 * goes to, whether a forum thread must be created first, and whether a notice
 * channel should be named. The GitHub reverse-link lookup is injected so this
 * module never touches the network; it decides, it does not act.
 */
import type { ReceiverConfig } from "./config.ts";
import type { NormalizedEvent } from "./normalize.ts";

export type RouteDeps = {
  cfg: ReceiverConfig;
  /** Resolve repo+item to an existing Discord thread ID, or null when unmapped. */
  resolveThreadId(input: { repo: string; kind: "issues" | "pulls"; number: number }): Promise<string | null>;
};

export type RouteDecision = {
  /** Discord thread or channel ID. Empty when createThread is set. */
  target: string;
  /** "thread" (existing issue/PR thread) or "channel" (a plain channel). */
  targetKind: "thread" | "channel";
  /** Forum thread to create before delivery (opened issues/PRs). */
  createThread?: { forumChannelId: string; title: string };
  /** Channel that must also be notified (CI failure replied on a PR thread). */
  noticeChannelId?: string;
  /** Machine-readable name of the routing-table row that matched. */
  reason: string;
};

function titleFrom(ev: NormalizedEvent): string {
  const number = /#(\d+)/.exec(ev.item)?.[1] ?? "";
  const subject = /^제목: (.+)$/m.exec(ev.summary)?.[1] ?? ev.item;
  return `[${ev.repo}#${number}] ${subject}`.slice(0, 100);
}

/** A failed lookup is an unresolved lookup: log and fall through to the fallback row. */
async function lookup(deps: RouteDeps, input: { repo: string; kind: "issues" | "pulls"; number: number }): Promise<string | null> {
  try {
    return await deps.resolveThreadId(input);
  } catch (err) {
    console.warn(`mapping lookup failed for ${input.repo} ${input.kind} #${input.number}:`, err);
    return null;
  }
}

export async function route(ev: NormalizedEvent, deps: RouteDeps): Promise<RouteDecision> {
  const { cfg } = deps;
  const repoCfg = cfg.repos[ev.repo];
  if (!repoCfg) {
    // Unlisted repo: webhook pointed here but no routing configured. Admin notice.
    console.warn(`repo not configured: ${ev.repo}`);
    return { target: cfg.adminChannelId, targetKind: "channel", reason: "unconfigured-repo" };
  }

  // CI failures: reply on the linked PR thread when one resolves, else #ci-alerts.
  if (ev.item.startsWith("CI ")) {
    const pr = ev.prNumbers?.[0];
    if (pr !== undefined) {
      const threadId = await lookup(deps, { repo: ev.repo, kind: "pulls", number: pr });
      if (threadId) {
        return { target: threadId, targetKind: "thread", noticeChannelId: cfg.ciAlertsChannelId, reason: "ci-linked-pr-thread" };
      }
    }
    return { target: cfg.ciAlertsChannelId, targetKind: "channel", reason: "ci-alerts" };
  }

  // New items: create a forum thread in that repo's parent channel.
  if (ev.targetKind === "channel") {
    if (ev.item.startsWith("issue")) {
      return { target: "", targetKind: "channel", createThread: { forumChannelId: repoCfg.issuesForumChannelId, title: titleFrom(ev) }, reason: "opened-issue" };
    }
    if (ev.item.startsWith("PR")) {
      return { target: "", targetKind: "channel", createThread: { forumChannelId: repoCfg.prsForumChannelId, title: titleFrom(ev) }, reason: "opened-pr" };
    }
    return { target: ev.target, targetKind: "channel", reason: "unrouted" };
  }

  // Follow-ups: resolve the thread via the GitHub reverse link.
  const number = Number(/#(\d+)/.exec(ev.item)?.[1]);
  const kind = ev.item.startsWith("issue") ? "issues" : "pulls";
  if (Number.isInteger(number) && number > 0) {
    const threadId = await lookup(deps, { repo: ev.repo, kind, number });
    if (threadId) return { target: threadId, targetKind: "thread", reason: "followup-resolved" };
  }

  // Unresolved: never guess (spec §5). Admin notice.
  console.warn(`no thread mapping for ${ev.repo} ${ev.item}`);
  return { target: cfg.adminChannelId, targetKind: "channel", reason: "followup-unresolved" };
}
