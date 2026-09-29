# Stackot runtime VM — artifacts and runbook

**What this is.** The repository-local preparation for running Stackot on a
single Proxmox KVM guest: a cloud-init file, systemd units, a Caddy ingress
config, a backup script plus timer, and an environment template.

**What this is not.** Deployment evidence. Every ledger row these files serve
(S44 service supervision, S45 HTTPS/Gateway boundary, S47 restore drill, S48
rollback drill, and the M2 runtime rows behind them) stays **open** until the
commands below have been run on the VM and their outputs recorded. A committed
unit file proves nothing about a running service.

S26 adds Gateway-side pending approval storage under `gateway/`, verified through
a real isolated native Gateway restart with synthetic request data. The fixture
is not installed by these VM units and does not register production callbacks
or enable approved worker execution. Host rollout remains a separate gate.

S27 implements approval/consumption predicates using supplied trusted context.
Its denial/concurrency tests are synthetic, not actual Discord authentication.
These guards alone do not authorize production dispatch or establish exactly-once
execution; trusted callback/worker integration and lost-ack reconciliation remain.

S28 callback/flow-binding helpers pass synthetic denial tests. They are not an
fully verified production path. Native artifact/bootstrap now starts and survives
an actual isolated Gateway restart; route/flow discovery has synthetic coverage.
Actual component emission and real two-user principal verification remain unfinished.

The publisher and opt-in no-op actor-QA paths now exist. Component delivery/token
binding/known-message edit recovery have synthetic tests and installed SDK render
contract checks. No actual Discord message or actor event was produced by those
checks. Shared-channel writes need confirmation and native two-user evidence.
Do not enable execution based solely on helper build/test success.

S35 adds durable thread intent/receipt reconciliation. Its restart fixture uses a
synthetic external provider and the real native flow store; it does not provision
Discord channels or prove live marker authentication/idempotency. These modules
still need the trusted production controller/adapter before host activation.

S36 adds backlink-only reconciliation against the accepted thread receipt.
Synthetic retries leave the thread unchanged and reconcile one GitHub marker;
actual provider author metadata, send-outcome guarantees and live account writes
are not established by this fixture. Production activation remains gated on S49.

## Topology

```
GitHub ──443──▶ Caddy (public)  ──/stackot/webhook──▶  127.0.0.1:9377  stackot-receiver
Tailscale ────▶                        127.0.0.1:18789  OpenClaw Gateway + Control UI
                        loopback only: 9377, 18789      (never exposed)
```

- The receiver is the only public surface, and only through Caddy, and only on
  `/stackot/webhook`. Everything else on that hostname answers 404.
- The gateway and its Control UI are reached over Tailscale/WireGuard, never
  through Caddy.
- `ufw` in `cloud-init.yaml` opens 80/443 publicly, SSH only from the Tailscale
  CGNAT range, and 41641/udp for Tailscale. Ports 9377 and 18789 are never opened.

## 1. Provision the guest

Proxmox: create a VM (2–4 vCPU, 4–8 GB RAM, 60–100 GB disk) with a Debian 12 or
Ubuntu 24.04 LTS cloud image, attach `cloud-init.yaml` as user-data, and set the
SSH key in it.

```bash
# Edit cloud-init.yaml first: SSH key, then (optionally) the clone URL.
qm create 200 --name stackot --memory 6144 --cores 4 --net0 virtio,bridge=vmbr0
qm importdisk 200 <cloud-image>.qcow2 local-lvm
qm set 200 --scsi0 local-lvm:vm-200-disk-0 --ide2 local-lvm:cloudinit \
  --cicustom user=local:snippets/stackot-user-data.yaml --ipconfig0 ip=dhcp \
  --serial0 socket --vga serial0
qm start 200
```

Resource note: the receiver itself is tiny; the CPU and RAM are for the ACP
worker (a coding harness compiling and testing repositories) and its caches.

## 2. Place the secrets

```bash
sudo install -d -m 0755 /etc/stackot
sudo install -m 0600 -o root -g root /dev/null /etc/stackot/receiver.env
sudo -e /etc/stackot/receiver.env        # from deploy/vm/stackot.env.example
sudo install -m 0600 -o root -g stackot /dev/null /etc/stackot/receiver.json
sudo -e /etc/stackot/receiver.json       # from receiver/config.example.json
```

`receiver.json` must carry every required key, including `discordGuildId` and
`githubBacklinkLogin` (the receiver refuses to start without them) and the
per-repo forum channel IDs. The receiver validates all of this at startup, so a
mistake here surfaces as a failed unit, not as silent misrouting.

Caddy's two variables go in `/etc/default/caddy`:

```
STACKOT_DOMAIN=stackot.example.com
ACME_EMAIL=you@example.com
```

## 3. Install the runtime (gateway and worker)

Follow `deploy/README.md` §2 — it is the canonical sequence, and ledger row S23
freezes the exact OpenClaw/acpx contract from the *installed* versions before any
adapter is written:

Node must be 24.16+ on the 24.x line (S23 verified 24.21.0) or 26.1+ — the
OpenClaw package engines reject other majors; `cloud-init.yaml` installs 24.x
via NodeSource.

```bash
npm install -g openclaw@2026.9.6 --allow-scripts=openclaw
openclaw plugins install @openclaw/acpx@2026.9.6 --pin --accept-capabilities
openclaw plugins install @openclaw/discord@2026.9.6 --pin --accept-capabilities
# Discord bot token for the gateway:
install -m 0600 -o stackot -g stackot /dev/null ~stackot/.openclaw/.env
#   DISCORD_BOT_TOKEN=...
sudo -u stackot openclaw config validate
sudo -u stackot openclaw gateway install    # or run it in the foreground first
# Worker harness auth must exist on this host before workers are enabled:
sudo -u stackot codex --version             # and complete its login once
```

Copy the skill where the gateway expects it, per `deploy/README.md` §2.

## 4. Start and check the receiver

```bash
cd /opt/stackot/receiver && sudo -u stackot /usr/local/bin/bun install --frozen-lockfile
sudo systemctl enable --now stackot-receiver
sudo systemctl enable --now stackot-backup.timer
sudo systemctl reload caddy

curl -sS http://127.0.0.1:9377/healthz                      # ok
curl -sS http://127.0.0.1:9377/readyz                       # ready
curl -sS http://127.0.0.1:9377/status | jq .                 # outbox + gateway health
curl -sS https://$STACKOT_DOMAIN/stackot/webhook -X POST -d '{}' -o /dev/null -w '%{http_code}\n'
#   → 401 (signature missing), never 200: proves the public route reaches the
#     receiver and that unsigned traffic is rejected
```

Then attach the repository webhooks and the Discord bot per `deploy/README.md`
§4, and send one real event.

## 5. The drills these artifacts exist for

Each of these is a ledger row; run it, capture the output, and record it as the
row's evidence.

**S44 — service supervision.** `sudo systemctl kill -s SIGKILL stackot-receiver`
and confirm systemd restarts it within `RestartSec`; then `sudo reboot` and
confirm both services come back and `/readyz` answers 200 without manual steps.

**S45 — public/private boundary.** From outside the host: 443 and 80 answer,
`/stackot/webhook` reaches the receiver, and 9377/18789 are unreachable. From the
host prove the gateway never left loopback: `ss -ltnp | grep -E '9377|18789'`.

**S47 — restore drill.** `sudo systemctl start stackot-backup`, copy the newest
snapshot to a scratch host, then start a receiver against *only* that snapshot and
confirm `/status` shows the same pending and dead-letter counts and that a
dead-lettered row can be replayed with `bun src/replay.ts <id>`.

**S48 — rollback drill.** Check out the previous release commit in a second
directory, point `STACKOT_CONFIG` and `STACKOT_OUTBOX_PATH` at the live files, and
confirm the older binary starts against the current schema (the outbox migrates
forward only) and answers `/readyz` 200 — then stop it and record the result.

## 6. Ongoing operations

- Backups: nightly at 03:30 UTC by `stackot-backup.timer`, 14 snapshots retained,
  each verified with `PRAGMA integrity_check` before being kept. Copy them off
  the VM (or rely on the Proxmox guest backup as the second layer). Token
  rotation is ledger row B08.
- Logs: receiver to the journal (`journalctl -u stackot-receiver`), the gateway
  per its own CLI, Caddy access log to `/var/log/caddy/stackot-access.log`.
  Delivery telemetry and queue metrics are structured JSON lines on the
  receiver's stdout.
- Alerting on backlog is ledger row B04 and needs a delivery target.
- The `stackot` user owns `/opt/stackot`, `/var/lib/stackot` and the gateway's
  home; nothing in this deployment should run as root except the backup unit and
  Caddy's own service.
# Current host selection

S33 push-authority preparation is in
[push-authority.md](../../docs/contracts/push-authority.md); no worker credential
isolation or live push transport is implied.
The separate owner transport prepares sealed Git objects/config; no VM or
GitHub activation is implied by its actual local-Git fixture tests.
The native callback owner-factory attachment is preparation only; no factory is
provided by default deployment/JSON configuration and no live push is enabled.
The owner catalog composer checks persisted targets and owns lazy sealing and
cleanup; real task/worktree catalog provisioning remains outstanding.
Failed cleanup emits a fixed diagnostic and preserves confirmed transport results.
Prepared Git credentials use per-operation private0600 owner files and are
removed after success/failure; token bytes do not enter child argv/environment.
Actual Mac fixture process-env visibility is recorded separately from these
Linux instructions. No VM/worker isolation or live push acceptance is inferred.
The prepared owner-controlled Docker executor has fixed image/mount/privilege
policy, actual-container timeout/cancel reconciliation and preserved task files;
see [docker-worker.md](../../docs/contracts/docker-worker.md). Real model auth,
approved native task/Git lineage and worker activation remain separate gates.
The Linux CI shell fixture is not a VM deployment or an actual Codex run.

The expired approval guidance is documented in
[b06-expired-approval.md](../../docs/verification/b06-expired-approval.md).
No VM/native delivery, re-request control or human QA is implied by that source.
Retry-control source preparation is still separate from its native deployment
and human QA; fresh card intents include the retry control, legacy cards persist.

The optional hook credential reference/rotation boundary is in
[token-rotation.md](../token-rotation.md), including actual selected-Mac drill
evidence. No VM rotation/drill result is implied.

The genuine S47 restore/drain record is [restore.md](../../docs/verification/restore.md)
on the selected Mac. It does not establish VM restoration or model/Discord success.

The B04 alert policy/one-shot monitor is in [../alerts.md](../alerts.md). Its
current installer targets the selected Mac; no VM alert supervisor or live
receipt is implied by these VM templates.

On 2026-09-28 the user selected the local Mac and `stackot.justn.me` instead of
provisioning a VM. See [macOS deployment](../macos/README.md). This runbook is
retained for the VM alternative; none of its systemd/reboot receipts is implied
by a launchd deployment.
