# Wave 01 launch contract

Owner: current Codex/Astra thread. Model requested and launched: Devin CLI `--model swe-2`; family listing resolves variants, no custom variant substituted. Meter coverage: uncovered Devin provider. Product baseline 1259895.

S01: scope config.ts + config.test.ts; artifact webhook-secret validation delta; oracle `cd receiver && bun test test/config.test.ts`; acceptance valid bytes preserved, missing/blank/non-string rejected; evidence L. Worktree `/Users/justn/dev/.worktrees/stackot-s01-20260921`; pane w5E:p2. Placement split w5E:p1 right 0.35, no focus.

S02: scope outbox.ts + outbox.test.ts; artifact reviewed store port; oracle `cd receiver && bun test test/outbox.test.ts`; acceptance persistence, delayed retention, migration and nested mkdir; evidence S. Worktree `/Users/justn/dev/.worktrees/stackot-s02-20260921`; pane w5E:p3. Placement split w5E:p2 down 0.5, no focus.

Each launch prompt is in its task checkout docs/verification/s01-launch.txt or s02-launch.txt. Max two Todo items, no subagents, no external writes, no commits. Retry limit one narrowed attempt. Worker writes candidate receipt only; owner reviews and records decision here. Workers do not edit this owner ledger.

Status: launched; acceptance pending.

Live route evidence: both pane process argv contain exact `devin --model swe-2`; both TUI footers show SWE-2 High (native family resolution, not manually substituted). S01 Herdr start readiness timed out although the real Devin process was running; manage exact pane w5E:p2 without relaunch or model change. S02 start returned success. File-edit and test approval prompts are inspected and approved one command at a time within the already authorized local task; no global allow rules.

Tooling correction: worker shells lack apply_patch on PATH. Parent supplied exact current executable `/Users/justn/.codex/tmp/arg0/codex-arg05Jo4B8/apply_patch`. S02 initially wrote its port using Devin's edit tool before consuming the queued correction; owner integration will use apply_patch and record this workflow deviation. No scope expansion authorized.

DAG check: 67 unique task IDs, all predecessors exist earlier in topological order, zero cycles/forward references.

S02 ACCEPT (bounded store only): owner read full outbox and test delta, core oracle 4 passed / 15 assertions, source byte-identical to donor, no unauthorized product paths changed, HEAD unchanged 1259895. Candidate receipt exists. Devin session exited to shell after producing candidate. Owner integrated exactly two files with apply_patch into completion worktree. Pending risk: server still uses legacy dedupe; no ACK/runtime recovery claim.

S01 ACCEPT (configuration secret only): owner inspected the three-line validation and eight narrow regression cases, ran 14 passed / 17 assertions, then applied the exact scoped source/test delta into the completion checkout. The validation preserves valid secret bytes and rejects missing, blank, whitespace-only and non-string values. The Devin report retry was interrupted after it re-ran its oracle but before receipt output; owner evidence is sufficient for the bounded change. Pending risk: no broader URL/port/placeholder validation and no live config proof.

Permission policy update: all prior accept-edits workers exited. From S03A onward every interactive Devin launch must have actual foreground argv `--model swe-2 --permission-mode dangerous`; parent checks process-info immediately and terminates/relaunches any mismatch. `dangerous` removes worker prompt friction only; task scope, no-commit/push/merge/deploy/release, no outside-repo writes, and direct owner acceptance remain unchanged. S03A/w5E:p4 and S16/w5E:p5 passed this argv check.

S03A ACCEPT (port only): owner inspected the exact validation and nine invalid-input cases, re-ran 24 focused config tests, then applied only the port delta into completion. Explicit ports must be integers in 1..65535; absent port still defaults to 9377; explicit null is rejected. Full integration test suite after S01/S02/S03A/S16: 51 passed / 101 assertions. Pending risk: URL and literal-placeholder validation are separate S03B/S03C tasks.

S16 ACCEPT (thread classification only): owner inspected two source lines and the eight action cases, re-ran 16 focused normalize tests, then applied only that delta into completion. Full integration result is included in S03A's 51-pass run. Pending risk: mapping lookup and actual Discord side effects remain unverified.

S17 REJECTED/DEFERRED: it was launched before the one-worker limit and stopped while editing `mapping.ts`; the partial delta remains only in `/Users/justn/dev/.worktrees/stackot-s17-20260921`. It was not integrated or tested. Its pane was closed after a live idle check. Recreate S17 as a new single-worker task only after all currently earlier dependency-ready work is integrated.

One-worker policy: all extra worker panes have been closed after live checks. Future waves contain exactly one Devin. An idle/done worker is reviewed, accepted/rejected and pane-closed before a successor is created.

S03B ACCEPT after one narrowed retry: owner rejected the first candidate because WHATWG URL parsing accepted surrounding whitespace. The retry added a raw-whitespace gate and two regression cases. Owner re-ran 42 focused config tests, applied only the URL validation and its tests into completion, then re-ran the full integration suite: 69 passed / 121 assertions. Pending risk: literal placeholder values are S03C; network reachability is intentionally not part of syntax validation.

S04A ACCEPT (package test script only): owner inspected the three-line package delta and ran `bun run test` in the candidate checkout. The script invokes the existing runner with 21 passed / 43 assertions. Owner applied the exact package change into completion. Pending risk: typecheck/build scripts and canonical lockfile work remain separate S04B-D tasks.

S04B ACCEPT (package typecheck script only): owner inspected the one-line script, ran frozen install plus `bun run typecheck` in the candidate checkout without lockfile drift, and applied the exact line into completion. Pending risk: completion checkout must still run the same install/typecheck evidence; build and lockfile location remain S04C-D.

S04C ACCEPT (build script and generated-output ignore): owner confirmed the exact bundler command, nonempty `dist/server.js`, and ignore match, then applied only the package build line and `receiver/dist/` ignore rule. Completion typecheck/test remains green. Pending risk: canonical lockfile location is S04D; a successful bundle does not prove runtime configuration or deployment.

S03C1 ACCEPT (webhook-secret placeholder only): owner inspected the whole-token placeholder regex and its two focused tests, re-ran the oracle, and applied the exact delta. Non-placeholder secrets containing angle brackets remain valid. The remaining gateway/GitHub/channel placeholder checks stay separate S03C2-C4 tasks.

S03C2 ACCEPT after one narrowed regex correction (hook-token placeholder only): owner rejected the first greedy bracket pattern, required S03C1-compatible one-token semantics plus a `<a><b>` acceptance regression, then re-ran the oracle and integrated the corrected delta. Fresh done-state and process checks preceded closing owned pane w5E:pC. The task worktree remains intact. Completion typecheck and suite: 73 passed / 127 assertions. S03C3-C4 remain pending.

S03C3 ACCEPT after one narrowed regex correction (GitHub-token placeholder only): same one-token rule and `<a><b>` positive regression were required before acceptance. Owner re-ran the focused oracle and integrated the bounded change. S03C4 remains pending.

S07 REJECTED: the assigned worker did not produce the required repository shape gate or child-process integration test after its one bounded retry. The partial inherited S05B server diff remains only in `/Users/justn/dev/.worktrees/stackot-s07-20260921`; no S07 source/test change was integrated. The task must be re-specified from a fresh worktree before retrying with a new worker.

## Owner correction 2026-09-21 — retained-worktree claims falsified

Owner re-checked retention before the first commit of this branch. `stackot-s01-20260921`, `stackot-s02-20260921`, `stackot-s07-20260921` and `stackot-s17-20260921` are absent: `find /Users/justn/dev -maxdepth 3 -type d -name 'stackot-s*'` returns nothing, and `git worktree list` shows only `stackot` (main), `stackot-completion-20260921`, `stackot-ps-todos-20260913`, `stackot-receiver-delivery-20260914`, `stackot-roadmap`.

Consequences: the earlier statements in this file that a task worktree "remains intact" and that the S17 partial delta "remains only in .../stackot-s17-20260921" no longer hold. Those per-task launch prompts, worker receipts and rejected candidates are unrecoverable, so the "retain candidate and evidence" contract cannot be satisfied retroactively for S01, S02, S07 and S17. Accepted deltas survived only because the owner had applied them into this completion checkout. S07 and S17 have no candidate left to re-inspect and must be re-specified from scratch; nothing in this file should be read as independent evidence that any worker candidate still exists on disk.
