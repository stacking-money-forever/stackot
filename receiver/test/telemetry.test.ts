/**
 * S42 unit oracle — telemetry emits one parseable JSON object per call, carries
 * the correlation fields, redacts secrets through the S39 list, and can never
 * carry event body text because the schema is a fixed whitelist.
 */
import { describe, expect, test } from "bun:test";
import { createTelemetry } from "../src/telemetry.ts";
import { REDACTED } from "../src/redact.ts";

function capture(secrets: readonly string[] = []) {
  const lines: string[] = [];
  const telemetry = createTelemetry((line) => lines.push(line), secrets);
  return { lines, telemetry };
}

function onlyLine(lines: string[]): Record<string, unknown> {
  expect(lines.length).toBe(1);
  expect(lines[0]).not.toContain("\n");
  return JSON.parse(lines[0]!) as Record<string, unknown>;
}

describe("telemetry line shape", () => {
  test("delivered emits one JSON line with event, deliveryId, attempts, target", () => {
    const { lines, telemetry } = capture();
    telemetry.delivered({ deliveryId: "d-1", attempts: 2, target: "777" });
    const obj = onlyLine(lines);
    expect(obj.event).toBe("delivery.delivered");
    expect(obj.deliveryId).toBe("d-1");
    expect(obj.attempts).toBe(2);
    expect(obj.target).toBe("777");
    expect(typeof obj.at).toBe("number");
  });

  test("failed emits nextAttemptAt and error alongside the correlation fields", () => {
    const { lines, telemetry } = capture();
    telemetry.failed({ deliveryId: "d-2", attempts: 1, error: "gateway rejected delivery (status 500)", nextAttemptAt: 1700000002000 });
    const obj = onlyLine(lines);
    expect(obj.event).toBe("delivery.failed");
    expect(obj.deliveryId).toBe("d-2");
    expect(obj.attempts).toBe(1);
    expect(obj.error).toBe("gateway rejected delivery (status 500)");
    expect(obj.nextAttemptAt).toBe(1700000002000);
  });

  test("deadLettered carries the terminal error", () => {
    const { lines, telemetry } = capture();
    telemetry.deadLettered({ deliveryId: "d-3", attempts: 5, error: "boom" });
    const obj = onlyLine(lines);
    expect(obj.event).toBe("delivery.dead_letter");
    expect(obj.deliveryId).toBe("d-3");
    expect(obj.attempts).toBe(5);
    expect(obj.error).toBe("boom");
  });

  test("routingFallback carries repo, item, and reason", () => {
    const { lines, telemetry } = capture();
    telemetry.routingFallback({ deliveryId: "d-4", repo: "owner/repo", item: "issue #9", reason: "followup-unresolved" });
    const obj = onlyLine(lines);
    expect(obj.event).toBe("routing.fallback");
    expect(obj.deliveryId).toBe("d-4");
    expect(obj.repo).toBe("owner/repo");
    expect(obj.item).toBe("issue #9");
    expect(obj.reason).toBe("followup-unresolved");
  });
});

describe("telemetry redaction", () => {
  test("secrets embedded in any string field are masked", () => {
    const secret = "hook-token-abcdef";
    const { lines, telemetry } = capture([secret]);
    telemetry.failed({ deliveryId: "d-5", attempts: 1, error: `fetch https://h/?token=${secret} failed`, nextAttemptAt: 1 });
    telemetry.delivered({ deliveryId: `id-${secret}`, attempts: 0, target: `chan-${secret}` });
    for (const line of lines) {
      expect(line).not.toContain(secret);
      expect(line).toContain(REDACTED);
    }
  });

  test("blank secrets are ignored and longer secrets mask before their prefixes", () => {
    const { lines, telemetry } = capture(["", "tok-long", "tok-longer-secret"]);
    telemetry.routingFallback({ deliveryId: "d-6", repo: "o/tok-longer-secret", item: "issue #1", reason: "unconfigured-repo" });
    const obj = onlyLine(lines);
    expect(obj.repo).toBe(`o/${REDACTED}`);
  });
});

describe("telemetry whitelist schema", () => {
  test("body/summary fields are never emitted even when passed in", () => {
    const bodyMarker = "SECRET_BODY_TEXT-9f8e7d";
    const { lines, telemetry } = capture();
    telemetry.delivered({ deliveryId: "d-7", attempts: 0, target: "1", body: bodyMarker, summary: bodyMarker } as never);
    telemetry.deadLettered({ deliveryId: "d-8", attempts: 5, error: "x", body: bodyMarker, summary: bodyMarker } as never);
    telemetry.routingFallback({ deliveryId: "d-9", repo: "r", item: "i", reason: "ci-alerts", body: bodyMarker, summary: bodyMarker } as never);
    expect(lines.length).toBe(3);
    for (const line of lines) {
      expect(line).not.toContain(bodyMarker);
      const obj = JSON.parse(line) as Record<string, unknown>;
      expect("body" in obj).toBe(false);
      expect("summary" in obj).toBe(false);
    }
  });

  test("a newline inside a field cannot break the one-line-JSON contract", () => {
    const { lines, telemetry } = capture();
    telemetry.deadLettered({ deliveryId: "d-10", attempts: 5, error: "line1\nline2" });
    const obj = onlyLine(lines);
    expect(obj.error).toBe("line1\nline2");
  });
});
