/**
 * Secret redaction for log output and stored error text.
 *
 * Config secrets must never reach operator stderr or the outbox `last_error`
 * column in raw form. Bun's fetch errors carry the request URL on a `path`
 * property (and other failure modes put URLs in the message), so a hook token
 * embedded in `openclawHooksUrl` — a shape operators commonly use — leaks on
 * every delivery failure. Everything that logs or rethrows an error routes it
 * through `describeError`/`redact` with `redactSecrets(cfg)` first.
 */
import { inspect } from "node:util";
import type { ReceiverConfig } from "./config.ts";

/** Fixed replacement token — its presence proves masking ran. */
export const REDACTED = "[redacted]";

/**
 * Replace every occurrence of each secret in `text` with the fixed token.
 *
 * Blank secrets (empty or whitespace-only) are ignored — replacing "" would
 * shred the text. Longer secrets are applied first so a short secret that is a
 * prefix of a longer one cannot leave a recoverable fragment behind.
 */
export function redact(text: string, secrets: readonly string[]): string {
  const active = secrets.filter((s) => s.trim() !== "").sort((a, b) => b.length - a.length);
  let out = text;
  for (const secret of active) out = out.split(secret).join(REDACTED);
  return out;
}

/**
 * The config values treated as secrets for masking.
 *
 * `openclawHooksUrl` is included deliberately: it can legitimately carry
 * credentials in userinfo or query parameters that the token fields above
 * never see, and it is exactly what fetch errors echo back.
 */
export function redactSecrets(cfg: ReceiverConfig): string[] {
  const repoTokens = Object.values(cfg.repos ?? {})
    .map((rc) => rc?.githubToken)
    .filter((t): t is string => typeof t === "string");
  return [cfg.githubWebhookSecret, cfg.openclawHookToken, cfg.githubToken, cfg.openclawHooksUrl, ...repoTokens];
}

/**
 * Render a thrown value as log/store-safe text.
 *
 * For Errors the full inspect dump is used — not just `.message` — because the
 * sensitive data lives on extra properties (fetch puts the request URL on
 * `path`, which `.message` alone would silently drop instead of mask). The
 * dump is then passed through `redact`, so callers can log or persist the
 * result without leaking raw secrets.
 */
export function describeError(error: unknown, secrets: readonly string[]): string {
  const text = error instanceof Error ? inspect(error) : String(error);
  return redact(text, secrets);
}
