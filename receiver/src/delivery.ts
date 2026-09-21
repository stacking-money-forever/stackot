import type { NormalizedEvent } from "./normalize.ts";

export type PendingDelivery = { id: string; event: NormalizedEvent; attempts: number };

export type DeliveryOutbox = {
  due(): PendingDelivery | null;
  delivered(id: string): void;
  fail(id: string, attempts: number, error: string): void;
};

export type DeliveryForwarder = (job: PendingDelivery) => Promise<{ ok: boolean; status?: number }>;

export class DeliveryDrainer {
  private draining = false;

  constructor(private readonly outbox: DeliveryOutbox, private readonly forward: DeliveryForwarder) {}

  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      let job: PendingDelivery | null;
      while ((job = this.outbox.due())) {
        try {
          const result = await this.forward(job);
          if (!result.ok) throw new Error(`gateway rejected delivery (status ${result.status ?? "unknown"})`);
          this.outbox.delivered(job.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.outbox.fail(job.id, job.attempts + 1, message);
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
