/**
 * S41 unit oracle — the judgment functions behind /healthz, /readyz, /status.
 *
 * Core contract: Gateway reachability is an operational signal, never an
 * intake gate. readiness() answers only the outbox question; a dead Gateway
 * shows up exclusively in statusReport() as "degraded" with a masked error.
 */
import { describe, expect, test } from "bun:test";
import { createGatewayHealth, liveness, readiness, statusReport } from "../src/health.ts";

function unreachable() {
  const gw = createGatewayHealth();
  gw.recordFailure("connect ECONNREFUSED 127.0.0.1:1");
  return gw;
}

describe("liveness", () => {
  test("is 200 for every outbox/Gateway combination", () => {
    for (const outboxReady of [true, false]) {
      for (const gateway of [createGatewayHealth(), unreachable()]) {
        const res = liveness(outboxReady, gateway);
        expect(res.status).toBe(200);
        expect(res.body).toBe("ok");
      }
    }
  });
});

describe("readiness", () => {
  test("is 503 when the outbox is not ready, whatever the Gateway state", () => {
    for (const gateway of [createGatewayHealth(), unreachable()]) {
      const res = readiness(false, gateway);
      expect(res.status).toBe(503);
      expect(res.body).toBe("outbox unavailable");
    }
  });

  test("is 200 when the outbox is ready even while the Gateway is unreachable", () => {
    const res = readiness(true, unreachable());
    expect(res.status).toBe(200);
    expect(res.body).toBe("ready");
  });

  test("is 200 when both the outbox and the Gateway are healthy", () => {
    const res = readiness(true, createGatewayHealth());
    expect(res.status).toBe(200);
    expect(res.body).toBe("ready");
  });
});

describe("statusReport", () => {
  test("initial state (no attempt yet) is ok and distinct from a failure state", () => {
    const report = statusReport(true, createGatewayHealth());
    expect(report.status).toBe("ok");
    expect(report.outboxReady).toBe(true);
    expect(report.gateway.reachable).toBe(true);
    expect(report.gateway.lastError).toBeNull();
    expect(report.gateway.lastSuccessAt).toBeNull();
  });

  test("a recorded failure degrades the report and carries the error", () => {
    const gateway = createGatewayHealth();
    gateway.recordFailure("connect ECONNREFUSED 127.0.0.1:1");
    const report = statusReport(true, gateway);
    expect(report.status).toBe("degraded");
    expect(report.gateway.reachable).toBe(false);
    expect(report.gateway.lastError).toBe("connect ECONNREFUSED 127.0.0.1:1");
  });

  test("an unreachable Gateway never makes readiness fail while status shows degraded", () => {
    const gateway = unreachable();
    expect(readiness(true, gateway).status).toBe(200);
    expect(statusReport(true, gateway).status).toBe("degraded");
  });

  test("a success returns the report to ok and stamps lastSuccessAt", () => {
    const gateway = createGatewayHealth();
    gateway.recordFailure("connect ECONNREFUSED 127.0.0.1:1");
    gateway.recordSuccess();
    const report = statusReport(true, gateway);
    expect(report.status).toBe("ok");
    expect(report.gateway.reachable).toBe(true);
    expect(report.gateway.lastError).toBeNull();
    expect(report.gateway.lastSuccessAt).toBeGreaterThan(0);
  });

  test("outbox not ready is also reported as degraded", () => {
    const report = statusReport(false, createGatewayHealth());
    expect(report.status).toBe("degraded");
    expect(report.outboxReady).toBe(false);
  });

  test("recordFailure masks configured secrets out of lastError", () => {
    const gateway = createGatewayHealth(["s41-unit-hook-token"]);
    gateway.recordFailure("POST http://127.0.0.1:1/hooks?key=s41-unit-hook-token failed");
    const report = statusReport(true, gateway);
    expect(report.gateway.lastError).not.toContain("s41-unit-hook-token");
    expect(report.gateway.lastError).toContain("[redacted]");
  });
});
