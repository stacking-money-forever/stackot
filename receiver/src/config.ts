/**
 * Stackot Receiver configuration.
 *
 * Loaded from STACKOT_CONFIG (JSON) or default ./config.json next to the
 * package. Every field is required unless noted — fail fast at startup.
 */
export type RepoConfig = {
  /** Discord forum channel ID for Issue threads. */
  issuesForumChannelId: string;
  /** Discord forum channel ID for PR threads. */
  prsForumChannelId: string;
  /**
   * Optional per-repo GitHub token for reverse-link lookups. When set it is
   * the only token that may authorize this repo's GitHub reads; when absent
   * the shared `githubToken` applies.
   */
  githubToken?: string;
};

export type ReceiverConfig = {
  /** Bind address. Keep 127.0.0.1 when the reverse proxy runs on the same host. */
  host: string;
  /** Bind port. */
  port: number;
  /**
   * GitHub webhook secret — used for X-Hub-Signature-256 verification. One
   * secret covers every repo whose webhooks point at this receiver.
   */
  githubWebhookSecret: string;
  /** OpenClaw Gateway hooks endpoint, e.g. http://127.0.0.1:18789/hooks */
  openclawHooksUrl: string;
  /** hooks.token configured in openclaw.json (sent as Bearer). */
  openclawHookToken: string;
  /** GitHub token with repo read scope — used for reverse-link mapping lookups. */
  githubToken: string;
  /**
   * Discord guild (server) ID — a Discord thread URL counts as a backlink only
   * when its guild segment equals this value exactly.
   */
  discordGuildId: string;
  /**
   * GitHub login of the recorder account that writes backlink thread URLs —
   * the only author whose links are trusted (matched case-insensitively).
   */
  githubBacklinkLogin: string;
  /**
   * Per-repo Discord routing. Key is "owner/name" exactly as GitHub sends it
   * in repository.full_name. Events from unlisted repos are dropped (404-equivalent).
   */
  repos: Record<string, RepoConfig>;
  /** Discord channel ID of #ci-alerts (shared across repos). */
  ciAlertsChannelId: string;
  /** Discord channel ID of #stackot-admin (shared across repos). */
  adminChannelId: string;
  /** OpenClaw agentId that owns the Stackot skill. */
  agentId: string;
};

export async function loadConfig(): Promise<ReceiverConfig> {
  const path = process.env.STACKOT_CONFIG ?? new URL("../config.json", import.meta.url).pathname;
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`config not found: ${path}`);
  }
  const cfg = JSON.parse(await file.text()) as ReceiverConfig;
  const required = ["openclawHooksUrl", "openclawHookToken", "githubToken", "ciAlertsChannelId", "adminChannelId", "agentId"] as const;
  for (const key of required) {
    if (!cfg[key]) throw new Error(`config missing: ${key}`);
  }
  if (typeof cfg.githubWebhookSecret !== "string" || cfg.githubWebhookSecret.trim() === "") {
    throw new Error("config missing: githubWebhookSecret (non-empty string required)");
  }
  if (/^<[^<>]*>$/.test(cfg.githubWebhookSecret.trim())) {
    throw new Error("config invalid: githubWebhookSecret is an angle-bracket placeholder; set a real secret");
  }
  if (/^<[^<>]*>$/.test(cfg.openclawHookToken.trim())) {
    throw new Error("config openclawHookToken is an unfilled placeholder like <HOOK_TOKEN> — set the real hooks.token value");
  }
  if (/^<[^<>]*>$/.test(cfg.githubToken.trim())) {
    throw new Error("config githubToken is still a <...> placeholder");
  }
  if (/^<[^<>]*>$/.test(cfg.ciAlertsChannelId.trim())) {
    throw new Error("config ciAlertsChannelId must be a real channel ID, not a <...> placeholder");
  }
  if (typeof cfg.adminChannelId === "string" && /^<[^<>]*>$/.test(cfg.adminChannelId.trim())) {
    throw new Error("config adminChannelId must be a real channel ID, not a <...> placeholder");
  }
  if (typeof cfg.discordGuildId !== "string" || cfg.discordGuildId.trim() === "") {
    throw new Error("config missing: discordGuildId (non-empty numeric string required)");
  }
  if (/^<[^<>]*>$/.test(cfg.discordGuildId.trim())) {
    throw new Error("config invalid: discordGuildId is an angle-bracket placeholder; set the real guild ID");
  }
  if (!/^\d+$/.test(cfg.discordGuildId)) {
    throw new Error(`config discordGuildId must be a numeric guild ID, got: ${JSON.stringify(cfg.discordGuildId)}`);
  }
  if (typeof cfg.githubBacklinkLogin !== "string" || cfg.githubBacklinkLogin.trim() === "") {
    throw new Error("config missing: githubBacklinkLogin (non-empty GitHub login required)");
  }
  if (/^<[^<>]*>$/.test(cfg.githubBacklinkLogin.trim())) {
    throw new Error("config invalid: githubBacklinkLogin is an angle-bracket placeholder; set the recorder account login");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,38}(\[bot\])?$/.test(cfg.githubBacklinkLogin)) {
    throw new Error(`config githubBacklinkLogin must be a GitHub login (alphanumeric/hyphen/underscore, optional [bot] suffix), got: ${JSON.stringify(cfg.githubBacklinkLogin)}`);
  }
  if (typeof cfg.openclawHooksUrl !== "string" || cfg.openclawHooksUrl.trim() === "") {
    throw new Error("config openclawHooksUrl must be a non-blank absolute http(s) URL");
  }
  if (cfg.openclawHooksUrl !== cfg.openclawHooksUrl.trim()) {
    throw new Error("config openclawHooksUrl must not have leading or trailing whitespace");
  }
  let hooksProtocol: string;
  try {
    hooksProtocol = new URL(cfg.openclawHooksUrl).protocol;
  } catch {
    throw new Error(`config openclawHooksUrl must be an absolute http(s) URL, got: ${JSON.stringify(cfg.openclawHooksUrl)}`);
  }
  if (hooksProtocol !== "http:" && hooksProtocol !== "https:") {
    throw new Error(`config openclawHooksUrl protocol must be http: or https:, got: ${hooksProtocol}`);
  }
  if (!cfg.repos || typeof cfg.repos !== "object" || Object.keys(cfg.repos).length === 0) {
    throw new Error("config missing: repos (at least one owner/name entry)");
  }
  for (const [repo, rc] of Object.entries(cfg.repos)) {
    for (const key of ["issuesForumChannelId", "prsForumChannelId"] as const) {
      const value = rc?.[key];
      if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`config repos["${repo}"].${key} must be a non-empty channel ID string`);
      }
      if (/^<[^<>]*>$/.test(value.trim())) {
        throw new Error(`config repos["${repo}"].${key} is an unfilled <...> placeholder — set the real forum channel ID`);
      }
    }
    if (rc?.githubToken !== undefined) {
      if (typeof rc.githubToken !== "string" || rc.githubToken.trim() === "") {
        throw new Error(`config repos["${repo}"].githubToken must be a non-empty string when set`);
      }
      if (/^<[^<>]*>$/.test(rc.githubToken.trim())) {
        throw new Error(`config repos["${repo}"].githubToken is an unfilled <...> placeholder — set the real token or remove the key`);
      }
    }
    if (!/^[^/]+\/[^/]+$/.test(repo)) {
      throw new Error(`config repos key "${repo}" must be owner/name`);
    }
  }
  cfg.host ??= "127.0.0.1";
  if (cfg.port === undefined) {
    cfg.port = 9377;
  } else if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) {
    throw new Error(`config port must be an integer in range 1-65535, got: ${JSON.stringify(cfg.port)}`);
  }
  return cfg;
}
