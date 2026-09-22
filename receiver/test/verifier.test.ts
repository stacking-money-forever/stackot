import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyWorkerClaim, type CommandRunner } from "../src/verifier.ts";

const dirs: string[] = [];

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
}

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "stackot-s32-"));
  dirs.push(dir);
  git(dir, "init");
  git(dir, "config", "user.email", "verifier@test.local");
  git(dir, "config", "user.name", "Verifier Test");
  await writeFile(join(dir, "README.md"), "# repo\n");
  git(dir, "add", "README.md");
  git(dir, "commit", "-m", "init");
  return dir;
}

function workerChange(dir: string, file: string): Promise<void> {
  return writeFile(join(dir, file), "// worker output\n");
}

/** Runner that answers git probes successfully and stubs the test command. */
function fakeRunner(testResult: { code: number; stdout: string; stderr: string }, changed = ""): {
  run: CommandRunner;
  calls: { argv: readonly string[]; opts: { cwd: string; timeoutMs: number } }[];
} {
  const calls: { argv: readonly string[]; opts: { cwd: string; timeoutMs: number } }[] = [];
  const run: CommandRunner = async (argv, opts) => {
    calls.push({ argv, opts });
    if (argv.includes("rev-parse")) return { code: 0, stdout: "true\n", stderr: "" };
    if (argv.includes("status")) return { code: 0, stdout: changed, stderr: "" };
    if (argv.includes("diff")) return { code: 0, stdout: "", stderr: "" };
    return testResult;
  };
  return { run, calls };
}

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

describe("verifyWorkerClaim", () => {
  test("honest worker: claim matches observed changes and tests really pass -> verified", async () => {
    const dir = await makeRepo();
    await workerChange(dir, "worker.ts");
    const report = await verifyWorkerClaim({
      worktreePath: dir,
      claim: { filesChanged: ["worker.ts"], testsPassed: true, testCommand: "exit 0" },
    });
    expect(report.verdict).toBe("verified");
    expect(report.reasons).toEqual([]);
    expect(report.observed.changedFiles).toEqual(["worker.ts"]);
    expect(report.observed.testsPassed).toBe(true);
  });

  test("lying worker: claims testsPassed but the real command fails -> rejected", async () => {
    const dir = await makeRepo();
    await workerChange(dir, "worker.ts");
    const report = await verifyWorkerClaim({
      worktreePath: dir,
      claim: { filesChanged: ["worker.ts"], testsPassed: true, testCommand: "exit 1" },
    });
    expect(report.verdict).toBe("rejected");
    expect(report.observed.testsPassed).toBe(false); // observed, not copied from claim
    expect(report.reasons.some((r) => /exited with code 1/.test(r))).toBe(true);
  });

  test("ghost file: claim lists a file that was not changed -> rejected", async () => {
    const dir = await makeRepo();
    await workerChange(dir, "worker.ts");
    const report = await verifyWorkerClaim({
      worktreePath: dir,
      claim: { filesChanged: ["worker.ts", "ghost.ts"], testsPassed: true, testCommand: "exit 0" },
    });
    expect(report.verdict).toBe("rejected");
    expect(report.reasons.some((r) => r.includes("ghost.ts") && /ghost/.test(r))).toBe(true);
  });

  test("unclaimed change: a real change outside the claim -> rejected", async () => {
    const dir = await makeRepo();
    await workerChange(dir, "worker.ts");
    await workerChange(dir, "extra.ts");
    const report = await verifyWorkerClaim({
      worktreePath: dir,
      claim: { filesChanged: ["worker.ts"], testsPassed: true, testCommand: "exit 0" },
    });
    expect(report.verdict).toBe("rejected");
    expect(report.reasons.some((r) => r.includes("extra.ts") && /not claimed/.test(r))).toBe(true);
  });

  test("test claim without a testCommand is unverifiable -> rejected", async () => {
    const dir = await makeRepo();
    await workerChange(dir, "worker.ts");
    const report = await verifyWorkerClaim({
      worktreePath: dir,
      claim: { filesChanged: ["worker.ts"], testsPassed: true },
    });
    expect(report.verdict).toBe("rejected");
    expect(report.observed.testsPassed).toBeNull();
    expect(report.reasons.some((r) => /no testCommand/.test(r))).toBe(true);
  });

  test("empty claim -> rejected", async () => {
    const dir = await makeRepo();
    const report = await verifyWorkerClaim({ worktreePath: dir, claim: {} });
    expect(report.verdict).toBe("rejected");
    expect(report.reasons.some((r) => /no verifiable claim/.test(r))).toBe(true);
  });

  test("missing worktree path -> rejected", async () => {
    const missing = join(tmpdir(), `stackot-s32-missing-${Date.now()}`);
    const report = await verifyWorkerClaim({
      worktreePath: missing,
      claim: { filesChanged: ["x.ts"], testsPassed: true, testCommand: "exit 0" },
    });
    expect(report.verdict).toBe("rejected");
    expect(report.reasons.some((r) => /does not exist|not a git/i.test(r))).toBe(true);
    expect(report.observed.testsPassed).toBeNull();
  });

  test("non-git directory -> rejected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stackot-s32-nogit-"));
    dirs.push(dir);
    const report = await verifyWorkerClaim({
      worktreePath: dir,
      claim: { filesChanged: ["x.ts"], testsPassed: true, testCommand: "exit 0" },
    });
    expect(report.verdict).toBe("rejected");
    expect(report.reasons.some((r) => /not a git repository/i.test(r))).toBe(true);
  });

  test("test command that exceeds timeoutMs -> rejected as timeout, not passed", async () => {
    const dir = await makeRepo();
    await workerChange(dir, "worker.ts");
    const report = await verifyWorkerClaim({
      worktreePath: dir,
      claim: { filesChanged: ["worker.ts"], testsPassed: true, testCommand: "sleep 30" },
      timeoutMs: 300,
    });
    expect(report.verdict).toBe("rejected");
    expect(report.observed.testsPassed).toBe(false);
    expect(report.reasons.some((r) => /timed out/.test(r))).toBe(true);
  });

  test("timeout kills the whole process group, not just the shell", async () => {
    const dir = await makeRepo();
    await workerChange(dir, "worker.ts");
    const started = performance.now();
    const report = await verifyWorkerClaim({
      worktreePath: dir,
      claim: {
        filesChanged: ["worker.ts"],
        testsPassed: true,
        // The shell forks both sleeps; a background child keeps the stdout
        // pipe open even after the shell is killed. If the runner only kills
        // the shell, the pipe read hangs ~30s waiting for these orphans.
        testCommand: "sh -c 'sleep 30 & sleep 30'",
      },
      timeoutMs: 300,
    });
    const elapsed = performance.now() - started;
    expect(report.verdict).toBe("rejected");
    expect(report.observed.testsPassed).toBe(false);
    expect(report.reasons.some((r) => /timed out/.test(r))).toBe(true);
    expect(elapsed).toBeLessThan(3000);
  });

  test("injected runner receives expected argv, cwd and timeoutMs", async () => {
    const dir = await makeRepo();
    const { run, calls } = fakeRunner({ code: 0, stdout: "ok", stderr: "" });
    const report = await verifyWorkerClaim({
      worktreePath: dir,
      claim: { filesChanged: [], testsPassed: true, testCommand: "exit 0" },
      run,
      timeoutMs: 7777,
    });
    expect(report.verdict).toBe("verified");
    const testCall = calls.find((c) => c.argv[0] === "sh");
    expect(testCall).toBeDefined();
    expect(testCall?.argv).toEqual(["sh", "-c", "exit 0"]);
    expect(testCall?.opts.cwd).toBe(dir);
    expect(testCall?.opts.timeoutMs).toBe(7777);
  });

  test("observed changes are still checked when claim declares no filesChanged", async () => {
    const dir = await makeRepo();
    const { run } = fakeRunner({ code: 0, stdout: "", stderr: "" }, "?? worker.ts\n");
    const report = await verifyWorkerClaim({
      worktreePath: dir,
      claim: { testsPassed: true, testCommand: "exit 0" },
      run,
    });
    expect(report.verdict).toBe("rejected");
    expect(report.observed.changedFiles).toEqual(["worker.ts"]);
    expect(report.reasons.some((r) => r.includes("worker.ts") && /no filesChanged scope/.test(r))).toBe(true);
  });

  test("secrets never appear in reasons or observed output", async () => {
    const dir = await makeRepo();
    const secret = "ghp_FAKESECRET123456789";
    const run: CommandRunner = async (argv) => {
      if (argv.includes("rev-parse")) {
        return { code: 128, stdout: "", stderr: `fatal: credential ${secret} rejected` };
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    const report = await verifyWorkerClaim({ worktreePath: dir, claim: { testCommand: "exit 0" }, run });
    expect(report.verdict).toBe("rejected");
    const surface = report.reasons.join("\n") + (report.observed.testOutputTail ?? "");
    expect(surface).not.toContain(secret);
  });

  test("test output tail is redacted and truncated", async () => {
    const dir = await makeRepo();
    const secret = "ghp_FAKESECRET123456789";
    const { run } = fakeRunner({ code: 1, stdout: "", stderr: `${"x".repeat(2000)} leaked ${secret}` });
    const report = await verifyWorkerClaim({
      worktreePath: dir,
      claim: { filesChanged: [], testsPassed: true, testCommand: "emit" },
      run,
    });
    expect(report.verdict).toBe("rejected");
    expect(report.observed.testOutputTail).not.toContain(secret);
    expect(report.observed.testOutputTail).toContain("[REDACTED]");
    expect(report.observed.testOutputTail!.length).toBeLessThanOrEqual(1001);
  });
});
