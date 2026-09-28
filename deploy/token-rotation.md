# B08 hook credential rotation — owner drill observed, acceptance pending CI

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

Owner drill uses actual native software with all tools denied, ACP absent,
deliver=false and private state. No production Gateway activation or user bot
token reset; no credential-store extraction/copy. Controlled traffic must be
labeled separately from genuine GitHub-origin events. Source/CI/live receipts
are required;4 credential-file tests and the fake-Gateway integration test are S only.

## Procedure

1. Configure the optional absolute `openclawHookTokenFile` and create its
   operator-owned regular JSON file with mode0600 before receiver startup.
   Keep the mandatory bootstrap token valid. Never put credentials in Git or
   shell arguments. Test a signed supported event and its committed DB row.
2. Generate a new credential privately. Atomically replace the pinned native
   Gateway config's `hooks.token` while retaining its other settings. Wait for
   actual old-Bearer401 and new-Bearer200 plus runId; config-write completion
   alone does not prove the reload. Verify the actual Gateway listener PID.
3. Atomically replace the credential JSON with version1/new token, retaining
   mode0600. The running receiver reads it immediately before each forward.
   In the brief mismatch window, supported intake stays committed and failed
   forwards remain pending. Change the file promptly before retry exhaustion.
4. Check receiver/Gateway listener PIDs are unchanged, every accepted probe row
   is delivered, and old/new values appear in neither logs nor DB errors. A
   malformed/missing credential file must keep the queue pending without using
   the retired bootstrap value. Restore a valid current file to resume drain.
   If Gateway rejects the new credential, restore its previously verified
   config first and its matching private file second, then recheck admission.

## Actual owner evidence

`docs/verification/b08-built-result.json` records the owned Mac drill:
real native Gateway36477 and receiver36910 remained unchanged; old token401,
new token200/runId, one observed pending401 attempt before replacement, three
supported signed intake rows each ACK200 with an existing DB row, all drained.
Both values were absent from logs/DB errors and owned listeners closed.
The receiver bundle SHA256 is recorded in that receipt; private state/logs
remain at its privateRoot. The drill rebuilt the receiver from recorded source
hashes before launching and checked those files stayed unchanged. Earlier
weaker and failed receipts are retained.

This is actual token/hook-admission and durable-intake evidence on the selected
host using controlled signed traffic. It is not genuine GitHub-origin delivery,
production token activation, model completion, Discord or worker completion,
or human QA. Production Gateway settings were unchanged.
