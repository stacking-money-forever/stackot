# macOS host deployment

The owner selected this Mac and `stackot.justn.me` on 2026-09-28. This is an
alternative to `deploy/vm`, not evidence of a Linux systemd installation.

Dedicated Cloudflare tunnel → loopback Caddy `9378` → loopback receiver `9377`.
The public path is exactly `/stackot/webhook`, rewritten to `/webhook`.
All other paths return 404. Cloudflare terminates public HTTPS; local Caddy
uses HTTP and does not request an ACME certificate. Gateway `18789` remains
loopback-only and is never a tunnel ingress target.

Private runtime root: `~/Library/Application Support/Stackot` (0700). Keep
credentials/config 0600 outside Git. Render with `render.py --help`; validate
Caddy, tunnel ingress and plists before loading. `gateway-run.py` belongs in
the runtime `bin` directory; compatible pinned Node and OpenClaw packages go
in `runtime/node` and `runtime/packages`. Gateway's own state is isolated from
the user's default OpenClaw state. Never copy personal authentication stores.

Put exact-SHA receiver build in `releases/<SHA>/receiver/server.js`; `current`
points to that release. Configure real Discord forum/operations IDs and real
secrets in `config/receiver.json`. Missing assets block activation; do not
substitute text channels or fake IDs. Bootstrap-only Gateway has hooks disabled
until the reviewed live controller configuration is ready.

Owned labels: `me.justn.stackot.{receiver,gateway,ingress,tunnel}`. Initial login
installation puts plists under `~/Library/LaunchAgents`, then uses
`launchctl bootstrap gui/$(id -u) <absolute-plist>`.
Inspect `launchctl print gui/$(id -u)/me.justn.stackot.<service>`.
KeepAlive and ThrottleInterval=10 supervise crashes. GUI-domain LaunchAgents
require this user to be logged in; they do not promise pre-login reboot recovery.
Do not reboot the shared Mac merely to produce evidence.

Verify each owned process PID changes after SIGKILL and the listener/health
returns; verify unsigned public POST returns 401 and other paths 404. Host-local
requests to the public hostname prove the edge route from this host, not an
independent off-host private-port scan. Preserve that distinction in receipts.
GitHub automatic retry is not an availability assumption; retain delivery IDs
for explicit redelivery. Full S44 acceptance still needs actual reboot recovery;
full S45 needs independent external boundary evidence.

For boot-time execution before this user logs in, `install-system.py --plan`
validates the exact four system targets and preserves old login plists. Actual
installation requires local administrator authentication and runs each job as
`--user justn`, never as root. It neither reboots nor changes other services.
Then use `probe.py --domain system` for owned crash recovery. A real reboot drill
and any FileVault unlock requirement remain separate evidence.

## Current system installation and pending reboot drill

On 2026-09-29 the administrator-authenticated installer completed. All four
root-owned 0644 plists are under `/Library/LaunchDaemons`, registered in the
`system` domain with `UserName=justn`, and actually run with uid501. Old login
plists were preserved as `.plist.disabled`; there are no duplicate GUI jobs.
The owner's `probe.py --domain system` killed and observed recovery of each
service. Public unrelated paths returned404 and unsigned webhook POST401.
The bound approval flow stayed at revision12, with model/worker runs0.
See `docs/verification/s44-system-owner.md` and its JSON receipts.

The real reboot oracle is still pending. Before an explicitly scheduled reboot,
preserve the baseline boot time, installed release, approval flow/revision and
queue counts from `s44-system-installed.json`. After reboot, require a changed
`sysctl -n kern.boottime`, four running system jobs with uid501, receiver ready,
Gateway reachable, unchanged persisted flow and a working public route. Observe
the public route from an independent machine while this Mac is at the login
screen if claiming pre-login availability. Record whether FileVault unlock or
user login was needed; success after login alone cannot prove unattended boot.
Do not reset grants, requeue old dead letters, enable worker dispatch or change
FileVault for this drill. Preserve any failure and recover only these owned jobs
using their installed plists; retain the `.disabled` originals.
