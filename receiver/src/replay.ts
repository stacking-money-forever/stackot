/**
 * Manual replay path for dead-lettered deliveries.
 *
 * An operator resumes exactly one delivery by its exact delivery ID:
 *   bun src/replay.ts <delivery-id>        (cwd: receiver/)
 *
 * The outbox path comes from STACKOT_OUTBOX_PATH, falling back to the
 * same default as server.ts (../var/outbox.sqlite next to this file).
 * Prints one human-readable line; exits 0 when the row was resumed,
 * 1 when the ID is not a replay target, 2 on usage error.
 */
import { Outbox } from "./outbox.ts";

export type ReplayResult = "resumed" | "not_found" | "not_dead_letter";

export function replayDelivery(outbox: Outbox, id: string): ReplayResult {
  if (!outbox.has(id)) return "not_found";
  return outbox.requeue(id) ? "resumed" : "not_dead_letter";
}

if (import.meta.main) {
  const id = process.argv[2];
  if (!id) {
    console.error("usage: bun src/replay.ts <delivery-id>");
    process.exit(2);
  }
  const outbox = new Outbox(process.env.STACKOT_OUTBOX_PATH ?? new URL("../var/outbox.sqlite", import.meta.url).pathname);
  const result = replayDelivery(outbox, id);
  outbox.close();
  if (result === "resumed") {
    console.log(`replayed ${id}: dead_letter -> pending`);
  } else {
    console.log(`not replayed ${id}: ${result === "not_found" ? "no such delivery" : "row is not dead_letter"}`);
    process.exitCode = 1;
  }
}
