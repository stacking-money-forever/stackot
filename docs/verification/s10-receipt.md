# S10 receipt — Gateway 요청 시간 제한 오라클

## 변경 파일
- `receiver/src/gateway.ts`
- `receiver/test/gateway.test.ts`

## 핵심 diff 요약
- `gateway.ts`: `export const GATEWAY_TIMEOUT_MS = 10_000` 추가. `forwardToGateway`에 네 번째 인자 `opts: { timeoutMs?: number } = {}` 추가. `AbortSignal.timeout(10_000)` → `AbortSignal.timeout(opts.timeoutMs ?? GATEWAY_TIMEOUT_MS)`. 하드코딩된 리터럴 `10_000`은 export 상수 선언부에만 남음.
- `gateway.test.ts`: `GATEWAY_TIMEOUT_MS` 임포트, 공용 `ev` fixture와 `cfgFor(port)` 헬퍼 추가, 테스트 4개 추가(기본값 상수 단언, hanging 게이트웨이 타임아웃, 502 비-2xx, opts 생략 기본 경로). 기존 프레이밍/헤더 테스트는 무수정.

## 타임아웃 주입 방식
- 시그니처: `forwardToGateway(cfg, ev, deliveryId, opts = {})`.
- `opts.timeoutMs` 미지정 시 `GATEWAY_TIMEOUT_MS`(10_000ms)를 사용하므로 기존 호출부(`server.ts`의 drainer 콜백, 3인자)는 변경 없이 호환.
- 타임아웃 발화 시 `fetch`가 reject → `forwardToGateway`가 reject를 그대로 전파 → DeliveryDrainer가 throw를 실패로 처리해 기존 재시도/백오프 경로 유지.

## 오라클 실행 결과 (원문)

### `cd receiver && bun run typecheck`
```
$ tsc --noEmit
```
(종료 코드 0, 출력 없음)

### `cd receiver && bun test test/gateway.test.ts`
```
bun test v1.4.0 (34cbb9a40)

test/gateway.test.ts:
(pass) forwardToGateway > sends framed message with idempotency key [2.42ms]
(pass) forwardToGateway > exposes the default timeout as GATEWAY_TIMEOUT_MS [0.02ms]
(pass) forwardToGateway > rejects a hanging gateway in bounded time (timeoutMs: 50) [52.51ms]
(pass) forwardToGateway > returns ok:false on 502 without throwing [0.97ms]
(pass) forwardToGateway > uses the default timeout when opts are omitted [0.58ms]

 5 pass
 0 fail
 15 expect() calls
Ran 5 tests across 1 file. [61.00ms]
```

### `cd receiver && bun test`
```
 207 pass
 0 fail
 411 expect() calls
Ran 207 tests across 16 files. [2.81s]
```

## 남은 리스크
- hanging 테스트의 상한(2초)은 타임아웃 미적용 회귀를 잡기에 충분하지만, 극단적으로 느린 CI에서는 경계 플래키 가능성이 있다(현재 실측 ~52ms, 여유 40배).
- 타임아웃 오류 식별은 name+message에 대한 `/timeout|abort/i` 매칭이다. Bun의 reject 값이 DOMException `TimeoutError`이므로 현재는 통과하지만, 런타임이 에러 문자열을 바꾸면 테스트가 함께 실패한다(의도된 결합).
- `server.ts`는 계약대로 미수정 — 기본 10초 경로는 "빠른 스텁 정상 동작" 테스트로만 간접 검증됨. 실제 10초 hang 회귀는 스위트 시간상 커버하지 않는다.
