# stackot

Discord에서 GitHub 프로젝트를 지휘하는 코딩 에이전트 봇. Issue/PR 포럼 스레드를 작업실로
만들고, `@스태콧` 멘션으로 계획부터 PR 생성까지 이어진다.

구조와 범위는 [docs/spec.md](docs/spec.md) v0.2 참고. 배포는
[deploy/README.md](deploy/README.md).

## 구성

| 디렉터리 | 내용 |
|---|---|
| `docs/` | 기능 명세 (v0.2, OpenClaw 네이티브 구조) |
| `receiver/` | GitHub webhook 수신기 — HMAC 검증, delivery dedupe, 이벤트 정규화, Gateway 전달. 유일한 커스텀 서버 코드 (Bun) |
| `skill/stackot/` | OpenClaw 스킬 — 문맥 읽기 → 계획 → 버튼 승인 → ACP worker 실행 → 보고 |
| `deploy/` | openclaw.json 템플릿, 배포 가이드 |

## 동작 흐름

```txt
GitHub webhook → Receiver (HMAC·dedupe·정규화)
              → OpenClaw Gateway /hooks/agent
              → 포럼 스레드 생성/전달 → @스태콧 세션
              → 계획 게시 → 버튼 승인 → managed worktree + ACP codex worker
              → 테스트 → push/PR 승인 → PR 링크
```

## 로컬 개발

```bash
cd receiver
bun install
bun test          # 단위 테스트 (15개)
bun run src/server.ts   # STACKOT_CONFIG=./config.json 필요
```
