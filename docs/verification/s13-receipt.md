# S13 receipt — dead_letter 수동 재개 경로 (worker candidate)

Worker candidate only. No commit/push/merge/deploy performed. HEAD unchanged at `eb0dba7`.

## 변경 파일 목록

- `receiver/src/replay.ts` — 신규 (36 lines)
- `receiver/test/replay.test.ts` — 신규 (4 tests, 22 assertions)
- `receiver/package.json` — **변경 없음**. `bun src/replay.ts`가 파일을 직접 실행하므로 script 노출이 필요 없다고 판단 (launch contract: "필요할 때 한 줄만" → 필요 없음).

그 외 파일 수정 없음. `git status --short`: 위 두 신규 파일만.

## 핵심 diff 요약

`replay.ts`는 두 가지 표면을 제공한다.

1. **좁은 재개 API** — `replayDelivery(outbox: Outbox, id: string): ReplayResult` where `ReplayResult = "resumed" | "not_found" | "not_dead_letter"`. 기존 프리미티브만 조합한다: `outbox.has(id)`로 행 존재를 먼저 확인하고, `outbox.requeue(id)`(dead_letter만 pending으로 되돌리는 UPDATE … WHERE state = 'dead_letter')로 실제 재개를 수행한다. outbox.ts는 건드리지 않았으므로 스키마·정책 변경은 전혀 없다.
   - `not_found` — 해당 delivery ID의 행이 없음 (대상 아님).
   - `not_dead_letter` — 행은 있으나 상태가 dead_letter가 아님(pending/delivered). 재개된 직후 같은 ID를 다시 호출하면 이 결과가 돌아온다.
   - `resumed` — dead_letter → pending 전이 성공. `requeue`가 `attempts`를 보존하고 `next_attempt_at = now`로 설정하므로 다음 drain에서 즉시 전달된다.
2. **CLI 진입점** — 같은 파일이 `import.meta.main` 가드로 CLI로 동작한다: `bun src/replay.ts <delivery-id>` (cwd receiver). outbox 경로는 `STACKOT_OUTBOX_PATH` 우선, 기본값은 `server.ts`와 동일한 `new URL("../var/outbox.sqlite", import.meta.url).pathname`. 출력은 사람이 읽는 한 줄 (`replayed <id>: dead_letter -> pending` / `not replayed <id>: …`). 종료 코드: 재개 0, 대상 아님(not_found·not_dead_letter) 1, 인자 누락(usage) 2. 종료 코드는 `process.exitCode`로 설정해 DB close와 stdout flush가 자연스럽게 끝나도록 했다.

`replay.test.ts`는 contract의 필수 테스트 4건을 그대로 커버한다.

- 정확한 ID의 dead_letter 한 건 재개 → `due()`에 나타나고 `attempts = MAX_DELIVERY_ATTEMPTS` 보존, `state = pending`, `next_attempt_at <= now`.
- 같은 ID 재재개 → `not_dead_letter` 반환 + 행 전체(`SELECT *`) 변화 없음. 미존재 ID → `not_found`.
- 다른 dead_letter 행(`dead-b`: state·attempts·last_error 그대로)과 delivered 행(`done-1`)은 무변경.
- CLI 실실행: `Bun.spawn([process.execPath, "src/replay.ts", id])`로 성공(0, 출력 라인 일치, DB에서 pending 확인), 같은 ID 재실행(1), 미존재 ID(1), delivered ID(1)를 검증.

## 실행한 명령과 결과 (oracle 출력 원문)

작업 전 `cd receiver && bun install`을 1회 실행했다 — worktree에 `node_modules`가 없어 `tsc`가 없던 상태였고, bun 캐시에서 `@types/bun@1.4.2`/`typescript@7.0.2` 6개 패키지가 설치됐다(wave-02 기록과 동일 버전).

`cd receiver && bun run typecheck`:

```
$ tsc --noEmit
```

(종료 코드 0, 출력 없음)

`cd receiver && bun test test/replay.test.ts`:

```
bun test v1.4.0 (34cbb9a40)

test/replay.test.ts:
(pass) replays one dead_letter row by exact id: due() returns it with attempts preserved [19.89ms]
(pass) replaying the same id again reports a non-target result and changes nothing [3.13ms]
(pass) other dead_letter and delivered rows are untouched by a replay [2.79ms]
(pass) CLI replays by exact id: exit 0 on resume, exit 1 on non-target [48.45ms]

 4 pass
 0 fail
 22 expect() calls
Ran 4 tests across 1 file. [84.00ms]
```

`cd receiver && bun test`:

```
bun test v1.4.0 (34cbb9a40)
…
 107 pass
 0 fail
 220 expect() calls
Ran 107 tests across 13 files. [2.54s]
```

(전체 출력은 worker 보고에 첨부; 107 pass / 0 fail / 13 files, replay.test.ts 4건 포함. S12 시점 103 pass에서 +4.)

## 남은 리스크

- **재배달 dedupe 경계 (documented, unchanged)**: GitHub 재배달은 같은 delivery ID로 도착하지만 `outbox.has(id)`가 상태를 구분하지 않으므로 dead_letter 행의 재배달은 `200 duplicate`로 응답되고 자동 재개되지 않는다. 본 행은 이 동작을 바꾸지 않는다. **운영 절차**: dead_letter가 확인되면 operator가 `cd receiver && STACKOT_OUTBOX_PATH=<outbox> bun src/replay.ts <delivery-id>`를 실행해 수동 재개한다. `server.ts` dedupe 동작 변경 여부는 owner가 별도 행으로 결정한다.
- **has→requeue 비원자성**: `replayDelivery`는 `has()`와 `requeue()` 두 쿼리를 순차 실행한다. 사이에 행이 삭제되면 `resumed` 대신 `not_dead_letter`가 돌아올 수 있다. outbox에 행 삭제 경로는 TTL cleanup(delivered만)뿐이고 dead_letter 행은 삭제되지 않으므로 실질 영향 없음. CLI는 단발 프로세스라 동시성 경합은 drainer의 state 전이뿐이며, dead_letter 행은 drainer가 건드리지 않는다(due()는 pending만 읽음).
- **CLI 사용법 종료 코드**: contract는 0/1만 명시. 인자 누락은 usage 오류로 2를 반환한다 — "대상 아님"과 구분하기 위한 선택이며 contract 범위 밖의 케이스.
- **`requeue`의 `last_error` 클리어**: 재개 시 `last_error`가 NULL이 된다(기존 requeue 동작, 본 행에서 변경 아님). 재개 전 원인 파악이 필요하면 CLI 실행 전에 DB를 직접 조회해야 한다.
- **CLI는 outbox 파일이 없으면 생성한다**: `Outbox` 생성자가 경로를 `create: true`로 열고 부모 디렉터리를 만든다. 잘못된 `STACKOT_OUTBOX_PATH`로 실행하면 빈 outbox가 생기고 `not_found`/exit 1을 반환한다 — 오타 경로를 조용히 만들 수 있으므로 operator는 경로를 확인해야 한다.
