# E15b — 여러 창 + macOS 네이티브 탭

> 사용자 요구: **"인텔리처럼 여러개 선택해서 여러개 창 띄우거나 탭으로 관리하거나"**
> E15a가 그 절반(한 창 안에서 저장소 바꾸기)을 했다. 이 에픽이 나머지 절반이다.

## 1. 문제

앱이 창 하나를 전제로 쓰여 있다. 그 전제가 코드 세 곳에 박혀 있고, 그중 하나는 **이미 결함이다**:

| 자리 | 지금 | 결과 |
| --- | --- | --- |
| `git-handlers.ts:179` `stopWatching` | `registerGitHandlers()` 클로저의 `let` 하나 | 새 창이 옛 창의 감시를 끄고, **창 B를 닫으면 `stopWatching = null`이 A를 가리키던 감시까지 끈다.** A는 조용히 E10(외부 변경 감지)을 잃는다 |
| `terminal-manager.ts:35` `MAX_SESSIONS = 8` | `TerminalManager` 하나의 `sessions.size` | 앱 전체 8개. 창 3개면 셋이 8개를 나눠 쓰고, "안 쓰는 탭을 닫아 주세요"가 **다른 창에 있어 보이지도 않는 탭**을 가리킨다 |
| `AppSettings` 11필드 | 전부 앱 공용 | 창마다 달라야 할 레이아웃 5개가 서로를 덮어쓴다 |

`terminal-handlers.ts`는 **이미 창별이다** — E7b가 `targets: Map<sessionId, WebContents>`로 설계했고 정리도 `sender`로 거른다. 상한 계산만 고치면 된다. (플랜 후속 노트가 이걸 선행 조건으로 적었던 것은 오기다.)

`allowedRepoPaths`(`git-handlers.ts:23`)는 `Set` 하나를 공유하는데 **그대로 둔다** — 두 창의 저장소가 다 허용되는 것이 맞고, 창별로 쪼개도 보안이 나아지지 않으면서 코드만 는다.

**감시를 다시 쓰면서 순서 결함도 함께 고친다.** 지금 `repoWatch` 핸들러는 `--git-common-dir` 해석을 **먼저** 하고 그 다음에 `stopWatching?.()`을 부른다(`git-handlers.ts:161-165`). rev-parse가 실패하면 옛 감시가 살아남은 채 새 저장소는 감시되지 않는다(E15a 리뷰 발견). 창별 `Map`으로 바꿀 때 **해제를 먼저 하고 새 감시를 건다** — "자연히 정리된다"고 가정하지 말고 태스크에 명시한다.

## 2. 사용자 결정 (이 브레인스토밍에서 확정)

| 물음 | 답 |
| --- | --- |
| 껐다 켜면 창이 돌아오나 | **돌아온다** (IntelliJ식) |
| 같은 저장소를 두 창에서 | **막는다** — 이미 연 창을 앞으로 |
| 진입점 | **넷 다** — 전환기 ⌥클릭 · ⌘N 빈 창 · 전환기 우클릭 메뉴 · 워크트리 |
| 네이티브 탭 | **OS에 맡긴다** — `tabbingIdentifier`만 |
| 새 창의 레이아웃 | **열어준 창을 따라간다** |
| 터미널 상한 | **창마다 8개** |
| 에픽 크기 | **한 번에** — 복원까지 |

## 3. 아키텍처 — 창 레지스트리

**생성** `apps/desktop/src/main/window-registry.ts`. main이 창의 정본을 갖는다.

```ts
/** 창별 레이아웃 — 앱 공용 설정과 갈라진다 (§4) */
export interface WindowLayout {
  leftCollapsed?: boolean
  rightCollapsed?: boolean
  rightWidth?: number
  terminalOpen?: boolean
  terminalHeight?: number
}

export interface WindowState {
  repoPath: string | null
  layout: WindowLayout
}
```

키는 `webContents.id`다. 등록은 **`new BrowserWindow(...)` 직후 동기적으로** 한다 — `webContents.id`는 그 순간 존재하고, preload의 `settings:get-sync`(§4)가 그보다 늦게 돈다. 이 순서가 깨지면 새 창이 씨앗 레이아웃 대신 기본값을 받는다.

레지스트리가 답하는 것은 넷뿐이다: **어느 창이 어느 저장소를 열었나**(중복 차단·복원) · **그 창의 레이아웃**(설정 분리) · **창별 감시 해제 함수** · **창별 터미널 세션 수**. 그 이상을 담지 않는다.

## 4. 설정을 둘로 가른다

| 앱 공용 (파일 최상위, 지금 그대로) | 창별 (`WindowLayout`) |
| --- | --- |
| `theme` · `pullMode` · `autoFetch` · `worktreeSelectAction` · `recentRepos` · `hosting`(토큰) | `leftCollapsed` · `rightCollapsed` · `rightWidth` · `terminalOpen` · `terminalHeight` |

**렌더러는 이 구분을 모른다.** 이것이 분리를 값싸게 만드는 핵심이다:

- `settingsApi.initial`은 지금처럼 평평한 객체 하나로 온다 — main이 `settings:get-sync`에서 `event.sender`로 창을 찾아 **앱 공용 + 그 창의 layout**을 합쳐 돌려준다.
- `settingsApi.set(partial)`도 지금처럼 부른다 — main이 `event.sender`로 창을 찾아 필드 성격에 따라 갈라 저장한다. **한 `partial`에 두 성격이 섞여 와도 각각 제 자리로 간다** — 렌더러가 갈라 보낼 의무가 없다.
- **렌더러 소비처(`sync-settings.ts`·`recent-repos-settings.ts`·`SettingsDialog`·스토어)는 한 줄도 안 바뀐다.**

`settings.ts`의 `save({ ...current(), ...sanitizeSettings(partial) })` 얕은 병합은 앱 공용 필드에만 적용된다. 창별 필드는 레지스트리의 그 창 항목에 병합한다.

**새 창의 씨앗**: `window:open`을 부른 창의 현재 `layout`을 복사한다. ⌘N(빈 창)은 **포커스된 창**을 따른다. 창이 하나도 없으면 마지막으로 저장된 창의 레이아웃, 그것도 없으면 기본값.

## 5. 진입점 넷 → 핸들러 하나

전부 `window:open(repoPath: string | null)` 하나로 모인다.

| 진입점 | 위치 |
| --- | --- |
| 전환기 항목 **⌥클릭** | `RepoSwitcher.tsx` (E15a) |
| 전환기 항목 **우클릭 → "새 창에서 열기"** | 같음 — ⌥의 발견 가능한 짝 |
| **⌘N** — 빈 새 창 | `App.tsx`의 키다운 리스너 (⌘O 옆) |
| 워크트리 → **"새 창에서 열기"** | `WorktreesPanel.tsx` 우클릭 메뉴 |

**보안**: `window:open`의 인자도 **디스크 설정에서 온 렌더러 입력**이다. E15a의 `repo.open`과 **같은 검증**을 거친다 — 실제로 `repo.open`의 검증 함수를 재사용하고, 검증에 통과한 정규화 경로로만 창을 만든다. `null`(빈 창)은 검증 대상이 아니다.

**중복 차단**: 레지스트리에서 같은 `repoPath`인 창을 찾으면 새로 만들지 않고 `show()` + `focus()`. 탭으로 묶여 있어도 `focus()`면 macOS가 그 탭을 앞으로 가져온다.

**워크트리는 중복 차단에 안 걸린다** — 링크드 워크트리의 `--show-toplevel`은 워크트리 경로라 `repoPath`가 다르다. 두 워크트리를 나란히 보는 것이 이 기능의 가장 큰 용도일 텐데 그것이 구조적으로 그냥 된다.

**⌘N이 드러내는 선재 결함 하나를 이 에픽에서 함께 고친다**: 지금 `RepoPicker`는 최근 목록을 안 보여 준다(E15a 후속 노트). 빈 창을 만들면서 그대로 두면 "새 창 = 항상 OS 다이얼로그부터"가 되어 최근 10개가 무의미해진다. **`RepoPicker`에 최근 목록을 붙인다.** 빈 창이 이 결함을 처음으로 아프게 만든다.

## 6. 네이티브 탭

`BrowserWindow`에 `tabbingIdentifier: 'dev.gitgui.repo'`를 준다. **실측(Electron 35.7.5)**: `BrowserWindowConstructorOptions.tabbingIdentifier`(`electron.d.ts:3735`) · `addTabbedWindow`(`:5142`) · `mergeAllWindows`(`:2860`) · `selectNextTab`(`:2905`) 전부 존재.

macOS가 사용자의 시스템 설정("탭 선호: 항상 / 전체화면에서 / 안 함")을 보고 새 창을 탭으로 묶는다. **탭바·드래그 분리·창 병합·⌘⇧[ ] 이동이 전부 OS 기능으로 딸려오고 앱이 그릴 것도 관리할 것도 없다.**

곁들여 창 메뉴에 **"모든 창 병합"**(`mergeAllWindows`)을 넣는다 — 이 항목은 앱이 제공해야 나온다.

**대가를 명시한다**: macOS 전용이고, 사용자의 시스템 설정이 "안 함"이면 탭이 생기지 않는다. 그건 결함이 아니라 사용자가 고른 것이지만, "탭으로 관리하고 싶다"는 요구가 시스템 설정에 달려 있다는 사실을 **README에 한 줄 적는다.**

## 7. 복원

종료 시 레지스트리를 설정에 직렬화한다:

```ts
/** 마지막 종료 시점의 창들 — 앞이 먼저 복원된다 (E15b) */
windows?: Array<{ repoPath: string | null; layout: WindowLayout }>
```

`sanitizeSettings`가 이 필드를 방어한다 — E15a의 `recentRepos`와 같은 이유로, 이 값은 사람이 편집할 수 있는 디스크 파일에서 오고 `repoPath`가 창을 만드는 인자가 된다.

**탭 묶음은 복원하지 않는다.** `addTabbedWindow`로 재현할 수는 있으나 그룹·순서·활성 탭을 따로 저장해야 하고, macOS의 탭 선호가 "항상"이면 복원된 창들이 **어차피 다시 탭으로 묶인다.** 얻는 것에 비해 비싸다.

**없어진 저장소**: 복원 경로가 저장소가 아니면 그 창을 만들지 않고 넘어간다(§5의 검증이 이미 판정한다). 전부 없거나 저장된 창이 없으면 빈 창 하나. **알림은 띄우지 않는다** — 시작하자마자 배너를 보는 것은 성가시고, 그 경로는 최근 목록에서도 곧 빠진다.

**저장 시점**: `before-quit`. 창이 하나씩 닫히는 `closed` 이벤트로 지우면 마지막 창을 닫아 종료할 때 목록이 비어 버린다 — **닫히는 중이 아니라 종료 직전의 스냅샷**을 쓴다.

## 8. 테스트 전략

**이 저장소의 E2E 135건이 전부 창 하나만 다뤄 왔다.** API는 있다 — 실측(Playwright 1.61.1): `ElectronApplication.windows(): Array<Page>`(`types.d.ts:17131`) · `waitForEvent('window')`(`:17125`). 미지수는 API가 아니라 **우리 하네스와 맞물리는가**다: `e2e/harness.ts`는 창 하나(`firstWindow`)를 전제로 하고, E2E는 창을 숨긴 채(`GIT_GUI_E2E_SHOW`가 없으면) 띄운다.

그래서 **첫 태스크는 "두 창을 띄우고 각각 조작하는 최소 E2E 하나"를 세우고 그것이 실제로 도는지 확인하는 것**이다. 안 되면 거기서 멈추고 보고한다 — 이 에픽의 유일한 미지수이고, 나머지 태스크가 전부 그 위에 선다.

**반드시 무는 단언 셋** (수정 전 빨강을 확인한다):

1. **감시 창별화** — 창 A·B를 열고 **B를 닫은 뒤 A에서 외부 파일 변경이 잡히는지.** 지금 코드에서 반드시 빨개진다.
2. **설정 창별화** — A에서 좌측을 접어도 B는 안 접힌다. 각각 재시작 후에도 유지된다.
3. **중복 차단** — 이미 연 저장소를 ⌥클릭하면 창 수가 늘지 않고 그 창이 앞으로 온다.

터미널 상한은 창별 8개인지를 단위 테스트로 문다(pty 16개를 E2E로 띄우는 것은 값이 비싸고 잘 깨진다).

**상한을 어디서 세는지 명시한다**: `TerminalManager`는 pty만 소유하고 창을 모른다. 창별 계수는 이미 창을 아는 `terminal-handlers.ts`에서 한다 — `targets`(`Map<sessionId, WebContents>`)에서 `event.sender`와 같은 항목 수를 세어 8 이상이면 거절한다. `TerminalManager`의 전역 `MAX_SESSIONS` 검사는 **제거한다**(두 곳에서 세면 문구가 갈린다).

## 9. 이 에픽에서 하지 않는 것

- **탭 그룹 복원** (§7)
- **Windows/Linux 탭** — 네이티브 탭은 macOS 전용이고, 직접 탭바를 그리는 것은 이 에픽을 두 배로 키운다
- **창 위치·크기 복원** — Electron의 기본 동작에 맡긴다. 레이아웃(사이드 접힘 등)과 다른 문제다
- **저장소별 레이아웃 기억** — 사용자가 "열어준 창을 따라간다"를 골랐다
- **`headInfos` 캐시 만료**(E15a 후속) · **`repoWatch`의 `stopWatching` 순서**(§3이 이 코드를 다시 쓰므로 그때 자연히 정리된다) · **E14c 참조 안정화**

## 10. 성공 기준

- 전환기 ⌥클릭·우클릭·⌘N·워크트리 넷으로 새 창이 열린다
- 시스템 탭 선호가 "항상"이면 그 창들이 탭으로 묶이고, 탭바·드래그 분리·병합이 동작한다
- 같은 저장소를 두 번 열려 하면 창이 안 늘고 그 창이 앞으로 온다
- 창마다 사이드 접힘·폭·터미널 높이가 따로 살고, 새 창은 열어준 창을 닮는다
- **창 B를 닫아도 A의 외부 변경 감지가 산다**
- 껐다 켜면 열려 있던 창들이 각자의 저장소·레이아웃으로 돌아온다
- 게이트: lint 0 errors · typecheck 6/6 · `pnpm test` 639 이상 · e2e 135 이상
