# Stackot Roadmap

Stackot의 다음 목표는 기능 수를 늘리는 것이 아니라, 현재 구현된 Receiver와 OpenClaw
워크플로를 실제 GitHub 저장소와 Discord 서버에서 끝까지 연결해 **신뢰할 수 있는 한 번의
작업 흐름**을 만드는 것이다.

이 문서는 [기능 명세](docs/spec.md)의 P0/P1/P2를 실행 순서와 완료 기준으로 구체화한다.
각 체크박스는 구현과 검증 증거가 모두 있을 때 체크하고, Phase는 하단의 완료 기준 전체를
통과해야 끝난 것으로 본다.

제품 동작과 권한의 기준은 `docs/spec.md`, 실행 순서와 단계별 증거의 기준은 이 문서다. 각
Phase는 앞 단계의 완료 기준을 통과한 뒤 시작한다. Phase 1과 Phase 2는 폐기 가능한 테스트
저장소와 Discord 서버에서만 실행하며, 실제 사용자나 운영 저장소는 Phase 3까지 통과한 뒤
연결한다.

완료 증거는 관련 GitHub Issue나 PR에 실행 명령, 테스트 결과, delivery ID, Gateway run ID,
Discord 메시지 URL을 필요한 만큼 남긴다. 체크박스를 갱신하는 사람이 증거 링크와 판정일도
함께 기록한다.

## 현재 기준선

### 저장소에서 확인된 것

- [x] GitHub webhook HMAC 검증
- [x] `X-GitHub-Delivery` 기반 SQLite dedupe
- [x] Issue, PR, 댓글, 리뷰, CI 이벤트 정규화
- [x] 저장소별 Discord 포럼 채널 라우팅
- [x] GitHub 역링크에서 Discord 스레드 ID 복원
- [x] OpenClaw `/hooks/agent` 전달
- [x] Stackot 스킬 초안과 OpenClaw 설정 템플릿
- [x] Discord 봇 및 배포 가이드
- [x] Receiver 단위 테스트

### 아직 실제 환경에서 증명되지 않은 것

- [ ] 배포 대상 OpenClaw 버전과 설정 템플릿의 호환성
- [ ] GitHub Issue 생성에서 Discord 포럼 스레드와 역링크 생성까지의 실제 흐름
- [ ] 멘션, 계획, 승인 버튼, ACP worker 실행의 연결
- [ ] managed worktree에서 수정, 테스트, 커밋까지의 격리된 실행
- [ ] push 승인과 PR 생성, 최종 Discord 보고
- [ ] Gateway 재시작, 전달 실패, 중복 webhook 상황에서의 복구

## 원칙

1. GitHub를 소스 오브 트루스로 두고 Discord는 작업 공간으로 사용한다.
2. 한 저장소의 수직 흐름을 먼저 완성한 뒤 여러 저장소로 확장한다.
3. 파일 수정과 로컬 커밋은 계획 승인 후, push와 PR 생성은 별도 승인 후 실행한다.
4. 자동 merge와 자동 배포는 범위에 넣지 않는다.
5. 외부 입력은 신뢰하지 않으며 secret은 로그와 Discord 메시지에 남기지 않는다.
6. 완료 여부는 실제 표면의 증거로 판단한다. 단위 테스트만으로 운영 준비 완료로 보지 않는다.

## Phase 0. 기준선 고정

현재 코드를 안전하게 확장할 수 있도록 로컬 품질 기준과 아직 흔들리는 아키텍처 계약을 먼저
고정한다.

- [ ] 배포 대상 OpenClaw와 Bun 버전을 정하고 설치 및 업데이트 정책을 기록한다.
- [ ] 최신 OpenClaw에서 HTTP hook, components, tasks, ACP, managed worktree 계약을 확인한다.
- [ ] tasks ledger 밖에 별도 작업 상태가 필요한지 결정하고 상태 소유자와 저장 위치를 정한다.
- [ ] managed worktree와 ACP worker를 연결하는 지원 경로를 검증한다. 하나의
      `sessions_spawn` 호출이 두 기능을 함께 제공한다고 가정하지 않는다.
- [ ] 작업 브랜치 이름을 하나로 통일하고 재시도, 기존 브랜치, dirty worktree 처리 규칙을
      정한다.
- [ ] Discord 멘션 작성자를 요청자로 정의하고 계획, push, PR 승인자의 자격과 승인 무효화
      조건을 정한다.
- [x] `bun test`와 TypeScript 검사를 깨끗한 checkout에서 통과시킨다.
      (2026-09-03, Bun 1.4.0, 21 tests, `tsc --noEmit`)
- [ ] Receiver 시작, `/healthz`, 정상/비정상 서명 요청을 포함한 로컬 smoke test를 만든다.
- [ ] 지원 이벤트와 무시하는 이벤트를 테스트 표로 고정한다.
- [ ] 설정 오류가 시작 시 명확하게 실패하는지 검증한다.
- [ ] README의 테스트 개수처럼 쉽게 낡는 수치를 자동 검증하거나 제거한다.
- [ ] CI에서 타입 검사와 테스트를 실행한다.

**완료 기준:** `docs/spec.md`, Stackot 스킬, 배포 템플릿이 같은 OpenClaw 계약과 브랜치
정책을 가리킨다. 새 checkout에서는 한 명령으로 타입 검사와 테스트가 통과하고, 실패 시
원인을 재현할 수 있다.

## Phase 1. 한 저장소 라이브 수직 흐름

폐기 가능한 테스트 저장소 하나와 별도 Discord 서버의 포럼 채널 한 쌍으로 가장 작은 통합
경로를 연다. 이 단계의 Receiver와 Gateway에는 실제 사용자나 운영 저장소를 연결하지 않는다.

- [ ] 실제 설치 버전에서 `openclaw config validate`를 통과시킨다.
- [ ] Discord bot, guild allowlist, 채널 권한, components TTL을 검증한다.
- [ ] Receiver를 HTTPS 엔드포인트 뒤에 배포하고 Gateway는 비공개로 유지한다.
- [ ] GitHub webhook의 ping과 `issues.opened` delivery를 수신한다.
- [ ] Issue 생성 시 `[owner/repo#N] 제목` 포럼 스레드를 만든다.
- [ ] GitHub Issue에 Discord 스레드 URL을 한 번만 기록한다.
- [ ] 후속 Issue 댓글이 기존 스레드로 전달되는지 확인한다.
- [ ] 실패한 CI 이벤트가 `#ci-alerts`와 연결된 PR 스레드에 전달되는지 확인한다.
- [ ] Discord 게시만 성공하거나 GitHub 역링크만 성공한 부분 실패의 복구 규칙을 정한다.
- [ ] delivery ID, Gateway run ID, Discord 메시지 URL을 검증 기록으로 남긴다.

**완료 기준:** 새 Issue 1건에 대해 `GitHub webhook → Receiver → Gateway → Discord
스레드 → GitHub 역링크 → 후속 댓글`이 수작업 보정 없이 왕복한다.

## Phase 2. 승인형 코딩 작업 완성

포럼 스레드에서 계획을 승인하고 실제 코딩 worker가 PR을 만드는 핵심 제품 경험을 완성한다.

- [ ] 멘션으로 연결된 Issue/PR 문맥을 읽고 계획을 게시한다.
- [ ] `작업 시작` 버튼을 요청자만 사용할 수 있게 제한한다.
- [ ] 계획 내용이나 변경 범위가 달라지면 기존 승인을 무효화한다.
- [ ] 승인, 작업 상태, worker run, worktree, commit, PR의 식별자와 저장 위치를 정한다.
- [ ] 승인 전에는 파일 수정이나 worker 실행이 일어나지 않음을 확인한다.
- [ ] Phase 0에서 확정한 정책에 따라 작업별 managed worktree와 브랜치를 만든다.
- [ ] ACP Codex worker를 제한 시간과 명시적 작업 범위로 실행한다.
- [ ] 변경 파일과 테스트 결과를 Discord에 요약한다.
- [ ] `push 허용`과 `PR 생성`을 독립 승인으로 처리한다.
- [ ] PR 본문에 `Closes #N`과 검증 결과를 기록한다.
- [ ] 버튼 재전송, worker 재시도, 중복 webhook에도 commit, push, PR이 중복되지 않게 한다.
- [ ] `중단`과 `재시도`가 상태 및 worktree를 잃지 않고 동작한다.
- [ ] 최종 메시지에 커밋, PR, 테스트, 승인자를 남긴다.

**완료 기준:** Discord 멘션 하나에서 시작해 계획 승인, 격리 실행, 테스트, push 승인,
PR 생성까지 이어지는 데모를 두 번 연속 성공한다. 두 번째 실행은 첫 실행의 수동 조치를
필요로 하지 않아야 한다.

## Phase 3. 전달 신뢰성과 운영성

현재 Receiver는 GitHub에 먼저 `200 accepted`를 반환한 뒤 Gateway 전달을 메모리에서
비동기로 처리한다. Gateway가 일시적으로 실패하면 이벤트가 유실될 수 있으므로 운영 전에
복구 경로가 필요하다.

- [ ] SQLite outbox에 정규화 이벤트와 delivery ID를 기록한다.
- [ ] Gateway 전달 성공 후에만 outbox 항목을 완료 처리한다.
- [ ] 지수 backoff, 최대 재시도, dead-letter 상태를 정의한다.
- [ ] 관리자 채널에 최종 실패와 수동 재전송 방법을 알린다.
- [ ] delivery ID를 Receiver 로그, Gateway run, Discord 보고까지 연결한다.
- [ ] `/healthz`와 readiness를 분리해 DB/Gateway 상태를 확인한다.
- [ ] systemd 또는 동등한 프로세스 관리, 로그 순환, 재시작 정책을 문서화한다.
- [ ] SQLite 백업과 복구 절차를 검증한다.
- [ ] Gateway 중단, GitHub 재전송, Receiver 재시작을 포함한 장애 테스트를 실행한다.

**완료 기준:** Gateway를 의도적으로 중단한 동안 받은 webhook이 Receiver 재시작 후에도
유실되지 않는다. 재전달이 생겨도 같은 idempotency key로 처리돼 사용자에게 중복 부작용이
나타나지 않으며, 운영자는 delivery ID로 전체 경로를 추적할 수 있다.
이 기준을 통과하기 전에는 실제 사용자나 운영 저장소를 연결하지 않는다.

## Phase 4. 여러 저장소 운영

Receiver의 멀티 저장소 설정은 이미 구현돼 있다. 다음 단계는 저장소 수를 늘리는 것이 아니라
저장소마다 권한, 상태, 장애를 독립적으로 관리하는 것이다.

- [ ] 두 개 이상의 실제 저장소에서 포럼 채널과 역링크가 섞이지 않음을 검증한다.
- [ ] 저장소별 GitHub App 설치와 최소 권한을 적용한다.
- [ ] 저장소별 허용 사용자, worker, timeout, push 정책을 설정할 수 있게 한다.
- [ ] 역링크 조회 결과를 TTL 캐시해 GitHub API 호출을 줄인다.
- [ ] 저장소별 동시 작업 수와 전체 동시 작업 수를 제한한다.
- [ ] 작업 큐 우선순위와 취소 정책을 정의한다.
- [ ] `/stackot status`, `/stackot retry`, `/stackot cancel`부터 슬래시 명령을 추가한다.
- [ ] 설정 변경을 재시작 전에 검증하는 명령을 제공한다.

**완료 기준:** 한 저장소의 과부하나 설정 오류가 다른 저장소의 webhook 처리와 작업 실행을
막지 않는다.

## Phase 5. 작업 품질 자동화

안정적인 수직 흐름 위에 반복 작업을 줄이는 기능을 추가한다.

- [ ] PR 리뷰 피드백을 기존 작업 세션으로 전달하고 수정 계획을 다시 승인받는다.
- [ ] CI 실패 로그를 요약하고 재현 명령 후보를 제시한다.
- [ ] 저장소별 테스트 정책과 필수 체크를 읽어 worker 작업 계약에 포함한다.
- [ ] Planner와 Reviewer 역할을 분리하되 최종 결정은 부모 세션이 소유한다.
- [ ] 변경 범위가 큰 작업은 추가 승인 또는 분할 계획을 요구한다.
- [ ] 릴리스 노트 초안을 생성하되 tag, release, deploy는 자동 실행하지 않는다.

**완료 기준:** 리뷰 또는 CI 실패를 받은 PR이 원래 스레드에서 문맥을 유지한 채 수정되고,
새 테스트 증거와 함께 다시 보고된다.

## Phase 6. 운영 준비

- [ ] webhook, GitHub API, Discord API, Gateway 호출의 rate limit 정책을 검증한다.
- [ ] prompt injection, 권한 우회, secret 노출, 승인 재사용에 대한 위협 모델을 작성한다.
- [ ] 만료되거나 다른 사용자가 누른 버튼이 실행을 시작하지 못하는지 테스트한다.
- [ ] 감사 로그의 보존 기간과 개인정보 최소 수집 원칙을 정한다.
- [ ] 작업 수, 성공률, 대기 시간, 실패 원인, worker 비용을 관측한다.
- [ ] 운영 runbook에 설치, 업데이트, rollback, 장애 복구, token rotation을 포함한다.
- [ ] 첫 사용자용 10분 온보딩과 예제 Issue를 제공한다.

**완료 기준:** 새 운영자가 문서만 보고 설치와 장애 복구를 수행할 수 있고, 모든 외부 변경을
승인자와 delivery ID 기준으로 감사할 수 있다.

## 바로 다음 작업

다음 구현 사이클은 아래 순서로 진행한다.

1. 배포 대상 OpenClaw 버전을 설치하고 hook, tasks, ACP, managed worktree 계약을 검증한다.
2. 검증 결과에 맞춰 `docs/spec.md`, Stackot 스킬, 설정 템플릿의 충돌을 해소한다.
3. Phase 0의 CI 및 Receiver smoke test를 추가한다.
4. 테스트 저장소 하나에서 Issue 생성과 스레드 역링크 왕복을 통과시킨다.
5. 승인과 작업 상태 계약을 구현하고 Phase 2의 worker 흐름을 테스트 환경에서 연결한다.
6. SQLite outbox와 장애 복구를 통과시킨 뒤에만 첫 운영 저장소를 연결한다.

## 범위 밖

- 자동 merge
- 승인 없는 push, PR 생성, 배포
- 별도 orchestrator 또는 커스텀 관리자 페이지
- Discord 전체 대화 수집
- 포럼에 원시 터미널 로그 전체 게시
- 초기 단계의 다중 worker 자동 선택

우선순위나 제품 가정이 바뀌면 먼저 [기능 명세](docs/spec.md)를 갱신하고, 이 문서의 단계와
완료 기준을 함께 맞춘다.
