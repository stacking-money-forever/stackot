/**
 * Per-repo authorization policy — the single point that decides which
 * credential may read a repo's GitHub data.
 *
 * Every reverse-link lookup must go through `authorizeRepo`: a repo carrying
 * its own `githubToken` is served by that token only (`tokenSource: "repo"`),
 * any other configured repo falls back to the shared `cfg.githubToken`
 * (`tokenSource: "shared"`), and an unconfigured repo is denied before any
 * network access. `assertGrantForRepo` is the second line of defense: a grant
 * minted for one repo can never be spent on another, so a cross-repo call
 * path fails closed instead of silently borrowing authority.
 *
 * Pure module — no network, no storage.
 */
import type { ReceiverConfig } from "./config.ts";

/** Credential and routing context minted for exactly one repo. */
export type RepoGrant = {
  /** The repo this grant authorizes — "owner/name", bound at mint time. */
  repo: string;
  /** Token to send as the GitHub Authorization bearer for this repo only. */
  githubToken: string;
  /** "repo" when the repo carries its own token, "shared" for the global one. */
  tokenSource: "repo" | "shared";
  /** Discord forum channel ID for Issue threads of this repo. */
  issuesForumChannelId: string;
  /** Discord forum channel ID for PR threads of this repo. */
  prsForumChannelId: string;
};

export type RepoAuthorization = { allowed: true; grant: RepoGrant } | { allowed: false; reason: string };

/**
 * Decide whether `repo` may be queried and with which credential.
 * Unconfigured repos are denied without minting a grant.
 */
export function authorizeRepo(cfg: ReceiverConfig, repo: string): RepoAuthorization {
  const rc = cfg.repos[repo];
  if (!rc) return { allowed: false, reason: "unconfigured-repo" };
  const own = typeof rc.githubToken === "string" && rc.githubToken.trim() !== "" ? rc.githubToken : null;
  return {
    allowed: true,
    grant: {
      repo,
      githubToken: own ?? cfg.githubToken,
      tokenSource: own ? "repo" : "shared",
      issuesForumChannelId: rc.issuesForumChannelId,
      prsForumChannelId: rc.prsForumChannelId,
    },
  };
}

/** Refuse to spend a grant on a repo it was not minted for. */
export function assertGrantForRepo(grant: RepoGrant, repo: string): void {
  if (grant.repo !== repo) {
    throw new Error(`repo grant for "${grant.repo}" cannot authorize "${repo}"`);
  }
}
