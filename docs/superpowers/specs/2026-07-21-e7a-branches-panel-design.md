# E7a — IntelliJ식 실험 공간(브랜치) 패널 설계

2026-07-21 브레인스토밍 확정본. 사용자 요청: "브랜치를 인텔리제이처럼 — 우클릭으로 업데이트·푸시·체크아웃 등 브랜치별 관리."

## 로드맵 맥락 (3에픽 분해 — 사용자 확정)

| 에픽 | 내용 | 순서 |
| --- | --- | --- |
| **E7a (이 스펙)** | 좌측 탭 실험 공간 패널 — 목록·상태 배지·우클릭 관리 (rebase 충돌 흐름 포함) | 1 |
| E7b | 내장 터미널 — 지금 보고 있는 컨텍스트(체크아웃된 브랜치 = 저장소 루트)에서 동작하는 세션형 터미널 (node-pty + xterm) | 2 |
| E7c | 워크트리 1급 관리 — 좌측 탭에 [워크트리] 추가, 선택하면 터미널이 그 폴더를 따라감 | 3 |

터미널은 E7b 시점엔 저장소 루트에서 동작하고, E7c에서 "선택된 워크트리 폴더"로 컨텍스트가 확장된다. E7a는 이 확장을 막지 않는 탭 구조만 마련한다.

## 결정 사항과 근거

### 배치: 좌측 탭 [변경 | 실험 공간] + 헤더 스위처 유지

시각 목업 3안(헤더 팝업 / 우측 탭 / 좌측 상시) → 좌측 2변형(아코디언 vs 탭) 비교 끝에 **좌측 탭** 확정. 근거:

- 가장 빈번한 커밋 흐름(변경 확인 → diff → 저장)은 "변경" 탭이 기본이라 한 픽셀도 변하지 않는다. 아코디언은 E6a에서 정리한 좌측 세로 공간을 상시 잠식한다.
- 브랜치 작업은 간헐적·목적형이라 탭 1클릭이 부담이 아니고, 탭 안에서는 전체 높이를 쓴다.
- 빠른 전환은 기존 헤더 스위처가 계속 담당(이원화: 빠른 전환 = 헤더, 관리 = 좌측 탭).
- E7c에서 [워크트리] 탭을 옆에 추가하면 "선택 → 터미널 컨텍스트" 그림이 그대로 성립한다.

탭 선택 상태는 renderer 로컬 상태로 둔다(store 오염 없음). 기본 탭은 "변경".

### 우클릭 메뉴 (전체 스코프 — 사용자 확정: 원격 관리·비교·rebase 전부 포함)

**로컬 브랜치:**

| 항목 | 동작 |
| --- | --- |
| 이 공간으로 이동 (checkout) | 기존 switch 재사용 (스마트 자동 보관 포함) |
| 여기서 새 실험 공간… | 기존 create(fromHash 없이 그 브랜치 tip 기준) 재사용 |
| 지금 것과 합치기 (merge) | 기존 merge 흐름 재사용 (선택 브랜치를 현재로) |
| 지금 것을 이 위로 재배치 (rebase) | 신규 — 아래 rebase 절 |
| 지금과 비교… | 신규 — 비교 다이얼로그 |
| 원격 최신으로 업데이트 | 신규 — 현재 브랜치면 기존 pull, 아니면 ff-only fetch |
| 백업 (push) | 신규 — checkout 없이 선택 브랜치 push |
| 이름 바꾸기… | 기존 rename 재사용 |
| 지우기… | 기존 remove(needsForce 2중 확인) 재사용 |

**현재 브랜치 행**: 이동·합치기·재배치·지우기는 숨기지 않고 **사유 병기 + 비활성**("지금 여기예요" 등 — HistoryPanel undo/reword·E6b 삭제 파일 관례). 업데이트는 기존 pull, 백업은 기존 push로 연결.

**원격 브랜치:** 내 공간으로 가져오기(추적 checkout) · 지금과 비교… · 원격에서 지우기…(2중 확인).

**진행 중 상태(merging·reverting·cherry-pick·rebasing)에서는** 파괴적 항목(이동·합치기·재배치·지우기·업데이트) 비활성+사유.

## 레이아웃·UI

- 좌측 열 상단에 탭바 추가: `[변경 N | 실험 공간]` — 변경 탭에 기존 변경 개수 배지.
- 새 컴포넌트 `BranchesPanel`(components/): 검색 입력(이름 부분 일치 필터) → "내 공간(로컬)" 그룹(기존 `branch-groups.ts` 폴더 그룹핑 재사용) → remote별 원격 그룹(`origin (원격)` 등).
- 행 구성: `⎇ 이름` · 현재면 "지금 여기" 칩 · 우측 끝 `↑N ↓M` 배지(upstream 없으면 "연결 없음" 흐림). 색에 의존하지 않는 글리프 우선(색약 대응 관례).
- 우클릭은 기존 `ui/ContextMenu` 재사용. 목록이 길면 기존 가상화 관례 재사용.
- 헤더 스위처(BranchSwitcher)·관리 다이얼로그(ManageBranchesDialog)는 그대로 유지 — 관리 다이얼로그는 장기적으로 패널이 대체할 수 있으나 이번 범위에서 제거하지 않는다(회귀 면 최소화).

## 엔진 (git-adapter — 접근안 A: for-each-ref 일괄)

### branches.overview()

```
git for-each-ref refs/heads refs/remotes \
  --format='%(refname:short)%1f%(upstream:short)%1f%(upstream:track)%1f%(committerdate:unix)%1f%(objectname)'
```

1회 호출로 수집해 파싱한다:

```ts
interface BranchOverview {
  locals: Array<{
    name: string
    isCurrent: boolean          // symbolic-ref HEAD와 대조
    upstream: string | null     // 'origin/main' 형태
    ahead: number | null        // upstream 없으면 null
    behind: number | null
    lastCommittedAt: number
  }>
  remotes: Array<{ remote: string; name: string /* 'origin/feature/pay' */ }>
}
```

- `%(upstream:track)`은 `[ahead 1, behind 2]`·`[gone]`·빈 문자열을 파싱한다. `[gone]`(원격이 지워진 upstream)은 ahead/behind null + gone 플래그로 노출해 "연결 끊김" 표시.
- `origin/HEAD` 심볼릭 항목은 제외. detached HEAD면 isCurrent 전부 false(패널 상단에 기존 관례대로 안내).
- ahead/behind는 fetch 기준값이다 — "업데이트"가 fetch를 겸하므로 수용하고, 배지 툴팁에 "업데이트하면 최신 기준으로 갱신돼요"를 병기한다.

### branches.update(name)

- 현재 브랜치: 기존 `sync.pull()` 재사용.
- 비현재: `git fetch <remote> <name>:<name>` (ff-only가 기본 동작). 실패(non-fast-forward)면: "이 공간은 원격과 갈라져 있어요. 이동한 뒤 받아오기(pull)로 합쳐 주세요." upstream 없으면: "원격과 연결된 적이 없는 공간이에요." remote는 upstream의 remote를 사용(없으면 origin 우선 관례).

### branches.backup(name)

- 현재 브랜치: 기존 `sync.push()` 재사용.
- 비현재: `git push <remote> <name>:<name>` — upstream 없으면 `push -u <remote> <name>`. E6b의 원격 앞섬 매핑(`(fetch first)`·`(non-fast-forward)` → 받아오기 안내)을 재사용한다.

### branches.compare(name)

`git rev-list --left-right <current>...<name>` 기반으로 두 방향 해시를 나눈 뒤 기존 log 파서 포맷으로 각각 조회해 `{ onlyInSelected: CommitSummary[], onlyInCurrent: CommitSummary[] }` 반환(각 100개 상한 + 초과 표시). UI는 다이얼로그 2목록("이 공간에만 있는 저장 / 지금 공간에만 있는 저장") — 기존 커밋 행 컴포넌트 재사용.

### rebase 네임스페이스 (신규 — 풀 충돌 흐름, 사용자 확정)

- `rebase.start(onto)` — 현재 브랜치를 `git rebase <onto>`. 시작 전 작업 중 변경은 **스마트 자동 보관**(merge 관례 재사용).
- 충돌 시 상태 `rebasing` — 감지는 `.git/rebase-merge` 또는 `.git/rebase-apply` 존재(기존 merging=MERGE_HEAD·reverting·cherry-pick 감지 옆에 추가, 상태 바 4겸용).
- 기존 충돌 카드 UI 재사용 — 커밋 단위 루프: 해결(모든 UU 해소) → **계속하기** = `rebase.continue()`(`git rebase --continue`, 해소 결과가 빈 커밋이면 git 안내를 친절 매핑해 "이 저장은 재배치하면 내용이 없어요 — 건너뛸까요?" → `--skip` 확인창) → 다음 충돌 또는 완료.
- **그만두기** = `rebase.abort()`(`git rebase --abort`) — 시작 전 상태로 복원.
- 진행 표시: 상태 바에 "재배치 중 — M/N번째 저장"(`.git/rebase-merge/msgnum`·`end` 실측 후 확정, 플랜 단계에서 사전 실측 항목).
- rebase 중 재시작 복원: 기존 관례대로 부수 상태 없이 저장소 상태(rebase-merge 디렉터리)만으로 복원.

### 원격 브랜치 조작

- `branches.checkoutRemote(name)` — `git switch -c <local> --track <remote>/<local>`. 동명 로컬이 이미 있으면: "이미 같은 이름의 공간이 있어요 — 그 공간으로 이동해 업데이트해 주세요."
- `branches.removeRemote(name)` — `git push <remote> --delete <branch>`. UI 2중 확인(기존 지우기 관례 + "원격에서 지워져요. 다른 사람에게도 영향이 있어요" 경고 문구).

인자 정리: 브랜치 이름은 기존 create/rename의 `check-ref-format` 선검증 관례를 재사용하고, git 호출은 `--end-of-options` 관례를 따른다.

## 데이터 흐름 (store)

- `branchOverview: BranchOverview | null` 상태 + `loadBranchOverview()` — guard 경유가 아닌 조회 전용(기존 snapshot 조회 관례에 맞춤: busy와 독립적으로 읽되 에러는 배너로).
- 실험 공간 탭 진입 시 + 각 브랜치 작업(guard 액션) 완료 시 overview 갱신. 이동·합치기·이름 바꾸기·지우기는 기존 store 액션을 그대로 재사용하고 완료 후 overview도 함께 갱신.
- 신규 액션(update·backupBranch·compare·rebase 3종·checkoutRemote·removeRemote)은 전부 guard 경유 — 에러 배너·notice(10초 자동 소멸)·busy 규약을 그대로 얻는다.
- IPC: 기존 ipc-contract 네임스페이스 관례대로 `branches:*`·`rebase:*` 채널 추가, renderer 노출은 preload 통과(토큰류 없음 — 보안 영향 없음).

## 에러·엣지 정리

| 상황 | 처리 |
| --- | --- |
| 이동·rebase 시작 시 작업 중 변경 | 스마트 자동 보관 재사용 (보관 notice 병기) |
| 진행 중 상태에서 파괴적 메뉴 | 비활성 + 사유 병기 |
| ff 불가 업데이트 | "갈라져 있어요 — 이동해서 받아오기" 친절 거부 |
| 원격 앞섬 push | E6b 매핑 재사용 |
| upstream 없는 업데이트 | 친절 거부 / 백업은 -u 연결 |
| upstream gone | "연결 끊김" 표시, 업데이트는 친절 거부 |
| rebase 빈 커밋 | --skip 확인창 |
| 동명 로컬 있는 원격 가져오기 | 친절 거부 + 안내 |
| detached HEAD | 현재 표시 없음 + 패널 상단 안내 |

## 테스트

- **엔진 단위**: overview 파싱(upstream 유/무/gone·ahead/behind·origin/HEAD 제외·detached), update(현재=pull 위임·비현재 ff 성공·non-ff 거부·upstream 없음), backup(비현재 push·-u·원격 앞섬 매핑), compare(양방향·상한), rebase(clean 완료·충돌 감지·continue·빈 커밋 skip·abort 복원), checkoutRemote(성공·동명 거부), removeRemote. 실제 git 저장소 픽스처(기존 관례).
- **E2E**: 탭 전환·목록/배지 표시, 우클릭 이동(자동 보관 포함), 비현재 업데이트, rebase 충돌 → 카드 해결 → 계속하기 → 완료, 원격 가져오기, 비교 다이얼로그. 현재 브랜치 행 비활성+사유 단언.
- 플랜 단계 사전 실측 항목: for-each-ref track 포맷 변형, rebase-merge msgnum/end, fetch refspec ff-only 거부 stderr, 빈 커밋 continue stderr.

## 범위 밖 (후속)

- 워크트리 탭·터미널 연동 (E7b·E7c)
- 관리 다이얼로그 제거/통합 (패널 안착 후 검토)
- 브랜치 그래프 시각화·브랜치별 보호 규칙
- compare 다이얼로그에서 커밋 클릭 → 상세 연동 (v1은 목록만)
