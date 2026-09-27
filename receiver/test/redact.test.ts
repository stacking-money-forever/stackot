import { describe, expect, test } from "bun:test";
import { describeError, REDACTED, redact, redactSecrets } from "../src/redact.ts";
import type { ReceiverConfig } from "../src/config.ts";

const cfg: ReceiverConfig = {
  host: "127.0.0.1",
  port: 9377,
  githubWebhookSecret: "webhook-secret",
  openclawHooksUrl: "http://127.0.0.1:18789/hooks",
  openclawHookToken: "hook-token",
  githubToken: "ghp_token",
  discordGuildId: "111",
  githubBacklinkLogin: "stackot-bot",
  repos: { "owner/repo": { issuesForumChannelId: "101", prsForumChannelId: "102" } },
  ciAlertsChannelId: "103",
  adminChannelId: "104",
  agentId: "stackot",
};

describe("redact", () => {
  test("replaces a single occurrence of one secret", () => {
    expect(redact("failed to reach abc123 endpoint", ["abc123"])).toBe(`failed to reach ${REDACTED} endpoint`);
  });

  test("replaces every occurrence of one secret", () => {
    expect(redact("tok leaked tok again tok", ["tok"])).toBe(`${REDACTED} leaked ${REDACTED} again ${REDACTED}`);
  });

  test("masks each secret when several are mixed in one text", () => {
    const out = redact("alpha SECRET_ONE beta SECRET_TWO gamma", ["SECRET_ONE", "SECRET_TWO"]);
    expect(out).toBe(`alpha ${REDACTED} beta ${REDACTED} gamma`);
  });

  test("applies the longer secret first when secrets overlap", () => {
    // If the short secret ran first, "secret-extra" would degrade to
    // "[redacted]-extra" — leaving the fragment "-extra" and a partial leak.
    expect(redact("token is secret-extra", ["secret", "secret-extra"])).toBe(`token is ${REDACTED}`);
  });

  test("ignores empty and whitespace-only secrets", () => {
    const text = "nothing should change";
    expect(redact(text, ["", "   ", "\t\n"])).toBe(text);
  });

  test("returns the input unchanged when the secret list is empty", () => {
    expect(redact("keep me", [])).toBe("keep me");
  });

  test("returns the input unchanged when no secret appears in it", () => {
    expect(redact("plain error: connection refused", ["abc123"])).toBe("plain error: connection refused");
  });

  test("masks secrets across multiline text", () => {
    const out = redact("line one tok\nline two\ntok line three\n", ["tok"]);
    expect(out).toBe(`line one ${REDACTED}\nline two\n${REDACTED} line three\n`);
  });

  test("matches literally, not as a regex", () => {
    expect(redact("value a.b end", ["a.b"])).toBe(`value ${REDACTED} end`);
    expect(redact("value axb end", ["a.b"])).toBe("value axb end");
  });
});

describe("redactSecrets", () => {
  test("includes the webhook secret, hook token, and github token", () => {
    const secrets = redactSecrets(cfg);
    expect(secrets).toContain("webhook-secret");
    expect(secrets).toContain("hook-token");
    expect(secrets).toContain("ghp_token");
  });

  test("includes the hooks URL so query/userinfo credentials are masked", () => {
    expect(redactSecrets(cfg)).toContain("http://127.0.0.1:18789/hooks");
  });
});

describe("describeError", () => {
  test("masks secrets carried on error properties, not just the message", () => {
    // Bun's fetch failure: message is clean, but `path` holds the request URL.
    const error = Object.assign(new TypeError("Unable to connect."), {
      path: "http://127.0.0.1:1/hooks?token=hook-token/agent",
      code: "ConnectionRefused",
    });
    const out = describeError(error, redactSecrets(cfg));
    expect(out).not.toContain("hook-token");
    expect(out).toContain(REDACTED);
  });

  test("handles non-Error thrown values", () => {
    expect(describeError("raw hook-token string", redactSecrets(cfg))).toBe(`raw ${REDACTED} string`);
  });
});
