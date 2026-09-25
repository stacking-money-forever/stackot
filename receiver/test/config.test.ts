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
  discordGuildId: "999888777666",
  githubBacklinkLogin: "stackot-bot",
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

  const invalidForumChannelIds: Record<string, unknown> = {
    missing: undefined,
    "empty string": "",
    "whitespace-only string": " \t\n ",
    number: 1234567890,
    boolean: true,
    null: null,
    object: { channel: "1" },
    array: ["1"],
    "single placeholder": "<FORUM_CHANNEL_ID>",
    "padded placeholder": "  <forum-id>  ",
  };
  for (const [label, value] of Object.entries(invalidForumChannelIds)) {
    test(`rejects repos issuesForumChannelId: ${label}`, async () => {
      const path = await writeConfig({
        ...base,
        repos: { "owner/x": { issuesForumChannelId: value, prsForumChannelId: "202" } },
      });
      await expect(loadConfigWith(path)).rejects.toThrow('repos["owner/x"].issuesForumChannelId');
    });
    test(`rejects repos prsForumChannelId: ${label}`, async () => {
      const path = await writeConfig({
        ...base,
        repos: { "owner/x": { issuesForumChannelId: "201", prsForumChannelId: value } },
      });
      await expect(loadConfigWith(path)).rejects.toThrow('repos["owner/x"].prsForumChannelId');
    });
  }

  test("rejects repo entry where both forum channel IDs are placeholders", async () => {
    const path = await writeConfig({
      ...base,
      repos: { "owner/x": { issuesForumChannelId: "<ISSUES_FORUM>", prsForumChannelId: "<PRS_FORUM>" } },
    });
    await expect(loadConfigWith(path)).rejects.toThrow('repos["owner/x"].issuesForumChannelId');
  });

  test("error names the offending repo and key among multiple repos", async () => {
    const path = await writeConfig({
      ...base,
      repos: {
        "owner/one": { issuesForumChannelId: "101", prsForumChannelId: "102" },
        "owner/two": { issuesForumChannelId: "201", prsForumChannelId: "<PRS_FORUM>" },
      },
    });
    await expect(loadConfigWith(path)).rejects.toThrow('repos["owner/two"].prsForumChannelId');
  });

  test("accepts real-looking forum channel IDs and non-single-placeholder brackets", async () => {
    for (const value of ["1234567890", "<a><b>", "123<456>"]) {
      const path = await writeConfig({
        ...base,
        repos: { "owner/x": { issuesForumChannelId: value, prsForumChannelId: value } },
      });
      const cfg = await loadConfigWith(path);
      expect(cfg.repos["owner/x"]!.issuesForumChannelId).toBe(value);
      expect(cfg.repos["owner/x"]!.prsForumChannelId).toBe(value);
    }
  });

  test("accepts a per-repo githubToken", async () => {
    const path = await writeConfig({
      ...base,
      repos: {
        "owner/one": { issuesForumChannelId: "101", prsForumChannelId: "102", githubToken: "ghp_repo_one" },
        "owner/two": { issuesForumChannelId: "201", prsForumChannelId: "202" },
      },
    });
    const cfg = await loadConfigWith(path);
    expect(cfg.repos["owner/one"]!.githubToken).toBe("ghp_repo_one");
    expect(cfg.repos["owner/two"]!.githubToken).toBeUndefined();
  });

  test("config without per-repo githubToken still passes (regression)", async () => {
    const path = await writeConfig(base);
    const cfg = await loadConfigWith(path);
    expect(cfg.repos["owner/one"]!.githubToken).toBeUndefined();
    expect(cfg.githubToken).toBe("g");
  });

  const invalidRepoTokens: Record<string, unknown> = {
    "empty string": "",
    "whitespace-only string": " \t\n ",
    number: 12345,
    boolean: true,
    null: null,
    object: { token: "x" },
    array: ["x"],
    "single placeholder": "<GITHUB_TOKEN>",
    "padded placeholder": "  <repo-token>  ",
  };
  for (const [label, githubToken] of Object.entries(invalidRepoTokens)) {
    test(`rejects repos githubToken: ${label}`, async () => {
      const path = await writeConfig({
        ...base,
        repos: { "owner/x": { issuesForumChannelId: "201", prsForumChannelId: "202", githubToken } },
      });
      await expect(loadConfigWith(path)).rejects.toThrow('repos["owner/x"].githubToken');
    });
  }

  test("accepts a per-repo githubToken with brackets that is not a single placeholder", async () => {
    for (const githubToken of ["ghp_abc<def>", "<a><b>"]) {
      const path = await writeConfig({
        ...base,
        repos: { "owner/x": { issuesForumChannelId: "201", prsForumChannelId: "202", githubToken } },
      });
      const cfg = await loadConfigWith(path);
      expect(cfg.repos["owner/x"]!.githubToken).toBe(githubToken);
    }
  });

  test("per-repo githubToken error names the offending repo", async () => {
    const path = await writeConfig({
      ...base,
      repos: {
        "owner/one": { issuesForumChannelId: "101", prsForumChannelId: "102" },
        "owner/two": { issuesForumChannelId: "201", prsForumChannelId: "202", githubToken: "<TOKEN>" },
      },
    });
    await expect(loadConfigWith(path)).rejects.toThrow('repos["owner/two"].githubToken');
  });

  test("rejects missing shared fields", async () => {
    const { agentId: _drop, ...rest } = base;
    const path = await writeConfig(rest);
    await expect(loadConfigWith(path)).rejects.toThrow("agentId");
  });

  const invalidSecrets: Record<string, unknown> = {
    missing: undefined,
    null: null,
    "empty string": "",
    "whitespace-only string": " \t\n ",
    number: 12345,
    boolean: true,
    object: { nested: true },
  };
  for (const [label, secret] of Object.entries(invalidSecrets)) {
    test(`rejects githubWebhookSecret: ${label}`, async () => {
      const path = await writeConfig({ ...base, githubWebhookSecret: secret });
      await expect(loadConfigWith(path)).rejects.toThrow("githubWebhookSecret");
    });
  }

  test("preserves githubWebhookSecret bytes verbatim", async () => {
    const path = await writeConfig({ ...base, githubWebhookSecret: "  padded-secret\t" });
    const cfg = await loadConfigWith(path);
    expect(cfg.githubWebhookSecret).toBe("  padded-secret\t");
  });

  test("rejects githubWebhookSecret that is an angle-bracket placeholder after trim", async () => {
    for (const secret of ["<WEBHOOK_SECRET>", "  <anything>\t"]) {
      const path = await writeConfig({ ...base, githubWebhookSecret: secret });
      await expect(loadConfigWith(path)).rejects.toThrow("githubWebhookSecret");
    }
  });

  test("accepts githubWebhookSecret containing angle brackets as ordinary text", async () => {
    const path = await writeConfig({ ...base, githubWebhookSecret: "real-secret<with>brackets" });
    const cfg = await loadConfigWith(path);
    expect(cfg.githubWebhookSecret).toBe("real-secret<with>brackets");
  });

  test("rejects placeholder openclawHookToken", async () => {
    const path = await writeConfig({ ...base, openclawHookToken: "  <HOOK_TOKEN>  " });
    await expect(loadConfigWith(path)).rejects.toThrow("openclawHookToken");
  });

  test("accepts openclawHookToken containing angle brackets", async () => {
    const path = await writeConfig({ ...base, openclawHookToken: "real<tok>en" });
    const cfg = await loadConfigWith(path);
    expect(cfg.openclawHookToken).toBe("real<tok>en");

    const wrapped = await writeConfig({ ...base, openclawHookToken: "<a><b>" });
    const cfg2 = await loadConfigWith(wrapped);
    expect(cfg2.openclawHookToken).toBe("<a><b>");
  });

  test("rejects githubToken that is a single placeholder", async () => {
    const path = await writeConfig({ ...base, githubToken: "  <your-token-here>  " });
    await expect(loadConfigWith(path)).rejects.toThrow("githubToken");
  });

  test("accepts githubToken containing brackets as non-placeholder", async () => {
    const path = await writeConfig({ ...base, githubToken: "ghp_abc<def>" });
    const cfg = await loadConfigWith(path);
    expect(cfg.githubToken).toBe("ghp_abc<def>");
  });

  test("accepts githubToken '<a><b>' as non-placeholder", async () => {
    const path = await writeConfig({ ...base, githubToken: "<a><b>" });
    const cfg = await loadConfigWith(path);
    expect(cfg.githubToken).toBe("<a><b>");
  });

  test("rejects ciAlertsChannelId <...> placeholder", async () => {
    const path = await writeConfig({ ...base, ciAlertsChannelId: "  <ci-alerts>  " });
    await expect(loadConfigWith(path)).rejects.toThrow("ciAlertsChannelId");
  });

  test("accepts ciAlertsChannelId containing brackets as non-placeholder", async () => {
    const path = await writeConfig({ ...base, ciAlertsChannelId: "123<456>" });
    const cfg = await loadConfigWith(path);
    expect(cfg.ciAlertsChannelId).toBe("123<456>");

    const wrapped = await writeConfig({ ...base, ciAlertsChannelId: "<a><b>" });
    const cfg2 = await loadConfigWith(wrapped);
    expect(cfg2.ciAlertsChannelId).toBe("<a><b>");
  });

  test("rejects adminChannelId placeholder", async () => {
    for (const adminChannelId of ["<admin-channel-id>", "  <123>  "]) {
      const path = await writeConfig({ ...base, adminChannelId });
      await expect(loadConfigWith(path)).rejects.toThrow("adminChannelId");
    }
  });

  test("accepts adminChannelId with brackets that is not a single placeholder", async () => {
    const path = await writeConfig({ ...base, adminChannelId: "<a><b>" });
    const cfg = await loadConfigWith(path);
    expect(cfg.adminChannelId).toBe("<a><b>");
  });

  test("rejects agentId placeholder and blank values", async () => {
    for (const agentId of ["<stackot-agent>", "  <AGENT_ID>  ", "   "]) {
      const path = await writeConfig({ ...base, agentId });
      await expect(loadConfigWith(path)).rejects.toThrow("agentId");
    }
  });

  test("accepts agentId with brackets that is not a single placeholder", async () => {
    const path = await writeConfig({ ...base, agentId: "<a><b>" });
    const cfg = await loadConfigWith(path);
    expect(cfg.agentId).toBe("<a><b>");
  });

  test("preserves boundary ports 1 and 65535", async () => {
    for (const port of [1, 65535]) {
      const path = await writeConfig({ ...base, port });
      const cfg = await loadConfigWith(path);
      expect(cfg.port).toBe(port);
    }
  });

  const invalidPorts: Record<string, unknown> = {
    zero: 0,
    negative: -1,
    "above max": 65536,
    fractional: 9377.5,
    string: "9377",
    boolean: true,
    null: null,
    object: { port: 9377 },
    array: [9377],
  };
  for (const [label, port] of Object.entries(invalidPorts)) {
    test(`rejects port: ${label}`, async () => {
      const path = await writeConfig({ ...base, port });
      await expect(loadConfigWith(path)).rejects.toThrow("port");
    });
  }

  const invalidHooksUrls: Record<string, unknown> = {
    missing: undefined,
    null: null,
    "empty string": "",
    "whitespace-only string": " \t\n ",
    "leading space": " http://127.0.0.1:18789/hooks",
    "trailing tab": "http://127.0.0.1:18789/hooks\t",
    "relative path": "/hooks",
    "no scheme": "example.com/hooks",
    "bare host:port": "127.0.0.1:18789/hooks",
    "scheme-like non-http": "localhost:18789/hooks",
    malformed: "http://",
    "ftp protocol": "ftp://127.0.0.1:18789/hooks",
    "file protocol": "file:///etc/passwd",
    number: 12345,
    boolean: true,
    object: { url: "http://127.0.0.1:18789/hooks" },
    array: ["http://127.0.0.1:18789/hooks"],
  };
  for (const [label, url] of Object.entries(invalidHooksUrls)) {
    test(`rejects openclawHooksUrl: ${label}`, async () => {
      const path = await writeConfig({ ...base, openclawHooksUrl: url });
      await expect(loadConfigWith(path)).rejects.toThrow("openclawHooksUrl");
    });
  }

  test("preserves valid http loopback and https hooks URLs byte-for-byte", async () => {
    const urls = [
      "http://127.0.0.1:18789/hooks",
      "http://localhost:18789/hooks?x=1#frag",
      "https://gw.internal.example.com:8443/hooks/path?q=a%20b",
    ];
    for (const url of urls) {
      const path = await writeConfig({ ...base, openclawHooksUrl: url });
      const cfg = await loadConfigWith(path);
      expect(cfg.openclawHooksUrl).toBe(url);
    }
  });

  const invalidGuildIds: Record<string, unknown> = {
    missing: undefined,
    null: null,
    "empty string": "",
    "whitespace-only string": " \t\n ",
    placeholder: "<DISCORD_GUILD_ID>",
    "padded placeholder": "  <guild-id>  ",
    "non-numeric": "guild-123",
    "mixed alphanumeric": "123abc",
    "decimal string": "123.45",
    "padded digits": " 123456789 ",
    number: 123456789,
    boolean: true,
  };
  for (const [label, discordGuildId] of Object.entries(invalidGuildIds)) {
    test(`rejects discordGuildId: ${label}`, async () => {
      const path = await writeConfig({ ...base, discordGuildId });
      await expect(loadConfigWith(path)).rejects.toThrow("discordGuildId");
    });
  }

  test("accepts a long numeric discordGuildId verbatim", async () => {
    const path = await writeConfig({ ...base, discordGuildId: "1234567890123456789" });
    const cfg = await loadConfigWith(path);
    expect(cfg.discordGuildId).toBe("1234567890123456789");
  });

  const invalidBacklinkLogins: Record<string, unknown> = {
    missing: undefined,
    null: null,
    "empty string": "",
    "whitespace-only string": " \t\n ",
    placeholder: "<BACKLINK_LOGIN>",
    "padded placeholder": "  <bot-login>  ",
    "with space": "stackot bot",
    "with @": "@stackot-bot",
    "with slash": "org/bot",
    number: 42,
    boolean: false,
  };
  for (const [label, githubBacklinkLogin] of Object.entries(invalidBacklinkLogins)) {
    test(`rejects githubBacklinkLogin: ${label}`, async () => {
      const path = await writeConfig({ ...base, githubBacklinkLogin });
      await expect(loadConfigWith(path)).rejects.toThrow("githubBacklinkLogin");
    });
  }

  test("accepts regular and app-style githubBacklinkLogin values", async () => {
    for (const githubBacklinkLogin of ["stackot-bot", "StackotBot", "stackot-app[bot]"]) {
      const path = await writeConfig({ ...base, githubBacklinkLogin });
      const cfg = await loadConfigWith(path);
      expect(cfg.githubBacklinkLogin).toBe(githubBacklinkLogin);
    }
  });
});
