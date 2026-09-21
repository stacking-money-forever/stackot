# Stackot atomic completion ledger

Understood as: 원자 작업을 Devin interactive --model swe-2에 한 건씩 맡기고 Codex/Astra 오너가 직접 검증하여 제품 출시 증거까지 진행한다.

Base: origin/main 1259895 (product code d473453). Existing 21 unit tests pass. Existing outbox candidate remains unmerged in stackot-receiver-delivery-20260914; reuse its bounded store, do not claim production recovery. No credentials or deployment evidence currently established.

## Execution contract

Each row is ONE task, ONE primary changeset/receipt, ONE core oracle. At most TWO Todo items (implement; verify/report), no subagents, maximum TWO sibling Devin workers. Exact CLI selector --model swe-2; no fallback. Meter provider: uncovered (Devin). Worker report is a candidate; owner checks diff, scope and oracle and records ACCEPT/REJECT. One narrowed retry only. No worker commit/push/merge/deploy/release/worktree deletion. No source changes outside its Stackot task checkout. New external-runtime-dependent paths are provisional: S23/S25 must freeze their exact location in a launch contract before dispatch.

L=로컬, S=합성 process/fixtures, R=실런타임, D=실배포, H=사람 QA. A D/H claim needs actual deployment/human receipt; test doubles never upgrade it. Command paths run in receiver unless stated. Named new tests are planned oracles, not claims they exist today.

Boundaries: -=local approved; I=installation/runtime auth (repo-local prepare first, global changes require scope); E=user-owned external credentials/accounts; P=push/PR; D=deployment/host/DNS; G=GitHub settings/merge/release; H=consented human action. Signatures in tests use synthetic secret; live signing/token values never enter reports. Local implementation authorization is not external action approval.

Failure in a row means REJECT, retain candidate and evidence, do not integrate; narrow once then record blocker. Rollback means remove ONLY owner-applied delta using reverse patch after confirming no intervening user edit, never reset/checkout/delete worktree. Data/external rows require tested restore, never automatic destructive rollback. Residual risk: the next evidence layer remains unverified until its dependent task passes.

## Atomic work DAG

The predecessors column is the canonical directed acyclic graph; all predecessors must be owner-accepted. Rows are topologically ordered except independent lanes that may run together. All status TODO initially. Existing HMAC/basic dedupe/21 tests are baseline, not new tasks.

| ID | Priority | Predecessors | Exact scope | Single artifact / observable result | Single core oracle | Completion | Failure / rollback trigger | Evidence | Boundary |
|---|---|---|---|---|---|---|---|---|---|
| S01 | P0 | - | config.ts + config.test.ts | webhook secret 누락/빈/공백/비문자열 거부 | bun test test/config.test.ts | 유효 secret 허용, 나머지 모두 시작 실패 | 기존 정상 설정 거부 | L | - |
| S02 | P0 | - | outbox.ts + outbox.test.ts | 기존 후보 durable store 이식(부모 mkdir, pending, dedupe, delivered_at migration) | bun test test/outbox.test.ts | 재개·8일 지연 보관·schema upgrade 통과 | pending 손실 또는 premature purge | S | - |
| S03A | P0 | S01 | config.ts + config.test.ts | port가 정수 1..65535인지 검증 | invalid port matrix | 숫자 외·범위 밖 port는 시작 실패 | 기본/유효 port 회귀 | L | - |
| S03B | P0 | S03A | config.ts + config.test.ts | openclawHooksUrl이 절대 http(s) URL인지 검증 | invalid URL matrix | 잘못된 URL은 시작 실패 | loopback URL 회귀 | L | - |
| S03C1 | P0 | S03B | config.ts + config.test.ts | githubWebhookSecret의 literal angle-bracket placeholder 거부 | placeholder-secret matrix | `<...>` secret은 시작 실패 | 유효 secret 회귀 | L | - |
| S03C2 | P0 | S03C1 | config.ts + config.test.ts | openclawHookToken의 literal angle-bracket placeholder 거부 | placeholder-hook-token test | `<...>` hook token은 시작 실패 | 유효 token 회귀 | L | - |
| S03C3 | P0 | S03C2 | config.ts + config.test.ts | githubToken의 literal angle-bracket placeholder 거부 | placeholder-github-token test | `<...>` GitHub token은 시작 실패 | 유효 token 회귀 | L | - |
| S03C4A | P0 | S03C3 | config.ts + config.test.ts | ciAlertsChannelId의 literal angle-bracket placeholder 거부 | placeholder-ci-alert test | `<...>` CI channel은 시작 실패 | 유효 ID 회귀 | L | - |
| S03C4B | P0 | S03C4A | config.ts + config.test.ts | adminChannelId의 literal angle-bracket placeholder 거부 | placeholder-admin-channel test | `<...>` admin channel은 시작 실패 | 유효 ID 회귀 | L | - |
| S03C4C | P0 | S03C4B | config.ts + config.test.ts | agentId의 literal angle-bracket placeholder 거부 | placeholder-agent test | `<...>` agent ID는 시작 실패 | 유효 ID 회귀 | L | - |
| S03C4D | P0 | S03C4C | config.ts + config.test.ts | repo forum channel ID의 literal angle-bracket placeholder 거부 | placeholder-repo-channel test | `<...>` forum ID는 시작 실패 | 유효 ID 회귀 | L | - |
| S04A | P0 | - | receiver/package.json | `bun run test` script 명시 | bun run test | 기존 전체 test runner가 script로 재현 | script가 runner와 불일치 | L | - |
| S04B | P0 | S04A | receiver/package.json | `bun run typecheck` script 명시 | bun install --frozen-lockfile && bun run typecheck | 설치 뒤 TS 검사가 script로 재현 | script가 숨은 global 의존 | L | - |
| S04C | P0 | S04B | receiver/package.json | `bun run build` script 명시 | bun run build | entrypoint bundle 생성 | build가 source tree를 오염 | L | - |
| S04D | P0 | S04C | bun.lock + receiver/package.json + .gitignore | receiver package의 lockfile 위치 고정 | disposable copy frozen install twice | lockfile 한 개와 반복 설치 일치 | lock drift 또는 숨은 root traversal | L | - |
| S05A | P0 | S01 | ingress.ts + ingress.test.ts | delivery header의 missing/blank 판정 helper | missing/blank helper matrix | 유효 ID만 반환 | empty ID 통과 또는 정상 ID 거부 | L | - |
| S05B | P0 | S05A | server.ts + server.delivery.integration.test.ts | webhook endpoint에 delivery header 4xx 적용 | signed missing-header HTTP request | missing/blank은 4xx, DB 불변 | UUID 대체 또는 2xx ACK | S | - |
| S06 | P0 | S05 | ingress.ts + ingress.test.ts | JSON parse 실패를 저장 이전에 거부 | malformed then corrected same ID test | 400 뒤 정상 같은 ID 접수 | ID 선점 | S | - |
| S07 | P0 | S06 | ingress.ts + ingress.test.ts | 지원 payload 최소 schema 검사 | event payload matrix | 잘못된 객체는 4xx, process 생존 | uncaught handler exception | S | - |
| S08A | P0 | S07 | ingress.ts + ingress.test.ts | 제한된 request body stream reader | chunked byte-limit test | 상한 초과는 typed failure | 전체 body 버퍼링 | L | - |
| S08B | P0 | S08A | server.ts + server.size.integration.test.ts | webhook endpoint의 413 및 dedupe 무변경 | oversized signed HTTP request | 413, row 0 | body read 후 dedupe 또는 2xx | S | - |
| S09A | P0 | S02,S08B | server.ts + server.outbox.integration.test.ts | outbox enqueue commit 뒤에만 ACK | signed valid HTTP request + SQLite row | 2xx 전에 pending row 존재 | persist 전 ACK | S | - |
| S09B | P0 | S09A | server.ts + server.outbox.failure.integration.test.ts | outbox DB write failure는 5xx | unwritable DB path request | 5xx, ACK 없음 | 실패 후 2xx | S | - |
| S10 | P0 | S09 | gateway.ts + gateway.test.ts | Gateway 요청 시간 제한 | hanging gateway timeout test | 정해진 시간에 실패 반환 | 무기한 pending fetch | S | - |
| S11 | P0 | S10 | delivery.ts + delivery.test.ts | pending drain과 backoff | fake-clock retry test | 재시도 시간 준수, key 유지 | busy retry 또는 중복 drain | S | - |
| S12 | P0 | S11 | outbox.ts + outbox.test.ts | dead-letter와 last_error 저장 | retry exhaustion test | 한도 후 재시도 멈춤 | 무한 재시도 | S | - |
| S13 | P0 | S12 | receiver/src/replay.ts + replay.test.ts | dead-letter 한 건 수동 재개 | exact-ID replay test | 선택 ID만 pending 복귀 | 범위 밖 replay | S | - |
| S14 | P0 | S11 | server.ts + restart.integration.test.ts | startup drain/종료 lifecycle | 502 kill restart recovery test | ACK 이벤트 재개와 동일 key | 재시작 유실 | S | - |
| S15 | P0 | S02 | outbox.ts + outbox.test.ts | SQLite busy/durability 정책 | concurrent duplicate insert test | 동시 ID 하나만 저장 | 두 side-effect job 생성 | S | - |
| S16 | P0 | - | normalize.ts + normalize.test.ts | opened만 create-thread 분류 | issue/PR action table test | edited/closed/reopen/sync는 followup | followup 신규 thread | L | - |
| S17 | P0 | S16 | mapping.ts + mapping.test.ts | PR discussion comments 올바른 issues endpoint 사용 | fetch URL contract test | PR 역링크 일반 댓글 검색 | review comment만 검색 | S | - |
| S18 | P0 | S17 | mapping.ts + mapping.test.ts | 역링크 댓글 pagination | page-2 backlink test | 후속 페이지 링크 복원 | 첫 20개만 조회 | S | - |
| S19 | P0 | S18 | mapping.ts + mapping.test.ts | 신뢰 가능한 bot marker/길드 역링크 검증 | forged backlink rejection test | 임의 댓글 링크 거부 | 다른 길드로 라우팅 | S | E |
| S20 | P0 | S16 | normalize.ts + routing.test.ts | check_run PR 목적지 추출 | CI with linked PR fixture | PR ID와 CI 대상 보존 | CI 채널만 전달 | L | - |
| S21 | P0 | S19,S20,S09 | router.ts + routing.test.ts | 지원 event의 목적지 결정 | routing table replay | opened/followup/CI 목적지 일치 | repo 간 혼선 | S | - |
| S22 | P0 | S21 | docs/spec.md + deploy/README.md | 지원하지 않는 check_suite/push/release 주장 제거 | source/event subscription comparison | 문서와 구독 목록 일치 | 미구현 지원 주장 | L | - |
| S23 | P0 | - | docs/verification/openclaw-contract.md | 고정 OpenClaw/acpx 계약 조사 receipt | 실제 version/config/help probe | hook/task/ACP/worktree API 근거 존재 | 추정 API 또는 실행 불가 | R | I |
| S24 | P0 | S23 | deploy/openclaw.json5.template | 실제 버전 config schema 일치 | openclaw config validate | template 치환본 validate 통과 | unknown field | R | I,E |
| S25 | P0 | S23 | docs/contracts/task-state.md | task/approval/run 상태 소유자 확정 | native state restart probe | durability와 callback actor 출처 검증 | native 기능 추측 | R | I |
| S26 | P0 | S25 | approval.ts + approval.test.ts (계약 확정 후 위치 고정) | requester+plan hash+TTL 승인 레코드 | approval persistence restart test | 새 process에서 승인 상태 복원 | 승인 유실 | S | - |
| S27 | P0 | S26 | approval.ts + approval.test.ts | actor/expiry/plan version 승인 거부 | unauthorized callback matrix | 타인·만료·변경 plan 모두 거부 | 권한 우회 | S | - |
| S28 | P0 | S27,S24 | Stackot callback adapter + contract test | 실제 callback actor를 승인 guard 연결 | two-user approval runtime probe | UI 외 callback 강제 확인 | 프롬프트에만 의존 | R | E,H |
| S29 | P0 | S28 | worker adapter + worker.test.ts | 유효 start 승인만 ACP spawn | before/after approval probe | 미승인 spawn 0 | 승인 전 파일 변경 | R | I,E |
| S30 | P0 | S29 | worktree adapter + worktree.test.ts | task당 worktree/branch 계보 하나 | retry worktree identity test | 재시도 경로 동일, dirty 보존 | 새 branch 또는 덮어쓰기 | R | I |
| S31 | P0 | S30 | worker lifecycle adapter + test | cancel/timeout 뒤 작업물 보존 | cancel real worker probe | worker 종료, dirty 남음 | worker 계속 실행 | R | I |
| S32 | P0 | S30 | result verifier + test | worker 결과의 diff/test 독립 확인 | lying worker fixture | 실패 테스트 완료 주장 거부 | worker 문자열만 신뢰 | S | - |
| S33 | P0 | S27,S32 | push gate adapter + test | push 별도 승인과 credential 경계 | unapproved push denial test | 승인 전 원격 변경 없음 | worker가 push credential 보유 | R | E |
| S34 | P0 | S33 | PR adapter + test | PR 별도 승인과 중복 lookup | repeat PR action probe | 같은 task PR 하나 | 중복 PR | D | P,E |
| S35 | P0 | S21,S24 | thread adapter + test | thread 생성 성공 receipt 영속화 | post-create crash retry fixture | 재시도 thread 재사용 | 중복 thread | S | - |
| S36 | P0 | S35,S19 | backlink adapter + test | 역링크 실패만 재개 | thread-ok backlink-fail replay | thread 유지·backlink 한 번 | 전체 작업 재생성 | S | - |
| S37 | P0 | S04 | receiver/package.json | typecheck/test/build 명령 고정 | clean install command sequence | 명령 재현 | 암묵 global 의존 | L | - |
| S38 | P0 | S37,S14,S21 |  .github/workflows/ci.yml | SHA 연결 receiver checks | CI run same SHA | 필수 checks 모두 통과 | 다른 SHA 증거 | D | P |
| S39 | P0 | S09 | redact.ts + redact.test.ts | 로그 secret masking | seeded secret log test | secret 원문 없음 | 토큰 노출 | S | - |
| S40 | P0 | S29,S33 | docs/security/threat-model.md | 외부 콘텐츠/worker 권한 경계 감사 | prompt injection tool denial probe | 권한 없는 tool side effect 0 | 문자열 프레이밍만 방어 | R | I |
| S41 | P0 | S09 | health.ts + health.test.ts | DB readiness와 Gateway degraded 구분 | gateway-down health probe | 수신 queue 유지, dependency 경고 | Gateway down 수신 중지 | S | - |
| S42 | P0 | S12,S39 | telemetry.ts + telemetry.test.ts | delivery 상태 구조화 로그 | single-delivery correlation test | ID/error/attempt 연결 | 본문·secret 로그 노출 | S | - |
| S43 | P0 | S42 | metrics.ts + metrics.test.ts | queue age/dead-letter 메트릭 | known rows metric test | pending/dead-letter 관측 | 상태 누락 | S | - |
| S44 | P0 | S24,S41 | deploy/receiver.service (호스트 선택 후 확정) | 서비스 자동 재기동 | kill/reboot smoke | 지정 user로 재시작 | 권한·설정 유실 | D | D,E |
| S45 | P0 | S44 | deploy/Caddyfile | Receiver HTTPS/Gateway private 경계 | external port probe | HTTPS만 public | Gateway public | D | D,E |
| S46 | P0 | S15 | receiver/src/backup.ts + backup.test.ts | SQLite 일관 backup 산출 | backup integrity_check | snapshot DB 검증 | WAL 누락 | S | - |
| S47 | P0 | S46,S14 | docs/verification/restore.md | 빈 환경 pending 복원 receipt | restore and drain drill | ACK pending 복원 | data loss | D | D |
| S48 | P0 | S44,S47 | docs/verification/rollback.md | 이전 binary/config rollback receipt | rollback same DB drill | schema·health 호환 | DB 비호환 | D | D |
| S49 | P0 | S24,S45,S36 | docs/verification/github-discord.md | 실 webhook→thread→backlink 왕복 receipt | live issue and followup | delivery/run/message URL 연결 | 수작업 보정 | D | E,D |
| S50 | P0 | S49,S31,S34,S32 | docs/verification/e2e-run-1.md | 실 승인→worker→test→PR 첫 receipt | end-to-end issue 1 | 모든 승인·SHA·PR 링크 연결 | 단계 누락 | D | E,P,H |
| S51 | P0 | S50 | docs/verification/e2e-run-2.md | 두 번째 독립 E2E receipt | end-to-end issue 2 | 수동 보정 없이 재성공 | 첫 task 상태 의존 | D | E,P,H |
| S52 | P0 | S51,S14,S28 | docs/verification/failure-qa.md | 실 장애 후 중복 없는 복구 | Gateway stop/restart live delivery | 원본 task/승인 유지 | 유실·중복·권한 우회 | D | E,D,H |
| B01 | P1 | S52 | repo-policy.ts + test | repo별 권한 분리 | two-repo unauthorized test | 교차 권한 거부 | 공유 credential 누출 | S | - |
| B02 | P1 | B01 | scheduler.ts + test | repo별 동시 실행 상한 | two-repo saturation test | 한 repo 포화가 다른 repo 막지 않음 | 기아 | S | - |
| B03 | P1 | S18 | github-client.ts + test | 429 Retry-After 준수 | rate-limit fake-clock test | 재시도 시각 준수 | burst retry | S | - |
| B04 | P1 | S43 | deploy/alerts.yaml | 오래된 pending 운영 알림 | threshold alert drill | 담당자 알림 도달 | 무음 장애 | D | E,D |
| B05 | P1 | S31 | status command adapter + test | task status 표시 | existing task query QA | 영속 상태와 일치 | stale 표시 | R | E |
| B06 | P1 | S27 | approval UI copy + QA receipt | 만료 승인 재요청 안내 | expired button human QA | 사용자가 다음 행동 이해 | 잘못된 재승인 | H | H,E |
| B07 | P1 | S51 | deploy/onboarding.md | 새 사용자 첫 작업 안내 | new-user first PR QA | 문서만으로 완료 | 운영자 구두 보정 | H | E,H,P |
| B08 | P1 | S47 | deploy/token-rotation.md | 토큰 교체 절차 | test token rotation drill | 노출 없이 서비스 복구 | 권한 공백 | D | E,D |
| B09 | P1 | B02,B03,B04 | docs/verification/soak.md | 24h 베타 관찰 receipt | 24h bounded workload | SLO·복구 시간 측정 | 부하 대표성 부족 | D | E,D |
| B10 | P1 | S38 | docs/verification/repo-protection.md | required checks/secret scanning 설정 receipt | GitHub settings readback | 지원 기능 강제 확인 | 플랜 제약 | D | G |
| B11 | P1 | B07,B08,B09,B10,S48 | release-manifest.json + release notes | 정확 SHA 릴리스 후보 | release-ready assessment | P0/P1 evidence 전부 연결 | missing gate | D | P,D,G |
| C01 | P2 | B11 | review-event adapter + test | review를 원래 task로 연결 | review followup fixture | 원래 thread/task 유지 | 잘못된 task | S | - |
| C02 | P2 | C01 | revision approval adapter + test | 리뷰 수정 새 승인 | changed-plan approval test | 이전 승인 재사용 거부 | 자동 push | S | - |
| C03 | P2 | B11 | cost projection + test | task 비용 집계 | known usage fixture | 중복 없는 합계 | provider 누락 | L | - |
| C04 | P2 | B11 | docs/adr/availability.md | 실측 기반 단일 호스트 대안 | RPO/RTO comparison | 확장 필요 여부 근거 | 가정 부하 | L | - |

## Waves and milestones

Wave 1: S01 + S02, independent files, one task each. S01 must not broaden config validation (S03A-C4). S02 must not wire server ACK (S09). Wave 2: S03A + S16; wave 3: S03B + S04A; then S03C1 + S04B. Later waves choose exactly one task under the one-worker policy. Server changes serialize. S23 external contract research can run beside Receiver tasks, but no guessed OpenClaw implementation before its receipt. Clone accepted owner working snapshot into each dependent task checkout without committing; record base SHA plus overlay hashes.

M1 reliable ingress: S01–S22 accepted (no external success claim). M2 runtime authority: S23–S36 accepted. M3 runnable operations: S37–S48 accepted. M4 controlled beta: S49–S52 including two actual E2Es and human approval checks. M5 public release: B01–B11. C tasks are post-release and do not block MVP.

Definition of done: ACK durability; no duplicate thread/backlink side effects; server-enforced approval per action and requester/plan; real GitHub→Discord→approval→ACP→independent tests→approved push/PR twice; same deployed SHA CI, restore, rollback and trace evidence; actual human QA. No open release-blocking P0/P1 gate. Goal remains active until this evidence exists; checklist or worker report is never completion. If account/host authority is missing, finish independent work and ask only for that exact action.

Scope corrections to earlier checklist: TypeScript passed after dependency installation, not a type bug. 76.52% coverage excluded server.ts and is not whole-product coverage. Gateway admission is not Discord delivery. Stable header alone does not prove downstream idempotency. Worktree cwd alone is not a security sandbox. main and origin/main differ only by ROADMAP. A corrected payload with same ID is a synthetic ordering regression, not evidence GitHub normally changes redeliveries. P2 cannot expand into auto-merge/deploy.
