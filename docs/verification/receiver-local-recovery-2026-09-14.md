# Receiver 로컬 장애·복구 실행 기록

- 실행 시각: 2026-09-14 08:39 KST
- 작업 트리: `/Users/justn/dev/.worktrees/stackot-receiver-delivery-20260914`
- 기준 커밋: `d47345367d2259b45e383172f1c555f7bd0b364f`
- 대상: 커밋되지 않은 Receiver outbox 변경 및 자동 통합 테스트
- 외부 서비스: 사용하지 않음. GitHub payload, webhook secret, Gateway 응답은 테스트용 값이다.

## 재실행

```sh
cd receiver
bun install
bun test test/restart.integration.test.ts
bun test
bunx tsc --noEmit
```

통합 테스트는 실제 Bun Receiver 자식 프로세스를 시작한다. 서명된 HTTP webhook을 보내고,
로컬 Gateway 서버가 `502`를 반환할 때 SQLite outbox가 `pending`인지 확인한다. Receiver를
종료한 뒤 같은 DB로 다시 시작하고 Gateway를 `200`으로 전환한다. `delivered` 상태와 동일한
idempotency key의 두 Gateway 호출, 동일 delivery ID 재전송의 `200 duplicate`를 검증한다.
DB와 설정 파일은 테스트별 임시 디렉터리에 만들고 종료 시 제거한다.

## 관찰 결과

```text
receipt: synthetic webhook accepted=200, after-502=pending, after-restart=delivered, redelivery=duplicate, gateway-calls=2, idempotency-key=same
25 pass, 0 fail, 60 expect() calls
TypeScript: bunx tsc --noEmit exited 0
git diff --check: exited 0
```

이 기록이 증명하는 범위는 **Receiver의 로컬 유실 재현·복구**다. Gateway는 테스트 서버이며
`200`은 Gateway admission만 뜻한다. 실제 GitHub webhook, Discord 계획·승인, ACP worker,
배포 후 동작은 이 테스트에서 검증하지 않았다. PS 또는 포트폴리오에는 전체 Stackot 흐름의
성공으로 계산하지 않는다.

## 8일 지연 전달 보관 회귀 (2026-09-14)

별도 임시 SQLite DB에서 8일 된 `pending`을 전달 완료한 뒤 이전 정리식
(`state = 'delivered' AND received_at < now - 7일`)을 적용하면 ID가 즉시 삭제됐다
(`old_cleanup_keeps_id=false`). `delivered_at`을 기록하고 이를 기준으로 정리하면
Receiver 재시작 후에도 같은 ID가 남았다 (`new_cleanup_keeps_id=true`).

`receiver/test/outbox.test.ts`는 8일 지연 전달, 전달 시각 기준 보관, 이전 outbox 스키마의
`delivered_at` 컬럼 추가와 기존 pending 보존을 자동 확인한다. 위의 전체 테스트 수와 타입
검사 결과는 이 회귀 테스트를 포함해 다시 실행한 값이다.
