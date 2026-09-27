# S32b retry — 타임아웃이 셸만 죽여서 runner hang (CI 실패 후속 수정)

Date: 2026-09-22. Scope: `receiver/src/verifier.ts`, `receiver/test/verifier.test.ts`만 수정. 그 외 파일 변경 없음.

## 수정 전/후 러너 동작

### Before (CI 결함)
- `Bun.spawn([...argv], { cwd, stdout: "pipe", stderr: "pipe" })` — 자식은 부모와 같은 프로세스 그룹.
- 타임아웃 시 `proc.kill("SIGKILL")` — **직접 자식(`sh`)만** kill.
- `new Response(proc.stdout).text()` — 파이프에 writer(고아가 된 손자 프로세스)가 남아 있으면 EOF가 안 오므로, `Promise.all`이 손자 종료 때까지(테스트 기준 ~30s) 매달림.
- Linux CI에서 `sleep 30` 테스트가 5001ms 예산 초과로 실패. macOS는 `sh`가 단순 명령을 exec 대체해 우연히 통과했으나, 복합 명령(`a & b`)이면 macOS도 동일하게 hang한다(아래 되돌림 실험이 macOS에서 재현).

### After
- `Bun.spawn(..., { detached: true })` — POSIX에서 `setsid()`로 자식이 자기 프로세스 그룹의 리더가 됨(bun-types 문서 확인, Bun 1.4.0 런타임에서 group kill 동작 확인).
- 타임아웃 시 `process.kill(-proc.pid, "SIGKILL")`로 **그룹 전체**를 kill. 실패(ESRCH/비POSIX)하면 `proc.kill("SIGKILL")` 폴백.
- 파이프 읽기를 `drain()` 헬퍼가 백그라운드로 수집. `proc.exited` 해결 후 drain 완료를 최대 `PIPE_DRAIN_GRACE_MS = 250ms`까지만 기다림(`Promise.race` vs `Bun.sleep`). 직접 자식이 죽은 뒤에도 파이프를 잡는 고아 손자가 있어도 runner는 유한 시간에 반환하며 부분 출력을 보존.
- 계약 불변: 타임아웃 시 코드 124(`TIMEOUT_EXIT_CODE`) → `observed.testsPassed=false` + reason에 `timed out`. 정상 종료 코드/출력 그대로. `CommandRunner` 시그니처·주입 인터페이스·redaction·tail·판정 규칙 미변경.

## 되돌림(revert) 실험
- `git show HEAD:receiver/src/verifier.ts`로 수정 전 runner를 임시 복원(테스트 파일은 수정본 유지)하고 신규 테스트만 실행: `bun test test/verifier.test.ts -t "process group"`.
- 결과: **실패 재현**. elapsed = **30,114ms** (`expect(elapsed).toBeLessThan(3000)` 위반), 테스트 총 30,185ms. 셸만 죽고 두 `sleep 30`이 파이프를 잡아 drain이 30초 hang함을 확인.
- 이후 수정본을 `cp`로 원복하고 전체 오라클 재실행 → 통과.

## 신규 회귀 테스트
- `timeout kills the whole process group, not just the shell`: `testCommand: "sh -c 'sleep 30 & sleep 30'"`, `timeoutMs: 300`.
- 단언: `verdict === "rejected"`, `observed.testsPassed === false`, reason에 `timed out`, `elapsed < 3000ms`.
- 수정 후 측정: 테스트 본체 **~400–412ms**(timeoutMs 300 + drain/kill 오버헤드 ~100ms).

## 오라클 원문

### `cd receiver && bun run typecheck`
```
$ tsc --noEmit
(exit 0)
```

### `cd receiver && bun test test/verifier.test.ts`
```
bun test v1.4.0 (34cbb9a40)

test/verifier.test.ts:
(pass) verifyWorkerClaim > honest worker: claim matches observed changes and tests really pass -> verified [106.91ms]
(pass) verifyWorkerClaim > lying worker: claims testsPassed but the real command fails -> rejected [96.23ms]
(pass) verifyWorkerClaim > ghost file: claim lists a file that was not changed -> rejected [97.93ms]
(pass) verifyWorkerClaim > unclaimed change: a real change outside the claim -> rejected [101.29ms]
(pass) verifyWorkerClaim > test claim without a testCommand is unverifiable -> rejected [96.61ms]
(pass) verifyWorkerClaim > empty claim -> rejected [90.88ms]
(pass) verifyWorkerClaim > missing worktree path -> rejected [10.40ms]
(pass) verifyWorkerClaim > non-git directory -> rejected [10.24ms]
(pass) verifyWorkerClaim > test command that exceeds timeoutMs -> rejected as timeout, not passed [405.93ms]
(pass) verifyWorkerClaim > timeout kills the whole process group, not just the shell [400.35ms]
(pass) verifyWorkerClaim > injected runner receives expected argv, cwd and timeoutMs [76.18ms]
(pass) verifyWorkerClaim > observed changes are still checked when claim declares no filesChanged [80.34ms]
(pass) verifyWorkerClaim > secrets never appear in reasons or observed output [72.09ms]
(pass) verifyWorkerClaim > test output tail is redacted and truncated [69.55ms]

 14 pass
 0 fail
 42 expect() calls
Ran 14 tests across 1 file. [1.72s]
```

### `cd receiver && bun test`
```
 344 pass
 0 fail
 1202 expect() calls
Ran 344 tests across 31 files. [51.81s]
```
(개별 pass 라인 전부 green — 위 요약이 최종 집계)

## 남은 리스크
- drain grace(250ms) 안에 flush되지 못한 출력은 잘린다 — 직접 자식 종료 후에도 손자가 계속 쓰는 비정상 케이스 한정. 정상 명령 출력은 자식 종료 전에 이미 수집됨.
- `kill(-pid)`가 자식의 `setsid` 완료 전 극초기 타임아웃에서 ESRCH하면 `proc.kill` 폴백이 직접 자식만 죽임 — 이후 fork되는 손자는 살아남을 수 있으나 drain grace로 runner는 어차피 유한 반환.
- Windows에서는 그룹 kill이 지원되지 않아 `proc.kill` 폴백(직접 자식만) — 손자 고아 가능. drain grace가 hang을 막지만 손자 프로세스 자체는 남는다. CI 타깃은 Linux.
- `detached` 자식은 부모 크래시 시 고아가 되어 계속 살 수 있음 — detached의 본래 의미이며 timeout kill이 정상 경로에서 정리함.
