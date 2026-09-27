# B01 receipt — repo별 권한 분리

Base: worktree HEAD (uncommitted candidate; owner records launch SHA).
Scope: one changeset. Per-repo GitHub credentials, single authorization point,
no cross-repo credential use.

## 변경 파일

| 파일 | 상태 | 요약 |
|---|---|---|
| `receiver/src/repo-policy.ts` | 신규 | `RepoGrant` / `RepoAuthorization` / `authorizeRepo` / `assertGrantForRepo`. 순수 모듈 |
| `receiver/src/config.ts` | 수정 | `RepoConfig.githubToken?: string` 추가 + repo 루프 안 검증(비어 있음·`<...>` 거부) |
| `receiver/src/mapping.ts` | 수정 | `fetchItem` opts에 `token?: string` — 주어지면 `cfg.githubToken` 대신 Authorization에 사용 |
| `receiver/src/server.ts` | 수정 | `resolveThreadId`가 `authorizeRepo` → `assertGrantForRepo` → `fetchItem(..., { token: grant.githubToken })` |
| `receiver/src/redact.ts` | 수정 | `redactSecrets`에 `repos[*].githubToken` 포함 (S39 마스킹) |
| `receiver/test/repo-policy.test.ts` | 신규 | 두 repo 자기 토큰, 교차 거부, 공유 폴백, 미설정 거부, 포럼 채널 바인딩 |
| `receiver/test/config.test.ts` | 수정 | `repos[*].githubToken` 정상/빈 문자열/공백/비문자열/placeholder 거부 + 회귀 |
| `receiver/test/server.repo-policy.integration.test.ts` | 신규 | 프로세스 레벨: A/B/C 스텁 관찰 Authorization, 미설정 repo → admin, 교차 사용 0 |

금지 목록 파일(outbox, delivery, router, normalize, gateway, ingress, telemetry,
metrics, replay, backup, health, package.json) 미수정.

## 권한 결정 표

| `repos[repo]` 존재 | `repos[repo].githubToken` | 결과 |
|---|---|---|
| 없음 | — | `{ allowed: false, reason: "unconfigured-repo" }` — 조회 시도 없음, 라우터 admin 폴백 |
| 있음 | 설정됨 | grant `{ tokenSource: "repo" }`, 해당 토큰으로만 GitHub 조회 |
| 있음 | 없음 | grant `{ tokenSource: "shared" }`, 전역 `cfg.githubToken` 사용 |
| grant.repo ≠ 요청 repo | — | `assertGrantForRepo` throw — 교차 사용 불가(실패 시 닫힘) |

`resolveThreadId`는 grant의 토큰만 `fetchItem`에 넘긴다. 다른 repo의 권한을
빌려 쓰는 경로는 존재하지 않는다(라우터는 이벤트의 repo로만 resolve를 호출하고,
policy 계층이 grant↔repo 바인딩을 재확인).

## 핵심 diff 요약

- `config.ts`: `RepoConfig`에 선택 키 추가. repo 루프에서 `githubToken`이 정의돼
  있으면 문자열·trim 후 비어 있지 않음·단일 `<...>` placeholder 아님을 강제.
  기존 repo 검증·전역 검증 미변경.
- `repo-policy.ts`: `authorizeRepo(cfg, repo)`가 유일한 자격 결정 지점.
  `assertGrantForRepo(grant, repo)`가 repo 불일치 시 throw.
- `mapping.ts`: `opts.token ?? cfg.githubToken` — 미지정 시 기존 동작과 동일.
- `server.ts`: unconfigured repo는 `authorizeRepo` 단계에서 차단되어 GitHub 호출
  자체가 없다. throw 경로는 `describeError(error, secrets)`로 마스킹 유지.
- `redact.ts`: `redactSecrets`가 모든 repo별 토큰을 수집 — 로그·텔레메트리·
  `last_error`에 repo 토큰 원문이 남지 않는다.

## 오라클 실행 결과

### `cd receiver && bun run typecheck`

```
$ tsc --noEmit
(exit 0, 출력 없음)
```

### `cd receiver && bun test test/repo-policy.test.ts test/config.test.ts test/mapping.test.ts`

```
 142 pass
 0 fail
 205 expect() calls
Ran 142 tests across 3 files. [96.00ms]
```

### `cd receiver && bun test`

```
 298 pass
 0 fail
 1057 expect() calls
Ran 298 tests across 28 files. [51.72s]
```

신규 B01 통합 테스트(5개) 포함 전 파일 그린. 회귀 없음: S21 라우팅 표,
S21b persist-then-resolve, S39 마스킹, S41 health/readiness, S42 텔레메트리,
S43 메트릭, S46 backup, S09A/S09B/S09Bb 전부 통과.

## 환경 메모

- `receiver/node_modules` 부재 → `bun install --frozen-lockfile` 1회 실행(허용 범위).
- 통합 테스트는 로컬 `Bun.serve` 스텁만 사용, 실제 네트워크 없음.

## 남은 리스크

- `assertGrantForRepo`는 현재 호출 경로에서 항상 통과한다(authorize가 같은 repo로
  grant를 만들므로). 미래의 다른 호출 경로가 grant를 잘못 연결했을 때 닫히는
  방어선이지, 현재 경로의 기능 분기는 아니다.
- `fetchItem`의 `opts.token`을 직접 호출하는 다른 경로가 생기면 policy를 우회할
  수 있다 — 현재 호출자는 `server.ts resolveThreadId`뿐. 새 호출자 추가 시
  `authorizeRepo` 경유가 계약이다.
- 배포 시 repo별 토큰을 설정하지 않으면 동작은 기존과 동일(전역 shared 토큰).
  분리 효과는 `repos[*].githubToken`을 실제로 채운 repo부터 적용된다.
- 미커밋 후보 상태. 커밋·푸시·머지는 owner launch 계약에 위임.
