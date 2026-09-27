/**
 * GitHub API fetch with Retry-After compliance.
 *
 * A plain `fetch` turns a GitHub 429 into an instant failure, and a naive retry
 * loop turns it into a burst that deepens the limit. Here the `Retry-After`
 * header is the authority: each rate-limited response is answered by exactly
 * one delayed retry, sequentially, with no added backoff.
 */
export type GithubFetchOptions = {
  /** Extra attempts after the first rate-limited response (default 2). */
  maxRetries?: number;
  /** Upper bound on a single instructed wait (default 60_000 ms). */
  maxRetryAfterMs?: number;
  /** Injectable delay — tests observe waits without a real clock. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock for HTTP-date Retry-After values. */
  now?: () => number;
};

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_RETRY_AFTER_MS = 60_000;
const DEFAULT_WAIT_MS = 1_000;

function isRateLimited(res: Response): boolean {
  if (res.status === 429) return true;
  // GitHub also signals primary/secondary limits with 403 + remaining: 0.
  return res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0";
}

/**
 * Interpret `Retry-After` as milliseconds. Delta-seconds and HTTP-date are both
 * accepted; an absent or unparseable value falls back to a safe default wait.
 */
export function retryAfterMs(res: Response, now: () => number = Date.now): number {
  const raw = res.headers.get("retry-after")?.trim();
  if (!raw) return DEFAULT_WAIT_MS;
  if (/^\d+$/.test(raw)) return Number(raw) * 1000;
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.max(0, date - now());
  return DEFAULT_WAIT_MS;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `fetch` that honors `Retry-After` on 429 (and rate-limited 403) responses.
 *
 * Retries are sequential, capped at `opts.maxRetries`, and each wait is capped
 * at `opts.maxRetryAfterMs`. When retries are exhausted the last response is
 * returned as-is — the caller decides what a still-limited response means.
 */
export async function githubFetch(
  url: string,
  init: RequestInit,
  opts: GithubFetchOptions = {},
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const maxRetryAfterMs = opts.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;

  let response = await fetch(url, init);
  for (let attempt = 0; attempt < maxRetries && isRateLimited(response); attempt++) {
    const waitMs = Math.min(retryAfterMs(response, now), maxRetryAfterMs);
    // Release the dropped response's connection before waiting.
    await response.body?.cancel().catch(() => {});
    await sleep(waitMs);
    response = await fetch(url, init);
  }
  return response;
}
