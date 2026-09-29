# S44 administrator-authenticated system migration — partial D

Decision: NOT ACCEPT. Count remains59/81. The canonical kill/reboot oracle still
needs a real reboot; these receipts prove installation and crash recovery only.

The user completed local administrator authentication in owned Herdr pane
`w6Y:p1`, workspace `stackot-local-deploy`. No password was captured. The installed
helper matches source SHA256
`b21d730af635ee1fffbdbd34435ebc0c5d392e6d1d284d1a5e564346550ac5be`.
`s44-admin-readiness.json` is the preserved pre-authentication snapshot, not the
post-install state. `s44-system-installed.json` is the actual post-install readback.

Four root-owned0644 system plists configure `UserName=justn`, `GroupName=staff`
and KeepAlive. Actual process uid is501 for every job. Old login plists remain
as `.plist.disabled`; active login originals are absent. The receiver release is
7987f9483c2a54deb8c2c808ba8f77977bc711cd, not this documentation branch.

Owner reran `python3 deploy/macos/probe.py --domain system --services receiver
gateway ingress tunnel --output docs/verification/s44-system-crash-recovery.json`.
Actual SIGKILL recovery changed receiver57462→67352, gateway57465→67366,
ingress57468→67697 and tunnel57471→67721. Service health returned; public unrelated
paths404, unsigned webhook401. These requests originate on the deployment host,
not an independent port scan. Receiver pending0/deadLetter3/delivered1 remained;
native flow5f5ff5b0-cac3-42aa-bba6-71b5db31f7b9 stayed ready/revision12. Gateway's
actual bound model/worker runs0 and worker dispatch disabled.

No executable code changed in this evidence changeset. Existing synthetic
installer rollback checks were rerun before authentication; they are S, not D.
Actual failure rollback was not induced against the live system. No reboot,
FileVault change, main merge, worker/push/PR dispatch or GitHub hook activation.

FileVault is actually enabled. Keep the current boot baseline from the receipt
and follow `deploy/macos/README.md` for a scheduled reboot drill. Record genuine
unlock/login dependencies and independent observation before claiming unattended
availability. S44, and its downstream S45/S48 acceptance gates, remain open.
