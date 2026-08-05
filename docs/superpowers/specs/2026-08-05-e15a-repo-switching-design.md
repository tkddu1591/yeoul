# E15a — 저장소 전환 설계

**한 줄:** 한번 연 폴더에서 다른 폴더로 갈 방법이 없다. 헤더에 전환기를 달고 최근 목록을 기억한다.

사용자 제보: *"왜 폴더 한번 선택하면 다른 폴더로 못바꿔? 인텔리처럼 여러개 선택해서 여러개 창 띄우거나 탭으로 관리하거나 하는건 안되는거야? 아니면 뒤로가기로 돌아가거나?"*

---

## 1. 실태 (실측)

- `App.tsx:521` — `repoPath`가 있으면 `RepoPicker`를 **아예 렌더하지 않는다.**
- `repoPath`를 다시 `null`로 만드는 경로가 스토어에 **하나도 없다**(`repoPath: null`은 초기값 선언 한 줄뿐).
- 헤더·메뉴 어디에도 "열기"가 없다.
- 최근 저장소를 기억하지 않는다 — 껐다 켜면 매번 처음부터 고른다.
- 창은 하나뿐이고 `activate`에서 0개일 때만 새로 만든다.

**즉 앱을 껐다 켜는 것 말고는 돌아갈 방법이 없다.** 워크트리 탭(E7c)은 *한 저장소 안*의 이동이라 다른 얘기다.

### 1-1. 그런데 전환 기계는 이미 다 있다

`openRepository()`(`repository-store.ts:465`)가 폴더 선택 → `historyRef`/`historyLimit`/`hostingStatus`/`pulls`/`CLEAR_SELECTIONS` 리셋 → 새 스냅샷 → 감시 교체를 이미 수행한다. E14a의 `invalidateReads()`가 진행 중 조회의 저장소 간 유출도 막는다.

**빠진 것은 그것을 부를 방법 하나뿐이다.**

---

## 2. 범위

이 에픽은 **한 창 안에서 저장소를 바꾸는 것**이다. 사용자가 요청한 "여러 창 + 전환기 + 탭" 중 전환기.

**여러 창·탭은 E15b로 미룬다.** 순서를 바꿀 수 없는 이유가 있다 — 지금 코드로 창을 두 개 띄우면
`git-handlers.ts:153`의 `stopWatching`이 모듈 전역 변수 하나라 **두 번째 창이 첫 창의 파일 감시를
죽인다.** 창별 UI 설정도 서로 덮어쓴다. 그걸 안 고치고 창부터 늘리면 조용히 깨진 앱이 된다.

**단, 그 둘을 이 에픽에서 미리 만들지는 않는다 (YAGNI).** 창이 하나인 동안 `stopWatching` 전역은
오히려 옳은 동작이고(같은 창에서 저장소를 바꾸면 옛 감시를 꺼야 한다), "창별 설정"은 창이 하나라
전역 설정과 같다. E15b가 창을 실제로 늘릴 때 함께 한다.

**탭은 우리가 만들지 않는다.** macOS가 `BrowserWindow`의 `tabbingIdentifier`로 창을 탭으로 묶어
준다 — 탭바·탭 드래그로 창 분리·"모든 창 병합"·⌘⇧] 이동이 전부 OS 기능이다(Electron 35에
`tabbingIdentifier`·`addTabbedWindow`·`mergeAllWindows`·`selectNextTab` 전부 있음을 확인).
사파리·Finder와 동작이 같아 학습할 것도 없다. **창을 제대로 만드는 것이 곧 탭이다** — E15b 몫.

---

## 3. 헤더 저장소 전환기

지금 헤더 왼쪽의 저장소 이름·경로(`app__repo`)를 누를 수 있게 만들고 팝오버를 연다.

- **최근 저장소** — 최대 10개. 현재 저장소는 표시로 구분한다.
- **다른 폴더 열기…** — 지금의 `repo.select()` 다이얼로그.
- **없어진 경로** — 흐리게 표시하고, 누르면 열지 않고 목록에서 제거한다(E7d의 prunable 워크트리 친절 거부와 같은 결).

브랜치 스위처(`header-branch`)·워크트리 탭과 같은 관용구다. 새 패턴을 만들지 않는다.

단축키는 **`⌘O` = 다른 폴더 열기**. 전환기 팝오버 자체의 단축키는 두지 않는다 — 지금 앱의 단축키는
`⌘F`·`⌘↵`·`⌘\``·`⌘⌥1/2`뿐이고, 마우스로 두 번 누르면 되는 것에 단축키를 늘리지 않는다 (YAGNI).

---

## 4. 최근 저장소

`AppSettings`에 `recentRepos?: string[]`를 더한다. 열기에 성공하면 그 경로를 맨 앞에 넣고 중복을
제거한 뒤 10개로 자른다.

이 규칙은 **순수 함수로 분리한다**(`components/recent-repos.ts` — 이 저장소는 순수 로직을 모듈로
빼 단위 테스트하는 관례가 확고하다: `branch-tree`·`file-tree`·`worktree-label`·`run-guard`…).

```ts
export const RECENT_REPOS_MAX = 10
/** 연 저장소를 맨 앞으로 — 중복 제거 후 상한으로 자른다 */
export function pushRecentRepo(recent: readonly string[], path: string): string[]
/** 없어진 경로를 뺀다 */
export function removeRecentRepo(recent: readonly string[], path: string): string[]
```

---

## 5. `openRepository(path?)` 와 **보안 경계**

인자가 있으면 다이얼로그를 건너뛰고 그 경로를 연다. 최근 목록 클릭이 이 경로를 쓴다.

**여기가 이 에픽의 유일한 보안 표면이다.** 지금 구조는:

- `repoSelect`(`git-handlers.ts:118`) — OS 다이얼로그로 **사용자가 직접 고른** 폴더를
  `rev-parse --is-inside-work-tree`로 검증하고 `registerRepoPath`가 저장소 루트로 정규화해
  `allowedRepoPaths` allowlist에 넣는다. 이후 모든 핸들러가 `assertAllowedRepo`로 그 목록을 대조한다.

최근 목록의 경로는 **디스크의 `settings.json`에서 온 렌더러 입력**이다. 사용자가 예전에 골랐다는
사실은 지금 그 값이 안전하다는 보장이 아니다(파일은 편집될 수 있다).

**따라서 새 IPC는 `repoSelect`와 똑같이 검증한다** — 렌더러가 준 경로를 그냥 `registerRepoPath`에
넘기면 **렌더러가 임의 디렉터리에서 git을 돌리게 만드는 통로가 된다.**

```ts
// repoOpenPath(가칭) — 다이얼로그 없이 여는 경로. 검증은 repoSelect와 동일해야 한다
ipcMain.handle(CHANNELS.repoOpen, async (_event, repoPath: unknown) => {
  const path = assertString(repoPath)
  const check = await execGit(['rev-parse', '--is-inside-work-tree'], { cwd: path })
  if (check.exitCode !== 0 || check.stdout.trim() !== 'true') {
    throw new Error('그 폴더는 이제 Git 저장소가 아니에요.')   // 목록에서 제거하는 신호
  }
  return registerRepoPath(path)
})
```

> **이름 주의:** `repo.openPath(repoPath, worktreePath)`는 **이미 있고 다른 뜻**이다
> (`ipc-contract:55` — 워크트리를 앱에서 열기). 새 것은 **`repo.open(path)`** 로 한다.

**계약서의 신뢰 규칙도 함께 고쳐야 한다.** `packages/ipc-contract/src/index.ts:36`이 이렇게 적고 있다:

> *신뢰 규칙: `repoPath`는 `repo.select()` 또는 `repo.initialPath()`가 반환한 값만 유효하다 —
> main은 자신이 돌려준 경로만 allowlist로 신뢰하고 그 외는 거부한다.*

`repo.open()`이 세 번째 진입점이 되므로 이 문장을 갱신하지 않으면 **계약서가 스스로 거짓이 된다.**
`select`와 **같은 검증을 거친 뒤에만** 값을 돌려준다는 점을 명시한다.

---

## 6. 전환할 때 무엇을 지우는가 — **플랜에서 실측으로 확정한다**

지금 정리되는 것: `CLEAR_SELECTIONS` 8개(`selected`·`diff`·`diffLabel`·`commitDetail`·`commitFile`·
`conflictFile`·`pullDetail`·`branchCompare`) + `fetchSnapshot` 7개(`status`·`history`·`branches`·
`shelf`·`branchOverview`·`rebaseProgress`·`worktrees`) + `historyRef`·`historyLimit`·`hostingStatus`·`pulls`.

**정리 목록에 없어 보이는 것 (추측 — 확정 아님):**

| 상태 | 남으면 무슨 일이 나는가 |
| --- | --- |
| `activeWorktree` | 옛 저장소의 워크트리를 가리킨 채 남으면 터미널 cwd·도크 라벨이 틀린다. **가장 위험** — 그리고 **스토어 밖이다**(`App.tsx:116`의 `useState`). `openRepository()`가 아무리 정리해도 여기엔 닿지 않으므로 App에서 따로 리셋해야 한다. 이펙트가 아니라 E14b가 `findScope`에 쓴 **렌더 중 파생**(`repoPath`가 바뀌면 비운다) 관용구를 쓴다 — `set-state-in-effect`는 이제 lint 에러다 |
| `lastFetchAt` | 옛 저장소의 마지막 페치 시각이 새 저장소 화면에 뜬다 |
| `headInfos` | `경로::HEAD` 키 캐시 — 옛 항목이 남는다(무해하지만 누수) |
| `notice` · `error` | 옛 저장소의 안내·오류가 새 화면에 남는다 |

**이 표는 코드를 읽고 세운 가설이고, 플랜이 하나씩 실제로 재서 확정한다.** E14a에서 정확히 이
부류(`openRepository` 중 옛 저장소의 선택이 새 화면에 되살아남)가 Blocking이었다.

**순서를 지킨다: 유출을 잡는 E2E를 먼저 쓰고(현재 코드에서 빨간 것을 확인) 그다음 고친다.**
E14b Task 4에서 같은 순서를 지켜, 고치기 전에 "원래 되던 것"인지 "원래 깨져 있던 것"인지를
구별할 수 있었다.

---

## 7. 테스트

- **단위** — `pushRecentRepo`/`removeRecentRepo`: 중복 제거, 상한 10, 맨 앞 이동, 없는 경로 제거.
- **E2E — 이 에픽이 그 그물을 처음 만든다.** E14b가 실측으로 확인했듯 **저장소를 두 번 여는
  시나리오가 지금 저장소에 하나도 없다**(`repo-picker`/저장소 열기를 건드리는 테스트 0건). 그래서
  E14b의 ⌘F 저장소 전환 무효화도 그물 없이 코드 리뷰로만 지켜지고 있다.
  - 전환기로 다른 저장소를 열면 화면이 그 저장소로 바뀐다
  - 전환 후 옛 저장소의 상태가 남지 않는다 (§6에서 확정한 목록 기준)
  - 최근 목록이 재시작 후에도 남는다
  - 없어진 경로를 누르면 열리지 않고 목록에서 빠진다
- **기존 게이트 무변** — lint 0 errors · typecheck 6/6 · 단위 606(+최근 목록) · e2e 128(+위 4건).

새 E2E는 반드시 **반증**한다(수정을 되돌려 빨개지는 것을 재빌드 후 확인).

---

## 8. 이 에픽에서 하지 않는 것

- **여러 창 · 네이티브 탭 · 창별 감시 · 창별 설정 · `MAX_SESSIONS` 정리** → E15b (§2).
- **뒤로가기** — 사용자가 물어본 셋 중 하나지만 만들지 않는다. 전환기의 최근 목록이 "돌아가기"를
  이미 제공하고, 별도의 뒤로가기 스택은 "무엇의 뒤로인가"(저장소? 선택한 파일? 브랜치?)가 모호해
  같은 기능을 두 관용구로 만드는 셈이 된다. 최근 목록을 써 보고도 부족하면 그때 다시 본다.
- **터미널 세션 정리** — 저장소를 바꿔도 이전 저장소의 pty를 죽이지 않는다(사용자 결정). 지금
  구조가 이미 그렇게 동작한다 — 터미널이 워크트리별 `groupKey`로 묶여 있어(E7h ④) 저장소를 바꾸면
  탭 목록만 걸러지고 세션은 남는다. 추가 작업이 없다. **대가: 상한 8개를 여러 저장소가 나눠 쓴다** —
  E15b에서 창별인지 전체인지와 함께 정리한다.

---

## 9. 성공 기준

앱을 끄지 않고 다른 저장소로 갈 수 있다. 방금 쓰던 저장소로는 목록에서 한 번에 돌아간다.
전환 후 화면에 이전 저장소의 흔적이 남지 않는다. 앱을 껐다 켜도 최근 목록이 남는다.
