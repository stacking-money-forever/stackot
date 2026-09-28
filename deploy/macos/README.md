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

Owned labels: `me.justn.stackot.{receiver,gateway,ingress,tunnel}`. Install
plists under `~/Library/LaunchAgents` for login startup, then use
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
