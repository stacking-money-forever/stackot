import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const validRepos = {
  repos: {
    "owner/one": { issuesForumChannelId: "101", prsForumChannelId: "102" },
    "owner/two": { issuesForumChannelId: "201", prsForumChannelId: "202" },
  },
};

async function writeConfig(body: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "stackot-cfg-"));
  const path = join(dir, "config.json");
  await Bun.write(path, JSON.stringify(body));
  return path;
}

const base = {
  githubWebhookSecret: "s",
  openclawHooksUrl: "http://127.0.0.1:18789/hooks",
  openclawHookToken: "t",
  githubToken: "g",
  ciAlertsChannelId: "103",
  adminChannelId: "104",
  agentId: "stackot",
  ...validRepos,
};

// loadConfig caches nothing, but STACKOT_CONFIG is read per call — set it
// per test rather than importing with cache-busting queries.
import { loadConfig } from "../src/config.ts";

async function loadConfigWith(path: string) {
  process.env.STACKOT_CONFIG = path;
  return loadConfig();
}

describe("loadConfig", () => {
  test("accepts multi-repo config with defaults", async () => {
    const path = await writeConfig(base);
    const cfg = await loadConfigWith(path);
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.port).toBe(9377);
    expect(Object.keys(cfg.repos)).toHaveLength(2);
    expect(cfg.repos["owner/two"]!.issuesForumChannelId).toBe("201");
  });

  test("rejects missing repos", async () => {
    const path = await writeConfig({ ...base, repos: undefined });
    await expect(loadConfigWith(path)).rejects.toThrow("repos");
  });

  test("rejects empty repos", async () => {
    const path = await writeConfig({ ...base, repos: {} });
    await expect(loadConfigWith(path)).rejects.toThrow("at least one");
  });

  test("rejects repo entry missing forum channel", async () => {
    const path = await writeConfig({ ...base, repos: { "owner/x": { issuesForumChannelId: "1" } } });
    await expect(loadConfigWith(path)).rejects.toThrow("owner/x");
  });

  test("rejects malformed repo key", async () => {
    const path = await writeConfig({ ...base, repos: { "justname": { issuesForumChannelId: "1", prsForumChannelId: "2" } } });
    await expect(loadConfigWith(path)).rejects.toThrow("owner/name");
  });

  test("rejects missing shared fields", async () => {
    const { agentId: _drop, ...rest } = base;
    const path = await writeConfig(rest);
    await expect(loadConfigWith(path)).rejects.toThrow("agentId");
  });
});
