# Stackot 완료 체크리스트

**이 파일이 프로젝트의 완료 조건이다.** 아래 항목이 모두 체크되기 전에는 어떤 형태로도
"완성"이라고 말하지 않는다. 테스트가 green이라는 사실은 완료가 아니다 — 그것은 로컬/합성
증거일 뿐이다.

원장(행 정의·선행관계·오라클)은 `docs/atomic-completion.md`, 행별 결정 기록은
`docs/verification/wave-*.md`, 진행 상태 요약은 `docs/verification/owner-state.md`에 있다.
이 파일은 **사람이 실제로 해야 할 일 순서**만 담는다.

## 현재 상태 (2026-09-28 기준)

- 원장 81행 중 **48행 수용, 33행 미완**. 마일스톤: **M1 36/36**, M2 2/14, M3 7/12, M4 0/4, M5 3/11, C 0/4.
- receiver 코드 기준선: `bun test` 346 pass / 0 fail, typecheck clean, `dist/server.js` 빌드, CI 매 푸시 green.
- 기존 47행은 L(로컬) 또는 S(합성 프로세스). **S23은 설치본 CLI·schema·소스 계약과 실제 로컬 Gateway 기동/인증 health로 수용**했다. R 증거는 이 범위에 한정되며, 실제 worker·GitHub→Discord 연동은 아직 미검증이다. **D(배포)·H(사람) 증거는 0건**. 근거: `docs/verification/wave-03.md`, `openclaw-contract.md`, `s23-owner-probe.md`.

## 0. 증거 등급 규칙 (먼저 읽을 것)

| 등급 | 의미 | 올리는 조건 |
|---|---|---|
| L | 로컬 코드·단위 테스트 | 이미 충족 |
| S | 합성 프로세스(스텁 의존성) | 이미 충족 |
| R | 실제 런타임(실 OpenClaw·codex worker) | 해당 소프트웨어가 실제로 설치·실행됨 |
| D | 실제 배포(호스트·HTTPS·서비스 상주) | 배포된 SHA에서 관측 |
| H | 사람 QA | 사람이 실제로 보고 판단 |

**test double은 등급을 올리지 못한다.** 스텁으로 통과한 것을 R/D/H라고 부르면 그 순간 기록이 거짓이 된다.

## 1. 런타임 설치 — OpenClaw + acpx (13행을 한꺼번에 연다)

전제: VM(§3) 또는 동등한 호스트. 설치 명령은 `deploy/README.md` §2가 정본이다.

- [x] **OpenClaw 설치** — S23 전용 워크트리의 ignored runtime에 Node 24.21.0, OpenClaw 2026.9.6, ACP 플러그인 2026.9.6 설치. 배포 호스트 설치와는 별도다.
- [x] **S23** 설치본 version/config/`--help`/ACP/worktree 계약 확인. 산출물: `docs/verification/openclaw-contract.md`; 오너 재실행·교정·정확 SHA CI 성공은 `wave-03.md`에 기록.
- [ ] **S24** `deploy/openclaw.json5.template`의 치환본이 실제 버전 스키마로 `openclaw config validate`를 통과
- [ ] **S25** task/approval/run 상태의 소유자 확정(재시작 durability probe) → `docs/contracts/task-state.md`
- [ ] **S26/S27** 승인 레코드(요청자+plan hash+TTL) 저장·거부 매트릭스 — S25 계약 확정 후 위치 고정
- [ ] **S30** task당 worktree/branch 계보 하나(재시도 경로 동일, dirty 보존)
- [ ] **S31** cancel/timeout 후 작업물 보존
- [ ] **S29** 유효 승인 이후에만 ACP spawn (acpx 플러그인 + codex 로그인 선행)
- [ ] **S28** 승인 actor를 Discord UI 밖에서 강제 확인 — 아래 Discord 값 필요
- [ ] **S33/S34/S36** push·PR·역링크 쓰기 어댑터 — 아래 GitHub 권한 필요
- [ ] **S35** thread 생성 성공 receipt 영속화(재시도 시 thread 재사용)

## 2. 사용자 자산 (값이 없으면 위 행들이 시작조차 못 한다)

- [ ] **Discord**: 봇 토큰, 길드 ID, 포럼 3개(이슈/PR) + `#ci-alerts` + `#stackot-admin` 채널 ID
- [ ] **`githubBacklinkLogin`**: GitHub 이슈/PR에 스레드 URL을 기록하는 계정 로그인 (S19부터 필수 설정)
- [ ] **`githubWebhookSecret`**: webhook 서명 비밀값
- [ ] **GitHub 토큰**: repo:read 최소권한(공용), 원하면 **repo별 토큰**(B01에서 지원)
- [ ] **GitHub push/PR 권한**: S33/S34/S49~S51을 위해 (worker가 자격을 쥐지 않도록 게이트에서만 사용)
- [ ] **`openclawHookToken`**: gateway hooks.token (gateway와 receiver 동일 값)
- [ ] **도메인 + A 레코드 + ACME 메일**: 공개 webhook 엔드포인트용

## 3. 호스트 배포 (5행) — 준비물은 `deploy/vm/`에 이미 있음

**준비물은 증거가 아니다.** 아래 명령을 실제로 돌려 출력을 남겨야 한다.

- [ ] Proxmox KVM 게스트 생성(2–4 vCPU / 4–8 GB / 60–100 GB) + `deploy/vm/cloud-init.yaml` user-data
- [ ] `deploy/vm/README.md` 순서대로 secrets 배치 → Caddy/유닛 설치 → receiver 기동
- [ ] 공개 확인: `https://<도메인>/stackot/webhook`에 서명 없이 POST → **401**(200이면 실패), 그 외 경로 404
- [ ] **S44** `systemctl kill -s SIGKILL stackot-receiver` 후 자동 재기동 + `reboot` 후 무개입 복귀
- [ ] **S45** 외부에서 443/80만 열려 있고 9377·18789는 도달 불가(gateway loopback 유지) 증명
- [ ] **S47** 스냅샷으로 빈 환경에서 pending 복원 drill (`backup.ts` + `replay.ts`)
- [ ] **S48** 이전 바이너리 + 현재 DB로 rollback drill
- [ ] **S40** threat model + 라이브 prompt-injection tool-denial probe

## 4. 실제 E2E + 사람 (4행)

- [ ] 실 webhook→thread→역링크 왕복 receipt (**S49**)
- [ ] **S50**: 승인→worker→테스트→승인된 push→PR 첫 receipt (사람이 승인 클릭)
- [ ] **S51**: 두 번째 독립 E2E (수동 보정 없이 재성공)
- [ ] **S52**: Gateway 중단/재시작 장애 QA — 유실·중복·권한 우회 없음

## 5. 릴리스·운영 (8행)

- [ ] **B04** 오래된 pending 알림(수신 대상 필요)
- [ ] **B05** `status` 커맨드가 영속 상태와 일치
- [ ] **B06** 만료 승인 재요청 안내 문구 + 사람 QA
- [ ] **B07** 새 사용자 온보딩 문서 + 사람 QA
- [ ] **B08** 토큰 교체 drill(무중단)
- [ ] **B09** 24h soak 관찰
- [ ] **B10** required checks / secret scanning 설정 readback
- [ ] **B11** 정확 SHA 릴리스 manifest + 릴리스 노트 (P0/P1 증거 전부 연결)

## 6. 포스트릴리스 (4행, MVP 비차단)

- [ ] **C01** 리뷰 이벤트 → 원래 task 연결
- [ ] **C02** 리뷰 수정용 새 승인(이전 승인 재사용 거부)
- [ ] **C03** task 비용 집계
- [ ] **C04** 실측 기반 단일 호스트 대안 ADR

## 7. 이미 끝난 것 (다시 하지 말 것)

- M1 전 구간(36행): 수신 서명 검증·delivery dedupe·크기 제한·malformed 거부, durable outbox(SQLite)와 ACK 이전 커밋, 재시도/dead-letter/manual replay, 라우팅 결정 모듈, 역링크 표면·페이지네이션·신뢰 검증(길드+기록자), 문서-구현 정합.
- 운영 기반: secret 마스킹(로그+`last_error`), health/readiness/status 분리, 구조화 텔레메트리, queue 메트릭, 일관 backup(`VACUUM INTO`).
- P1 로컬: repo별 자격증명 분리(B01), 전달 동시성·repo 공정성(B02), GitHub 429 `Retry-After` 준수(B03), worker 결과 독립 검증(S32).
- 배포 준비물: `deploy/vm/` (cloud-init·유닛 3종·Caddyfile·백업 스크립트+타이머·env 예시·런북).

## 8. 작업 규칙 (이 저장소에서 작업할 때)

1. 행 단위로 진행한다: 원장의 한 행 = 하나의 changeset = 하나의 오라클. 실행 계약은 `docs/atomic-completion.md`(워커 1건, `--model swe-2`, 오너 검증, 필요 시 1회 좁은 재시도)를 따른다.
2. 오너는 워커 보고를 믿지 않는다: 파일 해시 대조 → 오너 오라클 재실행 → **수정 전 코드 대비 판별력 확인** → 필요 시 실프로세스 증명.
3. 프로세스 제어·파일시스템 의미·타이밍을 건드리는 변경은 **푸시해서 CI(Linux)에서 통과를 확인하기 전까지 수용이라고 부르지 않는다**. 이 저장소에서만 세 번(셸 kill 차이, WAL 유도 방식, drain 경합) 로컬 green이 러너에서 깨졌다.
4. 증거를 파괴하지 않는다: 태스크 워크트리와 리시트는 해당 행 브랜치에 커밋되어 있다. 워크트리를 삭제하지 않는다.
5. secret은 저장소에 들어가지 않는다. receiver 설정은 누락·공백·`<...>` placeholder를 시작 시 거부한다(의도된 동작).
6. 문서를 사실과 일치시킨다: 동작이 바뀌면 `docs/spec.md`·`deploy/README.md`·`deploy/vm/README.md`를 같은 변경에서 갱신한다.
