import { describe, expect, test } from "bun:test";
import { authorizeRepo, assertGrantForRepo, type RepoGrant } from "../src/repo-policy.ts";
import type { ReceiverConfig } from "../src/config.ts";

const cfg = {
  githubToken: "shared-token",
  repos: {
    "owner/a": { issuesForumChannelId: "a-issues", prsForumChannelId: "a-prs", githubToken: "token-a" },
    "owner/b": { issuesForumChannelId: "b-issues", prsForumChannelId: "b-prs", githubToken: "token-b" },
    "owner/c": { issuesForumChannelId: "c-issues", prsForumChannelId: "c-prs" },
  },
} as unknown as ReceiverConfig;

function grantFor(repo: string): RepoGrant {
  const auth = authorizeRepo(cfg, repo);
  if (!auth.allowed) throw new Error(`expected grant for ${repo}`);
  return auth.grant;
}

describe("authorizeRepo", () => {
  test("two repos with their own tokens get their own token each", () => {
    const a = grantFor("owner/a");
    const b = grantFor("owner/b");
    expect(a.githubToken).toBe("token-a");
    expect(a.tokenSource).toBe("repo");
    expect(b.githubToken).toBe("token-b");
    expect(b.tokenSource).toBe("repo");
    expect(a.githubToken).not.toBe(b.githubToken);
    expect(a.repo).toBe("owner/a");
    expect(b.repo).toBe("owner/b");
  });

  test("a repo without its own token falls back to the shared token", () => {
    const c = grantFor("owner/c");
    expect(c.githubToken).toBe("shared-token");
    expect(c.tokenSource).toBe("shared");
    expect(c.repo).toBe("owner/c");
  });

  test("an unconfigured repo is denied and mints no grant", () => {
    const auth = authorizeRepo(cfg, "owner/unknown");
    expect(auth.allowed).toBe(false);
    if (auth.allowed) throw new Error("grant must not exist for an unconfigured repo");
    expect(auth.reason).toBe("unconfigured-repo");
  });

  test("each grant carries that repo's own forum channel IDs", () => {
    const a = grantFor("owner/a");
    const b = grantFor("owner/b");
    const c = grantFor("owner/c");
    expect(a.issuesForumChannelId).toBe("a-issues");
    expect(a.prsForumChannelId).toBe("a-prs");
    expect(b.issuesForumChannelId).toBe("b-issues");
    expect(b.prsForumChannelId).toBe("b-prs");
    expect(c.issuesForumChannelId).toBe("c-issues");
    expect(c.prsForumChannelId).toBe("c-prs");
  });
});

describe("assertGrantForRepo", () => {
  test("a grant may be spent on the repo it was minted for", () => {
    expect(() => assertGrantForRepo(grantFor("owner/a"), "owner/a")).not.toThrow();
    expect(() => assertGrantForRepo(grantFor("owner/b"), "owner/b")).not.toThrow();
    expect(() => assertGrantForRepo(grantFor("owner/c"), "owner/c")).not.toThrow();
  });

  test("a grant for repo A is refused for repo B, and vice versa", () => {
    const a = grantFor("owner/a");
    const b = grantFor("owner/b");
    expect(() => assertGrantForRepo(a, "owner/b")).toThrow();
    expect(() => assertGrantForRepo(b, "owner/a")).toThrow();
  });

  test("a shared-token grant is still bound to its own repo", () => {
    const c = grantFor("owner/c");
    expect(() => assertGrantForRepo(c, "owner/a")).toThrow();
    expect(() => assertGrantForRepo(grantFor("owner/a"), "owner/c")).toThrow();
  });
});
