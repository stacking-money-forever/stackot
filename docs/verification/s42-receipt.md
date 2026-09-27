# S42 receipt — 전달 상태 구조화 로그 (retry 1/1)

Base: `0d56fdc` (worktree HEAD at launch). One changeset; no commits made by candidate.

Retry 1/1 변경: 백오프 공식의 단일 소유자를 `outbox.ts`로 확정 — `retryDelayMs`를 export 함수로 승격하고 `server.ts`의 복제본을 삭제. 통합 테스트에 `delivery.failed.nextAttemptAt` ↔ DB `next_attempt_at` 드리프트 검출 단언(허용 오차 1초) 추가.

## 변경 파일

| 파일 | 상태 | 내용 |
|---|---|---|
| `receiver/src/telemetry.ts` | 신규 | `createTelemetry(sink, secrets)` — 4개 이벤트 메서드, 한 줄 JSON emit, 모든 문자열 필드 `redact()` 통과, 화이트리스트 스키마 |
| `receiver/src/outbox.ts` | 수정 (오너가 retry 범위에 추가) | `export function retryDelayMs(attempts)` 신규 — 기존 `Outbox.retry`의 공식을 그대로 승격, `Outbox.retry`가 그 함수를 사용. 동작·스키마·PRAGMA·시그니처 변경 없음 |
| `receiver/src/server.ts` | 수정 | 텔레메트리 생성, `TelemetryOutbox`(DeliveryOutbox 데코레이터)로 drainer 배선, route `reason` 기반 `routing.fallback` emit. 백오프는 outbox.ts에서 import |
| `receiver/test/telemetry.test.ts` | 신규 | 단위 테스트 8건 (라인 형상, redaction, 화이트리스트) |
| `receiver/test/server.telemetry.integration.test.ts` | 신규 | 프로세스 테스트 4건 (생애주기 상관+드리프트 검출, dead-letter, 폴백 관측, 무-secret/무-본문) |

그 외 금지 파일(`delivery.ts`, `router.ts`, `mapping.ts`, …) 및 기존 테스트 미수정 — `git status`로 확인.

## 핵심 diff 요약

- `TelemetryOutbox implements DeliveryOutbox`: `due()`가 반환한 `attempts`를 id별로 기록; `delivered(id)`는 inner write 성공 후 `delivery.delivered` emit; `fail(id, attempts, error)`는 한도(`MAX_DELIVERY_ATTEMPTS`) 도달 시 `delivery.dead_letter`, 미만이면 `delivery.failed`(+`nextAttemptAt`). emit은 항상 inner 위임 성공 후라 라인이 영속 상태를 반영.
- **백오프 소유자 = `outbox.ts` 하나**: `retryDelayMs(attempts)`가 `Outbox.retry`와 `TelemetryOutbox.fail` 양쪽의 유일한 계산원. `delivery.failed.nextAttemptAt` = `Date.now() + retryDelayMs(attempts)`로 영속 스케줄과 동일 공식·동일 시점에 계산.
- **드리프트 검출**: 통합 테스트가 각 `delivery.failed` 라인 직후(row를 due로 당기기 전) DB `next_attempt_at`을 읽어 `nextAttemptAt`과 ±1초 이내 일치를 단언 — 텔레메트리가 outbox 실제 스케줄에서 어긋나면 테스트가 실패.
- `delivered.target`: 저장 이벤트는 미라우팅 상태(S21b)라 forwarder가 `route()` 직후 `noteTarget(id, decision.target || createThread.forumChannelId)`으로 실제 목적지를 기록.
- `routing.fallback`: `decision.reason ∈ {unconfigured-repo, ci-alerts, followup-unresolved, unrouted}`일 때 emit. 정상 reason(`opened-issue`/`opened-pr`/`followup-resolved`/`ci-linked-pr-thread`)에는 미emit.
- sink는 `console.log` 한 줄 — stdout에서 deliveryId로 grep 가능.

## 이벤트 스키마

공통 필드: `event` (이벤트명), `at` (emit 시각, epoch ms), `deliveryId` (GitHub X-GitHub-Delivery, 상관 키).

| event | 추가 필드 | 의미 |
|---|---|---|
| `delivery.delivered` | `attempts`, `target` | 게이트웨이 전달 성공. `attempts`=직전 실패 횟수(due() 반환값 그대로, 계약 리터럴). `target`=라우팅된 스레드/채널 ID(createThread 시 forum channel) |
| `delivery.failed` | `attempts`, `error`, `nextAttemptAt` | 시도 실패·재시도 예약. `attempts`=방금 실패한 시도 번호(1..4), `nextAttemptAt`=다음 시도 예정(epoch ms, outbox `retryDelayMs` 공유) |
| `delivery.dead_letter` | `attempts`, `error` | 한도(5) 도달로 dead-letter 전이 |
| `routing.fallback` | `repo`, `item`, `reason` | admin/#ci-alerts 폴백 라우팅. `reason`=router 결정 사유 |

모든 문자열 필드는 S39 `redact()` 적용. `summary`/`body` 등 본문 필드는 스키마에 없어 호출자가 넘겨도 라인에 포함 불가.

## 오라클 실행 결과

### `cd receiver && bun run typecheck`

```
$ tsc --noEmit
```
(exit 0, 출력 없음)

### `cd receiver && bun test test/telemetry.test.ts test/server.telemetry.integration.test.ts`

```
bun test v1.4.0 (34cbb9a40)

test/telemetry.test.ts:
(pass) telemetry line shape > delivered emits one JSON line with event, deliveryId, attempts, target [0.12ms]
(pass) telemetry line shape > failed emits nextAttemptAt and error alongside the correlation fields [0.03ms]
(pass) telemetry line shape > deadLettered carries the terminal error [0.02ms]
(pass) telemetry line shape > routingFallback carries repo, item, and reason [0.02ms]
(pass) telemetry redaction > secrets embedded in any string field are masked [0.04ms]
(pass) telemetry redaction > blank secrets are ignored and longer secrets mask before their prefixes [0.03ms]
(pass) telemetry whitelist schema > body/summary fields are never emitted even when passed in [0.03ms]
(pass) telemetry whitelist schema > a newline inside a field cannot break the one-line-JSON contract

test/server.telemetry.integration.test.ts:
(pass) S42 structured delivery telemetry > failed attempts 1..N then delivered correlate under one deliveryId [1986.88ms]
(pass) S42 structured delivery telemetry > a delivery that exhausts the retry cap emits delivery.dead_letter [3035.65ms]
(pass) S42 structured delivery telemetry > an unresolved follow-up emits routing.fallback with the reason [103.86ms]
(pass) S42 structured delivery telemetry > no stdout/stderr line carries a raw secret or event body text [201.43ms]

 12 pass
 0 fail
 156 expect() calls
Ran 12 tests across 2 files. [5.40s]
```

### `cd receiver && bun test`

```
 256 pass
 0 fail
 852 expect() calls
Ran 256 tests across 24 files. [18.23s]
```

전 파일 pass — 200 accepted/duplicate, 503, retry/dead-letter, S09A/S09B/S21b/S39, /healthz·/readyz 회귀 없음.

## 남은 리스크

- `nextAttemptAt`은 outbox가 persist한 `next_attempt_at`과 같은 공식을 공유하지만 `Date.now()` 호출 시점이 수 ms 차이라 정밀 일치는 아님 — 통합 테스트가 ±1초 내 일치를 단언해 실질 드리프트를 검출.
- `delivered.attempts`는 계약 리터럴("최근 due() 반환값")대로 직전 실패 횟수 — 첫 시도 성공은 `attempts:0`. "총 시도 횟수"로 읽으면 off-by-one으로 보일 수 있음.
- 폴백 집합에 계약 예시 3종 외 `unrouted`를 포함 — admin/ci-alerts가 아닌 `ev.target=""`로 떨어지는 비정상 라우팅이므로 관측 가치가 있다고 판단. 예시만 허용이 의도였다면 제외 필요.
- `routing.fallback`은 재시도마다 route()가 다시 실행되므로 같은 deliveryId로 반복 emit됨(시도별 관측 — dedupe 없음).
- 기존 `console.warn`/`console.error` 라인(router lookup 실패 등)은 비구조화 상태로 잔존 — 이번 범위 밖.
- stdout 혼재: 구조화 라인과 `stackot receiver listening…` 같은 비JSON 라인이 같은 스트림 — 소비자는 `{` prefix + JSON.parse로 필터해야 함(테스트도 동일 방식).
