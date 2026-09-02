/**
 * Stackot Receiver configuration.
 *
 * Loaded from STACKOT_CONFIG (JSON) or default ./config.json next to the
 * package. Every field is required unless noted — fail fast at startup.
 */
export type ReceiverConfig = {
  /** Bind address. Keep 127.0.0.1 when the reverse proxy runs on the same host. */
  host: string;
  /** Bind port. */
  port: number;
  /** GitHub webhook secret — used for X-Hub-Signature-256 verification. */
  githubWebhookSecret: string;
  /** OpenClaw Gateway hooks endpoint, e.g. http://127.0.0.1:18789/hooks */
  openclawHooksUrl: string;
  /** hooks.token configured in openclaw.json (sent as Bearer). */
  openclawHookToken: string;
  /** GitHub token with repo read scope — used for reverse-link mapping lookups. */
  githubToken: string;
  /** Discord thread IDs the receiver is allowed to route to (allowlist). */
  allowedThreadIds: string[];
  /** Discord channel ID of the #issues forum (thread creation target). */
  issuesForumChannelId: string;
  /** Discord channel ID of the #pull-requests forum. */
  prsForumChannelId: string;
  /** Discord channel ID of #ci-alerts. */
  ciAlertsChannelId: string;
  /** Discord channel ID of #stackot-admin. */
  adminChannelId: string;
  /** OpenClaw agentId that owns the Stackot skill. */
  agentId: string;
};

export async function loadConfig(): Promise<ReceiverConfig> {
  const path = process.env.STACKOT_CONFIG ?? new URL("../config.json", import.meta.url).pathname;
  const file = Bun.file(path);
  if (!file.exists()) {
    throw new Error(`config not found: ${path}`);
  }
  const cfg = JSON.parse(await file.text()) as ReceiverConfig;
  const required: (keyof ReceiverConfig)[] = [
    "openclawHooksUrl",
    "openclawHookToken",
    "githubToken",
    "issuesForumChannelId",
    "prsForumChannelId",
    "ciAlertsChannelId",
    "adminChannelId",
    "agentId",
  ];
  for (const key of required) {
    if (!cfg[key]) throw new Error(`config missing: ${key}`);
  }
  cfg.host ??= "127.0.0.1";
  cfg.port ??= 9377;
  return cfg;
}
