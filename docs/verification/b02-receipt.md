# B02 receipt — repo별 동시 실행 상한과 공정성 (wave 04)

Candidate only. No commit/push/merge/deploy. Base: worktree HEAD (`ece4aad`).

## 변경 파일

| 파일 | 변경 |
|---|---|
| `receiver/src/scheduler.ts` | 신규. 순수 `selectRunnable(ready, inFlight, limits)` — 네트워크/DB/입력 변형 없음. |
| `receiver/src/outbox.ts` | `dueBatch(limit)` 추가만. `due()`와 동일 조건·정렬(`state='pending' AND next_attempt_at <= now ORDER BY next_attempt_at`), 단일 쿼리, `LIMIT`는 `max(0, floor(limit))`로 클램프. `due()`·스키마·PRAGMA 무수정. |
| `receiver/src/delivery.ts` | 동시 drain. `DeliveryOutbox`에 선택적 `dueBatch?` 추가(아래 리스크 1 참조). 생성자 3번째 인자 `limits: SchedulerLimits = { maxGlobal: 4, maxPerRepo: 1 }`. |
| `receiver/test/scheduler.test.ts` | 신규. 전역/repo 상한, in-flight+선택 합산, A,B,A,B 교대, 경계(0, maxPerRepo>maxGlobal, 빈 ready), 결정성·무결성 8건. |
| `receiver/test/delivery.test.ts` | 추가 4건: 기아(held A vs 즉시 B, 실 Outbox), repo별 동시 상한 계측, 중복 drain 중복 전달 금지, 실패 격리+백오프. 기존 단언 유지. |
| `receiver/test/outbox.test.ts` | 추가 2건: dueBatch limit/정렬/due() 일치/미래 행 제외, limit 0·빈 outbox. |

## 핵심 diff 요약

- `drain()`는 패스 내내 `inFlight`(id→{job,done})와 `pool`(가져왔지만 아직 시작 못 한 후보)을 유지한다. 매 반복: `candidates()`로 due 행을 가져와(이미 in-flight/pool인 id는 제외) pool에 넣고, `selectRunnable`이 허용한 작업을 즉시 `run()`으로 동시 시작한다(서로 await하지 않음). 선택할 게 없으면 in-flight 완료 또는 `kick`을 `Promise.race`로 대기.
- `run()`은 기존과 동일한 성공/실패 처리(`delivered` / `fail(id, attempts+1, msg)`, `{ok:false}`→`gateway rejected delivery (status …)` throw 후 catch). 한 작업의 실패가 다른 작업을 중단시키지 않는다.
- 중복 전달 금지: `done`은 절대 reject하지 않는다(성공→inFlight에서 제거, outbox 쓰기 실패→`firstError` 기록 + id를 in-flight에 유지해 재후보화 차단). `finally`에서 남은 in-flight를 `allSettled`로 기다린 뒤에야 `draining`을 해제 → 다음 패스가 아직 pending인 행을 다시 읽어 두 번 forward하는 일이 없다.
- `draining` 재진입 방지 유지 + 확장: 진행 중 drain() 재호출은 여전히 즉시 반환하지만 `kick?.()`으로 대기 중인 패스를 깨운다 — 느린 in-flight에 parked된 동안 enqueue된 행이 느린 repo 뒤에서 굶지 않게 한다.

## 스케줄러 규칙 표

| 규칙 | 내용 |
|---|---|
| 전역 상한 | `inFlight.length + selected.length <= maxGlobal` |
| repo별 상한 | repo당 `in-flight + selected` 합계가 `maxPerRepo` 미만일 때만 추가 선택 |
| 우선순위 | running 수가 가장 적은 repo 우선(선택분 포함). 동률 → `ready` 순서(FIFO, outbox `next_attempt_at` 순) |
| 결과 | ready가 A,B 모두 깊으면 A,B,A,B…로 교대 — 한 repo 독식 불가 |
| 순수성 | 입력 비변형, 동일 입력→동일 출력, 부수효과 없음 |

## 실행한 명령과 결과

- `cd receiver && bun install --frozen-lockfile` — node_modules 부재로 1회 실행(허용 범위). `6 packages installed`.
- `cd receiver && bun run typecheck` → `$ tsc --noEmit`, exit 0, 출력 없음(clean).
- `cd receiver && bun test test/scheduler.test.ts test/delivery.test.ts test/outbox.test.ts` → `34 pass / 0 fail / 156 expect() calls, 3 files, ~21s`. 신규 8+4+2 테스트 전부 pass, 기존 단언 전부 유지.
- `cd receiver && bun test` → `330 pass / 0 fail / 1159 expect() calls, 30 files, 48.61s`.

## 남은 리스크

1. **프로덕션 배선 미완(중요)**: `server.ts`의 `TelemetryOutbox`는 `DeliveryOutbox`만 구현하고 `dueBatch`가 없다. `dueBatch`는 선택 멤버이므로 typecheck는 통과하지만, drainer는 `due()` 폴백으로 사실상 기존 순차 동작(패스당 후보 1건)을 한다. 이 changeset은 메커니즘만 제공하고, 실제 프로덕션 동시성은 `TelemetryOutbox`가 `dueBatch`를 위임하도록 하는 후속(server.ts 편집)이 필요하다. `seenAttempts`/`targets` 맵은 id 키라 배치 경로에서도 그대로 동작한다.
2. 동시 forward → `delivered`/`fail` 쓰기가 동시에 몰릴 수 있다. WAL + `busy_timeout=5000`이 이미 있어 경합은 대기로 해소되지만, 쓰기 락 대기 시간이 길어질 수 있다(정합성 리스크는 아님).
3. resolve되지 않는 forward는 패스를 무한 유지시킨다(기존과 동일). 단 이제는 그 동안 다른 repo의 신규 행도 계속 처리된다. `drain()` promise 자체는 기존처럼 반환되지 않을 수 있다.
4. outbox 쓰기 실패(`delivered`/`fail` throw)는 `firstError`로 기록돼 다음 루프에서 drain()을 reject시킨다 — 기존 "drain이 throw" 의미 유지. 다만 throw 전에 나머지 in-flight가 먼저 완료된다(finally `allSettled`).
5. pool은 패스 동안만 살고 최대 `maxGlobal + inFlight.size`개까지 가져오므로 메모리 상한은 작다. capped 후보는 다음 선택 라운드에서 재사용된다.
