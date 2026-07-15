# Git 시나리오 카탈로그

이 문서는 기능 목록이 아니라 검증 가능한 사용자 시나리오를 관리한다. 각 시나리오는 fixture 저장소, 시작 상태, 사용자 행동, 기대 결과, 복구 방법을 포함하는 테스트 명세로 발전시킨다.

## 상태 모델

최상위 저장소 상태는 최소한 다음을 구분한다.

| 상태 | 사용자가 즉시 알아야 할 정보 | 주요 행동 |
| --- | --- | --- |
| Normal | 현재 branch, upstream, ahead/behind, 변경 수 | stage, commit, fetch, pull, push |
| Detached HEAD | 현재 commit, 도달 가능한 ref, 유실 위험 | branch 생성, switch, commit 보존 |
| Merge in progress | 병합 대상, 충돌 파일, 해결된 파일 | continue, abort |
| Rebase in progress | 원본/대상, 현재 todo 단계, 남은 commit | continue, skip, abort, todo 보기 |
| Cherry-pick in progress | 적용 중인 commit, 충돌 파일 | continue, skip, abort |
| Revert in progress | 되돌리는 commit, 충돌 파일 | continue, skip, abort |
| Bisect in progress | good/bad 범위와 현재 commit | good, bad, reset |

두 상태를 임의로 합쳐 표시하지 않는다. Git 메타데이터가 모순되거나 알 수 없는 상태라면 작업 버튼을 추측해 제공하지 않고 진단 정보를 보여 준다.

## 우선 검증 시나리오

### S-001 detached HEAD commit 보존

- 시작: remote branch의 특정 commit을 checkout한 detached HEAD
- 행동: 파일 수정 후 commit
- 기대: 유실 위험을 표시하고 새 branch 생성으로 commit을 보존
- 복구: switch로 떠나기 전과 후 모두 reflog에서 commit을 찾을 수 있음

### S-002 merge 충돌 해결과 중단

- 시작: 동일한 줄을 수정한 두 branch
- 행동: merge, 일부 파일 해결, 앱 재시작, continue 또는 abort
- 기대: 재시작 뒤 해결 상태가 보존되며 abort 시 merge 전 상태로 복원

### S-003 여러 단계 rebase 충돌

- 시작: 세 commit 중 둘이 대상 branch와 충돌
- 행동: 첫 충돌 해결, continue, 두 번째 충돌 해결, continue
- 기대: 현재 단계와 남은 todo를 매번 갱신하고 완료 후 commit graph를 재조회

### S-004 cherry-pick 충돌과 skip

- 시작: 연속된 여러 commit cherry-pick 도중 한 commit 충돌
- 행동: 충돌 commit skip
- 기대: 다음 commit으로 진행하고 최종 결과에서 누락된 commit을 명시

### S-005 중첩 submodule

- 시작: submodule이 자신의 submodule을 포함하며 각각 다른 remote 사용
- 행동: recursive 초기화와 업데이트
- 기대: 각 경로와 commit 고정 상태를 트리로 표시하고 실패 위치를 정확히 식별

### S-006 다중 worktree branch 점유

- 시작: 한 branch가 다른 worktree에서 checkout됨
- 행동: 현재 worktree에서 같은 branch로 switch 시도
- 기대: 점유 worktree 경로를 표시하고 그 worktree 열기 등 안전한 대안을 제공

### S-007 수만 개 변경 파일

- 시작: tracked/untracked 변경 합계가 수만 개인 저장소
- 행동: 상태 열기, 필터, 일부 stage, diff 보기
- 기대: 전체 목록 완료를 기다리지 않고 상호작용 가능하며 상태 조회를 취소·재시도할 수 있음

### S-008 파일 메타데이터 경계

- 시작: 비 UTF-8 이름, symlink, executable bit 변경, case-only rename, LF/CRLF 파일
- 행동: diff 확인 후 commit
- 기대: 이름과 변경 종류를 손실 없이 표시하고 의도하지 않은 내용 변경을 만들지 않음

### S-009 LFS·sparse·partial clone 조합

- 시작: blobless partial clone, cone mode sparse checkout, LFS 파일 포함
- 행동: sparse 범위 밖 이력 조회 후 LFS 파일 checkout
- 기대: 필요한 네트워크 요청과 예상 크기를 표시하고 실패 시 pointer/객체 상태를 구분

### S-010 force push 복구

- 시작: remote branch를 force-with-lease로 갱신할 수 있는 상태
- 행동: 영향 commit 확인 후 push, 이후 이전 tip 복구
- 기대: lease 불일치를 안전하게 거절하고 이전 tip을 로컬 복구 기록에서 branch로 생성 가능

### S-011 다중 계정 인증

- 시작: GitHub 개인·회사 계정, GitLab 계정, 서로 다른 SSH key와 HTTPS token
- 행동: 저장소마다 fetch/push
- 기대: 선택된 프로필을 명시하고 잘못된 계정 또는 SSO 미승인을 구체적으로 진단

### S-012 작업 중 프로세스 종료

- 시작: fetch, LFS pull 또는 rebase 처리 중
- 행동: 취소 또는 앱 강제 종료 후 재실행
- 기대: 실행 중이던 프로세스와 Git 메타데이터를 다시 검사하고 안전한 재개/정리 선택지를 제공

## fixture 원칙

- fixture는 가능한 한 로컬 bare remote를 사용해 반복 가능하게 만든다.
- 인증 시나리오는 실제 비밀 정보 대신 격리된 fake credential helper와 테스트 서버를 사용한다.
- 운영체제 파일 시스템 차이가 중요한 시나리오는 지원 OS별로 실행한다.
- 성능 fixture는 파일 수, commit 수, ref 수, diff 크기를 독립적으로 조절한다.
- Git 버전별 행동 차이는 지원 범위의 최저·최신 버전에서 검증한다.

