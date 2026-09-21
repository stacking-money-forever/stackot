# Stackot 기능 명세서 v0.2

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

`openclaw plugins install @openclaw/acpx` 후 `sessions_spawn({ runtime: "acp", agentId:
"codex", cwd: <worktree> })`로 harness를 실행한다.

- worker는 OpenClaw 도구를 기본적으로 받지 않는다(ACP 설계상 격리). 포럼 보고는 부모
  세션이 완료 이벤트를 받아 수행.
- harness별 auth는 호스트에 사전 구성돼 있어야 한다(codex 로그인 등).
- 비대면 실행이므로 permission profile을 headless로 설정(승인 프롬프트 클릭 불가).

### 격리

- **worktree**: OpenClaw managed worktree. 브랜치 `openclaw/<issue번호>-<slug>`,
  스냅샷·cleanup·restore 내장. `.worktreeinclude`로 `.env` 등 ignored 파일 시딩.
- **sandbox**: `agents.defaults.sandbox.mode: "non-main"` — 채널에서 파생된 세션은 자동
  docker 격리(기본 network none). worker harness는 ACP이므로 sandbox 밖이지만, 작업
  디렉터리가 worktree로 한정되고 tool policy로 위험 명령을 게이트한다.

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

버튼은 components v2로 구현. `allowedUsers`에 요청자 Discord ID. TTL 24h. 만료된 승인은
재요청(재시도 버튼)으로 처리.

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
- **격리**: 작업별 managed worktree + `non-main` sandbox.
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
- [ ] openclaw.json: guild allowlist, components TTL 24h, sandbox `non-main`, hooks enable
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
