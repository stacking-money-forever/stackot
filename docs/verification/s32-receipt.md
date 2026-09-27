# S32 — worker 결과 독립 검증 receipt

- Base: `9b6dac05c6397c0b7c055d21dddb55561d7fe391` (worktree HEAD at launch)
- Scope: ONE changeset, two new files. No commits/pushes made.

## Changed files

- `receiver/src/verifier.ts` (new, ~200 lines)
- `receiver/test/verifier.test.ts` (new, ~215 lines)
- `docs/verification/s32-receipt.md` (this receipt)

## Core diff summary

`verifyWorkerClaim({ worktreePath, baseRef = "HEAD", claim, run?, timeoutMs? })` treats the
worker report as a claim, not evidence:

1. Probes `git -C <worktree> rev-parse --is-inside-work-tree` — any failure is an early `rejected`.
2. Observes changed files as the union of `git status --porcelain` (untracked/staged/unstaged)
   and `git diff --name-only <baseRef>`, then diffs against `claim.filesChanged`:
   claimed-but-unchanged = ghost; changed-but-unclaimed = scope violation. `filesChanged`
   absent means no declared scope, so every observed change is flagged.
3. If `claim.testCommand` exists the verifier runs it itself via `sh -c` with `cwd` =
   worktree and `timeoutMs` (default 120s, hard SIGKILL at expiry). Exit code, not the
   claim string, sets `observed.testsPassed`.
4. `observed` is populated only from verifier-side observations (git output, real exit
   code, redacted output tail ≤1000 chars) — never copied from the claim.
5. All process access flows through the injectable `CommandRunner`; the default is a
   Bun.spawn implementation. Secret-shaped strings (ghp_*, github_pat_*, Bearer,
   `*_KEY|TOKEN|SECRET|PASSWORD=`, `Authorization:`, `//user@` URL creds) are redacted
   before anything lands in `reasons` or `observed.testOutputTail`.

## Verdict rules (as implemented)

| # | Observation | Verdict | Reason emitted |
|---|---|---|---|
| 1 | worktree missing / not a git repo / not a work tree | rejected | path or `git rev-parse` detail |
| 2 | claimed file not actually changed | rejected | `claimed file was not changed (ghost)` |
| 2 | file changed but not claimed | rejected | `file changed but was not claimed (scope violation)` / `…no filesChanged scope` |
| 2 | git status/diff itself fails | rejected | `could not observe worktree status/diff` |
| 3 | `testsPassed: true` but real exit code ≠ 0 | rejected | `exited with code N — claim asserted testsPassed=true, rejecting failed-test completion claim` |
| 3 | test command exits ≠ 0 (any claim) | rejected | `test command exited with code N` |
| 4 | `testsPassed` asserted without `testCommand` | rejected | `provides no testCommand; cannot independently verify` |
| 5 | runner returns timeout code (124) | rejected | `test command timed out after <ms> (not counted as passed)` |
| 6 | claim empty (no fields) | rejected | `no verifiable claim: worker claim is empty` |
| — | `testsPassed: false` in claim | rejected | `worker claim itself reports tests not passing` |
| 7 | no violations AND `observed.testsPassed === true` | verified | — |

Fail-closed: any path that cannot produce observed test passage emits a reason and rejects.

## Wiring status — NOT CONNECTED

This module is **not wired into the receiver pipeline** (no imports from `server.ts`,
`delivery.ts`, `scheduler.ts`, or anywhere else). Intended integration point: the S30/S33
worker-orchestration row calls `await verifyWorkerClaim({ worktreePath, baseRef, claim })`
when a worker reports done and gates promotion on `report.verdict === "verified"`.

## Oracle runs (verbatim output)

### `cd receiver && bun run typecheck`

```
$ tsc --noEmit
```
(exit 0, no diagnostics)

### `cd receiver && bun test test/verifier.test.ts`

```
bun test v1.4.0 (34cbb9a40)

test/verifier.test.ts:
(pass) verifyWorkerClaim > honest worker: claim matches observed changes and tests really pass -> verified [89.34ms]
(pass) verifyWorkerClaim > lying worker: claims testsPassed but the real command fails -> rejected [81.11ms]
(pass) verifyWorkerClaim > ghost file: claim lists a file that was not changed -> rejected [76.70ms]
(pass) verifyWorkerClaim > unclaimed change: a real change outside the claim -> rejected [75.89ms]
(pass) verifyWorkerClaim > test claim without a testCommand is unverifiable -> rejected [73.42ms]
(pass) verifyWorkerClaim > empty claim -> rejected [73.40ms]
(pass) verifyWorkerClaim > missing worktree path -> rejected [8.65ms]
(pass) verifyWorkerClaim > non-git directory -> rejected [8.36ms]
(pass) verifyWorkerClaim > test command that exceeds timeoutMs -> rejected as timeout, not passed [376.90ms]
(pass) verifyWorkerClaim > injected runner receives expected argv, cwd and timeoutMs [106.29ms]
(pass) verifyWorkerClaim > observed changes are still checked when claim declares no filesChanged [87.85ms]
(pass) verifyWorkerClaim > secrets never appear in reasons or observed output [58.36ms]
(pass) verifyWorkerClaim > test output tail is redacted and truncated [73.68ms]

 13 pass
 0 fail
 38 expect() calls
Ran 13 tests across 1 file. [1198.00ms]
```

### `cd receiver && bun test`

```
 343 pass
 0 fail
 1199 expect() calls
Ran 343 tests across 31 files. [51.39s]
```

## Remaining risks

- `testCommand` runs via `sh -c` — a malicious command string executes in the worktree
  with the verifier's env. Sandboxing/env scrubbing is the integrator's (S30/S33) job.
- Timeout is signaled by exit code 124 (timeout(1) convention); a test command that
  coincidentally exits 124 without being killed is reported as a timeout — still a
  rejection, just a differently worded reason.
- Porcelain parsing covers `XY path`, `??`, and `old -> new` renames; exotic quoted
  rename paths may compare imperfectly (still fails closed as ghost/unclaimed).
- File comparison is exact repo-relative path match after `./` normalization; a worker
  claiming absolute or `./`-style paths will be flagged rather than silently matched.
- `baseRef` defaults to `HEAD`; if the worker itself moved HEAD, `git diff HEAD` sees
  nothing committed — the launch contract expects the owner to pass the recorded
  launch SHA when that matters.
