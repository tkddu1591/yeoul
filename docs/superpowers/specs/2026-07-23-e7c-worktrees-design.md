# E7c — 워크트리 1급 관리 설계

2026-07-23 브레인스토밍 확정본. 사용자 원 요청(E7a 브레인스토밍): "워크트리를 쓰고 해당 터미널을 따라서 치기가 너무 불편했다 — 워크트리 선택 → 해당 워크트리에서 터미널 명령. 기존 깃 프로그램들은 이런 워크트리 관리를 제대로 안 해주더라." 3에픽 분해(E7a 브랜치 → E7b 터미널 → E7c 워크트리)의 마지막 조각.

## 결정 사항과 근거 (사용자 확정)

1. **선택의 의미 = 하이브리드 + 설정 제어.** 워크트리 행 클릭 = **활성(터미널 대상) 지정**이고, 그때 무엇이 일어나는지는 매번 묻지 않고 **설정**("워크트리 선택 시 동작")이 결정한다: `터미널만 따라가기`(기본) / `앱 전체 전환`. 우클릭 메뉴에는 설정과 무관하게 두 동작이 항상 노출된다(설정은 클릭의 기본 동작만 결정).
2. **설정 표면 = 헤더 ⚙ → 모달 다이얼로그** (VSCode·IntelliJ식 — 팝오버·전체 페이지 안 기각: 페이지는 라우팅 신설이 필요, 팝오버는 확장성 부족). 좌측 카테고리 사이드바("일반" — 후속: 테마·스타일, 프로필) + 우측 내용. **즉시 저장**(확인 버튼 없음 — 기존 rightWidth·테마 관례), ESC·✕ 닫기. 이 앱 최초의 범용 설정 UI.
3. **목록+생성+제거 모두 지원** — "기존 깃 프로그램들이 제대로 안 해주는 부분"이 요청의 핵심.

## UI — 좌측 3번째 탭 [워크트리] (E7a 예약석)

- 탭바: `[변경 | 실험 공간 | 워크트리]`. 워크트리 탭 내용:
  - 행: `🏠 (기본)`(저장소 본체) / `🌳 <폴더 이름>`(링크드), 우측에 **브랜치 배지**, 아래에 **경로**(흐리게). detached면 브랜치 배지 대신 `분리됨`, prunable(폴더가 사라진 등록)이면 `없어진 폴더` 배지+흐림.
  - 칩 2종: **"지금 여기"** = 앱이 열고 있는 워크트리, **"터미널 대상"** = 활성 워크트리(다음 터미널 세션이 열릴 곳).
  - `＋ 새 워크트리…` 행: 다이얼로그 — **체크아웃되지 않은 기존 로컬 브랜치 선택**(git 제약: 같은 브랜치를 두 워크트리가 체크아웃 불가 — 이미 체크아웃된 브랜치는 사유와 함께 비활성) + 경로 입력(기본 제안 `../<저장소 이름>-<브랜치 슬러그>`, 수정 가능). 새 브랜치 동시 생성은 후속(실험 공간 탭에서 만들고 오면 된다).
  - **클릭** = 활성 지정 + 설정된 동작 실행. **우클릭** 메뉴: `여기서 터미널 열기` · `앱에서 열기 (전체 전환)` · 구분선 · `Finder에서 보기` · `지우기… (worktree remove)`. 기본 워크트리(🏠) 행은 지우기 비활성+사유("본체는 지울 수 없어요"), 앱이 열고 있는 워크트리도 지우기 비활성+사유.
- 활성(터미널 대상) 상태는 **renderer 로컬**(App state) — 재시작 시 "앱이 연 곳"으로 초기화(영속 안 함, YAGNI).
- 터미널 연동: 활성 워크트리가 지정된 상태에서 새 터미널 세션은 그 폴더에서 열리고, **탭 라벨에 워크트리 폴더 이름을 병기**한다(`2: my-repo-feature-login`). 기존 세션은 건드리지 않는다(cwd는 세션 생성 시점 고정).

## 설정 다이얼로그 (SettingsDialog)

- 헤더에 ⚙ 버튼 신설 → 모달. 구조: 좌측 카테고리 목록(v1: "일반" 하나, 후속 카테고리는 흐림 예고 없이 **아예 렌더하지 않는다** — 죽은 UI 금지), 우측 내용.
- v1 항목: **워크트리 선택 시 동작** — 라디오 2지(`터미널만 따라가기`(기본) / `앱 전체 전환`) + 설명 문구("우클릭에서는 언제든 둘 다 고를 수 있어요").
- 영속: `AppSettings.worktreeSelectAction?: 'terminal' | 'switch-app'`(sanitize 포함, 기본 'terminal'). 라디오 변경 즉시 저장.

## 엔진 (git-adapter) — `worktrees` 네임스페이스

- `worktrees.list(): Promise<WorktreeInfo[]>` — `git worktree list --porcelain -z` 파싱(플랜 사전 실측: 필드 형식·detached·prunable·locked·bare 변형). 반환:

```ts
interface WorktreeInfo {
  path: string          // 절대 경로
  isMain: boolean       // 첫 항목(본체)
  branch: string | null // 체크아웃 브랜치(refs/heads/ 제거). detached면 null
  headHash: string | null
  prunable: boolean     // 폴더가 사라진 등록
  locked: boolean
}
```

- `worktrees.add(path, branch)` — `git worktree add <path> <branch>`. 선검증: 이미 체크아웃된 브랜치·존재하는 비어있지 않은 경로는 친절 거부(원어 stderr 매핑은 플랜 실측). 경로는 `--end-of-options` 관례.
- `worktrees.remove(path, force)` — `git worktree remove [--force]`. 미저장 변경으로 거부되면 `needsForce` 패턴(branches.remove 관례 — 1차 확인 후 강제 확인 2단). prunable 항목은 `git worktree prune` 경로로 정리.
- 이름 슬러그(경로 제안)는 renderer 순수 함수(`suggestWorktreePath`).

## 배선

- **IPC**: `worktrees:list/add/remove` invoke(allowlist repoPath 경유). **`repo:open-path`** 신설 — "앱에서 열기"용: 인자 경로가 **현재 allowlist 저장소의 워크트리 목록에 있는지 main이 검증**한 뒤 registerRepoPath로 등록·정규화해 반환(임의 경로 열기 방지 — select 다이얼로그 없는 경로 열기의 보안 가드). `shell.showItemInFolder`는 main 핸들러(`worktrees:reveal`) — 경로 동일 검증.
- **터미널 cwd 확장**: `terminal:create(repoPath, cwd?)` — cwd가 오면 main이 **그 저장소의 워크트리 경로인지 검증**(worktrees.list 대조) 후 spawn. E7b가 남겨둔 확장점(manager.create(cwd)는 이미 매개변수) 사용. 검증 실패는 친절 거부.
- **store**: `worktrees: WorktreeInfo[]`를 fetchSnapshot에 포함(가벼운 1회 git 호출 — overview 관례). 액션: `addWorktree(path, branch)`·`removeWorktree(path, force)`(needsForce 반환)·`openWorktree(path)`(전체 전환 — repo:open-path 후 openRepository 후속 로직 재사용: historyLimit 리셋·CLEAR_SELECTIONS·스냅샷·감시 교체). 활성 워크트리는 store가 아닌 App 로컬 상태(터미널 대상 표시·세션 생성 인자에만 쓰임).
- **fs watch**: 전체 전환 시 기존 repo.watch 재호출로 감시가 새 워크트리로 교체(기존 메커니즘 그대로). 링크드 워크트리의 `.git`은 파일(gitdir 포인터)이고 실제 git dir은 본체의 `.git/worktrees/<name>` — 감시 대상 경로가 달라지는 점은 **플랜 사전 실측**(rev-parse --absolute-git-dir 기준으로 감시해야 할 수 있음).

## 에러·엣지

| 상황 | 처리 |
| --- | --- |
| 이미 체크아웃된 브랜치로 add | 선검증 친절 거부(생성 다이얼로그에서는 비활성+사유) |
| 미저장 변경 있는 remove | needsForce 2단 확인("미저장 변경이 함께 사라져요") |
| 본체(🏠)·앱이 연 워크트리 remove | 메뉴 비활성+사유 |
| prunable 항목 | 배지 표시, 지우기 선택 시 prune으로 정리 |
| 터미널 대상 워크트리가 지워짐 | 활성은 앱이 연 곳으로 복귀(스냅샷 갱신 시 목록 대조) |
| 전체 전환 대상 경로가 목록에 없음 | main 검증 거부(보안 가드) |
| 감시 중 워크트리 전환 | repo.watch 교체 — 이전 감시 정리(기존 메커니즘) |

## 테스트

- **엔진 단위**: worktree porcelain 파싱(본체·링크드·detached·prunable·locked), add(성공·체크아웃 중 브랜치 거부·경로 충돌 거부), remove(클린·dirty needsForce·force), prune 경로. 실제 git 픽스처.
- **renderer 순수**: suggestWorktreePath 슬러그(공백·슬래시 브랜치), 설정 sanitize(worktreeSelectAction).
- **E2E**: 탭 목록·생성(브랜치 선택→경로 자동)·클릭 활성 지정 후 새 터미널의 `pwd`가 워크트리 경로(터미널 연동 핵심 검증)·설정 다이얼로그에서 "앱 전체 전환"으로 바꾼 뒤 클릭 → 헤더·역사가 그 워크트리 기준으로 전환·지우기 needsForce 2단.
- 플랜 사전 실측: worktree list --porcelain 출력 변형, add/remove stderr 문구, 링크드 워크트리의 absolute-git-dir·감시 동작, 같은 브랜치 add 거부 문구.

## 범위 밖 (후속)

- 새 브랜치 동시 생성 워크트리 add, 워크트리별 dirty 표시, 활성 워크트리 영속
- 설정 카테고리 확장(테마·스타일, 프로필), 설정 검색
- 워크트리 간 diff·비교
