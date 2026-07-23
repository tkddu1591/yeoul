# E7e — 원격/동기화 개선 설계

2026-07-23 브레인스토밍 확정본. E7d 방향 선정에서 미뤄뒀던 "원격/동기화 심화"를 본편으로. 협업 시 자주 부딪히는 "낡은 상태" 문제 3종 해소. 사용자 확정: fetch는 **자동+수동**, pull 방식은 **설정으로**, upstream은 **자동 연결+안내**.

## 항목과 설계

### ① 자동 + 수동 원격 새로고침 (fetch)

- 엔진 `remotes.fetch(): Promise<void>` 신설 — `git fetch --all --prune`(사라진 원격 브랜치 등록 정리 포함). 원격이 0개인 저장소는 no-op 성공(fetch --all이 그렇게 동작하는지 플랜 실측).
- **갱신 배선의 핵심**: fetch가 refs/remotes를 바꾸면 **기존 fs 감시(E7b)가 externalRefresh를 발동**한다 — 별도 갱신 경로를 만들지 않는다. E7d ⑤ 덕분에 보던 화면도 유지된다.
- **FETCH_HEAD 필터 제외**: fetch는 변화가 없어도 FETCH_HEAD를 매번 touch한다 — 현행 필터(`/^[A-Z_]+$/`)가 이를 수용해 10분마다 헛갱신이 나므로, isRelevantGitEvent에서 FETCH_HEAD만 명시 제외한다(refs/remotes/ 변화가 실질 신호). 다른 대문자 마커(MERGE_HEAD 등)는 그대로. 플랜 실측: fetch 1회의 이벤트 목록.
- **자동**: App effect 타이머 — 간격 10분 고정, 설정 [일반] 체크박스 "주기적으로 원격 새로고침 (10분)"(기본 켬, `AppSettings.autoFetch?: boolean`, 기본 true). 켜져 있으면 앱 시작 직후 1회 + 이후 주기 실행. busy와 무관하게 백그라운드 fetch(엔진 직접 호출 — guard 비경유: 읽기성 네트워크 작업이 UI busy를 잠그면 안 된다). 실패는 조용히 무시(다음 주기 재시도), 콘솔 로그만.
- **수동**: BranchesPanel(실험 공간 탭) 상단 검색 옆 새로고침 버튼 — guard 경유(busy 표시·에러 배너). 성공 notice 없음(감시발 갱신이 결과를 보여준다).
- **마지막 새로고침 시각**: store에 `lastFetchAt: number | null`(자동·수동 성공 공통 기록, 영속 안 함) — 실험 공간 탭 상단에 "방금 전 / N분 전 새로고침" 흐린 표시. 상대 시간 문자열은 순수 함수.

### ② 받아오기 방식 설정 (pull --rebase)

- `AppSettings.pullMode?: 'merge' | 'rebase'`(기본 'merge', sanitize 포함). 설정 [일반] 라디오: **합치며 받기(기본)** — "원격과 내 저장을 합쳐요. 지금까지의 방식" / **재배치로 받기** — "내 저장을 원격 최신 위로 다시 쌓아 역사가 일직선이 돼요".
- pullLatest 내부 분기만: 'merge' → 기존 `pull --no-rebase`, 'rebase' → `pull --rebase`. 버튼·어휘·스마트 자동 보관(막히면 보관함) 동작 동일.
- **재배치 받기 충돌 = 기존 rebasing 흐름 재사용**: `pull --rebase` 충돌은 git이 rebase-merge 디렉터리를 만들어 status.state='rebasing'이 되고, E7a의 상태 바(M/N번째·계속하기·취소)·충돌 카드가 그대로 동작한다 — 신규 UI 없음. 플랜 실측: pull --rebase 충돌 시 상태·진행 파일.
- 엔진 시그니처: `pull(mode)` 인자 확장(기존 호출은 store가 설정값 전달).

### ③ 백업 시 upstream 자동 연결 (push -u)

- 현행: 연결(upstream) 없는 브랜치의 backup 동작은 플랜 실측으로 확인(E3a는 PR 생성 흐름에서만 push -u 재연결).
- 변경: backup(push) 엔진이 upstream 부재를 감지하면 `push -u origin <브랜치>`로 올리고 결과에 `linked: true` 동봉 → notice: "원격에 이 실험 공간을 만들어 연결했어요 — 이제 ↑↓로 차이가 보여요." 이미 연결된 브랜치는 기존 그대로.
- E7a의 backupBranch(비현재 브랜치 checkout 없는 백업)에도 동일 적용.
- 원격이 하나도 없는 저장소: 기존 친절 에러 유지(플랜 실측으로 현행 문구 확인). 원격이 여럿이면 origin 우선, origin이 없으면 첫 원격(플랜 실측·설계 단순화 — 다중 원격 선택은 후속).

## 에러·엣지

| 상황 | 처리 |
| --- | --- |
| 자동 fetch 실패(오프라인·인증) | 조용히 무시, 다음 주기 재시도 — 에러 배너 없음(주기 작업이 배너를 도배하면 안 된다) |
| 수동 새로고침 실패 | guard 에러 배너(원어 wrap — 기존 pull 관례 문구 재사용 검토) |
| 자동 fetch 중 사용자 작업(guard busy) | 충돌 없음 — fetch는 git 내부 잠금으로 안전, 갱신은 감시 디바운스·억제 창이 조율 |
| 재배치 받기 충돌 | 기존 rebasing 바·카드 — 취소하면 pull 이전으로 |
| 재배치 받기 + 미저장 변경 | 기존 스마트 자동 보관과 동일(pull --rebase도 autostash 아닌 앱 보관 흐름 — 플랜 실측) |
| upstream 자동 연결 실패(권한 등) | push 실패 에러 그대로(연결 시도 사실은 문구에 병기하지 않음 — 단순) |
| 앱 시작 시 autoFetch 꺼짐 | 시작 fetch도 건너뜀 |

## 테스트

- **엔진 단위**: remotes.fetch(원격 신규 브랜치가 refs/remotes에 나타남·--prune으로 사라진 등록 정리·원격 0개 no-op), pull(mode 분기 — rebase 모드에서 일직선 역사 실측), backup(upstream 부재 → -u 연결·linked 플래그·이미 연결 시 미변). 실제 git 픽스처(로컬 bare 원격).
- **renderer 순수**: 상대 시간 문자열(방금 전·N분 전·N시간 전), sanitize(autoFetch·pullMode).
- **필터 단위**: FETCH_HEAD 제외·다른 대문자 마커 유지.
- **E2E**: 수동 새로고침 → 원격 신규 브랜치가 목록에 나타남, 재배치로 받기 → 병합 커밋 없는 일직선 역사, 연결 없는 브랜치 백업 → notice + ↑↓ 배지 등장, 설정 라디오·체크박스 영속.
- **플랜 사전 실측**: fetch 1회 이벤트 목록(FETCH_HEAD·refs/remotes 경로), fetch --all --prune의 원격 0개 동작, pull --rebase 충돌의 상태·진행 파일·자동 보관 상호작용, 연결 없는 브랜치 push 현행 stderr, 다중 원격 시 동작.

## 범위 밖 (후속)

- 다중 원격 선택 UI, 원격 인증(credential helper) UX, fetch 간격 커스텀(10분 고정), 원격별 새로고침, 자동 fetch 시각의 메뉴바/트레이 표시
