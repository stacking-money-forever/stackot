# S20 receipt — check_run 연결 PR 보존

Worker: Devin (SWE-2 High), candidate only. No commit/push/merge/deploy performed.

## Changed files

- `receiver/src/normalize.ts` (+20/-2)
- `receiver/test/routing.test.ts` (new, 79 lines)
- `receiver/test/normalize.test.ts` (+18, check_run cases strengthened only; no assertion weakened or removed)
- `docs/verification/s20-receipt.md` (this file, deliverable)

`git status --short` confirms no other files touched.

## Key diff summary

- `NormalizedEvent` gains optional `prNumbers?: number[]`. No other event branch sets it.
- `CheckRunPayload.check_run` gains `pull_requests?: { number?: unknown }[]`.
- `check_run` branch (failure path only, after the existing action/conclusion guards):
  - Collects `number` entries that are finite positive integers (`typeof === "number" && Number.isInteger && n > 0`); missing/string/NaN/Infinity/0/negative/fraction entries are silently dropped.
  - Dedupes while preserving first-seen order; sets `ev.prNumbers` only when non-empty.
  - When ≥1 linked PR, appends summary line `연결 PR: PR #<n>, PR #<m>, …` so human and agent readers can see the PRs.
- Existing check_run behaviour unchanged: non-`completed` action → null; missing/success/skipped/neutral conclusion → null; failures keep `target: ""`, `targetKind: "channel"`, `item: "CI <name>"`.

## Oracle output (verbatim)

### `cd receiver && bun run typecheck`

```text
$ tsc --noEmit
```

Exit 0, no diagnostics.

### `cd receiver && bun test test/routing.test.ts test/normalize.test.ts`

```text
bun test v1.4.0 (34cbb9a40)

test/routing.test.ts:
(pass) check_run linked PR preservation (S20) > failed check_run with linked PR keeps prNumbers, item, and summary ref [0.31ms]
(pass) check_run linked PR preservation (S20) > multiple linked PRs preserve order and dedupe [0.04ms]
(pass) check_run linked PR preservation (S20) > missing pull_requests → prNumbers unset, still channel target [0.01ms]
(pass) check_run linked PR preservation (S20) > empty pull_requests array → prNumbers unset or empty, still channel target [0.01ms]
(pass) check_run linked PR preservation (S20) > malformed number entries are dropped [0.03ms]
(pass) check_run linked PR preservation (S20) > conclusion success → null
(pass) check_run linked PR preservation (S20) > conclusion skipped → null
(pass) check_run linked PR preservation (S20) > conclusion neutral → null
(pass) check_run linked PR preservation (S20) > missing conclusion → null
(pass) check_run linked PR preservation (S20) > non-completed action → null

test/normalize.test.ts:
(pass) normalize > issue opened → channel target with createThread marker [0.10ms]
(pass) normalize > issue labeled (uninteresting action) → null [0.01ms]
(pass) normalize > issue comment → thread target [0.01ms]
(pass) normalize > PR closed merged → merged tail
(pass) normalize > failed check_run → channel target [0.02ms]
(pass) normalize > failed check_run with pull_requests → prNumbers preserved [0.02ms]
(pass) normalize > successful check_run → null
(pass) routing classification (S16) > issues.opened → targetKind channel
(pass) routing classification (S16) > issues.edited → targetKind thread
(pass) routing classification (S16) > issues.closed → targetKind thread
(pass) routing classification (S16) > issues.reopened → targetKind thread
(pass) routing classification (S16) > pull_request.opened → targetKind channel
(pass) routing classification (S16) > pull_request.edited → targetKind thread
(pass) routing classification (S16) > pull_request.synchronize → targetKind thread
(pass) routing classification (S16) > pull_request.closed → targetKind thread
(pass) mapping > threadTitle clamps to 100 chars [0.02ms]
(pass) mapping > findThreadId reads body first, then comments [0.12ms]

 27 pass
 0 fail
 70 expect() calls
Ran 27 tests across 2 files. [7.00ms]
```

### `cd receiver && bun test`

Full run: **162 pass / 0 fail / 319 expect() calls, 15 files, 2.54s.** Per-file sections (all pass): mapping (18), server.restart.integration (1), server.repository.integration (1), server.malformed.integration (1), routing (10), normalize (17), server.size.integration (1), ingress (6), outbox (9), replay (4), verify (6), gateway (1), server.delivery.integration (4), config (77), delivery (5). Tail verbatim:

```text
test/delivery.test.ts:
(pass) delivers pending job once on successful forward [0.07ms]
(pass) fails rejected forward with incremented attempts and status detail [0.05ms]
(pass) fails thrown forward with incremented attempts and the error message [0.04ms]
(pass) fails rejected forward at the attempt limit with status detail [0.04ms]
(pass) fails thrown forward at the attempt limit with the error message [0.04ms]

 162 pass
 0 fail
 319 expect() calls
Ran 162 tests across 15 files. [2.54s]
```

## Setup note

`node_modules` was absent; ran the permitted one-shot `cd receiver && bun install` (6 packages, `@types/bun@1.4.2`, `typescript@7.0.2`). No lockfile/package.json change resulted (`git status` clean of extra modifications).

## Remaining risks

- `prNumbers` is preserved on the normalized event but no downstream consumer uses it yet — S21 router (per wave-02 notes) is still absent, so PR-thread routing for CI failures remains future work; this changeset only removes the data loss.
- `prNumbers` survives outbox JSON persistence automatically (plain field on `NormalizedEvent`); no schema change needed.
- `pull_requests` entries shaped like non-objects (e.g. `null`, primitives) are tolerated at runtime via `pr?.number` + the `typeof` guard; type-level the array element is `{ number?: unknown }` which matches GitHub's documented shape.
