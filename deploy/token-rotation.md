# B08 hook credential rotation — implementation in progress, NOT ACCEPT

Existing deployed receiver keeps ingress independent of Gateway forwarding.
Optional `openclawHookTokenFile` points at an absolute operator-owned private
JSON file `{ "version": 1, "token": "<actual private token>" }`. The placeholder
above is documentation only and is rejected by startup. The legacy config token
is still mandatory and validated; adding a reference never makes blank/missing
credentials acceptable. File failure never falls back to retired credentials.

File open is nonblocking/no-follow, regular-file owner-only permissions checked
on the same descriptor, read bounded to4096bytes, exact version/token schema.
The token is loaded immediately before each forward and registered in the same
live secret-mask array used by logs, health, telemetry and outbox before network.
Both prior/current values remain masked. One request's copied config avoids
cross-delivery mutation; incoming HMAC/GitHub credentials are unchanged.

Pinned OpenClaw2026.9.6 config-reload-plan-D9XO5ks7.mjs classifies prefixhooks as
hot with reloadHooks. This is source evidence only; an actual same-PID reload,
old Bearer401/new Bearer200+runId and continuous receiver intake/drain must be
observed before acceptance. deliver=false suppresses Gateway outbound delivery,
not token authentication. No token fingerprint endpoint is required.

Owner drill will use actual native software with all tools denied, ACP absent,
deliver=false and private state. No production Gateway activation or user bot
token reset; no credential-store extraction/copy. Controlled traffic must be
labeled separately from genuine GitHub-origin events. Source/CI/live receipts
are required;3 credential-file tests and legacy config checks are S only.

Actual rotation procedure and runtime receipts remain unfinished. Do not change
production token files based on this preparation document alone.
