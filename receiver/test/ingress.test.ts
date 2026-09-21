import { describe, expect, test } from "bun:test";
import { PayloadTooLargeError, readBodyWithinLimit, requireDeliveryId } from "../src/ingress.ts";

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

const enc = new TextEncoder();

describe("readBodyWithinLimit", () => {
  test("null stream returns empty bytes", async () => {
    const body = await readBodyWithinLimit(null, 1024);
    expect(body).toBeInstanceOf(Uint8Array);
    expect(body.byteLength).toBe(0);
  });
  test("accumulates chunks up to the exact limit", async () => {
    const body = await readBodyWithinLimit(streamOf(enc.encode("abc"), enc.encode("de"), enc.encode("f")), 6);
    expect(new TextDecoder().decode(body)).toBe("abcdef");
    expect(body.byteLength).toBe(6);
  });
  test("throws PayloadTooLargeError when a chunk would exceed the limit", async () => {
    const promise = readBodyWithinLimit(streamOf(enc.encode("abc"), enc.encode("defg")), 6);
    await expect(promise).rejects.toBeInstanceOf(PayloadTooLargeError);
    await expect(promise).rejects.toThrow("exceeds");
  });
  test("rejects negative or non-finite maxBytes with RangeError", async () => {
    await expect(readBodyWithinLimit(null, -1)).rejects.toBeInstanceOf(RangeError);
    await expect(readBodyWithinLimit(null, Number.NaN)).rejects.toBeInstanceOf(RangeError);
    await expect(readBodyWithinLimit(null, Number.POSITIVE_INFINITY)).rejects.toBeInstanceOf(RangeError);
  });
});

describe("requireDeliveryId", () => {
  test("returns the delivery id and rejects missing or blank headers", () => {
    expect(requireDeliveryId(new Headers({ "X-GitHub-Delivery": "d-1" }))).toBe("d-1");
    expect(() => requireDeliveryId(new Headers())).toThrow("Missing or empty");
    expect(() => requireDeliveryId(new Headers({ "X-GitHub-Delivery": "  " }))).toThrow("Missing or empty");
  });
});
