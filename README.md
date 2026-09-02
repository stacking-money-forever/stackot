# stackot

Discord에서 GitHub 프로젝트를 지휘하는 코딩 에이전트 봇. Issue/PR 포럼 스레드를 작업실로
만들고, `@스태콧` 멘션으로 계획부터 PR 생성까지 이어진다.

구조와 범위는 [docs/spec.md](docs/spec.md) v0.2 참고.

- OpenClaw Gateway가 orchestrator 역할 (큐, 승인 버튼, worktree, worker 실행, 관리 UI)
- 커스텀 코드는 2개: GitHub webhook Receiver(유일한 서버 코드) + Stackot 스킬 1개
- worker는 ACP harness (codex 등)를 격리된 managed worktree에서 실행
