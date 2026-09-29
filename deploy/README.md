# Stackot 배포 가이드 (MVP)

봇 자격(앱·권한·초대) 준비는 [bot-setup.md](bot-setup.md)를 먼저 끝낸다. 이 문서는
Gateway·Receiver·GitHub webhook 연결을 다룬다.

### 승인 대기 수신 연결

기본 native `/hooks/agent`는 모델 run을 접수한다. 승인 가드 수신을 사용할
때는 receiver에 `openclawIngressMode: "approval"`을 지정한다. 기존
`openclawHooksUrl`의 origin을 유지하고 경로는 `/stackot/hooks/agent`로 고정된다.
Gateway 플러그인의 `config.ingress`에는 enabled/tokenFile/accountId/guildId/
threadId/parentChannelId/requesterId/allowedRepos를 오너 설정으로 지정한다.
threadId는 승인용 제어 스레드, parentChannelId는 그 부모 채널이다.
본문은 이 값이나 actor/session을 덮어쓸 수 없다.

tokenFile은 오너 소유0600 `{version:1,token}` JSON이다. receiver의
`openclawHookTokenFile`도 같은 파일을 사용할 수 있으며 기존 필수 토큰은
유지한다. 누락·symlink·잘못된 권한은 거부한다. 인증 실패401, 입력 오류400,
같은 delivery의 다른 내용409, 저장/발행 불확실503이다. 입력과 pending 승인,
카드 binding 영속화 후200을 반환한다. Native 일반 hooks를 활성화할 필요는 없다.
이 경로는 worker/push/PR을 호출하지 않는다. 실제 실행 및 제품 포럼 E2E는
남은 행 검증이며, 승인 카드 수신만으로 완료를 주장하지 않는다.

## 0. 사전 준비

- 서버: Linux/macOS, Docker 설치 (sandbox backend), Node 24.16+ on 24.x (S23 검증 24.21.0) 또는 26.1+
- OpenClaw Gateway 설치: `npm install -g openclaw@2026.9.6 --allow-scripts=openclaw`
  후 `openclaw plugins install @openclaw/acpx@2026.9.6 --pin --accept-capabilities`
  및 `openclaw plugins install @openclaw/discord@2026.9.6 --pin --accept-capabilities`
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

1. 템플릿 복사: `deploy/openclaw.json5.template` → `~/.openclaw/openclaw.json`,
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

참고: 템플릿은 stackot 에이전트에만 `sandbox.mode: "off"`를 둔다 — 채널 파생
컨트롤러 세션이 ACP spawn·Discord 액션을 내야 하고 샌드박스 요청자는 ACP
spawn이 불가하기 때문이다. 다른 에이전트의 non-main 세션은 전역 `non-main`
기본값으로 계속 docker 격리된다. 이는 worker 격리가 아니며(cwd도 보안 경계가
아님) push/PR 등 외부 변경을 위한 제품 승인 가드는 spec이 요구하지만 아직
미구현이다 — generic 버튼은 서버 측 가드가 아니므로 실운영 전 독립 검증이
필요하다.

S26의 Gateway-side pending 승인 저장 모듈은 `gateway/`에 있다. 해당 디렉터리에서
`bun install --frozen-lockfile`, `bun run typecheck`, `bun test`, `bun run build`로
검증한다. `python3 gateway/scripts/build-native-probe.py` 뒤 저장소 루트에서
`python3 docs/verification/s25-probe/run.py --plugin gateway/node_modules/s26-native-plugin
--method s26probe.state --expect-approval --output gateway/node_modules/s26-restart.json`은
고정 OpenClaw/Node를 PATH에 둔 독립 재시작 오라클이다. probe는 합성 요청을
저장할 뿐 production callback 등록이나 승인/worker 실행을 활성화하지 않는다.

S27의 승인/소비 guard는 합성 actor/context 거부 매트릭스로 검증한다. 호출
context는 향후 신뢰된 서버 callback adapter가 만들어야 하며 메시지·모델·
callback payload의 actor 값을 그대로 전달하면 안 된다. 소비 성공의 operation ID는
실행 receipt가 아니므로, actual dispatch/응답 유실 대조 없이 작업 성공으로 표시하지 않는다.

S28 helper/FlowCallbackRegistry는 native 호출의 actor 및 고정 route/message
binding을 S27에 연결한다. `python3 gateway/scripts/build-plugin.py`가 dev tools를
제외한 native artifact를 `gateway/node_modules/stackot-plugin`에 만든다.
설치 뒤 `plugins.entries.stackot-gateway.config.agentId`를 설정하고 plugin을
명시적으로 enable해야 한다. 설정 없이 최초 설치하면 disabled일 수 있으므로
`stackotgateway.health`의 실제 응답까지 확인한다. 이 readonly operator.admin
RPC는 parameter를 받지 않으며 actor/context injection 경로가 아니다.
native bootstrap은 실제 기동·재기동으로 확인했고 route/flow 선택은 합성 검증했다.
실제 승인 component producer 및 두 사용자 검증은 아직 미완이다.

component producer 코드와 opt-in QA 준비 경로는 구현했다. 고정 QA 설정 없이는
QA RPC가 등록되지 않는다. `docs/verification/s28-live-runbook.md`와 JSON 계획을
따르며, `qa.info`가 돌려준 실제 sessionKey로 native session을 만들고 `qa.publish`를
호출한다. 모든 QA RPC는 parameter를 거부하고 원격 coding/push/PR을 실행하지 않는다.
공유 Discord 스레드/메시지 쓰기는 사용자가 승인했지만 지정 채널 bot 접근 403을
해결해야 한다. 실제 두 사람의
native interaction만 actor 증거로 인정한다. 기존 서버/계정 설정을 자동 변경하지 않는다.
이 빌드를 VM에 복사하거나 합성 context를 호출해도 Discord 실승인 검증이 되지 않는다.

S35 thread receipt 저장 모듈도 `gateway/`에서 함께 검증한다. 저장소 루트에서
`python3 gateway/scripts/build-thread-probe.py` 뒤 같은 restart runner에
`--plugin gateway/node_modules/s35-native-plugin --method s35probe.state --expect-thread`를
지정하면 합성 외부 생성 성공/receipt 저장 실패 후 실제 native Gateway 재시작
복원을 검사한다. 외부 생성자는 fixture이며 Discord 전송·marker 인증 증거가 아니다.

S36 backlink 저장/복구도 Gateway 테스트에 포함된다. 이미 수용된 thread
receipt가 없으면 쓰지 않으며, 실패 시 GitHub marker만 재개한다. adapter의
실제 작성자/repo/item 응답 및 definitely-not-sent/idempotency 근거가 필요하다.
합성 backend 통과는 GitHub 쓰기·Discord 연결의 활성화나 실제 E2E 증거가 아니다.

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
     "discordGuildId": "<역링크로 신뢰할 Discord 길드(서버) ID>",
     "githubBacklinkLogin": "<GitHub 이슈/PR에 스레드 URL을 기록하는 계정 로그인>",
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
  Pull request review comments, Check runs

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

- Receiver outbox/dedupe DB: `receiver/var/outbox.sqlite` (delivery ID dedupe와 미전달
  이벤트를 함께 보관, 전달 완료 행은 7일 뒤 시작 시 정리). 경로는 `STACKOT_OUTBOX_PATH`로
  바꿀 수 있다.
- 로그: Gateway는 `openclaw logs --follow`, Receiver는 stdout.
- 재시도: `openclaw tasks list` / `openclaw tasks retry <id>`.
- Worktree 보존: 중단된 작업의 worktree는 자동 삭제되지 않는다
  (dirty/unpushed 보존 정책). `openclaw worktrees list`로 확인.
# Selected host (2026-09-28)

S33 owner-only push gate preparation is in
[push-authority.md](../docs/contracts/push-authority.md). It is not wired to the
deployed callback/worker/GitHub transport; no live push authority is enabled.
Prepared owner Git transport seals verified objects and ignores worker config;
local-remote tests are S evidence, with real GitHub/worker boundary still pending.
Optional native owner factory is code-only and absent from default bootstrap;
the deployed plugin still cannot dispatch push through configuration alone.
The code-only owner catalog composer validates the persisted push intent,
seals objects lazily and disposes generated storage after callback execution.
It still requires trusted real task/worktree lineage and is not activated here.
Cleanup errors emit a fixed diagnostic without replacing a confirmed push result.
Prepared Git auth puts only a private credential-file path in child environment;
askpass reads token bytes from a0600 per-operation owner file, removed after
success/failure. The actual Mac fixture found same-UID process environment
visibility despite the tested Seatbelt profile. This closes the token-in-env
channel; actual Codex/ACP filesystem/Keychain isolation remains unverified.
Prepared Docker execution transport is documented in
[docker-worker.md](../docs/contracts/docker-worker.md). Supply a vetted installed
immutable image, approved task workspace, authentic owner authority and a
separately configured coding home. The default network is offline; a vetted
owner egress bridge is needed for model requests. No personal auth-store copy,
host Docker socket or shared Git metadata mount is provided. This is not an
active ACP worker factory, and real actor/task lineage verification is pending.
Owner catalog verification can use
[isolated-verifier.md](../docs/contracts/isolated-verifier.md): Git and the
owner-fixed test command run offline without coding auth inside Docker. It
requires a clean pinned revision before/after tests and confirmed cleanup;
no direct host fallback or live catalog activation is added.

Expired approval copy preparation and outstanding native/re-request/human QA
are recorded in [b06-expired-approval.md](../docs/verification/b06-expired-approval.md).
This copy does not renew approvals or enable worker/push/PR actions.
New-card retry preparation issues a distinct pending approval through native
requester checks; publication/receipt recovery is durable. Existing cards are
preserved and do not gain controls by silently resetting their intent.

Optional protected per-forward hook credentials, the procedure and actual B08
Mac drill are described in [token-rotation.md](token-rotation.md); static legacy
credentials remain mandatory. Controlled drill evidence does not activate
production or imply downstream completion.

Real pending restore/native Gateway admission drill is recorded in
[`docs/verification/restore.md`](../docs/verification/restore.md). Its evidence
stops at Gateway run admission; it does not establish Discord/worker completion.

Aged-pending operations monitor is documented in [alerts.md](alerts.md); it
reads loopback receiver status and sends bounded notifications to the actual
configured ci-alerts channel. Runtime delivery is required before B04 acceptance.

The user selected deployment on this Mac at `stackot.justn.me`.
See [macOS deployment](macos/README.md) for launchd and the dedicated Cloudflare
tunnel. The VM instructions below remain an alternative, not the current host.
On 2026-09-29 the four Mac jobs were migrated to system LaunchDaemons, each
running as `justn`; owner-observed crash recovery passed. Existing login plists
were preserved as `.disabled`. Actual reboot recovery is still unverified and
FileVault remains enabled; S44 is not accepted.
