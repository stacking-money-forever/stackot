# Stackot 배포 가이드 (MVP)

봇 자격(앱·권한·초대) 준비는 [bot-setup.md](bot-setup.md)를 먼저 끝낸다. 이 문서는
Gateway·Receiver·GitHub webhook 연결을 다룬다.

## 0. 사전 준비

- 서버: Linux/macOS, Docker 설치 (sandbox backend), Node 22+
- OpenClaw Gateway 설치: `npm install -g openclaw@latest --allow-scripts=openclaw`
- Discord 앱: [bot-setup.md](bot-setup.md) 완료 — 토큰, 권한, 초대, ID 확보까지

## 1. Discord 서버 구성

**프로젝트(저장소)별로 포럼 채널 쌍을 만든다.** 카테고리는 프로젝트당 하나:

```txt
GitHub 카테고리 (프로젝트마다 반복 — 이름은 프로젝트명 추천)
├─ #issues            포럼 — 그 프로젝트 Issue 스레드
├─ #pull-requests     포럼 — 그 프로젝트 PR 스레드
└─ (공용, 하나만)
   #ci-alerts         텍스트 — 모든 프로젝트 CI 실패
   #stackot-admin     텍스트 — 관리 알림
```

포럼 채널 태그:

- `#issues`: bug, feature, question, triage, in-progress, blocked, resolved, wont-fix
- `#pull-requests`: draft, review, changes-requested, ci-failed, approved, merged, closed

기록할 것: 프로젝트별 포럼 채널 ID 2개씩 + 공용 채널 ID 2개.

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

1. `receiver/config.json` 생성 — `receiver/config.example.json`을 복사하고 채운다.
   저장소마다 `repos` 항목 하나씩 (키는 `owner/name` 정확히), 포럼 채널 ID는
   **저장소별로 따로** 만든 포럼 채널의 ID다:
   ```json
   {
     "host": "127.0.0.1",
     "port": 9377,
     "githubWebhookSecret": "<WEBHOOK_SECRET>",
     "openclawHooksUrl": "http://127.0.0.1:18789/hooks",
     "openclawHookToken": "<LONG_RANDOM_HOOK_TOKEN — gateway와 동일>",
     "githubToken": "<repo:read 최소권한 PAT>",
     "repos": {
       "owner/repo-a": { "issuesForumChannelId": "<...>", "prsForumChannelId": "<...>" },
       "owner/repo-b": { "issuesForumChannelId": "<...>", "prsForumChannelId": "<...>" }
     },
     "ciAlertsChannelId": "<CI_ALERTS_CHANNEL_ID>",
     "adminChannelId": "<ADMIN_CHANNEL_ID>",
     "agentId": "stackot"
   }
   ```
   등록 안 된 저장소의 webhook 이벤트는 #stackot-admin으로만 알림이 가고
   스레드는 만들어지지 않는다.
2. 실행: `cd receiver && bun run src/server.ts` (systemd 등으로 상주 권장).
3. 리버스 프록시: `https://<host>/stackot/webhook` → `127.0.0.1:9377/webhook`.
   Gateway는 절대 공개하지 않는다 (loopback 고정).

## 4. GitHub Webhook 설정

**webhook은 스태콧에 붙일 저장소마다 각각** 설정한다 (저장소 Settings → Webhooks →
Add webhook). Secret은 전부 같은 값으로:

- Payload URL: `https://<host>/stackot/webhook`
- Content type: `application/json`
- Secret: `<WEBHOOK_SECRET>` (receiver config와 동일)
- Events: Issues, Issue comments, Pull requests, Pull request reviews,
  Pull request review comments, Check runs, Check suites

webhook을 붙인 저장소는 receiver `config.json`의 `repos`에도 등록돼야
스레드가 생성된다.

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
