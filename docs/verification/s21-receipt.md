# S21 — Routing decision module — candidate receipt

Base: worktree HEAD `d41a46b` (docs: record S20 ACCEPT decision and write S21 router contract).
Candidate only — no commit/push/merge/deploy performed.

## Changed files

- `receiver/src/router.ts` (new) — pure routing decision module: `RouteDeps`, `RouteDecision`, `route(ev, deps)`. Injected `resolveThreadId`; no fetch/mapping/outbox/dedupe calls inside.
- `receiver/src/server.ts` — removed inline `resolveTarget`/`titleFrom`; added injected `resolveThreadId` (fetchItem + findThreadId); webhook path now calls `route()` and applies `target`/`targetKind`/`createThread`/`noticeChannelId` to the event.
- `receiver/src/normalize.ts` — added `noticeChannelId?: string` to `NormalizedEvent` (no behavior change).
- `receiver/src/gateway.ts` — message gains `CI 알림 채널: <id>` line only when `ev.noticeChannelId` is set; absent → byte-identical message.
- `receiver/test/routing.test.ts` — extended (S20 block untouched): decision-table describe with 9 table cases, cross-repo isolation case, resolver-throw fallback case, gateway notice-line cases.

## Routing table (priority order)

| Row | Condition | target | targetKind | createThread | noticeChannelId | reason |
|-----|-----------|--------|------------|--------------|-----------------|--------|
| 1 | repo not in `cfg.repos` | `cfg.adminChannelId` | channel | — | — | `unconfigured-repo` |
| 2a | `CI …` + `prNumbers[0]` resolves | thread id | thread | — | `cfg.ciAlertsChannelId` | `ci-linked-pr-thread` |
| 2b | `CI …` unresolved or no PRs | `cfg.ciAlertsChannelId` | channel | — | — | `ci-alerts` |
| 3a | channel-kind `issue …` | `""` | channel | `issuesForumChannelId`, `[repo#N] 제목` (≤100) | — | `opened-issue` |
| 3b | channel-kind `PR …` | `""` | channel | `prsForumChannelId`, `[repo#N] 제목` (≤100) | — | `opened-pr` |
| 3c | channel-kind other (dead path) | `ev.target` | channel | — | — | `unrouted` |
| 4a | thread-kind, lookup resolves | thread id | thread | — | — | `followup-resolved` |
| 4b | thread-kind, unresolved/throw/NaN | `cfg.adminChannelId` | channel | — | — | `followup-unresolved` |

## Oracle output (verbatim)

### `cd receiver && bun run typecheck`

```txt
$ tsc --noEmit

Exit code: 0
```

### `cd receiver && bun test test/routing.test.ts`

```txt
bun test v1.4.0 (34cbb9a40)

test/routing.test.ts:
(pass) check_run linked PR preservation (S20) > failed check_run with linked PR keeps prNumbers, item, and summary ref [0.05ms]
(pass) check_run linked PR preservation (S20) > multiple linked PRs preserve order and dedupe [0.02ms]
(pass) check_run linked PR preservation (S20) > missing pull_requests → prNumbers unset, still channel target [0.01ms]
(pass) check_run linked PR preservation (S20) > empty pull_requests array → prNumbers unset or empty, still channel target [0.01ms]
(pass) check_run linked PR preservation (S20) > malformed number entries are dropped [0.03ms]
(pass) check_run linked PR preservation (S20) > conclusion success → null
(pass) check_run linked PR preservation (S20) > conclusion skipped → null
(pass) check_run linked PR preservation (S20) > conclusion neutral → null
(pass) check_run linked PR preservation (S20) > missing conclusion → null
(pass) check_run linked PR preservation (S20) > non-completed action → null
(pass) route() decision table (S21) > opened issue on configured repo → issues forum createThread [0.21ms]
(pass) route() decision table (S21) > opened PR on configured repo → prs forum createThread
(pass) route() decision table (S21) > issue follow-up resolved → mapped thread [0.05ms]
(pass) route() decision table (S21) > PR follow-up resolved → mapped thread
no thread mapping for a/repo issue #42
(pass) route() decision table (S21) > follow-up unresolved → admin channel [0.01ms]
(pass) route() decision table (S21) > CI + linked PR thread resolved → PR thread + ci-alerts notice
(pass) route() decision table (S21) > CI + linked PR thread unresolved → ci-alerts channel
(pass) route() decision table (S21) > CI + no linked PR → ci-alerts channel, no lookup
repo not configured: ghost/repo
(pass) route() decision table (S21) > unconfigured repo → admin channel
(pass) route() decision table (S21) > repos do not cross: each event uses its own forums and lookups [0.11ms]
mapping lookup failed for a/repo issues #42: warn: github api down
      at boom (.../receiver/test/routing.test.ts:234:17)
      at lookup (.../receiver/src/router.ts:40:23)
      at route (.../receiver/src/router.ts:83:28)
      at <anonymous> (.../receiver/test/routing.test.ts:236:28)

no thread mapping for a/repo issue #42
mapping lookup failed for a/repo pulls #17: warn: github api down
      at boom (.../receiver/test/routing.test.ts:234:17)
      at lookup (.../receiver/src/router.ts:40:23)
      at route (.../receiver/src/router.ts:60:30)
      at <anonymous> (.../receiver/test/routing.test.ts:238:22)

(pass) route() decision table (S21) > resolveThreadId throwing falls back without crashing [0.35ms]
(pass) gateway notice channel line (S21) > noticeChannelId adds a CI 알림 채널 line [2.20ms]
(pass) gateway notice channel line (S21) > absent noticeChannelId leaves the message unchanged [0.73ms]

 23 pass
 0 fail
 54 expect() calls
Ran 23 tests across 1 file. [9.00ms]
```

### `cd receiver && bun test`

```txt
bun test v1.4.0 (34cbb9a40)
… (all 15 files; truncated here, every test "(pass)", no "(fail)" lines)
 175 pass
 0 fail
 350 expect() calls
Ran 175 tests across 15 files. [2.53s]
```

## Remaining risks

- Row 3c (`unrouted`) is unreachable via `normalize()` today; kept as passthrough to match the old `return ev` behavior rather than silently re-targeting.
- CI linked-PR resolution tries only `prNumbers[0]` per the contract; additional linked PRs are not threaded (they'd still hit `ci-alerts` notice path only via the first).
- `noticeChannelId` is delivered as a message line (`CI 알림 채널: <id>`); the agent must still act on it — no receiver-side second POST.
- `bun install` was run once (node_modules absent); no lockfile diff is present in the working tree.
