import { expect, test } from "bun:test";
import { selectRunnable, type ScheduledJob, type SchedulerLimits } from "../src/scheduler.ts";

const job = (id: string, repo: string): ScheduledJob => ({ id, repo });
const limits = (maxGlobal: number, maxPerRepo: number): SchedulerLimits => ({ maxGlobal, maxPerRepo });
const ids = (jobs: readonly ScheduledJob[]) => jobs.map((j) => j.id);

test("returns nothing when in-flight already fills the global limit", () => {
  expect(selectRunnable([job("r1", "a"), job("r2", "b")], [job("i1", "a"), job("i2", "b")], limits(2, 2))).toEqual([]);
  expect(selectRunnable([job("r1", "a")], [job("i1", "a"), job("i2", "b"), job("i3", "c")], limits(2, 5))).toEqual([]);
});

test("a repo at its per-repo limit is skipped while another repo still starts", () => {
  const ready = [job("a2", "a"), job("b1", "b")];
  expect(ids(selectRunnable(ready, [job("a1", "a")], limits(4, 1)))).toEqual(["b1"]);
});

test("the per-repo limit counts in-flight plus already selected jobs", () => {
  const ready = [job("a2", "a"), job("a3", "a"), job("b1", "b")];
  // a already has one running: b wins the first slot (fewer in-flight), then a fills its second.
  expect(ids(selectRunnable(ready, [job("a1", "a")], limits(4, 2)))).toEqual(["b1", "a2"]);
});

test("selection alternates repos so a ready-heavy repo cannot starve others", () => {
  const ready = [job("a1", "a"), job("a2", "a"), job("a3", "a"), job("b1", "b"), job("b2", "b")];
  expect(ids(selectRunnable(ready, [], limits(4, 4)))).toEqual(["a1", "b1", "a2", "b2"]);
});

test("per-repo cap can stop selection before the global cap is reached", () => {
  const ready = [job("a1", "a"), job("a2", "a"), job("a3", "a"), job("b1", "b"), job("b2", "b")];
  expect(ids(selectRunnable(ready, [], limits(4, 1)))).toEqual(["a1", "b1"]);
});

test("the global cap binds tighter than a larger per-repo cap", () => {
  const ready = [job("a1", "a"), job("a2", "a"), job("a3", "a"), job("a4", "a")];
  expect(ids(selectRunnable(ready, [], limits(2, 5)))).toEqual(["a1", "a2"]);
});

test("degenerate inputs: zero global limit and empty ready select nothing", () => {
  expect(selectRunnable([job("a1", "a")], [], limits(0, 1))).toEqual([]);
  expect(selectRunnable([], [], limits(4, 1))).toEqual([]);
  expect(selectRunnable([], [job("i1", "a")], limits(4, 1))).toEqual([]);
});

test("is deterministic and never mutates its inputs", () => {
  const ready = [job("a1", "a"), job("b1", "b"), job("a2", "a")];
  const inFlight = [job("i1", "a")];
  const readyBefore = JSON.stringify(ready);
  const inFlightBefore = JSON.stringify(inFlight);
  const first = selectRunnable(ready, inFlight, limits(4, 2));
  const second = selectRunnable(ready, inFlight, limits(4, 2));
  expect(first).toEqual(second);
  expect(ids(first)).toEqual(["b1", "a1"]);
  expect(JSON.stringify(ready)).toBe(readyBefore);
  expect(JSON.stringify(inFlight)).toBe(inFlightBefore);
});
