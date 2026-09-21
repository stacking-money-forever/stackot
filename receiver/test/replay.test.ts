import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_DELIVERY_ATTEMPTS, Outbox } from "../src/outbox.ts";
import { replayDelivery } from "../src/replay.ts";

const event = { repo: "example/app", item: "issue #1", target: "1", targetKind: "channel" as const, summary: "x", url: "https://example.test" };

function seedDeadLetter(outbox: Outbox, id: string): void {
  outbox.enqueue(id, event);
  outbox.fail(id, MAX_DELIVERY_ATTEMPTS, "gateway 502");
}

test("replays one dead_letter row by exact id: due() returns it with attempts preserved", () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-replay-"));
  const path = join(dir, "outbox.sqlite");
  try {
    const outbox = new Outbox(path);
    seedDeadLetter(outbox, "dead-1");
    expect(outbox.due()).toBeNull();

    expect(replayDelivery(outbox, "dead-1")).toBe("resumed");

    const due = outbox.due();
    expect(due?.id).toBe("dead-1");
    expect(due?.attempts).toBe(MAX_DELIVERY_ATTEMPTS);
    const db = new Database(path, { readonly: true });
    const row = db.query("SELECT state, next_attempt_at FROM outbox WHERE id = ?").get("dead-1") as { state: string; next_attempt_at: number };
    expect(row.state).toBe("pending");
    expect(row.next_attempt_at).toBeLessThanOrEqual(Date.now());
    db.close();
    outbox.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("replaying the same id again reports a non-target result and changes nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-replay-twice-"));
  const path = join(dir, "outbox.sqlite");
  try {
    const outbox = new Outbox(path);
    seedDeadLetter(outbox, "dead-1");
    expect(replayDelivery(outbox, "dead-1")).toBe("resumed");

    const db = new Database(path);
    const before = db.query("SELECT * FROM outbox WHERE id = ?").get("dead-1");
    expect(replayDelivery(outbox, "dead-1")).toBe("not_dead_letter");
    expect(replayDelivery(outbox, "never-seen")).toBe("not_found");
    expect(db.query("SELECT * FROM outbox WHERE id = ?").get("dead-1")).toEqual(before);
    db.close();
    outbox.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("other dead_letter and delivered rows are untouched by a replay", () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-replay-isolate-"));
  const path = join(dir, "outbox.sqlite");
  try {
    const outbox = new Outbox(path);
    seedDeadLetter(outbox, "dead-a");
    seedDeadLetter(outbox, "dead-b");
    outbox.enqueue("done-1", event);
    outbox.delivered("done-1");

    expect(replayDelivery(outbox, "dead-a")).toBe("resumed");

    const db = new Database(path, { readonly: true });
    const deadB = db.query("SELECT state, attempts, last_error FROM outbox WHERE id = ?").get("dead-b") as { state: string; attempts: number; last_error: string | null };
    expect(deadB).toEqual({ state: "dead_letter", attempts: MAX_DELIVERY_ATTEMPTS, last_error: "gateway 502" });
    expect((db.query("SELECT state FROM outbox WHERE id = ?").get("done-1") as { state: string }).state).toBe("delivered");
    db.close();
    outbox.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI replays by exact id: exit 0 on resume, exit 1 on non-target", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stackot-replay-cli-"));
  const path = join(dir, "outbox.sqlite");
  try {
    const seed = new Outbox(path);
    seedDeadLetter(seed, "cli-dead");
    seed.enqueue("cli-done", event);
    seed.delivered("cli-done");
    seed.close();

    const run = (id: string) => Bun.spawn([process.execPath, "src/replay.ts", id], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, STACKOT_OUTBOX_PATH: path },
      stdout: "pipe",
      stderr: "pipe",
    });

    const ok = run("cli-dead");
    const [okCode, okOut] = await Promise.all([ok.exited, new Response(ok.stdout).text()]);
    expect(okCode).toBe(0);
    expect(okOut.trim()).toBe("replayed cli-dead: dead_letter -> pending");

    const db = new Database(path, { readonly: true });
    expect((db.query("SELECT state FROM outbox WHERE id = ?").get("cli-dead") as { state: string }).state).toBe("pending");
    db.close();

    const again = run("cli-dead");
    const [againCode, againOut] = await Promise.all([again.exited, new Response(again.stdout).text()]);
    expect(againCode).toBe(1);
    expect(againOut.trim()).toBe("not replayed cli-dead: row is not dead_letter");

    const missing = run("nope");
    const [missingCode, missingOut] = await Promise.all([missing.exited, new Response(missing.stdout).text()]);
    expect(missingCode).toBe(1);
    expect(missingOut.trim()).toBe("not replayed nope: no such delivery");

    const delivered = run("cli-done");
    expect(await delivered.exited).toBe(1);
    const verify = new Database(path, { readonly: true });
    expect((verify.query("SELECT state FROM outbox WHERE id = ?").get("cli-done") as { state: string }).state).toBe("delivered");
    verify.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
