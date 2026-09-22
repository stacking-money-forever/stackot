#!/usr/bin/env bash
# Consistent outbox snapshot with retention.
#
# Uses the receiver's own backup entry point (VACUUM INTO), so the snapshot
# includes rows that only exist in the WAL and is a standalone file that opens
# without -wal/-shm companions. The destination must not already exist, hence
# the timestamped name; old snapshots are pruned to KEEP.
set -euo pipefail

DEST_DIR=${STACKOT_BACKUP_DIR:-/var/backups/stackot}
KEEP=${STACKOT_BACKUP_KEEP:-14}
RECEIVER_DIR=${STACKOT_RECEIVER_DIR:-/opt/stackot/receiver}
OUTBOX=${STACKOT_OUTBOX_PATH:-/var/lib/stackot/outbox.sqlite}
# Overridable so the script can be exercised outside the VM (cloud-init puts bun here).
BUN=${STACKOT_BUN:-/usr/local/bin/bun}

install -d -m 0700 "$DEST_DIR"

if [ ! -f "$OUTBOX" ]; then
  echo "outbox not found at $OUTBOX — nothing to back up" >&2
  exit 1
fi

stamp=$(date -u +%Y%m%dT%H%M%SZ)
dest="$DEST_DIR/outbox-$stamp.sqlite"

cd "$RECEIVER_DIR"
STACKOT_OUTBOX_PATH="$OUTBOX" "$BUN" run src/backup.ts "$dest"

# Verification: a snapshot that does not pass integrity_check is not a backup.
integrity=$(sqlite3 "file:$dest?mode=ro" 'PRAGMA integrity_check;')
if [ "$integrity" != "ok" ]; then
  echo "snapshot failed integrity_check: $integrity" >&2
  exit 1
fi

rows=$(sqlite3 "file:$dest?mode=ro" 'SELECT COUNT(*) FROM outbox;')
echo "backup ok: $dest (${rows} rows)"

# Prune everything beyond the newest KEEP. Names are `outbox-<ISO8601 UTC Z>.sqlite`,
# so a lexical reverse sort is a chronological one — and this stays portable
# (no `ls` parsing, no GNU-only `find -printf`).
mapfile -t old < <(find "$DEST_DIR" -maxdepth 1 -type f -name 'outbox-*.sqlite' -print | sort -r | tail -n +$((KEEP + 1)))
if [ "${#old[@]}" -gt 0 ]; then
  rm -f -- "${old[@]}"
  echo "pruned ${#old[@]} old snapshot(s)"
fi
