/**
 * S46 — consistent outbox snapshot.
 *
 * The outbox runs in WAL mode, so the newest committed rows can live only in
 * `<db>-wal`; copying the main file would silently lose them. `VACUUM INTO`
 * is SQLite's consistent-snapshot primitive: it serializes the database as of
 * a single read transaction (WAL contents included) into one standalone file
 * that needs no `-wal`/`-shm` companions to be valid.
 *
 * CLI: `bun src/backup.ts <dest-path>` — source is `STACKOT_OUTBOX_PATH`, with
 * the same default as server.ts. Exit codes: 0 success, 1 failure, 2 missing
 * argument.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Writes a consistent, standalone snapshot of the outbox at `sourcePath` to
 * `destPath` and returns the snapshot size in bytes.
 *
 * Destination policy: `destPath` must not already exist — an existing backup
 * is never silently overwritten (VACUUM INTO itself also refuses). Any
 * failure removes `destPath` so a half-written file is never left behind.
 * The source is opened read-only: its content, schema, pragmas and journal
 * files are untouched.
 */
export async function backupOutbox(sourcePath: string, destPath: string): Promise<{ bytes: number }> {
  if (!existsSync(sourcePath)) {
    throw new Error(`outbox source does not exist: ${sourcePath}`);
  }
  if (existsSync(destPath)) {
    throw new Error(`backup destination already exists, refusing to overwrite: ${destPath}`);
  }
  mkdirSync(dirname(destPath), { recursive: true });
  try {
    const db = new Database(sourcePath, { readonly: true });
    try {
      // The path cannot be bound as a parameter, so it is embedded as a SQL
      // string literal with single quotes doubled.
      db.run(`VACUUM INTO '${destPath.replaceAll("'", "''")}'`);
    } finally {
      db.close();
    }
  } catch (error) {
    rmSync(destPath, { force: true });
    throw error;
  }
  return { bytes: statSync(destPath).size };
}

if (import.meta.main) {
  const destPath = process.argv[2];
  if (!destPath) {
    console.error("usage: bun src/backup.ts <dest-path>");
    process.exit(2);
  }
  const sourcePath = process.env.STACKOT_OUTBOX_PATH ?? new URL("../var/outbox.sqlite", import.meta.url).pathname;
  try {
    const { bytes } = await backupOutbox(sourcePath, destPath);
    console.log(`backup complete: ${destPath} (${bytes} bytes)`);
  } catch (error) {
    console.error(`backup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
