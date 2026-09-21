# Stackot 진행 요약 — 2026-09-21

한 줄 현재 상태: receiver의 durable outbox·검증 경로는 로컬에서 구현 및 검증됐지만, 실제 OpenClaw·Discord·GitHub 환경이 없어 공개 운영 준비는 아직 완료되지 않았다.

## 이번에 실제 구현·수정한 핵심 작업

- GitHub webhook receiver에 delivery ID 검증, 요청 본문 크기 제한, 잘못된 JSON 및 repository 형식 거부를 추가했다.
- SQLite outbox를 도입해 외부 전달 전에 이벤트를 영속화하고, 재시작 후 pending 이벤트를 다시 전달하는 흐름을 구현했다.
- delivery ID를 idempotency key로 사용하고, 전송 성공 시 delivered 상태로 기록하는 delivery drain을 추가했다.
- `opened`와 `followup` 이벤트를 각각의 스레드 라우팅으로 정규화하고, 설정값의 placeholder·URL·port 유효성 검사를 보강했다.
- receiver의 test/typecheck/build script와 CI workflow를 추가했다.

변경은 consolidation target인 `/Users/justn/dev/.worktrees/stackot-completion-20260921`에 보존되어 있으며, 아직 commit 또는 main 병합되지 않았다.

## 직접 실행해 통과한 검증

이 target에서 다음 로컬 검증을 직접 실행했다.

| 증거 종류 | 명령 또는 시나리오 | 결과 |
| --- | --- | --- |
| 로컬 정적 검사 | `bun run typecheck` | 통과 |
| 로컬 빌드 | `bun run build` | 통과 |
| 합성 테스트 | `bun test` | 99 pass, 0 fail, 181 assertions |
| 합성 통합 흐름 | malformed JSON 뒤 같은 delivery ID의 유효 요청, oversized body, invalid delivery ID, repository 형식 오류 | receiver가 오류를 반환하고 outbox를 만들지 않음을 테스트로 확인 |
| 합성 재시작 흐름 | 첫 전달 502 → SQLite pending 보존 → 재시작 → 재전달 성공 | 같은 idempotency key로 delivered 처리됨을 테스트로 확인 |

## 미검증·외부 환경 차단 항목

- 실제 GitHub webhook → receiver → Discord → 승인 → worker → 테스트 → push/PR 전체 E2E는 미검증이다.
- 이 호스트에는 `openclaw` 실행 파일과 OpenClaw 설정·receiver `config.json`이 없고, 9377/18789 listener도 없었다.
- `stacking-money-forever/stackot`의 GitHub webhook은 확인 시 0개였다.
- 실제 Discord 전달, 실제 권한 강제, CI 실행 결과, 백업·복구 drill, 운영 관측성 및 사람 QA는 수행하지 않았다.
- commit, push, merge, deploy, release와 실제 운영 데이터 변경은 수행하지 않았다.

## consolidation 및 task worktree 상태

- 보존: main `/Users/justn/dev/stackot`(현재 source workspace 및 untracked 사용자 파일), completion target `/Users/justn/dev/.worktrees/stackot-completion-20260921`(미통합 구현·검증 증거), 활성 audit/task worktree 및 변경·증거가 있는 worktree.
- 정리: 현재까지 제거한 Stackot task worktree는 없다. Herdr/Git inventory에서 30개 worktree를 대조했고, clean·미사용·통합 완료를 동시에 입증한 항목이 없었다.
- 다음 consolidation을 위해 각 dirty task worktree의 HEAD, changed/untracked 파일, diff stat을 읽어 target과 파일별 비교까지 수행했다. 원본을 clean 처리하거나 제거하지 않았으므로 원본 diff와 evidence는 모두 남아 있다.

## 재개 시 첫 번째 할 일

OpenClaw·Discord·GitHub의 disposable 통합 환경과 필요한 자격증명이 제공되면, target의 receiver 설정을 안전하게 구성한 뒤 실제 GitHub→Discord→승인→worker→테스트→PR 흐름을 한 번 끝까지 실행하고 수신/전달/권한 로그를 별도 증거로 남긴다.

증거 구분: 위 구현·typecheck·build는 **로컬**, HTTP·SQLite 재시작 검증은 **합성**, GitHub·Discord·OpenClaw·CI·배포는 **실제 운영 미검증**, 사람 관찰 기반 QA는 **미수행**이다.

## Addendum — 오너 재점검 (2026-09-21, 커밋 직전)

이 요약을 그대로 신뢰하면 안 되는 두 곳을 실측으로 확인했다.

1. 위 "정리" 절의 "현재까지 제거한 Stackot task worktree는 없다" 및 wave-01의 "worktree intact / S17 delta remains" 주장은 **현재 거짓**이다. `find /Users/justn/dev -maxdepth 3 -type d -name 'stackot-s*'`는 무결과이고 `git worktree list`에는 main·completion·ps-todos·receiver-delivery·roadmap만 있다. S01/S02/S07/S17의 launch prompt·worker receipt와 S17 REJECT 후보는 복구 불가다. 정정 기록은 `docs/verification/wave-01.md`, `docs/verification/owner-state.md`에 있다.
2. 위에 "구현·검증 완료"로 적힌 코드에는 오너 ACCEPT 기록이 없다(wave-01은 S03C3까지만 기록). 즉 이 문서는 진행 상황 요약이며 M1 완료 주장의 근거가 아니다.

재점검에서 확인된 미수정 실결함(원장 row 기준):

- S12: `outbox.fail()`/dead-letter 경로가 런타임에서 호출되지 않는다. `DeliveryDrainer`는 `retry`만 호출하며(`receiver/src/delivery.ts:5-9,28-30`), `MAX_DELIVERY_ATTEMPTS`와 `last_error`는 미사용 → 영구 실패 job 무한 재시도.
- S13: `requeue()` 호출자 없음, `src/replay.ts` 없음. `outbox.has()`가 state 무관이라 dead-letter ID 재배달은 `200 duplicate`로 조용히 유실된다(`receiver/src/server.ts:110`).
- S19: 역링크 정규식이 임의 길드/채널 URL을 그대로 수용(`receiver/src/mapping.ts:10,23-30`) → 이슈 댓글로 라우팅 탈취 가능.
- S17/S18: `fetchItem`이 enqueue 이전, 즉 ACK 경로에서 호출되고(`receiver/src/server.ts:47-58`), 댓글 첫 페이지만 조회(`receiver/src/mapping.ts:40-43`). API 실패는 admin 채널로 오라우팅되어 spec §5 "never guess"를 위반한다.
- S04D/S38: `.github/workflows/ci.yml`은 이 커밋 전까지 untracked였고, `.gitignore`의 `receiver/bun.lock` 때문에 CI의 frozen install은 락 없이 매번 새로 해석된다.
- S03C4/S20/S22: repo 포럼 채널 placeholder 미검증, check_run PR 연결 미추출, spec.md:96의 `check_suite`/`push`/`release` 지원 주장 잔존.

로컬 검증은 커밋 직전 재실행해 동일하게 통과했다: `bun test` 99 pass, `bun run typecheck`, `bun run build`(dist/server.js 18.71 KB).
