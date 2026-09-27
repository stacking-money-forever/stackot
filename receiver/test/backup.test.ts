import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupOutbox } from "../src/backup.ts";
import { MAX_DELIVERY_ATTEMPTS, Outbox } from "../src/outbox.ts";
import type { NormalizedEvent } from "../src/normalize.ts";

const event: NormalizedEvent = { repo: "example/app", item: "issue #1", target: "1", targetKind: "channel", summary: "x", url: "https://example.test" };

type OutboxRow = { id: string; event: string; state: string; attempts: number; last_error: string | null };

function rows(path: string): OutboxRow[] {
  const db = new Database(path, { readonly: true });
  try {
    return db.query("SELECT id, event, state, attempts, last_error FROM outbox ORDER BY id").all() as OutboxRow[];
  } finally {
    db.close();
  }
}

function integrity(path: string): string {
  const db = new Database(path, { readonly: true });
  try {
    return (db.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
  } finally {
    db.close();
  }
}

test("snapshot includes committed rows that still live only in -wal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-backup-wal-"));
  const srcPath = join(dir, "outbox.sqlite");
  const destPath = join(dir, "backup.sqlite");
  try {
    // The source stays open the whole time — no close, no checkpoint — so the
    // enqueued rows are provably only in the WAL when the snapshot is taken.
    const outbox = new Outbox(srcPath);
    expect(outbox.enqueue("wal-only-1", event)).toBe(true);
    expect(outbox.enqueue("wal-only-2", { ...event, item: "issue #2" })).toBe(true);
    const walPath = `${srcPath}-wal`;
    expect(existsSync(walPath)).toBe(true);
    expect(statSync(walPath).size).toBeGreaterThan(0);

    const { bytes } = await backupOutbox(srcPath, destPath);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBe(statSync(destPath).size);

    expect(integrity(destPath)).toBe("ok");
    const snapshotRows = rows(destPath);
    expect(snapshotRows.map((row) => row.id)).toEqual(["wal-only-1", "wal-only-2"]);
    expect(snapshotRows.length).toBe(rows(srcPath).length);
    outbox.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("snapshot file stands alone after the source directory is deleted", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-backup-alone-"));
  const srcPath = join(dir, "src", "outbox.sqlite");
  const destPath = join(dir, "backup.sqlite");
  const elsewhere = mkdtempSync(join(tmpdir(), "stackot-backup-elsewhere-"));
  const copyPath = join(elsewhere, "copy.sqlite");
  try {
    const outbox = new Outbox(srcPath);
    outbox.enqueue("alone-1", event);
    await backupOutbox(srcPath, destPath);
    outbox.close();

    copyFileSync(destPath, copyPath);
    rmSync(dir, { recursive: true, force: true });
    expect(existsSync(srcPath)).toBe(false);

    expect(integrity(copyPath)).toBe("ok");
    const copyRows = rows(copyPath);
    expect(copyRows.length).toBe(1);
    expect(copyRows[0]?.id).toBe("alone-1");
    expect(JSON.parse(copyRows[0]?.event ?? "")).toEqual(event);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test("pending, delivered and dead_letter rows keep state, attempts, last_error and event", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-backup-state-"));
  const srcPath = join(dir, "outbox.sqlite");
  const destPath = join(dir, "backup.sqlite");
  try {
    const outbox = new Outbox(srcPath);
    outbox.enqueue("st-pending", event);
    outbox.enqueue("st-delivered", { ...event, item: "issue #2" });
    outbox.delivered("st-delivered");
    outbox.enqueue("st-dead", { ...event, item: "issue #3" });
    outbox.fail("st-dead", MAX_DELIVERY_ATTEMPTS, "gateway 502");

    await backupOutbox(srcPath, destPath);

    expect(rows(destPath)).toEqual(rows(srcPath));
    const byId = new Map(rows(destPath).map((row) => [row.id, row]));
    expect(byId.get("st-pending")?.state).toBe("pending");
    expect(byId.get("st-delivered")?.state).toBe("delivered");
    expect(byId.get("st-dead")).toMatchObject({ state: "dead_letter", attempts: MAX_DELIVERY_ATTEMPTS, last_error: "gateway 502" });
    expect(JSON.parse(byId.get("st-dead")?.event ?? "")).toEqual({ ...event, item: "issue #3" });
    outbox.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing source fails and leaves no destination file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-backup-missing-"));
  const srcPath = join(dir, "nope.sqlite");
  const destPath = join(dir, "backup.sqlite");
  try {
    await expect(backupOutbox(srcPath, destPath)).rejects.toThrow(srcPath);
    expect(existsSync(destPath)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("existing destination is refused, not overwritten", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-backup-exists-"));
  const srcPath = join(dir, "outbox.sqlite");
  const destPath = join(dir, "backup.sqlite");
  try {
    const outbox = new Outbox(srcPath);
    outbox.enqueue("keep-me", event);
    outbox.close();

    writeFileSync(destPath, "previous backup");
    await expect(backupOutbox(srcPath, destPath)).rejects.toThrow("already exists");
    expect(readFileSync(destPath, "utf8")).toBe("previous backup");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const receiverDir = new URL("..", import.meta.url).pathname;

function runCli(args: string[], env: Record<string, string>) {
  return Bun.spawn([process.execPath, "src/backup.ts", ...args], {
    cwd: receiverDir,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
}

test("CLI exits 0 and prints a byte count on success", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-backup-cli-"));
  const srcPath = join(dir, "outbox.sqlite");
  const destPath = join(dir, "backup.sqlite");
  try {
    const outbox = new Outbox(srcPath);
    outbox.enqueue("cli-1", event);
    outbox.close();

    const proc = runCli([destPath], { STACKOT_OUTBOX_PATH: srcPath });
    const stdout = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(stdout).toContain(destPath);
    expect(stdout).toContain("bytes");
    expect(integrity(destPath)).toBe("ok");
    expect(rows(destPath).length).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI exits 2 when the destination argument is missing", async () => {
  const proc = runCli([], {});
  const stderr = await new Response(proc.stderr).text();
  expect(await proc.exited).toBe(2);
  expect(stderr).toContain("usage");
});

test("CLI exits 1 when the source does not exist", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-backup-cli-fail-"));
  try {
    const proc = runCli([join(dir, "backup.sqlite")], { STACKOT_OUTBOX_PATH: join(dir, "nope.sqlite") });
    const stderr = await new Response(proc.stderr).text();
    expect(await proc.exited).toBe(1);
    expect(stderr).toContain("backup failed");
    expect(existsSync(join(dir, "backup.sqlite"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
