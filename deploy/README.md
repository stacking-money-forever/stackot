# Stackot 배포 가이드 (MVP)

## 0. 사전 준비

- 서버: Linux/macOS, Docker 설치 (sandbox backend), Node 22+
- OpenClaw Gateway 설치: `npm install -g openclaw@latest --allow-scripts=openclaw`
- Discord 앱 생성 (Developer Portal):
  - Bot 페이지: username `스태콧`, **Message Content Intent** + **Server Members Intent** 활성화, 토큰 복사
  - OAuth2 URL: scopes `bot` + `applications.commands`; 권한에 **Send Messages in Threads** 포함
  - 서버에 초대, Developer Mode로 Server/User/Channel ID 확보

## 1. Discord 서버 구성

`GitHub` 카테고리 아래 생성:

| 채널 | 타입 | 태그 |
|---|---|---|
| `#issues` | 포럼 | bug, feature, question, triage, in-progress, blocked, resolved, wont-fix |
| `#pull-requests` | 포럼 | draft, review, changes-requested, ci-failed, approved, merged, closed |
| `#ci-alerts` | 텍스트 | — |
| `#stackot-admin` | 텍스트 | — |

채널 ID 4개를 기록한다.

## 2. Gateway 설정

1. 템플릿 복사: `deploy/openclaw.json5.template` → `~/.openclaw/openclaw.json5`,
   placeholder 채우기 (`<GUILD_ID>`, 채널 ID 4개, `<OWNER_DISCORD_USER_ID>`,
   `<LONG_RANDOM_HOOK_TOKEN>` — `openssl rand -hex 32`).
2. `DISCORD_BOT_TOKEN`을 환경변수 또는 `~/.openclaw/.env`에 설정.
3. 스킬 설치:
   ```bash
   mkdir -p ~/.openclaw/workspace-stackot/skills
   cp -r skill/stackot ~/.openclaw/workspace-stackot/skills/
   ```
4. 검증 후 기동:
   ```bash
   openclaw config validate
   openclaw gateway install   # 또는 openclaw gateway (foreground)
   openclaw dashboard         # Control UI 확인: 세션/태스크/worktree
   ```
5. ACP worker auth (호스트에 사전 구성): `codex` 로그인 상태 확인.
   `openclaw config set plugins.entries.acpx.enabled true` (템플릿에 포함됨).

## 3. Receiver 설정

1. `receiver/config.json` 생성 (아래 예). `githubWebhookSecret`은 GitHub webhook
   설정 시 지정한 secret과 동일해야 한다:
   ```json
   {
     "host": "127.0.0.1",
     "port": 9377,
     "githubWebhookSecret": "<WEBHOOK_SECRET>",
     "openclawHooksUrl": "http://127.0.0.1:18789/hooks",
     "openclawHookToken": "<LONG_RANDOM_HOOK_TOKEN — gateway와 동일>",
     "githubToken": "<repo:read 최소권한 PAT>",
     "allowedThreadIds": [],
     "issuesForumChannelId": "<ISSUES_FORUM_CHANNEL_ID>",
     "prsForumChannelId": "<PRS_FORUM_CHANNEL_ID>",
     "ciAlertsChannelId": "<CI_ALERTS_CHANNEL_ID>",
     "adminChannelId": "<ADMIN_CHANNEL_ID>",
     "agentId": "stackot"
   }
   ```
2. 실행: `cd receiver && bun run src/server.ts` (systemd 등으로 상주 권장).
3. 리버스 프록시: `https://<host>/stackot/webhook` → `127.0.0.1:9377/webhook`.
   Gateway는 절대 공개하지 않는다 (loopback 고정).

## 4. GitHub Webhook 설정

저장소 Settings → Webhooks → Add webhook:

- Payload URL: `https://<host>/stackot/webhook`
- Content type: `application/json`
- Secret: `<WEBHOOK_SECRET>` (receiver config와 동일)
- Events: Issues, Issue comments, Pull requests, Pull request reviews,
  Pull request review comments, Check runs, Check suites

## 5. 동작 검증 (P0 체크리스트 대응)

1. **Issue → 스레드**: GitHub에서 Issue 생성 → `#issues`에 스레드 생성 확인 →
   이슈 본문에 스레드 URL 댓글 확인.
2. **멘션 → 계획 → 승인**: 스레드에서 `@스태콧 이 이슈 읽고 작업 계획 세워줘` →
   계획 게시 + 버튼 → `작업 시작` 클릭.
3. **worktree 실행**: Control UI에서 worktree/세션 생성 확인 → worker(codex) 실행 →
   테스트 결과 스레드 게시 확인.
4. **push/PR**: `push 허용` → `PR 생성` 버튼 → GitHub에 PR 생성, `Closes #N` 확인.
5. **중단·재시도**: 진행 중 `중단` 버튼 → 상태 기록 확인 → `재시도` → 재개 확인.
6. **CI 실패**: 실패하는 PR 생성 → `#ci-alerts` 알림 + PR 스레드 답글 확인.

## 6. 운영 메모

- Receiver dedupe DB: `receiver/var/dedupe.sqlite` (7일 TTL, 자동 정리).
- 로그: Gateway는 `openclaw logs --follow`, Receiver는 stdout.
- 재시도: `openclaw tasks list` / `openclaw tasks retry <id>`.
- Worktree 보존: 중단된 작업의 worktree는 자동 삭제되지 않는다
  (dirty/unpushed 보존 정책). `openclaw worktrees list`로 확인.
