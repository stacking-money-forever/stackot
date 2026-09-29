# Stackot 기능 명세서 v0.2

## Gateway 승인 대기 수신 경로

`openclawIngressMode: "approval"`은 기존 Gateway origin의
`/stackot/hooks/agent`로 정규화 이벤트와 delivery ID를 보낸다. 오너가 고정한
저장소·요청자·승인 제어 스레드를 사용하며 입력으로 actor/session/tool을
선택할 수 없다. 비공개 토큰 파일 인증 뒤 native managed flow에 입력과
pending 승인을 저장하고 전체 입력 계획·승인 카드를 발행한 뒤에만 ACK한다.
동일 delivery ID의 다른 내용은409, 재전송과 재시작은 같은 flow와 카드를
재사용한다. 기본 모드는 기존 native `/hooks/agent`이며 opt-in 없이는 변경되지 않는다.

이 수신 단계는 모델·ACP worker·Git·PR을 실행하지 않는다. 승인 뒤 실행
연결은 S29/S30/S31, push/PR 연결은 S33/S34, 제품 포럼·역링크는 S49의
독립 검증 대상이다. 승인 제어 스레드와 원래 이슈/PR 목적지는 별도이며
원래 목적지 정보는 native 입력에 보존한다. HTTP200을 작업 완료로 해석하지 않는다.

## 0. v0.1 대비 변경 요약

v0.1은 "OpenClaw를 Gateway로 사용하는 별도 Orchestrator 구축"을 가정했다. 문서 검증 결과
OpenClaw 자체가 orchestrator 기능(작업 큐, 승인 버튼, worker 실행, worktree 격리, 세션
관리, 관리 UI)을 대부분 내장하고 있어서, 별도 orchestrator를 만들면 내장 기능과 중복된다.

v0.2의 구조적 결정:

| v0.1 | v0.2 |
|---|---|
| Stackot Orchestrator를 별도로 구현 | OpenClaw Gateway = orchestrator. 코드로 만들지 않는다 |
| GitHub webhook을 직접 수신·처리 | 커스텀 수신기 1개(유일한 커스텀 서버 코드) |
| 커스텀 관리자 페이지 | OpenClaw Control UI 사용 (커스텀 페이지 폐기) |
| 작업 큐, 라이프사이클 상태머신 직접 구현 | TaskFlow + tasks ledger 내장 기능 사용 |
| worker 프로필 라우팅 시스템 | ACP 런타임(`sessions_spawn` runtime)으로 harness 실행 |
| 슬래시 커맨드 9종 | 멘션 + 버튼 승인으로 축소 (슬래시는 P1) |

## 1. 제품 정의

**Stackot은 Discord에서 GitHub 프로젝트를 지휘하는 코딩 에이전트 봇이다.**

사용자는 Discord에서 Issue나 PR 포럼 글에서 `@스태콧`을 멘션해 작업을 요청한다. Stackot은
GitHub 문맥을 읽고, 작업 계획을 세우고, 버튼 승인을 받은 뒤 실제 코딩 에이전트(ACP
harness)를 격리된 worktree에서 실행한다. 진행 상황과 결과는 해당 Discord 포럼 스레드에
기록한다.

## 2. 아키텍처

```txt
GitHub ──webhook──▶ Stackot Receiver (커스텀, 유일한 서버 코드)
                          │  HMAC 검증 + dedupe + 이벤트 정규화
                          ▼
                    OpenClaw Gateway
                    ├── Discord 채널 (포럼 스레드 바인딩 세션)
                    ├── TaskFlow / tasks ledger (작업 상태·재개)
                    ├── components 버튼 (승인 UI)
                    ├── managed worktrees (격리)
                    ├── ACP 런타임 (codex / claude / gemini / cursor …)
                    ├── Control UI (관리 화면)
                    └── sandbox (docker backend)
```

### 역할 분리

| 구성 요소 | 구현 | 역할 |
|---|---|---|
| Stackot Receiver | **커스텀 코드** | GitHub webhook HMAC 검증, delivery ID dedupe, 이벤트를 Discord/세션 메시지로 정규화, 매핑 조회 |
| Gateway | OpenClaw 내장 | Discord 연결, 세션 격리, 라우팅, tool policy |
| Orchestrator | OpenClaw 내장 (TaskFlow + tasks ledger) | 작업 상태, 재개, 재시도, 중단 |
| 승인 UI | OpenClaw 내장 (components v2) | 버튼/모달, `allowedUsers`, TTL |
| Worker | ACP harness (codex, claude 등) | 실제 코딩 실행. OpenClaw 도구는 기본 비노출 |
| 격리 | OpenClaw 내장 (managed worktree + sandbox) | 브랜치, 스냅샷, cleanup, docker 격리 |
| 관리 화면 | OpenClaw 내장 (Control UI) | 세션, 태스크, worktree, 실행 기록 |
| Stackot Skill | **커스텀 스킬 1개** | 이슈 읽기 → 계획 → 승인 → worker 실행 → 보고 워크플로 |

커스텀 코드는 위 2개뿐이다. 나머지는 설정과 스킬 작성으로 해결한다.

## 3. Discord 구조

```txt
GitHub 카테고리
├─ #issues           포럼 채널 — Issue별 스레드
├─ #pull-requests    포럼 채널 — PR별 스레드
├─ #ci-alerts        텍스트/포럼 — CI 실패 알림
└─ #stackot-admin    텍스트 — 관리자 알림
```

### 포럼 태그

- Issue: `bug` `feature` `question` `triage` `in-progress` `blocked` `resolved` `wont-fix`
- PR: `draft` `review` `changes-requested` `ci-failed` `approved` `merged` `closed`

### 스레드 생성 컨벤션

OpenClaw 포럼 지원: forum parent로 메시지를 보내면 첫 줄을 제목(100자 제한)으로 스레드를
자동 생성하거나, `message thread create`로 명시적 생성이 가능하다.

매핑 저장소를 별도 DB로 만들지 않고, **스레드 제목 컨벤션 + GitHub 측 역링크**로 매핑을
복원한다:

- 제목: `[owner/repo#123] 이슈 제목`
- GitHub 이슈 본문/댓글에 Discord 스레드 URL을 봇이 한 번 기록 (역방향 조회용)
- Receiver가 매핑을 찾을 때: GitHub 아이템 본문의 스레드 URL → 스레드 ID

이 방식의 트레이드오프: 매핑 조회가 GitHub API 읽기에 의존(레이트리밍 존재, 약간의 지연).
별도 매핑 DB를 피하는 것이 우선이며, P1에서 캐시 레이어를 얹는다.

## 4. GitHub 연동

### Receiver가 수신하는 이벤트

`issues`(opened/edited/closed/reopened), `issue_comment`, `pull_request`(opened/
edited/synchronize/closed), `pull_request_review`, `pull_request_review_comment`,
`check_run`.

`check_suite`, `push`, `release`는 **아직 구독하지 않는다**. Receiver의 정규화기가
해당 payload를 처리하지 않으므로, 그 webhook을 붙여도 이벤트는 무시된다.

### 동기화 규칙

```txt
GitHub Issue 생성   → #issues에 스레드 생성 (제목 컨벤션) + 이슈 본문에 스레드 URL 기록
GitHub PR 생성      → #pull-requests에 스레드 생성 + 연관 Issue가 있으면 양쪽 상호 링크
GitHub 댓글·리뷰    → 연결된 스레드에 답글 전달
CI 실패             → PR 스레드 답글 + #ci-alerts 알림
```

### Receiver 요구사항

- **HMAC 서명 검증**: `X-Hub-Signature-256` 필수. OpenClaw HTTP hooks는 provider HMAC을
  검증하지 않으므로 Receiver가 반드시 자체 검증한다.
- **Dedupe**: `X-GitHub-Delivery` ID 저장(중복 재전송 방지). 저장소는 SQLite 파일 1개.
- **정규화**: 이벤트를 "레포/타입/번호/요약" 형태의 텍스트 메시지로 변환해
  `POST /hooks/agent`로 전달 (해당 스레드 바인딩 세션으로 라우팅).
- **공개 엔드포인트**: Receiver만 공개 HTTPS에 노출. Gateway는 loopback/tailnet 유지.
- 배포: 기존 서버에 상주. 리버스 프록시(nginx/Caddy) 뒤.

## 5. Discord에서의 작업 요청

### 기본 사용법

```txt
@스태콧 이 이슈 읽고 작업 계획 세워줘
@스태콧 계획대로 구현 시작해줘
@스태콧 작업 중단해줘
```

매핑을 찾지 못하면 추측하지 않고 GitHub URL을 요구한다:

```txt
이 포럼 글에 연결된 GitHub Issue를 찾지 못했습니다.
GitHub Issue 또는 PR URL을 함께 보내주세요.
```

### 명령 방식

- **멘션**: 자유 서술 요청. 계획/분석/질문 등 읽기·쓰기 모두.
- **버튼**: 실행 게이트. `계획 승인` `작업 시작` `push 허용` `PR 생성` `중단` `재시도`.
  컴포넌트 TTL은 24h(승인 대기가 길어지는 workflow에 맞춤), `allowedUsers`로 요청자만
  클릭 가능.
- **슬래시 커맨드**: P1. `/stackot status` `/stackot retry` 등은 OpenClaw 네이티브 커맨드
  세션과 충돌하지 않게 커스텀 등록 필요. MVP에서는 멘션+버튼으로 대체.

## 6. 작업 라이프사이클

상태 저장은 OpenClaw TaskFlow에 위임한다. Stackot은 TaskFlow 상태를 포럼 메시지로
미러링할 뿐, 상태머신을 직접 구현하지 않는다.

```txt
요청 (멘션)
  → 이슈/PR 문맥 읽기            [TaskFlow: running]
  → 계획 작성 → 포럼 게시         [TaskFlow: waiting — 승인 버튼]
  → 승인 → worktree 생성          [TaskFlow: running]
  → ACP worker 실행 (codex 등)    [TaskFlow: running]
  → 테스트 결과 보고              [TaskFlow: waiting — push/PR 승인 버튼]
  → push + PR 생성                [TaskFlow: finished]
  → 포럼 최종 요약 (커밋·PR 링크)
```

실패·중단: `blocked`/`failed`/취소는 TaskFlow가 관리. `openclaw tasks retry`로 재시도.
Gateway 재시작 시에도 작업 기록은 SQLite에 보존되므로 재개 가능.

### 포럼 글에 남길 내용

작업 시작 시 자동 등록:

```md
## Stackot 작업 시작

- 작업: 로그인 오류 수정
- 저장소: example/app
- 기준 Issue: #42
- worker: codex (ACP)
- worktree: openclaw/issue-42-login-error
- 상태: 계획 작성 중
```

이후 단계별 업데이트: 계획, 변경 예정 파일, 질문, 실행 단계, 테스트 결과, 실패 원인,
커밋 링크, PR 링크, 최종 요약. 터미널 출력 전체는 포럼에 쏟지 않는다(스킬에서 요약 규칙
강제). 전체 로그는 Control UI 세션 뷰어에서 확인.

## 7. Worker 실행

### ACP 런타임

`openclaw plugins install @openclaw/acpx@2026.9.6` 후 `sessions_spawn({ runtime: "acp", agentId:
"codex", cwd: <worktree> })`로 harness를 실행한다.

- worker는 OpenClaw 도구를 기본적으로 받지 않는다(ACP 설계상 격리). 포럼 보고는 부모
  세션이 완료 이벤트를 받아 수행.
- harness별 auth는 호스트에 사전 구성돼 있어야 한다(codex 로그인 등).
- 비대면 실행이므로 permission profile을 headless로 설정(승인 프롬프트 클릭 불가).
  ACP harness의 `permissionMode`/`nonInteractivePermissions`는 harness 내부
  동작이며 §8이 요구하는 제품 push/PR 승인 가드와는 별개다 — 그 가드는 아직
  미구현이며 실운영 전 독립 검증이 필요하다.

### 격리

- **worktree**: OpenClaw managed worktree. 브랜치 `openclaw/<issue번호>-<slug>`,
  스냅샷·cleanup·restore 내장. `.worktreeinclude`로 ignored 파일 시딩 가능 — 단
  Discord/GitHub/publication secrets은 worker에 주입하지 않는다(게이트 전용).
- **sandbox**: 전역 `agents.defaults.sandbox.mode: "non-main"` — 다른 에이전트의
  채널 파생 세션은 자동 docker 격리(기본 network none). 단, stackot 컨트롤러는
  per-agent `sandbox.mode: "off"`다: 샌드박스 요청자는 ACP spawn이 불가해 채널
  파생 세션이 ACP·Discord 액션을 내려면 비격리여야 한다. 이것은 worker 격리가
  아니다(ACP worker는 원래 sandbox 밖; cwd도 보안 경계가 아님). push/PR 등 외부
  변경에는 §8이 요구하는 제품 승인 가드가 필요하며 이는 아직 미구현이다 —
  generic 버튼은 서버 측 가드가 아니므로 실운영 전 독립 검증이 필요하다.

## 8. 승인 정책

| 작업 | 기본 정책 | 수단 |
|---|---|---|
| GitHub Issue/PR 읽기 | 자동 | 스킬 |
| 저장소 읽기 | 자동 | 스킬 |
| 계획 작성 | 자동 | 스킬 |
| 파일 수정·테스트·로컬 커밋 | 계획 승인 후 | `작업 시작` 버튼 |
| 원격 push | 명시적 승인 | `push 허용` 버튼 |
| PR 생성 | 명시적 승인 | `PR 생성` 버튼 |
| PR merge | 금지 | 구현하지 않음 |
| 배포 | 금지 | 구현하지 않음 |

S33 준비 코드 `gateway/src/push.ts`는 별도 push 승인과 검증된 repo/branch/commit
intent를 결합하고 오너 broker에만 자격증명을 전달한다. 미승인·만료·변경된
계획은 자격증명 조회/전송 전 거부한다. 실제 callback/worker/원격 전송 연결과
격리 검증은 미완이다. 환경 변수 필터만으로 같은 UID의 파일·키체인 격리를
주장하지 않는다. 계약: `docs/contracts/push-authority.md`.
오너 Git 전송 준비는 검증된 커밋 객체를 별도 bare 저장소에 고정하고 작업자
설정·hook·URL 재작성을 사용하지 않는다. 실제 GitHub 연결·worker 격리 검증은
여전히 별도이며, 현재 배포의 push 동작을 활성화하지 않는다.
Native 연결 준비는 push approve callback의 실제 요청자 검사·승인 저장 뒤에만
오너 코드 factory를 조회한다. 기본 bootstrap에는 factory가 없으며 JSON/RPC로
주입할 수 없다. 작업 시작·거부·PR callback은 push를 실행하지 않는다.
`owner-push.ts`의 코드 전용 catalog 연결은 저장된 push intent와 정확히 같은
대상만 허용하고 검증 시 객체를 봉인한다. callback 종료 시 생성한 오너 저장소를
정리한다. 실제 task/worktree 계보를 공급하는 catalog와 배포 활성화는 미완이다.
정리 실패는 고정된 진단 이벤트로 기록하며 이미 확인한 전송 결과를 바꾸지 않는다.
Git 토큰 원문은 자식 프로세스 argv·환경변수·디스크 파일에 넣지 않고,
오너의 메모리 broker와 0600 Unix socket으로 askpass에 전달한다. 성공·실패 뒤
broker를 닫는다. 강제 종료 뒤 빈 socket이 남아도 토큰 파일은 없다. 실제 Mac
fixture에서 같은 UID의 다른 프로세스 환경변수 읽기가 관측됐기 때문이다.
파일·환경변수·자식 프로세스 검증은 실제 Codex/ACP 격리 수용과 별도이며,
같은 UID의 파일·키체인 접근 차단을 완료했다고 주장하지 않는다.
Docker worker 실행기 준비는 `gateway/src/docker-worker.ts`에 있다. 오너가 승인한
단일 작업 디렉터리와 고정 image ID만 사용하며, 호스트 자격증명·Docker 소켓·
공유 Git 상태는 mount하지 않는다. 생성된 실제 컨테이너 정책을 확인한 뒤 실행하고,
취소/timeout은 컨테이너 종료를 확인하되 작업 파일을 보존한다. 코딩 계정 로그인과
task/Git 계보·실제 승인 연결은 후속 런타임 검증이며 기본 배포에는 활성화하지 않는다.
계약과 네트워크/인증 경계: `docs/contracts/docker-worker.md`.
선택 Mac의 실제 Docker 격리·취소·linked-worktree 검증은 통과했다.
합성 worker/비밀값 증거이며 실제 Codex 실행·push 수용은 아니다:
`docs/verification/s33-macos-docker-owner.md`.
S33 독립 검증 연결 `docker-verifier.ts`는 Git 관측과 오너가 고정한 테스트를
동일한 Docker 경계 안에서 실행한다. worker가 테스트 범위를 줄일 수 없고,
테스트 전후에 branch·HEAD·clean 상태가 고정 대상과 같아야 push 검증을 통과한다.
호스트 실행 fallback은 없으며 실제 task 계보·승인 연결은 여전히 미완이다.
계약: `docs/contracts/isolated-verifier.md`.
S29 시작 어댑터 준비는 `start.ts`·`native-start.ts`에 있다. 명시적 coding 작업만
허용하고 승인 소비와 실행 대기 기록을 하나의 CAS로 저장한다. 응답 유실은
재실행하지 않으며 QA/검증용 승인은 거부한다. 기본 배포의 시작 factory는 없고,
실제 ACP·코딩 로그인 연결은 미검증이다: `docs/contracts/start-authority.md`.
Mac Gateway 시작기는 빈 전용 `CODEX_HOME`과 비활성 ACP 시작 probe를 강제해
개인 Codex 설정·인증의 자동 가져오기를 방지한다. 실제 코딩 로그인은 별도
격리 worker에 준비한다. acpx 호스트 파일·터미널 callback도 차단이 필요하다.
`verifiedPushOwner(policy)`는 실제 오너 lease를 읽는 resolver가 제공될 때만
native push factory를 구성한다. task·요청자·계획·실행 ID와 종료/정리 상태가
일치해야 하며 자격증명은 이 과정에서 조회하지 않는다. 기본 Gateway에는 실제
lease 공급자가 없어 자동 활성화하지 않는다. `docs/contracts/verified-push-catalog.md`.

버튼은 components v2로 구현. `allowedUsers`에 요청자 Discord ID. TTL 24h. 만료된 승인은
재요청(재시도 버튼)으로 처리.

B06 준비 구현은 실제 callback 인증·route/message·요청자 확인 뒤 trusted
approval repository의 정확한 만료 오류에만 비공개 만료 안내를 표시한다.
기존 승인·TTL을 갱신하거나 worker를 시작하지 않는다. 잘못된 요청자와 다른
오류에는 기존 일반 거부 안내를 유지한다. 재시도 버튼/새 승인 발행 경로와
실제 사용자 이해 QA는 아직 미검증이며, 아래 정책 표의 목표와 별개다.

B06 재요청 준비 구현: 새 승인 카드에 `승인 재요청`을 추가한다. 실제 native
요청자·route/message 확인을 통과한 만료 pending 요청만 현재 계획에 대한
새 pending 승인을 발행한다. 기존 승인·TTL은 그대로 두며, 재클릭/재시작은
영속 재요청 ID와 기존 plan/card receipt를 재사용한다. 새 승인이 필요하며
재요청 자체는 승인·worker 실행이 아니다. 새 코드의 실제 전달·사람 QA는 별도다.

S26 구현 범위: `gateway/src/approval.ts`가 요청자 decimal-string ID, task,
plan hash/version, action, 서버 epoch-ms 시각과 최대 24h TTL의 pending 레코드를
native managed-flow stateJson에 revision CAS로 저장한다. 같은 request ID의
동일 요청은 원래 만료시각을 유지하며, 다른 payload는 거부한다. 실제 Gateway
재시작으로 저장 복원을 검증한다. 저장은 승인 자체가 아니며, actor/만료/plan
거부와 consumption(S27), Discord callback(S28), 실행 게이트(S29 onward)는
아직 구현·검증되지 않았다.

S27은 pending→approved/denied 결정과 approved→consumed 권한 소비를 분리한다.
두 단계 모두 서버가 제공한 actor, 현재 task/requester/plan/version/action,
active task 상태와 `now < expiresAt`를 매 CAS 재시도마다 검사한다. 저장 응답이
만료 뒤 도착해도 권한을 반환하지 않는다. 거부·소비된 요청은 재승인/재소비로
갱신되지 않으며, 소비에는 서버 operation ID를 남긴다. 이는 레코드당 한 번의
dispatch eligibility이지 외부 작업 exactly-once 보장이 아니다. 응답 유실과
dispatch 전 장애는 신뢰된 controller의 receipt 대조로 복구해야 한다.
실제 Discord actor 출처(S28)와 worker/push/PR 실행 가드는 아직 별도 행이다.

S28 준비 코드는 native handler 등록 helper와 flow별 callback binding 저장소를
추가했다. native auth, numeric sender, account/guild/channel/parent/message
binding을 확인한 뒤 S27 결정을 호출하며, callback payload로 actor/flow/plan을
선택하지 않는다. 단순 객체 모양/token은 호출 출처 증명이 아니다. production
plugin 등록 엔트리와 native route/flow 조회 코드를 추가했고 실제 독립 Gateway
재기동에서 plugin 등록을 확인했다. route/flow 선택은 합성 매트릭스로 확인했으며
실제 component 발행과 두 사용자 검증이 남아 있어 S28은 아직 수용하지 않는다.

승인 publisher는 저장된 전체 planText의 hash/version/requester/action을 확인해
본문 전송 완료 뒤 승인 카드를 발행한다. receipt hook에서 두 token binding을
저장한 뒤 native component가 등록된다. 알려진 메시지의 등록 실패는 같은 ID
수정으로 복구하고, 불확실한 전송은 재생성하지 않는다. opt-in 실제 actor QA는
고정 server config와 operator.admin의 무인자 RPC만 사용하며 실제 코딩을 실행하지
않는다. 코드·설치본 렌더 계약은 검증했지만 실제 메시지/두 사용자 증거는 아직 없다.

S35의 `gateway/src/thread-receipt.ts`는 thread 생성 intent와 receipt를 native
state에 저장한다. inflight 재시도는 기존 operation의 신뢰된 marker 확인이
먼저이며, 빈 조회나 시간 경과만으로 다시 생성하지 않는다. 확인 불가 시
uncertain을 반환한다. 실제 provider의 영속 idempotency가 입증된 경우에만
같은 operation 재전송이 허용된다. 외부 provider 테스트는 합성이고 실제
Discord marker 인증·thread 생성 어댑터는 후속 실연동 검증이 필요하다.

S36의 `gateway/src/backlink.ts`는 이미 저장된 thread receipt를 소비하고
GitHub 역링크만 재개한다. task/repo/item/기록자와 guild/forum/thread/operation을
묶은 marker를 확인하며, 불확실한 응답이나 빈 조회로 다시 쓰지 않는다. 신뢰된
provider가 전송되지 않았음을 입증한 경우만 같은 operation을 재시도한다.
중복 marker는 오류로 드러내고 기존 thread receipt를 수정하지 않는다. 합성
회복 오라클과 Receiver marker 형식 호환을 검증하며 실제 쓰기는 S49에 남는다.

## 9. 관리

Control UI로 커버되는 것 (커스텀 페이지 만들지 않음):

- 실행 중인 세션/작업 목록, 세션 히스토리
- tasks ledger (`openclaw tasks list/audit/retry/dismiss`)
- worktree 목록·복원·강제 정리
- worker(Agent) 상태, 설정
- 승인 대기(exec approval 카드는 Control UI에도 전달됨)

Control UI에 없어서 필요하면 P1 이후에 추가하는 것:

- 저장소별 Discord 채널 매핑 설정 화면 (MVP에서는 openclaw.json + Receiver 설정 파일)
- 승인자 기록의 프로젝트별 대시보드 (MVP에서는 포럼 메시지가 기록을 대체)

## 10. 보안

- **GitHub**: GitHub App 또는 최소 권한 PAT. Receiver에서 HMAC 검증 필수.
- **Discord**: guild allowlist + `users` ID 화이트리스트. DM 정책 `allowlist`.
- **Gateway**: 공개 노출 금지(loopback/tailnet). Receiver→Gateway는
  `hooks.token`(Bearer) 사용, Gateway는 loopback에서만 수신.
- **외부 콘텐츠**: GitHub 이슈 본문/댓글은 신뢰하지 않는 데이터로 취급. Receiver가 전달하는
  메시지에 "데이터" 프레이밍 유지, 프롬프트 주입 지시는 실행 대상에서 제외(스킬 명시).
- **격리**: 작업별 managed worktree + 다른 에이전트의 `non-main` sandbox(stackot
  컨트롤러는 ACP/Discord 액션을 위해 예외적 비격리 — worker 격리 아님).
  push/PR 승인 가드는 spec 요구사항이며 아직 미구현 — 실운영 전 독립 검증 필요.
- **Secrets**: 스킬에 "로그와 Discord 메시지에서 secret 마스킹" 규칙 명시. Control UI 로그는
  Gateway 로그 정책을 따름.
- **감사**: 외부 API 변경(push, PR 생성)은 포럼 메시지에 승인자·시각 기록. 상세는 tasks
  ledger.
- **타임아웃**: `sessions_spawn`의 `runTimeoutSeconds`로 worker 실행 상한. 중단은 TaskFlow
  cancel.

## 11. MVP 범위

### P0

커스텀 코드:

- [ ] Receiver: HMAC 검증, dedupe, 이벤트 정규화, `/hooks/agent` 전달
- [ ] 스레드 생성·연결 로직 (제목 컨벤션, GitHub 역링크 기록)
- [ ] Stackot 스킬 1개: 문맥 읽기 → 계획 → 승인 버튼 → worker 실행 → 보고

설정:

- [ ] Discord 서버 구성: 카테고리, 포럼 채널 3개, 태그, 봇 권한(Send Messages in Threads 포함)
- [ ] openclaw.json: guild allowlist + guild binding(→stackot), components TTL 24h,
  stackot sandbox off + 나머지 `non-main`, hooks enable
- [ ] ACP: acpx 플러그인, codex harness auth, permission profile

동작 검증:

- [ ] Issue 생성 → 스레드 생성 → 멘션 → 계획 → 승인 → worktree 실행 → 테스트 → PR 링크
- [ ] 중단·재시도 동작
- [ ] CI 실패 → PR 스레드 알림

### P1

- 여러 저장소, 슬래시 커맨드 9종, PR 리뷰 피드백 자동 반영, CI 실패 자동 분석
- 매핑 캐시 레이어 (제목 컨벤션 조회의 레이트리밍 완화)
- 동시 작업 제한, 작업 큐 우선순위
- GJC/다른 harness worker 프로필 선택 (ACP agentId 분기)
- 저장소별 권한 정책 세분화 (channelAudience access group)

### P2

- 여러 전문 agent (Planner/Reviewer 분리 스킬), 자동 코드 리뷰, 릴리스 노트 생성
- 배포 연동, 주기적 유지보수, 비용·토큰 통계 (tasks ledger 데이터 기반)

## 12. 하지 않을 것

- 별도 orchestrator/상태머신/작업 큐 구현 (TaskFlow로 충분)
- 커스텀 관리자 페이지 (Control UI로 충분)
- 봇 여러 개 운영, 자동 merge, 무조건적 자동 push
- 모든 Discord 대화 읽기, 포럼에 실시간 터미널 로그 전체 출력
- GitHub와 Discord 양쪽에서 독립적으로 상태 수정
- 승인 없는 운영 서버 접근

## 13. 근거 문서

- OpenClaw Discord 포럼/컴포넌트: docs.openclaw.ai/channels/discord
- OpenClaw HTTP hooks (HMAC 미검증 확인): docs.openclaw.ai/automation/cron-jobs
- OpenClaw ACP 런타임: docs.openclaw.ai/tools/acp-agents
- OpenClaw managed worktrees: docs.openclaw.ai/concepts/managed-worktrees
- OpenClaw TaskFlow/tasks: docs.openclaw.ai/automation
- OpenClaw sandboxing: docs.openclaw.ai/gateway/sandboxing
- OpenClaw Webhooks plugin (provider webhook 비수용 명시): docs.openclaw.ai/plugins/webhooks
- Discord Forum Channel API, GitHub Webhooks 공식 문서
# Selected deployment host

Receiver may use an optional private `openclawHookTokenFile` validated at startup
and read before each forward. File failures are fail-closed with no retired-token
fallback; prior/current secrets enter redaction before network. The B08 owner
drill observed actual native hot rotation and supported durable intake on the
selected Mac and B08 is owner-accepted; production activation remains separate
(`deploy/token-rotation.md`).

S47 restoration preserves the genuine acknowledged pending delivery and observes
actual native hook admission before persisted delivered exclusion after restart.
This receiver handoff proof is separate from downstream model, Discord and worker
completion; see `docs/verification/restore.md`.

Operational aged-pending notifications use `deploy/alerts.yaml` and the bounded
monitor described in `deploy/alerts.md`. Receipt persistence, cooldown and
uncertain acknowledgment handling are separate from CI-failure event routing.
No worker or model starts from the monitor.

The current user-selected host is the local Mac at `stackot.justn.me`
(2026-09-28): dedicated Cloudflare HTTPS tunnel, exact webhook path, loopback
Caddy/receiver/Gateway, launchd supervision. On 2026-09-29 administrator-authenticated
installation migrated all four jobs to system LaunchDaemons running as `justn`.
Owner-observed SIGKILL recovery passed for all four; the existing approval flow
remained at revision 12 with worker dispatch disabled. See `deploy/macos/README.md`.
Actual reboot recovery remains untested; FileVault is enabled. System registration
does not establish unattended cold-boot availability. Runtime, external boundary
and human acceptance remain separate gates.
