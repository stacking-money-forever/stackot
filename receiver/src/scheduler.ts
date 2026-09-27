export type ScheduledJob = { id: string; repo: string };

export type SchedulerLimits = { maxGlobal: number; maxPerRepo: number };

/**
 * Which ready jobs may start now, in the order they should start.
 *
 * Fairness rule: the repo with the fewest running jobs (in-flight plus already
 * selected) wins each slot; ties fall back to `ready` order (FIFO). A repo that
 * dominates `ready` therefore alternates with the others instead of starving
 * them. `maxGlobal` bounds in-flight + selected, `maxPerRepo` bounds each
 * repo's share of that total.
 *
 * Pure: inputs are never mutated and equal inputs produce equal outputs.
 */
export function selectRunnable(
  ready: readonly ScheduledJob[],
  inFlight: readonly ScheduledJob[],
  limits: SchedulerLimits,
): ScheduledJob[] {
  const perRepo = new Map<string, number>();
  for (const job of inFlight) perRepo.set(job.repo, (perRepo.get(job.repo) ?? 0) + 1);

  const taken = new Array<boolean>(ready.length).fill(false);
  const selected: ScheduledJob[] = [];
  while (selected.length + inFlight.length < limits.maxGlobal) {
    let pick = -1;
    let pickCount = Number.POSITIVE_INFINITY;
    for (let i = 0; i < ready.length; i++) {
      if (taken[i]) continue;
      const job = ready[i];
      if (!job) continue;
      const count = perRepo.get(job.repo) ?? 0;
      if (count >= limits.maxPerRepo || count >= pickCount) continue;
      pick = i;
      pickCount = count;
    }
    if (pick < 0) break;
    taken[pick] = true;
    const job = ready[pick];
    if (!job) break;
    selected.push(job);
    perRepo.set(job.repo, pickCount + 1);
  }
  return selected;
}
