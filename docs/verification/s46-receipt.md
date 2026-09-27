# S46 receipt — SQLite 일관 backup (candidate)

Base: worktree HEAD `2da1e79` (`docs: record the S43 ACCEPT decision`). No commit, push, merge, deploy, or release performed. Scope check: `git status` shows only the two new files below plus this receipt; no listed file was modified.

## Changed files

- `receiver/src/backup.ts` (new) — `backupOutbox(sourcePath, destPath): Promise<{ bytes: number }>` + `import.meta.main` CLI.
- `receiver/test/backup.test.ts` (new) — 8 tests covering WAL inclusion, standalone validity, state preservation, failure paths, and CLI exit codes.
- `docs/verification/s46-receipt.md` (new) — this file.

## Core diff summary

- `backupOutbox` opens the source with `new Database(sourcePath, { readonly: true })` and runs `VACUUM INTO '<dest>'` — SQLite's consistent-snapshot primitive, which serializes the DB (including rows still only in `-wal`) as of one read transaction into a single standalone file. No `copyFile` of the source anywhere.
- The destination path is embedded as a SQL string literal with single quotes doubled (`destPath.replaceAll("'", "''")`) because `VACUUM INTO` cannot take a bound parameter.
- Failure hygiene: missing source → `Error("outbox source does not exist: …")` before touching the destination; any open/VACUUM failure runs `rmSync(destPath, { force: true })`, so a half-written file is never left behind.
- CLI: `bun src/backup.ts <dest-path>`; source = `STACKOT_OUTBOX_PATH` else `new URL("../var/outbox.sqlite", import.meta.url).pathname` — identical default rule to `server.ts`. Exit 0 with one line `backup complete: <dest> (<n> bytes)`; exit 1 on failure (`backup failed: …` on stderr); exit 2 on missing argument (`usage: …`).
- Source is strictly read-only: no writes, no pragma changes, no schema changes; the constructor side effects in `Outbox` (mkdir, CREATE TABLE, migrations, TTL delete) are bypassed entirely.

## Backup method and existing-destination behavior

- Method: `VACUUM INTO` on a read-only source connection. Probed before implementation: with the writer connection open and an un-checkpointed `-wal` present, the snapshot still contains the WAL-only rows and `PRAGMA integrity_check` returns `ok` on the snapshot.
- Existing destination: **refused**. `backupOutbox` throws `backup destination already exists, refusing to overwrite` before opening anything, and `VACUUM INTO` itself also errors with `output file already exists` as a second line of defense. An existing backup is therefore never silently overwritten; the caller must choose a fresh path or move the old file away explicitly.

## Commands run (oracle output verbatim)

`bun install --frozen-lockfile` was run once first because `receiver/node_modules` did not exist (permitted by the contract): resolved `@types/bun@1.4.2`, `typescript@7.0.2`, 6 packages.

### `cd receiver && bun run typecheck`

```
$ tsc --noEmit
```
(exit 0, no output)

### `cd receiver && bun test test/backup.test.ts`

```
bun test v1.4.0 (34cbb9a40)

test/backup.test.ts:
(pass) snapshot includes committed rows that still live only in -wal [11.46ms]
(pass) snapshot file stands alone after the source directory is deleted [5.21ms]
(pass) pending, delivered and dead_letter rows keep state, attempts, last_error and event [4.00ms]
(pass) missing source fails and leaves no destination file [0.23ms]
(pass) existing destination is refused, not overwritten [2.61ms]
(pass) CLI exits 0 and prints a byte count on success [13.48ms]
(pass) CLI exits 2 when the destination argument is missing [8.83ms]
(pass) CLI exits 1 when the source does not exist [8.88ms]

 8 pass
 0 fail
 33 expect() calls
Ran 8 tests across 1 file. [61.00ms]
```

### `cd receiver && bun test`

```
 271 pass
 0 fail
 939 expect() calls
Ran 271 tests across 26 files. [18.33s]
```
(All 8 backup tests pass inside the full run; output truncated to the tail above, exit 0.)

## Test coverage notes

- WAL inclusion test keeps the source `Outbox` connection open (no close → no checkpoint) and asserts `-wal` exists and is non-empty at backup time, so the rows are provably WAL-resident when the snapshot is taken.
- Standalone test `copyFile`s the *snapshot* (the copyFile ban applies to backing up the source, not to relocating a finished snapshot), deletes the entire source directory, then opens the copy.
- No real network: CLI tests spawn `process.execPath src/backup.ts` locally; no HTTP anywhere.

## Remaining risks

- **Source lock during backup:** `VACUUM INTO` needs a consistent read of the source. In WAL mode a reader coexists with the writer, but a long-running write transaction from another process, or an exclusive lock, can still block it; there is no explicit timeout on the backup connection (busy_timeout defaults apply). Worst case is a failed/slow backup, never a torn one.
- **Large DB duration/space:** VACUUM rewrites the whole database — time and disk roughly proportional to DB size, and the destination filesystem needs a full copy's worth of free space. No incremental mode; this is a full-snapshot tool only.
- **Rotation is caller's job:** the refusal-on-existing-dest policy means an operator cron must supply a fresh path each run (e.g. timestamped); nothing prunes old snapshots.
- **Snapshot journal mode:** the snapshot header inherits WAL mode, so opening it creates fresh empty `-wal`/`-shm` side files on first write access — harmless, since all data is already checkpointed into the main file.
- **Not exercised:** concurrent live traffic during backup (only synthetic concurrent-open coverage), restore drill (S47 scope), and very large outboxes.
