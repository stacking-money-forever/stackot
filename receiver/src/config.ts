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
  if (!cfg.repos || typeof cfg.repos !== "object" || Object.keys(cfg.repos).length === 0) {
    throw new Error("config missing: repos (at least one owner/name entry)");
  }
  for (const [repo, rc] of Object.entries(cfg.repos)) {
    if (!rc.issuesForumChannelId || !rc.prsForumChannelId) {
      throw new Error(`config repos["${repo}"] missing issuesForumChannelId or prsForumChannelId`);
    }
    if (!/^[^/]+\/[^/]+$/.test(repo)) {
      throw new Error(`config repos key "${repo}" must be owner/name`);
    }
  }
  cfg.host ??= "127.0.0.1";
  cfg.port ??= 9377;
  return cfg;
}
