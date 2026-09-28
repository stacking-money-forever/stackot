/** Observation only: original fetch/request/response pass through unchanged. */
import {appendFileSync} from 'node:fs';
const original = globalThis.fetch;
const endpoint = process.env.S47_NATIVE_HOOK_URL;
const output = process.env.S47_ADMISSION_RECEIPT;
if (!endpoint || !output || !/^http:\/\/127\.0\.0\.1:\d+\/hooks\/agent$/.test(endpoint)) {
  throw new Error('S47 observation binding missing');
}
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const response = await original(input, init);
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url === endpoint && init?.method === 'POST') {
    try {
      const data = await response.clone().json() as {ok?:unknown;runId?:unknown};
      const key = new Headers(init.headers).get('Idempotency-Key');
      if (response.status === 200 && data.ok === true && typeof data.runId === 'string' &&
          /^[0-9a-f-]{36}$/.test(data.runId) && key?.startsWith('stackot-')) {
        appendFileSync(output, JSON.stringify({deliveryId:key.slice(8), status:response.status,
          ok:true, runId:data.runId, realNetworkResponse:true}) + '\n', {mode:0o600});
      }
    } catch {
      // Observation failure never changes production fetch behavior/ACK.
    }
  }
  return response;
}) as typeof fetch;
