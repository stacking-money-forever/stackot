/**
 * Webhook ingress helpers.
 *
 * requireDeliveryId extracts the X-GitHub-Delivery header GitHub sets on every
 * webhook delivery. The ID is returned verbatim (untrimmed); missing, empty,
 * or whitespace-only values are rejected.
 */

export function requireDeliveryId(headers: Headers): string {
  const id = headers.get("X-GitHub-Delivery");
  if (id === null || id.trim() === "") {
    throw new Error("Missing or empty X-GitHub-Delivery header");
  }
  return id;
}

export class PayloadTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Request body exceeds limit of ${maxBytes} bytes`);
    this.name = "PayloadTooLargeError";
  }
}

export async function readBodyWithinLimit(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    throw new RangeError(`maxBytes must be a non-negative finite number, got ${maxBytes}`);
  }
  if (stream === null) return new Uint8Array(0);

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > maxBytes) {
        throw new PayloadTooLargeError(maxBytes);
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
