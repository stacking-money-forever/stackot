import type { NormalizedEvent } from "./normalize.ts";
import { selectRunnable, type SchedulerLimits } from "./scheduler.ts";

export type PendingDelivery = { id: string; event: NormalizedEvent; attempts: number };

export type DeliveryOutbox = {
  due(): PendingDelivery | null;
  /**
   * Batch form of due(): up to `limit` due rows in due() order. Optional so
   * outbox decorators written against the single-row interface still satisfy
   * it; the drainer falls back to one-row due() polls when it is absent.
   */
  dueBatch?(limit: number): PendingDelivery[];
  delivered(id: string): void;
  fail(id: string, attempts: number, error: string): void;
};

export type DeliveryForwarder = (job: PendingDelivery) => Promise<{ ok: boolean; status?: number }>;

type Running = { job: PendingDelivery; done: Promise<void> };

const DEFAULT_LIMITS: SchedulerLimits = { maxGlobal: 4, maxPerRepo: 1 };

/**
 * Concurrent drain: each pass keeps pulling due rows into a candidate pool and
 * starts whatever selectRunnable allows under the global and per-repo limits,
 * so one repo's slow forward never serializes the others. In-flight ids are
 * tracked for the whole pass — a still-pending row can never be forwarded
 * twice, and drain() only resolves once nothing in-flight remains.
 */
export class DeliveryDrainer {
  private draining = false;
  /**
   * Set only while a pass is parked waiting on in-flight jobs. A re-entrant
   * drain() call resolves it so rows enqueued during the wait are re-polled
   * instead of queueing behind the slowest in-flight forward.
   */
  private kick: (() => void) | null = null;
  private readonly limits: SchedulerLimits;

  constructor(
    private readonly outbox: DeliveryOutbox,
    private readonly forward: DeliveryForwarder,
    limits: SchedulerLimits = DEFAULT_LIMITS,
  ) {
    this.limits = limits;
  }

  /** Due rows not already in-flight or pooled; never consumes the same id twice. */
  private candidates(inFlight: ReadonlyMap<string, Running>, pool: ReadonlyMap<string, PendingDelivery>): PendingDelivery[] {
    // In-flight rows are still pending and therefore still due: they occupy
    // the head of every batch, so fetch wide enough to see past them.
    const batch = this.outbox.dueBatch
      ? this.outbox.dueBatch(this.limits.maxGlobal + inFlight.size)
      : [this.outbox.due()].filter((job): job is PendingDelivery => job !== null);
    const seen = new Set<string>([...inFlight.keys(), ...pool.keys()]);
    const fresh: PendingDelivery[] = [];
    for (const job of batch) {
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      fresh.push(job);
    }
    return fresh;
  }

  private async run(job: PendingDelivery): Promise<void> {
    try {
      const result = await this.forward(job);
      if (!result.ok) throw new Error(`gateway rejected delivery (status ${result.status ?? "unknown"})`);
      this.outbox.delivered(job.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.outbox.fail(job.id, job.attempts + 1, message);
    }
  }

  async drain(): Promise<void> {
    if (this.draining) {
      this.kick?.();
      return;
    }
    this.draining = true;
    const inFlight = new Map<string, Running>();
    // Fetched but not yet started. Keeping them here matters twice: repo-capped
    // candidates survive to the next selection round, and due()-only outboxes
    // that consume rows on each poll never lose one.
    const pool = new Map<string, PendingDelivery>();
    let firstError: unknown = null;
    try {
      for (;;) {
        if (firstError != null) throw firstError;
        for (const job of this.candidates(inFlight, pool)) pool.set(job.id, job);
        const running = [...inFlight.values()].map(({ job }) => ({ id: job.id, repo: job.event.repo }));
        const runnable = selectRunnable(
          [...pool.values()].map((job) => ({ id: job.id, repo: job.event.repo })),
          running,
          this.limits,
        );
        if (runnable.length === 0) {
          if (inFlight.size === 0) return;
          // Nothing may start: park on the first in-flight completion, or on a
          // kick reporting work enqueued after the last poll.
          const wake = new Promise<void>((resolve) => { this.kick = resolve; });
          await Promise.race([...inFlight.values()].map(({ done }) => done).concat(wake));
          this.kick = null;
          continue;
        }
        for (const sched of runnable) {
          const job = pool.get(sched.id);
          if (!job) continue;
          pool.delete(job.id);
          // done never rejects: success frees the slot, failure records the
          // error and keeps the id in-flight so the row is not re-forwarded.
          const done = this.run(job).then(
            () => { inFlight.delete(job.id); },
            (error: unknown) => { firstError ??= error; },
          );
          inFlight.set(job.id, { job, done });
        }
      }
    } finally {
      // A pass never exits with forwards still running: the next pass would
      // read their still-pending rows as due and forward them twice.
      await Promise.allSettled([...inFlight.values()].map(({ done }) => done));
      this.kick = null;
      this.draining = false;
    }
  }
}
