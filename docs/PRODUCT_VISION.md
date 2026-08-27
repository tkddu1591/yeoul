# Yeoul 제품 목적과 범위

## 1. 제품 한 문장

여울은 브랜치와 여러 워크트리를 한곳에서 편하게 살펴보고, 변경 검토부터 커밋·통합까지 안전하게 이어가도록 돕는 macOS Git GUI다.

## 2. 해결하려는 문제

기존 Git 도구는 정상적인 commit/push 흐름에는 편리하지만, 충돌이나 중단 상태가 발생하면 명령어와 내부 상태를 사용자가 직접 해석해야 하는 경우가 많다. 특히 다음 상황에서 맥락이 쉽게 사라진다.

- merge, rebase, cherry-pick 도중 충돌이 났을 때 현재 작업과 다음 행동을 알기 어렵다.
- detached HEAD, 삭제된 브랜치, 잘못된 force push 이후 복구 경로가 드러나지 않는다.
- 여러 worktree와 중첩 submodule의 상태가 한 저장소 화면에 섞인다.
- 수만 개 변경 파일이나 거대한 commit graph에서 UI가 멈추거나 중요한 변경을 찾기 어렵다.
- 여러 호스팅 서비스와 계정의 인증 정보가 어떤 저장소에 적용되는지 불명확하다.

이 제품은 Git을 단순화한다는 이유로 상태를 감추지 않는다. 대신 현재 상태, 가능한 행동, 행동의 영향, 되돌리는 방법을 하나의 흐름으로 제공한다.

## 3. 목표 사용자

- IntelliJ 계열 IDE의 Git 도구에 익숙하지만 IDE와 독립된 클라이언트를 원하는 개발자
- CLI를 함께 사용하면서도 변경 검토, 충돌 해결, commit graph 탐색은 시각적으로 하고 싶은 개발자
- monorepo, 대형 저장소, 여러 worktree를 사용하는 개인·소규모 팀
- IDE·CLI·자동화 도구를 오가며 여러 워크트리의 변경을 한곳에서 관리하려는 개발자

## 4. 제품 원칙

### 상태 우선

화면의 최우선 정보는 Git이 지금 어떤 상태인지다. 정상, merge 중, rebase 중, cherry-pick 중, detached HEAD 같은 상태를 명확히 구분하고 동시에 가능한 작업만 제공한다.

### 안전한 기본값과 명시적 위험

force push, hard reset, 브랜치 삭제처럼 데이터 유실 가능성이 있는 작업은 기본 동작과 시각적으로 구분한다. 실행 전 대상 ref와 영향받는 commit을 보여 주며 가능한 경우 reflog 기반 복구 지점을 만든다.

### Git 의미 보존

GUI 용어는 실제 Git 개념과 연결되어야 한다. 편의를 위해 동작을 감추는 대신 실행될 명령과 결과를 확인할 수 있게 한다.

### 점진적 성능

변경 파일과 graph 전체를 먼저 읽어야만 화면이 열리는 구조를 피한다. 저장소 요약, 화면에 필요한 구간, 상세 정보 순서로 점진적으로 로드하고 긴 작업은 취소 가능해야 한다.

### 계층과 경계

프레젠테이션, Git 상태 해석, 작업 정책, 프로세스 실행, 호스팅 서비스 연동, 인증 저장을 분리한다. UI가 Git 프로세스를 직접 실행하거나 원시 CLI 출력을 직접 해석하지 않는다.

## 5. 현재 지원 범위

- 저장소 열기·복제·초기화와 Git 원격 추가·제거
- 파일·hunk·줄 단위 stage/unstage, 커밋, 스태시
- 브랜치·워크트리·터미널, 워크트리별 dirty/staged/untracked/ahead/behind 요약
- merge/rebase/cherry-pick/revert 충돌 해결과 중단
- 첫 푸시 대상 확인, GitHub 풀 리퀘스트 검토·병합
- 취소·5분 제한이 있는 Git 작업과 민감한 인자를 제외한 로컬 실행 로그
- Universal macOS 패키지, 로컬 진단 로그와 크래시 덤프

아래 항목은 제품 방향과 로드맵이다. 현재 지원으로 오해하지 않도록 구현 완료 전에는 배포 설명에 포함하지 않는다.

## 6. 로드맵 범위

### 변경 작업

- IntelliJ의 changelist와 유사한 보류 그룹
- 커밋 서명과 메시지 템플릿·기록 고도화
- 파일 복원과 untracked 파일 정리 전 미리보기

### 브랜치와 동기화

- force-with-lease 중심의 force push
- tag 생성, 조회, push, 삭제
- 삭제된 브랜치와 유실 commit의 reflog 기반 복구

### 이력과 탐색

- 파일 이력, blame, commit 상세 diff
- 브랜치 간 파일 단위 통합 diff와 워크트리 통합 큐
- 경로 범위·작성자·기간을 조합한 고급 검색

### 충돌과 중단 상태

- base/ours/theirs 및 결과를 구분하는 충돌 편집기
- rebase skip과 커밋별 진행 편집
- rename/delete, add/add, binary, submodule, permission 충돌 처리
- 앱 종료·재실행 뒤에도 진행 중인 작업 복원
- 외부 CLI에서 시작한 작업도 감지하여 이어서 처리

### 저장소 구조

- submodule과 중첩 submodule 탐색, 초기화, 동기화, 업데이트
- worktree 잠금·prune 고급 관리
- bare repository 작업 지원 확대
- Git LFS 객체 상태와 pull/push 진행 상태 표시
- sparse checkout 패턴 조회와 변경
- partial clone의 누락 객체 요청과 네트워크 진행 상태 표시

### 호스팅과 인증

- GitHub, GitLab, Bitbucket 연결
- 서비스별 여러 계정과 조직 계정 프로필
- SSH 키와 passphrase agent 흐름
- HTTPS token, 2FA 이후 발급 token, credential helper 연동
- 회사 SSO 승인 여부와 만료 상태 안내
- 저장소별 계정·인증 프로필 선택
- 비밀 정보는 운영체제 보안 저장소에 보관하고 로그에서 제거

## 7. 반드시 다룰 엣지 케이스

- detached HEAD에서 commit 후 새 브랜치로 보존
- merge 또는 cherry-pick 중단 상태에서 continue/abort
- rebase todo 편집과 여러 차례 연속 충돌
- 충돌 해결 도중 외부에서 index가 변경된 경우
- submodule 내부에 다시 submodule이 존재하는 경우
- 동일 저장소에 여러 worktree가 있고 브랜치가 이미 점유된 경우
- 변경 파일이 수만 개이며 rename detection 비용이 큰 경우
- 비 UTF-8 파일명과 `core.quotepath` 차이
- symbolic link, executable bit, case-only rename
- LF/CRLF 혼합 및 인코딩이 다른 텍스트 파일
- LFS pointer만 존재하거나 LFS 객체가 누락된 경우
- sparse checkout 밖의 경로를 작업 대상으로 선택한 경우
- partial clone에서 필요한 객체 다운로드가 실패한 경우
- protected branch로의 push와 non-fast-forward 거절
- force push 이후 remote reflog에 의존할 수 없는 복구
- SSH host alias와 계정별 키가 다른 경우
- credential 만료, SSO 미승인, 잘못된 계정으로 인증된 경우
- 네트워크 단절, Git 프로세스 취소, 앱 강제 종료 후 상태 복구

세부 시나리오와 기대 동작은 [Git 시나리오 카탈로그](GIT_SCENARIOS.md)에서 관리한다.

## 8. UX 요구사항

모든 작업 화면은 최소한 다음 질문에 답해야 한다.

1. 지금 저장소는 어떤 상태인가?
2. 왜 이 작업을 할 수 있거나 할 수 없는가?
3. 실행하면 어떤 ref, commit, 파일이 바뀌는가?
4. 실패하면 어디서 이어서 할 수 있는가?
5. 실행 후 되돌릴 수 있는가? 가능하다면 어떻게 하는가?

긴 작업은 진행률, 현재 단계, 취소 가능 여부를 표시한다. 작업 로그에는 실행한 Git 명령과 정제된 출력을 남기되 token, passphrase, credential URL 같은 비밀 정보는 절대 기록하지 않는다.

## 9. 기술 경계 초안

구현 스택과 무관하게 아래 책임은 분리한다.

- **UI 계층**: 상태 표시, 사용자 입력, 접근성, 대형 목록 가상화
- **Application 계층**: 사용자 작업 흐름과 실행 순서 조정
- **Domain 계층**: 저장소 상태 모델, 가능한 작업, 위험도와 복구 정책
- **Git adapter 계층**: Git 출력과 파일 상태를 도메인 모델로 변환
- **Git process 계층**: 명령 실행, 취소, 표준 입출력, 환경 변수 격리
- **Hosting adapter 계층**: GitHub·GitLab·Bitbucket API 차이 흡수
- **Credential 계층**: 운영체제 보안 저장소와 agent/credential helper 연동

Git process 계층은 원시 결과만 반환한다. 변환은 adapter에서, 작업 가능 여부와 복구 정책은 domain에서, 사용자 메시지와 시각 표현은 UI에서 담당한다.

## 10. 단계별 출시 기준

### 0단계: 기반

- 저장소 열기와 상태 감지
- 변경 파일, diff, stage/unstage, commit
- branch 생성·전환
- fetch/pull/push
- 실행 로그와 취소 가능한 Git 프로세스

### 1단계: 일상 작업

- 보류 그룹과 stash
- commit graph
- merge, rebase, cherry-pick
- 텍스트 충돌 해결과 continue/abort
- GitHub 계정 연결

### 2단계: 복잡한 저장소

- worktree와 중첩 submodule
- LFS, sparse checkout, partial clone
- 대형 저장소 성능 목표 충족
- 파일명, 권한, symlink, 줄바꿈 엣지 케이스

### 3단계: 복구와 다중 호스팅

- reflog 기반 복구 안내
- GitLab·Bitbucket 및 다중 계정
- SSH/HTTPS/SSO 인증 진단
- 고급 충돌 유형과 외부 변경 복원

## 11. 완료의 정의

기능이 존재한다는 것은 버튼이 있다는 뜻이 아니다. 각 기능은 다음 조건을 모두 만족해야 한다.

- 정상 흐름, 실패 흐름, 중단 후 재개 흐름의 자동화 테스트가 있다.
- 실행 전 영향과 실행 후 상태가 UI에서 검증된다.
- 취소·재시도·복구 정책이 정의되어 있다.
- 대형 저장소에서 정한 응답성 예산을 통과한다.
- 비밀 정보가 화면, 로그, 오류 보고에 노출되지 않는다.
- CLI나 다른 Git 클라이언트가 만든 동일 상태를 인식한다.

## 12. 현재 비목표

- Git 서버 자체를 구현하는 것
- Git의 객체 저장 방식이나 전송 프로토콜을 재구현하는 것
- 특정 호스팅 서비스의 이슈·프로젝트 관리 기능 전체를 복제하는 것
- 충돌 결과를 사용자 확인 없이 자동 선택하는 것

이 비목표는 제품 범위를 통제하기 위한 것이며, Git 작업에 필요한 호스팅 메타데이터와 pull/merge request 연동은 추후 별도 범위로 정의할 수 있다.
