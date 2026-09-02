# 스태콧 Discord 봇 만들기 (설정 가이드)

스태콧 봇 자체는 코드가 아니다. OpenClaw Gateway가 봇 토큰으로 Discord에 접속하고
모든 메시지·스레드·버튼을 처리한다(docs/spec.md §2). 우리가 만드는 것은 **Discord
개발자 포털의 앱(봇) 자격과 권한 설정**이다. 이 문서를 끝내면 `deploy/README.md`
§2(Gateway 설정)로 넘어간다.

## 1. 애플리케이션 생성

1. https://discord.com/developers/applications → **New Application** → 이름 `스태콧`
2. **Bot** 페이지:
   - Username: `스태콧` (서버에서 보이는 이름)
   - **Privileged Gateway Intents** 두 개 활성화:
     - ✅ **Message Content Intent** — 멘션 본문을 읽기 위해 필수
     - ✅ **Server Members Intent** — `allowedUsers` 버튼 제한과 권한 검사에 필요
     - Presence Intent는 불필요
   - **Reset Token** → 토큰 복사 (최초 생성이지 "재설정"이 아님 — 한 번만 보인다)
   - 토큰은 안전한 곳에 보관. Gateway 머신의 `DISCORD_BOT_TOKEN` 환경변수로 쓴다.

## 2. 초대 URL 생성

**OAuth2 → URL Generator**:

- Scopes: `bot`, `applications.commands` (P1 슬래시 커맨드 대비)
- 생성되는 **Bot Permissions** 체크:

| 구분 | 권한 | 이유 |
|---|---|---|
| General | View Channels | 포럼 채널 접근 |
| Text | Send Messages | 스레드 답변 |
| Text | **Send Messages in Threads** | 포럼 스레드에 게시 — 스태콧의 핵심 동작 |
| Text | Read Message History | 스레드 맥락 읽기 |
| Text | Embed Links | 계획/요약 카드 |
| Text | Attach Files | 결과 파일 첨부 |
| Text | Add Reactions | 진행 표시 |
| Text | Create Public Threads | 포럼 스레드 생성 (message thread create) |
| Text | Manage Threads | 스레드 태그·제목 정리, 아카이브 |

생성된 URL을 열고 대상 서버 선택 → Continue.

## 3. 서버 구성

개인 서버 권장(스펙 §2 보안 기본값). `GitHub` 카테고리 아래:

| 채널 | 타입 | 태그 |
|---|---|---|
| `#issues` | 포럼 | bug, feature, question, triage, in-progress, blocked, resolved, wont-fix |
| `#pull-requests` | 포럼 | draft, review, changes-requested, ci-failed, approved, merged, closed |
| `#ci-alerts` | 텍스트 | — |
| `#stackot-admin` | 텍스트 | — |

태그는 포럼 채널 설정에서 직접 만든다(봇이 만들지 않는다 — Gateway가 태그를 다루지
않으므로 관리자 수동 운영).

채널별 권한 한정(선택이지만 권장): `#issues`, `#pull-requests`는 `@스태콧` 봇 역할에만
위 권한을 주고, `#stackot-admin`은 관리자 역할만 View 가능하게.

## 4. ID 확보

Discord 앱에서 **Developer Mode** 활성화(사용자 설정 → 고급) 후 우클릭 → ID 복사:

- Server (Guild) ID — `<GUILD_ID>`
- 본인 User ID — `<OWNER_DISCORD_USER_ID>`
- 채널 ID 4개 — issues / pull-requests / ci-alerts / stackot-admin

이 ID들은 `deploy/openclaw.json5.template`의 placeholder에 그대로 들어간다.

## 5. Gateway에 봇 토큰 전달

Gateway 머신에서:

```bash
export DISCORD_BOT_TOKEN="<복사한 토큰>"
# 영구 설정은 ~/.openclaw/.env 에 저장 (deploy/README.md §2)
```

토큰을 채팅·코드·문서에 붙이지 않는다. 유출 시 Developer Portal에서 즉시 Reset.

## 6. 확인

1. 봇이 서버에 접속해 있는지 (멤버 목록에 오프라인 봇 표시)
2. `deploy/README.md` §2 완료 후 Gateway 기동 → Control UI에서 discord 채널 상태 확인
3. `#stackot-admin`에서 `@스태콧 핑` → 응답 오면 봇 연결 완료

## 트러블슈팅

| 증상 | 원인 |
|---|---|
| 봇이 멘션에 반응 없음 | Message Content Intent 미활성화, 또는 `openclaw.json5`의 guild/channel ID 오타 |
| 스레드에 게시 실패 | **Send Messages in Threads** 누락 — 권한 재발급 후 재초대 필요할 수 있음 |
| 포럼에 스레드 생성 실패 | Create Public Threads 권한 누락 |
| 버튼 클릭 거부(ephemeral denial) | `allowedUsers`와 클릭자 User ID 불일치 |
