# GitHub → Discord 테스트 연결 준비 상태

- 확인일: 2026-09-14 KST
- 범위: 읽기 전용 환경·권한 확인. 실제 webhook 전송 없음.
- 대상 작업트리: `/Users/justn/dev/.worktrees/stackot-receiver-delivery-20260914`

## 확인한 사실

1. GitHub 인증은 유효하고 `stackot` 저장소에 접근 가능하다. 그 저장소의 등록 webhook 수는 **0**이다.
2. 본인 계정에 관리자 권한이 있는 `testrepo`(비공개)와 `test`(공개) 저장소가 보이지만,
   둘 다 webhook이 **0**이고 Stackot용 폐기 가능한 테스트 저장소로 지정됐다는 근거가 없다.
   이 저장소들에는 이벤트를 만들지 않았다.
3. 이 호스트에서 `openclaw` 실행 파일, `~/.openclaw`의 Gateway 설정·환경 파일,
   `receiver/config.json`, 관련 환경 변수를 찾지 못했다. 9377·18789 포트에 수신 프로세스도 없다.
4. Discord 테스트 서버, Stackot 봇 설치, 포럼 채널 ID와 메시지 read-back 권한은 확인되지 않았다.

## 이번 실행 판정

공개 ROADMAP의 Phase 1은 폐기 가능한 테스트 저장소와 별도 Discord 서버를 요구한다.
세 연결 요소가 확인되지 않아 benign webhook은 전송하지 않았다. 따라서 delivery ID,
Gateway run ID, Discord 메시지 URL은 **없다**. Receiver의 로컬 복구 테스트 25개 결과는
실제 GitHub → Discord 전달 증거로 계산하지 않는다.

실행에 필요한 선행 조건은 (1) 사용자가 폐기 가능한 대상으로 지정한 GitHub 저장소와
그 저장소의 Stackot webhook, (2) 별도 Discord 테스트 서버·봇·대상 스레드 및 read-back
권한, (3) 해당 저장소를 라우팅하는 Receiver와 OpenClaw Gateway의 실제 구동·설정·로그
접근이다. 비밀 값은 이 보고서에 기록하지 않는다.
