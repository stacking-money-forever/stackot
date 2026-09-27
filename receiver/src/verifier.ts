/**
 * Independent verification of worker completion claims.
 *
 * A worker's report ("I changed these files, tests pass") is a claim, not
 * evidence. This module re-derives the truth from the worktree itself: it
 * asks git which files actually changed and re-runs the claimed test
 * command, then compares those observations against the claim. Every
 * rejection reason comes from something the verifier observed, never from
 * the worker's string.
 *
 * All filesystem/git/child-process access goes through the injectable
 * CommandRunner, so tests can substitute a fake. The default runner uses
 * Bun.spawn and enforces a hard kill at timeoutMs.
 *
 * This module is not yet wired into the receiver pipeline. The worker
 * orchestration row (S30/S33) is expected to call verifyWorkerClaim after a
 * worker reports done and gate promotion on the returned verdict.
 */

export type CommandRunner = (
  argv: readonly string[],
  opts: { cwd: string; timeoutMs: number },
) => Promise<{ code: number; stdout: string; stderr: string }>;

export type WorkerClaim = {
  filesChanged?: readonly string[];
  testsPassed?: boolean;
  testCommand?: string;
};

export type VerifierReport = {
  verdict: "verified" | "rejected";
  reasons: string[];
  observed: {
    changedFiles: string[];
    testsPassed: boolean | null;
    testOutputTail: string | null;
  };
};

const GIT_TIMEOUT_MS = 30_000;
const DEFAULT_TEST_TIMEOUT_MS = 120_000;
const OUTPUT_TAIL_MAX = 1_000;
// Mirrors timeout(1): the default runner returns this code when it had to
// kill the process, so the verifier can tell a timeout from a normal failure.
const TIMEOUT_EXIT_CODE = 124;
// After the direct child exits, orphaned grandchildren can still hold the
// stdout/stderr pipes open (e.g. `sh -c 'sleep 30 & sleep 30'`). Give the
// drains a short grace period to flush, then return with partial output
// rather than hanging on a pipe that may never close.
const PIPE_DRAIN_GRACE_MS = 250;

const SECRET_PATTERNS: readonly [RegExp, string][] = [
  [/gh[pousr]_[A-Za-z0-9]{8,}/g, "[REDACTED]"],
  [/github_pat_[A-Za-z0-9_]{8,}/g, "[REDACTED]"],
  [/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]"],
  [/Bearer\s+\S{8,}/gi, "Bearer [REDACTED]"],
  [/Authorization:\s*\S+/gi, "Authorization: [REDACTED]"],
  [/([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))=("[^"]*"|'[^']*'|\S+)/g, "$1=[REDACTED]"],
  [/\/\/[^/\s:]+@/g, "//[REDACTED]@"],
];

function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

function tail(text: string, max = OUTPUT_TAIL_MAX): string {
  const trimmed = redact(text).trim();
  if (trimmed.length <= max) return trimmed;
  return `…${trimmed.slice(-max)}`;
}

/** Reads a stream to EOF in the background; text() returns what arrived so far. */
function drain(stream: ReadableStream<Uint8Array>): { done: Promise<void>; text: () => string } {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const done = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
      }
      buf += decoder.decode();
    } catch {
      // stream errored or was torn down; keep whatever arrived
    }
  })();
  return { done, text: () => buf };
}

const bunRun: CommandRunner = async (argv, opts) => {
  let proc;
  try {
    // detached: the child leads its own process group (setsid on POSIX), so a
    // timeout can SIGKILL the whole group. Without this, Linux `sh` forks the
    // real command and killing only the shell orphans a child that still
    // holds our stdout/stderr pipes open.
    proc = Bun.spawn([...argv], { cwd: opts.cwd, stdout: "pipe", stderr: "pipe", detached: true });
  } catch (err) {
    return { code: 127, stdout: "", stderr: `spawn failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  const stdout = drain(proc.stdout);
  const stderr = drain(proc.stderr);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      // Not a group leader (non-POSIX, or the child already exited);
      // fall back to killing just the direct child.
      try {
        proc.kill("SIGKILL");
      } catch {
        // already gone
      }
    }
  }, opts.timeoutMs);
  try {
    const code = await proc.exited;
    await Promise.race([Promise.all([stdout.done, stderr.done]), Bun.sleep(PIPE_DRAIN_GRACE_MS)]);
    return { code: timedOut ? TIMEOUT_EXIT_CODE : code, stdout: stdout.text(), stderr: stderr.text() };
  } finally {
    clearTimeout(timer);
  }
};

function normalizePath(p: string): string {
  return p.trim().replace(/^\.\//, "");
}

/** Parses `git status --porcelain` (v1) output into repo-relative paths. */
function parsePorcelain(out: string): string[] {
  const files: string[] = [];
  for (const line of out.split("\n")) {
    if (line.length < 4) continue;
    let p = line.slice(3);
    const arrow = p.indexOf(" -> ");
    if (arrow !== -1) p = p.slice(arrow + 4); // rename: keep the new path
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
    p = normalizePath(p);
    if (p) files.push(p);
  }
  return files;
}

export async function verifyWorkerClaim(input: {
  worktreePath: string;
  baseRef?: string;
  claim: WorkerClaim;
  run?: CommandRunner;
  timeoutMs?: number;
}): Promise<VerifierReport> {
  const run = input.run ?? bunRun;
  const baseRef = input.baseRef ?? "HEAD";
  const timeoutMs = input.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS;
  const claim = input.claim;
  const reasons: string[] = [];
  const observed: VerifierReport["observed"] = { changedFiles: [], testsPassed: null, testOutputTail: null };

  // Rule 1: the worktree must exist and be a usable git repository.
  const probe = await run(["git", "-C", input.worktreePath, "rev-parse", "--is-inside-work-tree"], {
    cwd: ".",
    timeoutMs: GIT_TIMEOUT_MS,
  });
  if (probe.code !== 0) {
    const detail = tail(probe.stderr || probe.stdout, 200);
    reasons.push(
      /no such file|cannot change to|enoent|not a directory/i.test(detail)
        ? `worktree path does not exist or is not a directory: ${input.worktreePath}`
        : `worktree is not a git repository: ${input.worktreePath} (git: ${detail})`,
    );
    return { verdict: "rejected", reasons, observed };
  }
  if (probe.stdout.trim() !== "true") {
    reasons.push(`worktree is not inside a git work tree: ${input.worktreePath}`);
    return { verdict: "rejected", reasons, observed };
  }

  // Rule 2: observe the actually-changed files (unstaged/staged/untracked
  // via porcelain, plus anything committed relative to baseRef).
  const gitOpts = { cwd: ".", timeoutMs: GIT_TIMEOUT_MS };
  const [status, diff] = await Promise.all([
    run(["git", "-C", input.worktreePath, "status", "--porcelain"], gitOpts),
    run(["git", "-C", input.worktreePath, "diff", "--name-only", baseRef], gitOpts),
  ]);
  if (status.code !== 0) reasons.push(`could not observe worktree status (git status exited ${status.code}): ${tail(status.stderr, 200)}`);
  if (diff.code !== 0) reasons.push(`could not observe diff against ${baseRef} (git diff exited ${diff.code}): ${tail(diff.stderr, 200)}`);

  const changed = new Set<string>();
  if (status.code === 0) for (const f of parsePorcelain(status.stdout)) changed.add(f);
  if (diff.code === 0) {
    for (const line of diff.stdout.split("\n")) {
      const f = normalizePath(line);
      if (f) changed.add(f);
    }
  }
  observed.changedFiles = [...changed].sort();

  const claimedFiles = new Set((claim.filesChanged ?? []).map(normalizePath));
  for (const f of claimedFiles) {
    if (!changed.has(f)) reasons.push(`claimed file was not changed (ghost): "${f}"`);
  }
  for (const f of changed) {
    if (!claimedFiles.has(f)) {
      reasons.push(
        claim.filesChanged === undefined
          ? `file changed but claim declares no filesChanged scope: "${f}"`
          : `file changed but was not claimed (scope violation): "${f}"`,
      );
    }
  }

  // Rules 3–5: if a test command was claimed, run it ourselves and observe.
  if (claim.testCommand) {
    const result = await run(["sh", "-c", claim.testCommand], { cwd: input.worktreePath, timeoutMs });
    observed.testOutputTail = tail([result.stdout, result.stderr].filter(Boolean).join("\n")) || null;
    observed.testsPassed = result.code === 0;
    if (result.code === TIMEOUT_EXIT_CODE) {
      reasons.push(`test command timed out after ${timeoutMs}ms (not counted as passed)`);
    } else if (result.code !== 0) {
      reasons.push(
        claim.testsPassed === true
          ? `test command exited with code ${result.code} — claim asserted testsPassed=true, rejecting failed-test completion claim`
          : `test command exited with code ${result.code}`,
      );
    }
  } else if (claim.testsPassed !== undefined) {
    reasons.push(`claim asserts testsPassed=${claim.testsPassed} but provides no testCommand; cannot independently verify`);
  }
  if (claim.testsPassed === false) reasons.push("worker claim itself reports tests not passing");

  // Rule 6: an empty claim is a report, not evidence.
  if (!claim.filesChanged?.length && claim.testsPassed === undefined && !claim.testCommand) {
    reasons.push("no verifiable claim: worker claim is empty");
  }

  // Rule 7: verified requires a clean claim/observation match AND observed
  // test passage; anything short of observed passage fails closed.
  if (reasons.length === 0 && observed.testsPassed !== true) {
    reasons.push("test passage was not independently observed");
  }

  return { verdict: reasons.length === 0 ? "verified" : "rejected", reasons, observed };
}
