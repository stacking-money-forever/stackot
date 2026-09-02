import { describe, expect, test } from "bun:test";
import { verifySignature, Dedupe } from "../src/verify.ts";

function sign(secret: string, body: string): string {
  const mac = new Bun.CryptoHasher("sha256", secret);
  mac.update(body);
  return `sha256=${mac.digest("hex")}`;
}

describe("verifySignature", () => {
  const secret = "test-secret";
  const body = '{"action":"opened"}';

  test("accepts valid signature", () => {
    expect(verifySignature(secret, new TextEncoder().encode(body), sign(secret, body))).toBe(true);
  });

  test("rejects wrong signature", () => {
    expect(verifySignature(secret, new TextEncoder().encode(body), sign("other", body))).toBe(false);
  });

  test("rejects missing or malformed header", () => {
    expect(verifySignature(secret, new TextEncoder().encode(body), null)).toBe(false);
    expect(verifySignature(secret, new TextEncoder().encode(body), "sha1=abc")).toBe(false);
    expect(verifySignature(secret, new TextEncoder().encode(body), "sha256=")).toBe(false);
  });

  test("rejects tampered body", () => {
    const sig = sign(secret, body);
    expect(verifySignature(secret, new TextEncoder().encode(body + "x"), sig)).toBe(false);
  });
});

describe("Dedupe", () => {
  test("first sight true, duplicate false", () => {
    const tmp = `${import.meta.dir}/.dedupe-test.sqlite`;
    try {
      const d = new Dedupe(tmp);
      expect(d.first("d1")).toBe(true);
      expect(d.first("d1")).toBe(false);
      expect(d.first("d2")).toBe(true);
      d.close();
    } finally {
      void Bun.file(tmp).delete();
    }
  });

  test("empty id passes through", () => {
    const tmp = `${import.meta.dir}/.dedupe-test2.sqlite`;
    try {
      const d = new Dedupe(tmp);
      expect(d.first("")).toBe(true);
      expect(d.first("")).toBe(true);
      d.close();
    } finally {
      void Bun.file(tmp).delete();
    }
  });
});
