import { app, BaseWindow, ipcMain, nativeTheme, WebContentsView } from 'electron'
import { isAbsolute, join } from 'node:path'
import {
  SETTINGS_CHANNELS,
  TAB_CHANNELS,
  WINDOW_CHANNELS,
  type TabInfo,
  type WindowLayout,
  type WindowOpenResult,
} from '@git-gui/ipc-contract'
import { openRepoPath, registerGitHandlers } from './git-handlers'
import { registerHostingHandlers } from './hosting-handlers'
import { assertAbsoluteRepoPath } from './repo-open-guard'
import { canAutoRestart, nextCrashStreak } from './restart-policy'
import { readTheme, readWindows, registerSettingsHandlers, saveWindows } from './settings'
import { registerTerminalHandlers } from './terminal-handlers'
import { createTrailingDebounce } from './watch-filter'
import { createWindowRegistry } from './window-registry'

/**
 * 레이아웃 변경을 디스크에 묶어 쓰는 간격 (E15b 리뷰 I-1) — 도크 높이·우측 폭 드래그는 초당
 * 여러 번 온다. E10의 감시 디바운스를 그대로 재사용한다(트레일링 1회)
 */
const LAYOUT_PERSIST_MS = 250

// 창의 정본 (E15b) — 어느 창이 어느 저장소를 열었나·그 창의 레이아웃. main만 안다.
//
// 바뀔 때마다 디스크에 남긴다 (E15b 리뷰 I-1): 예전엔 `before-quit` 한 번이 유일한 영속
// 지점이라, 창을 닫고 종료하면 그 창의 레이아웃이 통째로 증발했다(main 대비 회귀 — main은
// `settings:set`마다 파일에 썼다). 레이아웃은 묶어서, 창 목록은 즉시 쓴다
// snapshot()이 곧 영속 형식이다 (E15c Task 8) — Task 2의 과도기 브리지 persistedWindows(활성
// 탭의 저장소를 창의 저장소로 접기)는 PersistedWindow가 탭 목록을 갖게 되면서 지웠다
const persistLayout = createTrailingDebounce(LAYOUT_PERSIST_MS, () =>
  saveWindows(registry.snapshot()),
)
/**
 * `before-quit`이 지나갔는가 — 지나갔으면 **목록은 얼어붙는다** (E15b 리뷰 I-1 실측).
 *
 * ⌘Q는 `before-quit` → 창들을 **하나씩** 닫는 순서다. 그 각각의 `closed`도 레지스트리 변경이라,
 * 얼리지 않으면 마지막 창 하나만 남은 중간 스냅샷이 방금 저장한 올바른 목록을 덮어쓴다
 * (실측: 창 둘을 열고 종료했더니 복원이 1개만 됐다 — 전체 E2E에서 «껐다 켜면 …» 1건이 빨갰다.
 * 닫히는 속도에 달린 경합이라 단독 실행에서는 초록이었다).
 *
 * 종료 중의 `closed`는 "사용자가 창을 닫았다"가 아니라 "앱이 내려간다"다 — 둘을 가르는
 * 신호가 정확히 이 순서다. 창을 먼저 닫고 종료하는 경로(Windows/Linux의 X)는 `closed`가
 * `before-quit`보다 **앞**이라 영향받지 않는다
 */
let quitting = false
const registry = createWindowRegistry((kind) => {
  if (quitting) return
  if (kind === 'layout') {
    persistLayout.hit()
    return
  }
  saveWindows(registry.snapshot())
  // 탭 목록 push (E15c) — 탭 증감·활성 전환·저장소 갈아타기(git-handlers의 remember)가 전부
  // 'windows' 변경이라, 정본이 알리는 여기 한 곳이면 어느 경로도 탭바에 빠짐없이 닿는다.
  // 핸들러마다 push를 흩으면 setTabRepoPath(전환기로 저장소를 갈아탄 탭의 라벨)를 빠뜨린다
  pushAllTabs()
})

/** tokens.css의 --color-bg와 짝 — 부팅 창 배경색으로 쓴다(E13 흰 화면 제거).
 * 실측: 앱 최상위에서 실제로 페인트되는 배경은 --color-surface(카드·패널 전용)가 아니라
 * body의 --color-bg다(base.css `body { background: var(--color-bg) }`) — #root와 .app은
 * 배경을 지정하지 않아(layout.css) body 배경이 창 전체에 그대로 비친다. --color-surface를
 * 썼다면 body 배경과 미묘하게 어긋나는 색이 창 생성 직후 잠깐 보였을 것이다.
 * 값이 바뀌면 여기도 손으로 맞춘다 (use-terminal-sessions.ts TERMINAL_FONT_FAMILY와 같은 관례) */
const APP_BACKGROUND = { light: '#f4f5f7', dark: '#16181d' } as const

/** 창 배경색을 저장된 테마로 정한다 — 저장값이 없으면(첫 실행) renderer의 resolveInitialTheme과
 * 같은 폴백(OS 다크모드 설정)을 쓴다. 이 색은 창(BaseWindow)과 뷰(WebContentsView) 둘 다에
 * 생성 순간부터 칠해져 있어, 창이 페인트를 마치고 보이는 시점에 흰 배경이 낄 틈이 없다 */
function resolveBackgroundColor(): string {
  const saved = readTheme()
  const dark = saved === 'dark' || (saved === undefined && nativeTheme.shouldUseDarkColors)
  return dark ? APP_BACKGROUND.dark : APP_BACKGROUND.light
}

// 앱 이름 (E7f) — 창 전환 UI·일부 메뉴에 반영. dev 메뉴바는 "Electron" 고정(Info.plist — 실측 6),
// 패키징 산출물(electron-builder productName)에서 완전히 "Git GUI"가 된다
app.setName('Git GUI')
// dev에서도 독에 Electron 아이콘 대신 앱 아이콘 (macOS — 패키징 전에도 정체성 유지).
// !app.isPackaged가 반드시 필요하다: 이 png는 electron-builder의 files 목록에 없어 asar에 안 들어가고
// (패키징 앱은 Info.plist가 가리키는 icon.icns로 이미 아이콘을 받는다), 패키징 앱에서 부르면
// "Failed to load image from path …/app.asar/resources/icon.png"로 **앱이 즉시 죽는다**.
// E7f가 이 줄을 넣은 뒤로 패키징 산출물은 한 번도 뜬 적이 없었다 — verify-app-bundle.mjs가
// 아이콘 파일 존재만 보고 실제 실행은 보지 않았기 때문이다 (E14b 후속 실측)
if (process.platform === 'darwin' && !app.isPackaged) {
  app.dock?.setIcon(join(__dirname, '../../resources/icon.png'))
}

// E2E·테스트 격리 — userData를 임시 폴더로 재지정할 수 있게 한다 (설정 파일이 실제 프로필을 오염하지 않게)
if (process.env.GIT_GUI_USER_DATA) {
  app.setPath('userData', process.env.GIT_GUI_USER_DATA)
}

// E2E 창 비간섭 — Playwright 실행 중 창이 사용자 화면을 가리거나 포커스를 뺏지 않게 숨긴 채 띄운다.
// CDP 입력·렌더·스크린샷은 숨김 창에서도 전부 동작한다(플랜 실측: isVisible false에서
// 클릭·드래그·키보드·screenshot(1200·960) 정상 + 기존 42건 전체 통과).
// 패키징된 앱에서는 무시한다 (GIT_GUI_E2E_GH_TOKEN과 동일 관례)
// GIT_GUI_E2E=1: 명시적 E2E 플래그 — harness가 모든 launch에 주입한다. GIT_GUI_E2E_REPO만으로
// 판정하면 복원 2회차처럼 REPO 없이 띄우는 launch가 사용자 화면에 창을 띄운다(사용자 불만).
// GIT_GUI_E2E_REPO 폴백은 하위 호환 — 하네스를 안 거치는 프로브가 옛 방식으로 띄울 수 있다
const isE2E =
  !app.isPackaged &&
  (process.env.GIT_GUI_E2E === '1' || process.env.GIT_GUI_E2E_REPO !== undefined)
// 로컬 디버깅 opt-out (E6a 후속) — GIT_GUI_E2E_SHOW=1이면 숨김 게이트만 무시하고 창을 보여준다.
// 스로틀 해제 등 나머지 E2E 동작은 유지. 프로덕션(isPackaged)·CI 기본 동작 무변
const isE2EShow = isE2E && process.env.GIT_GUI_E2E_SHOW === '1'

/** 새 창이 무엇을 열고 어떤 모습으로 뜰지 (E15b) — 여는 쪽이 정해 넘긴다 */
interface WindowSeed {
  repoPath: string | null
  layout: WindowLayout
}

/** createWindow의 산출물 (E15c) — 창·첫 탭 뷰에 더해, 복원이 createTab으로 탭을 더 달 수 있게
 * 창 id도 준다(창 id는 createWindow가 발급하는 내부 값이라 여기 말고는 알 길이 없다) */
interface CreatedWindow {
  window: BaseWindow
  view: WebContentsView
  windowId: number
}

/** 뷰 id → 그 뷰가 사는 창 (E15c). registry는 electron을 모르므로 실물 연결은 여기(index.ts) 몫이다.
 * BaseWindow에는 webContents가 없어 예전의 getAllWindows().find(webContents.id)가 불가능하다 */
const windowOfView = new Map<number, BaseWindow>()

/** 탭 id → 뷰 실물 (E15c Task 3) — 가시성 전환·닫기·push가 뷰 객체를 필요로 한다.
 * windowOfView와 항상 같은 키 집합이다(createTab이 함께 넣고 정리 경로들이 함께 지운다) */
const viewOfTab = new Map<number, WebContentsView>()

/**
 * 탭 id → 연속 크래시 장부 (E15e 리뷰 I-1) — showActiveTab의 자동 재시동 상한 판정용.
 * streak는 연속 크래시 수(restart-policy의 산수), loadedAt은 직전 로드 완료 시각(로드 전엔
 * 생성 시각 — 첫 로드 중의 크래시도 연속으로 세어져야 크래시-온-로드가 잡힌다).
 *
 * 레지스트리가 아니라 여기(main)에 있는 이유: "자동 재시동"은 reload라는 main의 실행 개념이고
 * (레지스트리의 소비처인 탭바·영속은 crashed 불리언이면 족하다 — 카운트를 쓸 곳이 없다),
 * 레지스트리의 onChange('windows')는 즉시 디스크 쓰기+push라 크래시마다 카운트 갱신으로 그걸
 * 울리면 루프를 끊으려다 쓰기를 더 만든다. 단위 테스트는 판정을 restart-policy의 순수 함수로
 * 빼서 얻었다 — 여기는 시계(Date.now)와 장부만 든다. 정리는 viewOfTab과 같은 세 곳
 * (창 closed 훅·destroyed 훅·closeTab)이다
 */
const crashLedgerOfTab = new Map<number, { streak: number; loadedAt: number }>()

/** 창 id 발급 (E15c) — 창 id와 탭 id는 다른 이름 공간이다. 뷰가 여럿이라 webContents.id를 창
 * 키로 못 쓴다. 단조 증가면 충분하다 — webContents.id도 단조 증가라 재사용 걱정이 없는 것을
 * E15b 리뷰가 실측했고, 여기도 같은 성질만 필요하다 */
let nextWindowId = 1

function createWindow(seed: WindowSeed = { repoPath: null, layout: {} }): CreatedWindow {
  const window = new BaseWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'Git GUI',
    // E7f 한 줄 타이틀바(macOS) → E7h ⑦: hiddenInset은 신호등 y가 OS 고정이라 헤더와 안 맞았다 —
    // hidden + trafficLightPosition으로 세로 중앙에 맞춘다.
    // E15c — 타이틀바 구실이 헤더에서 탭바로 옮겨가(스펙 §3 "두 줄") 기준 높이도 바뀌었다:
    // y=10 실측: .tab-bar 실높이 34px(getBoundingClientRect) → Math.round((34-14)/2) = 10
    // (신호등 지름 14px 관례 — E7h와 같은 식, 기준만 헤더 58px→탭바 34px).
    // 탭바가 타이틀바를 겸한다(드래그·패딩은 tab-bar.css). 숨김 캡처와 공존(실측 1)
    // BrowserWindow가 아니라 BaseWindow지만 같은 옵션을 받는다
    // (실측: BaseWindowConstructorOptions에 titleBarStyle·trafficLightPosition 있음 — electron.d.ts).
    // E15b에서 네이티브 탭을 막았던 hidden이 여기서는 아무것도 안 막는다 — 탭은 우리가 그린다
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 20, y: 10 } }
      : {}),
    // E13 — 창이 뜨는 순간부터 이 색으로 칠해져 있다(콘텐츠가 없는 흰 배경 대신). 저장된
    // 테마를 못 읽는 극단적 실패에도 폴백값이 있어 undefined가 되지 않는다
    backgroundColor: resolveBackgroundColor(),
    // E13 — 페인트 전에 보여주지 않는다: 뷰가 로드를 마친 뒤에야 드러난다(아래 did-finish-load)
    show: false,
  })

  // 레지스트리 등록은 **여기서 동기적으로** 한다 (E15b). preload의 settings:get-sync가 이보다
  // 늦게 돌고(동기 IPC도 이 틱이 끝나야 처리된다), 그때 이 창의 layout 씨앗을 읽어야 새 창이
  // 열어준 창을 닮는다. repo:initial-path도 같은 이유로 여기(createTab) 등록된 repoPath를 읽는다.
  // 탭 키는 view.webContents.id — E15b의 sender.id 배선(git-handlers·terminal-handlers·settings)이
  // 전부 그대로 산다(sender가 곧 이 뷰의 webContents다). 창 키만 새 이름 공간이다 (E15c)
  const windowId = nextWindowId++
  registry.addWindow(windowId, seed.layout)
  const view = createTab(window, windowId, seed.repoPath)

  // 창 리사이즈마다 **모든** 탭 뷰를 창 크기에 맞춘다 — BrowserWindow 시절엔 공짜였던 것.
  // 숨은 뷰도 같이 맞춰 두어야 전환하는 순간 헌 크기 레이아웃이 한 프레임도 안 보인다
  window.on('resize', () => {
    for (const tabId of registry.getWindow(windowId)?.tabs ?? []) {
      const tabView = viewOfTab.get(tabId)
      if (tabView !== undefined) fitViewToWindow(window, tabView)
    }
  })

  // ready-to-show는 BrowserWindow의 이벤트다 — BaseWindow에는 없다 (첫 페인트 신호가
  // WebContentsView에는 노출되지 않는다: webContents의 'paint'는 오프스크린 전용).
  // did-finish-load는 페인트 이전일 수 있지만, 뷰 배경색을 창 배경색과 같게 칠해 두므로
  // (createRepoView의 setBackgroundColor) 페인트 전 프레임도 흰색이 아니라 테마색이다 —
  // E13의 판정 기준(창이 드러날 때 흰 배경이 한 프레임도 안 보인다)을 배경색으로 만족한다.
  // E2E 숨김 규칙(E6a)과의 합성은 그대로: isE2E && !isE2EShow는 계속 숨긴 채로 둔다.
  // 첫 탭에만 건다 — 이후 탭은 이미 보이는 창에 생기므로 show 신호가 필요 없다
  view.webContents.once('did-finish-load', () => {
    if (!isE2E || isE2EShow) window.show()
  })

  window.on('closed', () => {
    // 창이 닫히면 그 안의 **모든** 탭 뷰를 닫는다 (Task 1 배선의 탭 일반화).
    // removeWindow를 먼저 — 각 뷰의 destroyed 훅이 "레지스트리에 내 탭이 없다"로 이 경로임을
    // 알아보고 창을 또 닫으려 들지 않는다. removeTab이 창 항목을 이미 지운 경우(마지막 탭=창
    // 닫힘 동치)에도 removeWindow는 무해하다 — 없는 id는 조용히 무시.
    // 실측 (E15c Task 1): BrowserWindow와 달리 BaseWindow는 닫혀도 뷰의 webContents를 파괴하지
    // 않는다(닫은 뒤 getAllWebContents()에 잔류·'destroyed' 미발화). 명시적으로 닫아야
    // git-handlers·terminal-handlers의 once('destroyed') 정리(감시·pty)가 돈다
    const tabIds = [...(registry.getWindow(windowId)?.tabs ?? [])]
    registry.removeWindow(windowId)
    for (const tabId of tabIds) {
      const tabView = viewOfTab.get(tabId)
      windowOfView.delete(tabId)
      viewOfTab.delete(tabId)
      crashLedgerOfTab.delete(tabId)
      if (tabView !== undefined && !tabView.webContents.isDestroyed()) tabView.webContents.close()
    }
  })

  // 전체화면에서는 신호등이 숨는다 — 신호등 패딩을 접게 push (E7f 실측 2: CSS 신호 불가).
  // 숨은 뷰에도 보낸다 — 전체화면 중에 전환한 탭이 접힌 패딩을 이미 알고 있어야 한다
  window.on('enter-full-screen', () => {
    sendToWindowTabs(windowId, WINDOW_CHANNELS.fullScreen, true)
  })
  window.on('leave-full-screen', () => {
    sendToWindowTabs(windowId, WINDOW_CHANNELS.fullScreen, false)
  })

  // 창으로 돌아오면 재조회 — 감시가 못 잡은 잔여와 감시가 죽은 경우(watch error로 조용히 닫힘)를
  // 메운다 (E10). 숨은 뷰에도 보낸다 — 감시 사각지대는 숨은 탭에도 똑같이 생기고, 여기서 안
  // 메우면 그 탭은 켜지는 순간까지 낡은 화면을 들고 있다
  window.on('focus', () => {
    sendToWindowTabs(windowId, WINDOW_CHANNELS.focused)
  })

  return { window, view, windowId }
}

/**
 * 창에 탭(뷰) 하나를 만들어 단다 (E15c Task 3) — 실물 연결(맵)·레지스트리 등록·수명 배선까지.
 * 가시성은 손대지 않는다: 활성 전환은 호출자가 `setActiveTab` + `showActiveTab`으로 정한다
 * (레지스트리의 "첫 탭만 활성, 이후 추가는 활성을 안 훔친다"와 결이 같다)
 */
function createTab(window: BaseWindow, windowId: number, repoPath: string | null): WebContentsView {
  const view = createRepoView()
  const tabId = view.webContents.id
  window.contentView.addChildView(view)
  fitViewToWindow(window, view)
  // 맵을 addTab보다 먼저 — addTab의 onChange가 곧장 pushAllTabs를 돌리는데, 그 시점에 맵이
  // 비어 있으면 같은 창 다른 뷰들이 새 탭이 실린 목록을 못 받는다
  windowOfView.set(tabId, window)
  viewOfTab.set(tabId, view)
  // 크래시 장부의 시작점 — loadedAt의 초기값은 생성 시각이다: 첫 로드를 끝내지 못하고 죽는
  // 렌더러도 (긴 로드가 아니라면) 연속으로 세어져야 크래시-온-로드 상한이 잡는다
  crashLedgerOfTab.set(tabId, { streak: 0, loadedAt: Date.now() })
  registry.addTab(windowId, tabId, repoPath)

  // 뷰→창 방향 수명 (E15c Task 1 실측의 탭 일반화): webContents가 먼저 파괴돼도(Playwright
  // page.close()의 Target.closeTarget, DOM window.close(), 렌더러 크래시) BaseWindow는 아무
  // 반응이 없다 — BrowserWindow 시절엔 자기 webContents 파괴가 곧 창 닫힘이었다.
  // 탭이 여럿이면 동치가 갈라진다: **탭 하나가 죽었다고 창이 닫히면 안 되고, 마지막 탭이
  // 죽으면 빈 창이 남으면 안 된다**(남으면 registry에서도 안 빠져 복원이 유령 창을 만든다 —
  // Task 1에서 E2E 2건이 정확히 이 모양으로 빨갰다). registry.removeTab의 "마지막 탭이면 창
  // 항목도 지움"과 같은 판정을 실물(창·뷰)에도 적용한다
  view.webContents.once('destroyed', () => {
    windowOfView.delete(tabId)
    viewOfTab.delete(tabId)
    crashLedgerOfTab.delete(tabId)
    // 이미 레지스트리에 없다 — tabs:close(closeTab)나 창 closed 훅이 먼저 정리한 정상 경로다
    if (registry.windowOfTab(tabId) === undefined) return
    // 여기 도달했으면 렌더러가 스스로 죽은 경우다 — 레지스트리 정리는 이 훅 몫이다
    registry.removeTab(tabId)
    if (window.isDestroyed()) return
    if (registry.getWindow(windowId) === undefined) {
      // 마지막 탭이 죽었다 — 창 닫힘과 동치 (removeTab이 창 항목을 지운 것과 정합).
      // isDestroyed 가드(위)가 closed 훅과의 상호 재귀를 끊는다
      window.close()
      return
    }
    window.contentView.removeChildView(view)
    // 활성 탭이 죽었으면 removeTab의 승계(오른쪽 우선)를 화면에도 반영한다
    showActiveTab(windowId)
  })

  // 크래시한 렌더러는 destroyed가 **아니다** (E15c 리뷰 I-2 실측) — 위 destroyed 훅이 안 돌고
  // 뷰·레지스트리에 그대로 잔류한다. 탭바가 각 렌더러 안에 있으므로(E15c 스펙 §1) 여기서
  // main이 안 움직이면 활성 탭 크래시 = 창 인질이다: 산 탭으로 갈 UI(탭바·단축키)가 전부
  // 죽은 렌더러 안이라 유일한 출구(창 닫기)가 산 탭까지 잃는다.
  // 정상 닫힘 경로는 여기 안 걸린다 — closeTab·closed 훅이 레지스트리를 먼저 지우므로
  // 그 뒤에 이 이벤트가 와도 setCrashed는 없는 탭으로 무해하다
  view.webContents.on('render-process-gone', (_event, details) => {
    console.error(`탭 렌더러 크래시 (tab ${tabId}): ${details.reason}`)
    // 연속 크래시 장부 (E15e 리뷰 I-1) — 직전 로드 완료에서 얼마 만의 크래시인가로 "연속"을
    // 가른다(살 만큼 살았으면 1로 리셋 — restart-policy). 아래 showActiveTab의 자동 재시동
    // 분기가 이 값으로 상한을 판정하므로 **반드시 그보다 먼저** 적는다
    const ledger = crashLedgerOfTab.get(tabId)
    if (ledger !== undefined) {
      ledger.streak = nextCrashStreak(ledger.streak, Date.now() - ledger.loadedAt)
    }
    // 장부 절반 — 크래시 표시 + (활성이었으면) 산 이웃 승계(레지스트리가 removeTab과 같은
    // 오른쪽 우선으로 잇는다). onChange가 push를 돌려 산 형제의 탭바에 죽음 표시가 실린다
    registry.setCrashed(tabId, true)
    const where = registry.windowOfTab(tabId)
    if (where === undefined) return
    // 실물 절반 — showActiveTab이 승계를 화면에 반영한다. 산 이웃이 없어 활성이 크래시 탭에
    // 남았으면(유일 탭·전부 죽음) showActiveTab의 복구 분기가 reload로 재시동한다 — 죽은 뷰엔
    // 안내도 그릴 수 없어 재시동이 유일한 복구다 (스펙 §1 — 단 연속 상한까지만, 리뷰 I-1).
    // Task 1이 여기 두었던 reload 특례는 Task 2가 복구 분기를 showActiveTab 한 곳으로 모으면서 접었다
    showActiveTab(where)
  })

  // 크래시 표시 해제 — reload(위 자동 재시동·Task 2의 클릭 복구)가 끝날 때마다 와야 하므로
  // once가 아니라 **on**이다 (createWindow의 once('did-finish-load')는 첫 show용 1회 — 역할이
  // 다르다). 산 탭의 정상 로드에서는 setCrashed(false)가 무변화 무발화라 아무 일도 없다
  view.webContents.on('did-finish-load', () => {
    // 시각만 적는다 — streak 리셋은 타이머가 아니라 **다음 크래시에서** 경과 시간으로 판정한다
    // (restart-policy 주석 — 탭마다 타이머·해제 배선을 두는 것보다 값싸고 판정이 순수하다)
    const ledger = crashLedgerOfTab.get(tabId)
    if (ledger !== undefined) ledger.loadedAt = Date.now()
    registry.setCrashed(tabId, false)
  })
  return view
}

/** 이 창의 모든 뷰(숨은 뷰 포함)에 push한다 (E15c) — 숨은 탭도 상태를 받아 둬야 켜질 때 이미 맞다 */
function sendToWindowTabs(windowId: number, channel: string, ...args: unknown[]): void {
  for (const tabId of registry.getWindow(windowId)?.tabs ?? []) {
    const view = viewOfTab.get(tabId)
    if (view !== undefined && !view.webContents.isDestroyed()) {
      view.webContents.send(channel, ...args)
    }
  }
}

/**
 * 창별 레이아웃 변경을 같은 창의 **다른** 탭들에 알린다 (E15c Task 7, 스펙 §4 — 레이아웃은 창
 * 단위). settings.ts의 settings:set이 부른다 — 뷰 실물은 여기만 알므로 콜백으로 넘긴다.
 *
 * 보낸 탭 자신을 **반드시** 뺀다 — 메아리 차단의 main 쪽 절반이다(나머지 절반은 렌더러의
 * "push 적용은 저장 없는 setter만" — App.tsx). sendToWindowTabs를 안 쓰는 이유가 이 제외다.
 * 숨은 탭에도 보낸다 — 나중에 켜도 이미 맞아 있어야 한다(스펙 §4, sendToWindowTabs와 같은 이유)
 */
function pushLayoutToSiblings(senderTabId: number, layout: WindowLayout): void {
  const windowId = registry.windowOfTab(senderTabId)
  if (windowId === undefined) return
  for (const tabId of registry.getWindow(windowId)?.tabs ?? []) {
    if (tabId === senderTabId) continue
    const view = viewOfTab.get(tabId)
    if (view !== undefined && !view.webContents.isDestroyed()) {
      view.webContents.send(SETTINGS_CHANNELS.layoutChanged, layout)
    }
  }
}

/**
 * 활성 탭 하나만 보인다 (E15c Task 3 — 이 태스크의 실물). 모든 뷰가 전체 크기로 겹쳐 있고
 * setVisible로만 갈아탄다 — 숨은 뷰는 페인트하지 않는다(스펙 §2 실측). 활성 뷰는 보이기 전에
 * 창 크기에 다시 맞춘다(숨어 있는 동안의 리사이즈를 resize 훅이 맞춰 주지만, 훅 등록 전
 * 경합·창 이동 직후 등 어긋날 길을 여기서 한 번 더 닫는다).
 *
 * **크래시 복구 분기는 여기 한 곳이다** (E15e Task 2) — 화면에 세울 활성 탭이 크래시 상태면
 * reload로 재시동한다. 활성을 크래시 탭에 놓을 수 있는 경로 전부가 이 함수를 지난다: 클릭
 * 복구(tabs:activate)·중복 판정의 reveal(revealExistingTab)·유일 탭 크래시(render-process-gone
 * 훅)·마지막 산 탭 닫힘(closeTab — 남는 활성이 크래시 탭뿐인 경계)·렌더러 자멸 정리(destroyed
 * 훅). 경로마다 분기를 흩으면 reveal과 activate가 다른 복구를 하는 종류의 어긋남이 생긴다.
 * 활성화·표시는 즉시고 화면은 did-finish-load가 채운다 — 뷰 배경색(createRepoView)이 그동안의
 * 흰 프레임을 막고(E15c Task 1 실측), 같은 이벤트(createTab의 on)가 setCrashed(false)로 죽음
 * 표시를 걷는다.
 *
 * **자동 재시동은 연속 상한까지만이다** (E15e 리뷰 I-1) — "시도 1회당 reload 1회"는 크래시-온-
 * 로드 렌더러 앞에서 루프가 된다: reload 완료(did-finish-load)가 곧장 다음 크래시를 부르고,
 * 그 크래시 훅이 또 여기로 온다(수정 전 실측: 15초에 크래시 157회·reload 156회 + 크래시마다
 * setCrashed의 즉시 디스크 쓰기). `cause`가 가른다 — 'user'(클릭 복구 tabs:activate·reveal)는
 * 사용자의 의지라 상한과 무관하게 언제나 reload(스펙 §2·§3), 'auto'(크래시 훅·닫기 승계·자멸
 * 정리)는 앱의 추측이라 연속 상한(restart-policy)까지만. 상한을 넘기면 크래시 표시를 남긴 채
 * 정지한다 — 다탭이면 산 탭바의 클릭 복구가 남아 있고, 유일 탭이면 죽은 뷰가 선 채 남는다
 * (스펙 §3이 감수한 "수동 클릭 복구만"의 극단 — 표시할 탭바도 없지만 최소한 루프는 없다)
 */
function showActiveTab(windowId: number, cause: 'auto' | 'user' = 'auto'): void {
  const state = registry.getWindow(windowId)
  if (state === undefined) return
  for (const tabId of state.tabs) {
    const view = viewOfTab.get(tabId)
    const window = windowOfView.get(tabId)
    if (view === undefined || window === undefined) continue
    const visible = tabId === state.activeTab
    if (visible) {
      fitViewToWindow(window, view)
      if (registry.isTabCrashed(tabId) && !view.webContents.isDestroyed()) {
        if (cause === 'user' || canAutoRestart(crashLedgerOfTab.get(tabId)?.streak ?? 0)) {
          view.webContents.reload()
        }
      }
    }
    view.setVisible(visible)
  }
}

/** 이 창의 탭 목록을 계약서 형태(TabInfo[])로 — push(tabs:changed)와 pull(tabs:list)이 같이 쓴다 */
function tabInfosOf(windowId: number): TabInfo[] {
  const state = registry.getWindow(windowId)
  if (state === undefined) return []
  return state.tabs.map((tabId) => ({
    id: tabId,
    repoPath: registry.getTabRepoPath(tabId) ?? null,
    active: tabId === state.activeTab,
    // 계약서: 없으면 산 것 — false를 매 탭에 싣지 않아 기존 소비처·단언이 무변이다 (E15e)
    ...(registry.isTabCrashed(tabId) ? { crashed: true } : {}),
  }))
}

/** 이 창의 탭 목록을 그 창의 **모든 뷰**에 알린다 — 숨은 뷰 포함(나중에 켜져도 탭바가 이미 맞다).
 * 아직 로드 전인 뷰에는 유실되지만 초기 목록은 preload가 tabs:list로 당겨간다(계약서 주석 참조) */
function pushTabs(windowId: number): void {
  const tabs = tabInfosOf(windowId)
  for (const tab of tabs) {
    const view = viewOfTab.get(tab.id)
    if (view !== undefined && !view.webContents.isDestroyed()) {
      view.webContents.send(TAB_CHANNELS.changed, tabs)
    }
  }
}

/** 레지스트리 'windows' 변경마다 모든 창에 push — 창 id 열거는 실물 맵에서 얻는다
 * (registry에는 창 id 열거가 없고, 뷰가 없는 창은 어차피 받을 곳도 없다) */
function pushAllTabs(): void {
  const windowIds = new Set<number>()
  for (const tabId of viewOfTab.keys()) {
    const windowId = registry.windowOfTab(tabId)
    if (windowId !== undefined) windowIds.add(windowId)
  }
  for (const windowId of windowIds) pushTabs(windowId)
}

/**
 * 탭 하나를 닫는다 (E15c Task 3). 마지막 탭이면 창을 닫는다 — registry.removeTab의 "마지막
 * 탭이면 창 항목도 지움"과 실물(창)이 어긋나지 않게 창 닫기 경로에 위임한다(closed 훅이
 * removeWindow·뷰 close를 다 한다)
 */
function closeTab(tabId: number): void {
  const windowId = registry.windowOfTab(tabId)
  if (windowId === undefined) return
  const state = registry.getWindow(windowId)
  const window = windowOfView.get(tabId)
  const view = viewOfTab.get(tabId)
  if (state === undefined || window === undefined || view === undefined) return
  if (state.tabs.length === 1) {
    window.close()
    return
  }
  // 레지스트리 먼저 — 활성 승계(오른쪽 우선)가 여기서 정해지고, 이어지는 webContents.close()의
  // destroyed 훅은 "레지스트리에 이미 없다"로 이 경로가 정리를 끝냈음을 알아본다
  registry.removeTab(tabId)
  windowOfView.delete(tabId)
  viewOfTab.delete(tabId)
  crashLedgerOfTab.delete(tabId)
  window.contentView.removeChildView(view)
  // 실측 (Task 1): BaseWindow 세계에서 webContents는 아무도 대신 닫아 주지 않는다 — 명시적
  // close()가 있어야 git-handlers·terminal-handlers의 once('destroyed') 정리(감시·pty)가 돈다
  if (!view.webContents.isDestroyed()) view.webContents.close()
  // 닫힌 탭이 활성이었으면 승계된 이웃을 실제로 보인다 — 아니었으면 이 호출은 무해한 재확인이다.
  // 마지막 산 탭을 닫아 남은 활성이 크래시 탭뿐이면(E15e Task 1이 넘긴 경계) showActiveTab의
  // 복구 분기가 그 탭을 reload로 재시동한다 — 안 하면 죽은 뷰가 활성으로 서서 창이 도로 인질이다.
  // cause는 'auto'다 — 사용자가 시킨 것은 "닫기"지 "저 탭을 되살려라"가 아니고, 크래시-온-로드면
  // 이 reload도 곧장 크래시 훅의 루프 입구가 되므로 연속 상한의 지배를 받아야 한다(리뷰 I-1)
  showActiveTab(windowId)
}

/**
 * 이미 열린 탭으로 데려간다 (E15c Task 6 — 스펙 §3 "이미 있으면 거기로 데려간다"의 실행부).
 * 그 창을 앞으로(show+focus) + 그 탭 활성화 + 가시성 전환까지가 한 동작이다.
 *
 * 세 진입점(tabs:open·window:open·tabs:show-existing)이 **이 한 함수**를 공유한다 — 규칙
 * 하나(스펙 §3)의 "데려간다"가 진입점마다 다르게 굳는 것을 막는다. E15b는 window:open에서
 * show+focus만 하고 탭 활성화가 없었는데, 탭이 창마다 하나라 동작이 같았을 뿐이었다.
 *
 * 크래시 탭으로의 reveal도 손대지 않는다 (E15e — 스펙 §1 "죽은 뷰로 데려가지 않는다"):
 * 복구는 showActiveTab의 분기가 한다 — tabs:activate의 클릭 복구와 **같은 한 곳**이라
 * reveal과 activate가 다른 복구를 할 길이 없다. cause도 같은 'user'다 — "이 저장소를 보여
 * 달라"는 사용자의 의지라 자동 재시동 상한(리뷰 I-1)과 무관하게 복구한다
 */
function revealExistingTab(existing: { windowId: number; tabId: number }): void {
  registry.setActiveTab(existing.windowId, existing.tabId)
  showActiveTab(existing.windowId, 'user')
  // BaseWindow에는 webContents가 없어 getAllWindows().find(webContents.id)가 불가능하다 —
  // 뷰(탭) id → 창 역방향 맵으로 찾는다 (E15c)
  const window = windowOfView.get(existing.tabId)
  window?.show()
  window?.focus()
}

/** 뷰 하나가 창 콘텐츠 전체를 덮는다 — 탭이 늘어도 이 함수는 그대로다(전부 전체 크기,
 * 보이는 것 하나) */
function fitViewToWindow(window: BaseWindow, view: WebContentsView): void {
  const { width, height } = window.getContentBounds()
  view.setBounds({ x: 0, y: 0, width, height })
}

// 플랜은 createRepoView(seed)였지만 씨앗은 여기 올 일이 없는 것으로 판명됐다 — 탭별 씨앗
// (repoPath)은 createTab이 레지스트리에 등록하고 렌더러가 repo:initial-path로 당겨간다.
// 이 함수는 "특권 표면을 가진 빈 뷰 하나"만 만든다
function createRepoView(): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 숨김 창의 타이머·rAF 스로틀로 E2E 대기가 길어지지 않게 — E2E에서만 해제
      backgroundThrottling: !isE2E,
    },
  })
  // E13 — 뷰의 배킹은 기본 흰색이다: 창 backgroundColor 위를 뷰가 덮으므로, 뷰에도 같은
  // 테마색을 칠해야 첫 페인트 전에 흰 프레임이 안 보인다 (위 did-finish-load 주석 참조)
  view.setBackgroundColor(resolveBackgroundColor())
  // 이 뷰는 preload로 git 조작 API를 갖는 특권 표면이다 — 외부 네비게이션과 새 창을 차단한다
  // (파일 드래그&드롭의 file:// 네비게이션 같은 기본 동작도 여기서 막힌다)
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  view.webContents.on('will-navigate', (event) => event.preventDefault())

  // 패키징된 앱에서는 env로 임의 URL을 주입할 수 없어야 한다
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void view.webContents.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void view.webContents.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return view
}

/** 새 창은 열어준 창의 레이아웃을 씨앗으로 받는다 (사용자 결정). 그 창이 없으면 빈 레이아웃 —
 * 렌더러가 기본값을 쓴다. openerId는 sender.id, 즉 탭(뷰) id다 — 레이아웃은 창 단위(스펙 §4)라
 * 탭→창 조회를 layoutOfTab이 접는다 */
function seedLayoutFrom(openerId: number): WindowLayout {
  return { ...(registry.layoutOfTab(openerId) ?? {}) }
}

/** 새 창에서 연다 (E15b). 창을 만드는 것은 index.ts 책임이라 이 핸들러만 여기 있다 */
function registerWindowHandlers(): void {
  ipcMain.handle(
    WINDOW_CHANNELS.open,
    async (event, repoPath: unknown): Promise<WindowOpenResult> => {
      if (repoPath === null) {
        createWindow({ repoPath: null, layout: seedLayoutFrom(event.sender.id) })
        return { ok: true }
      }
      // 인자는 디스크 설정에서 온 렌더러 입력이라 repo.open과 **같은 검증**을 거친다 — 검증 없이
      // 씨앗으로 넣으면 그 창이 임의 디렉터리에서 git을 돌리는 통로가 된다
      const opened = await openRepoPath(assertAbsoluteRepoPath(repoPath))
      // 열기 실패는 예외가 아니다 (E15b 리뷰 I-2) — reason을 그대로 흘려보내야 렌더러가
      // E15a의 목록 제거 정책(reason !== 'failed')을 이 진입점에서도 쓸 수 있다.
      // 예전엔 여기서 throw했고 렌더러가 void로 버려 배너도 목록 정리도 없었다
      if (!opened.ok) return opened
      // 이미 그 저장소를 연 탭이 있으면 새로 만들지 않고 데려간다 (스펙 §3 셋째 행) —
      // 그 창을 앞으로 + **그 탭 활성화**까지 (E15c Task 6이 완성. Task 2는 판정만 탭
      // 단위(findTabByRepoPath)로 바꿨고 활성화가 없었다 — 탭이 창마다 하나라 티가 안 났다)
      const existing = registry.findTabByRepoPath(opened.path)
      if (existing !== undefined) {
        revealExistingTab(existing)
        return { ok: true }
      }
      createWindow({ repoPath: opened.path, layout: seedLayoutFrom(event.sender.id) })
      return { ok: true }
    },
  )
}

/** 탭 id는 정수다 — 렌더러 입력이라 형식부터 막는다 (git-handlers의 assertString 관례) */
function assertTabId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error('잘못된 요청 형식이에요.')
  }
  return value
}

/**
 * 탭 IPC (E15c Task 3). 탭의 실물(뷰 생성·가시성·닫기)은 전부 여기 — 레지스트리는 장부만 든다.
 *
 * `tabs:activate`/`tabs:close`의 tabId도 렌더러 입력이다 — **sender가 사는 창의 탭인지**
 * 대조한다. 안 하면 한 렌더러가 다른 창의 탭을 닫거나 활성을 바꾸는 통로가 된다(레지스트리의
 * setActiveTab에도 같은 가드가 있지만 close는 closeTab이 레지스트리를 안 거치고 뷰부터 만지므로
 * 경계에서 막아야 한다)
 */
function registerTabHandlers(): void {
  // preload 전용 스냅샷 — onChanged 등록 즉시 현재 목록 한 번 (계약서 TAB_CHANNELS.list 주석)
  ipcMain.handle(TAB_CHANNELS.list, (event): TabInfo[] => {
    const windowId = registry.windowOfTab(event.sender.id)
    return windowId === undefined ? [] : tabInfosOf(windowId)
  })

  ipcMain.handle(TAB_CHANNELS.open, async (event, repoPath: unknown): Promise<WindowOpenResult> => {
    const senderWindowId = registry.windowOfTab(event.sender.id)
    const senderWindow = windowOfView.get(event.sender.id)
    // 탭이 닫히는 중의 늦은 IPC — 조용히 버린다 (E15b 관례). 실패가 아니라 무의미다
    if (senderWindowId === undefined || senderWindow === undefined) return { ok: true }
    if (repoPath === null) {
      // 빈 탭 (⌘T·탭바 +) — 중복 판정이 없다: 빈 탭은 몇 개든 열 수 있다
      const view = createTab(senderWindow, senderWindowId, null)
      registry.setActiveTab(senderWindowId, view.webContents.id)
      showActiveTab(senderWindowId)
      return { ok: true }
    }
    // 이 인자도 렌더러 입력이다 — window:open·repo:open과 **같은 검증**을 거친다. 검증 없이
    // 씨앗으로 넣으면 그 탭이 임의 디렉터리에서 git을 돌리는 통로가 된다
    const opened = await openRepoPath(assertAbsoluteRepoPath(repoPath))
    // await 틈에 sender의 창이 닫혔으면 조용히 버린다 (E15c 리뷰 I-1 — E15b 늦은 IPC 관례).
    // 재검사 없이 진입 시 잡아 둔 senderWindow로 createTab을 부르면, createRepoView가
    // webContents를 만든 뒤 addChildView/addTab이 던져 그 뷰가 어느 맵에도 없이
    // destroyed:false로 앱 종료까지 잔류한다(고아 렌더러 프로세스 — 리뷰어 실측:
    // 한 탭짜리 창에서 tabs.open 직후 같은 마이크로태스크의 tabs.close(자기 탭)로 재현).
    // 두 조건이 다 필요하다: close()가 'closed'(registry 정리)와 실물 파괴(isDestroyed)를
    // 같은 틱에 끝낸다는 보장이 없다 — 어느 쪽이 먼저 관측되든 여기서 걸린다
    if (senderWindow.isDestroyed() || registry.getWindow(senderWindowId) === undefined) {
      return { ok: true }
    }
    if (!opened.ok) return opened
    // 어느 창에든 이미 열려 있으면 새 탭을 만들지 않고 그 탭으로 데려간다 (스펙 §3 — "이
    // 저장소를 보여 달라"는 요청은 전부 한 곳을 지나고, 이미 있으면 거기로 데려간다)
    const existing = registry.findTabByRepoPath(opened.path)
    if (existing !== undefined) {
      revealExistingTab(existing)
      return { ok: true }
    }
    const view = createTab(senderWindow, senderWindowId, opened.path)
    registry.setActiveTab(senderWindowId, view.webContents.id)
    showActiveTab(senderWindowId)
    return { ok: true }
  })

  // 전환기 클릭의 판정 절반 (E15c Task 6 — 스펙 §3 첫 행). "이미 열려 있나"만 정본(레지스트리)에
  // 묻고, false면 렌더러가 기존 갈아타기 경로(스토어 openRepository — E15a의 상태 정리·최근 목록
  // 정책이 전부 거기 있다)로 잇는다. git을 안 돌린다 — 비교는 레지스트리의 정규화 루트와의
  // 문자열 일치고, 호출자(전환기·RepoPicker 최근 목록)는 main이 정규화해 준 경로만 든다.
  //
  // 판정(여기 false)과 실행(렌더러의 repo:open) 사이에 다른 탭이 같은 저장소를 여는 경합은
  // 이론상 있다 — 지면 같은 저장소가 두 탭에 남는다. 막지 않기로 한 근거: ① 그 틈은 IPC 왕복
  // 하나 크기인데 끼어들려면 **다른 창에서의 사용자 조작**이 그 안에 들어와야 한다 ② 같은 모양의
  // 틈이 tabs:open·window:open 안에도 이미 있다(await openRepoPath 동안 레지스트리가 변한다) —
  // 판정/실행 분리가 새 종류의 경합을 만드는 게 아니다 ③ 져도 값이 깨지는 곳이 없다(감시·pty·
  // 설정 전부 탭 단위라 두 탭이 같은 저장소를 봐도 각자 정합하고, 한쪽이 떠나면 저절로 풀린다)
  ipcMain.handle(TAB_CHANNELS.showExisting, (_event, repoPath: unknown): boolean => {
    const existing = registry.findTabByRepoPath(assertAbsoluteRepoPath(repoPath))
    if (existing === undefined) return false
    revealExistingTab(existing)
    return true
  })

  // 크래시 탭 클릭이 곧 복구다 (E15e — 새 IPC 없음, 스펙 §2): showActiveTab의 분기가 크래시
  // 탭이면 reload 후 세운다. 이미 활성인 크래시 탭도 setActiveTab은 무변화로 스치지만
  // showActiveTab은 돌므로 복구가 된다. cause는 'user' — 클릭 복구는 자동 재시동 상한(리뷰
  // I-1)과 무관하게 **언제나** reload다(스펙 §3: 유한해야 하는 것은 앱의 추측뿐이다)
  ipcMain.handle(TAB_CHANNELS.activate, (event, tabId: unknown) => {
    const id = assertTabId(tabId)
    const windowId = registry.windowOfTab(event.sender.id)
    if (windowId === undefined) return
    if (registry.windowOfTab(id) !== windowId) return
    registry.setActiveTab(windowId, id)
    showActiveTab(windowId, 'user')
  })

  ipcMain.handle(TAB_CHANNELS.close, (event, tabId: unknown) => {
    const id = assertTabId(tabId)
    const windowId = registry.windowOfTab(event.sender.id)
    if (windowId === undefined) return
    if (registry.windowOfTab(id) !== windowId) return
    closeTab(id)
  })
}

/**
 * 시작할 때 창과 그 안의 탭들을 만든다 — 껐을 때 그대로, 순서·활성 탭까지 (E15b → E15c 스펙 §6).
 *
 * 저장된 목록이 없으면(첫 실행) 빈 창 하나 — 예전 동작과 같다.
 */
async function createStartupWindows(): Promise<void> {
  const restored = readWindows()
  // GIT_GUI_E2E_REPO가 있으면 **저장된 목록으로 창을 여럿 만들지 않는다** — 기존 E2E 143건이
  // 전부 "창 하나, 그 저장소" 하나를 전제로 짜여 있어 복원이 창을 더 만들면 대량으로 깨진다.
  //
  // 다만 레이아웃 기억은 저장소 목록과 **다른 문제라** 첫 창의 레이아웃은 그대로 복원한다.
  // E15b가 rightWidth·leftCollapsed를 settings.json에서 이 목록으로 옮겼으므로, 여기서
  // 씨앗으로 주지 않으면 재시작 지속성 E2E 2건(:373 우측 폭 · :3500 좌측 접힘)이 영영 빨갛다 —
  // 창 하나짜리 재시작도 복원 경로를 타야 한다. (플랜은 이 블록 전체를 환경변수로 감싸라고
  // 했는데, 그러면 그 2건이 돌아올 길이 없다 — 실측으로 갈랐다)
  const seededRepo = process.env.GIT_GUI_E2E_REPO
  if (seededRepo !== undefined) {
    createWindow({ repoPath: seededRepo, layout: restored[0]?.layout ?? {} })
    return
  }
  let created = 0
  for (const saved of restored) {
    // 탭마다 경로를 먼저 검증한다 — 각 repoPath는 사람이 편집할 수 있는 디스크 파일에서 왔고
    // 그대로 git의 cwd가 된다: repo.open·window.open과 **같은 검증**을 거치되, 여기서는 던지지
    // 않고 그 탭만 건너뛴다(손상 항목 하나가 앱 시작을 통째로 막으면 안 된다 — E15b 관례).
    // savedIndex를 들고 가는 이유: 탭이 버려지면 저장된 activeTab 인덱스가 어긋난다 — 살아남은
    // 탭이 원래 몇 번이었는지로 활성을 다시 찾는다
    const tabs: Array<{ repoPath: string | null; savedIndex: number }> = []
    for (const [savedIndex, tab] of saved.tabs.entries()) {
      if (tab.repoPath === null) {
        // 빈 탭(RepoPicker)은 검증할 경로가 없다 — 그대로 돌아온다
        tabs.push({ repoPath: null, savedIndex })
        continue
      }
      if (!isAbsolute(tab.repoPath)) continue
      const opened = await openRepoPath(tab.repoPath)
      // 없어진 저장소는 그 탭을 만들지 않고 넘어간다. 알림은 띄우지 않는다 — 시작하자마자
      // 배너를 보는 건 성가시고, 그 경로는 최근 목록에서도 곧 빠진다
      if (!opened.ok) continue
      tabs.push({ repoPath: opened.path, savedIndex })
    }
    // 탭이 전부 사라진 창은 만들지 않는다 — 탭 없는 창은 없다(sanitize·registry와 같은 판단)
    if (tabs.length === 0) continue
    const { window, windowId, view } = createWindow({
      repoPath: tabs[0]!.repoPath,
      layout: saved.layout,
    })
    const tabIds = [view.webContents.id]
    for (const tab of tabs.slice(1)) {
      tabIds.push(createTab(window, windowId, tab.repoPath).webContents.id)
    }
    // 활성 탭 복원 — 저장된 인덱스의 탭이 살아남았으면 그 탭, 사라졌으면 첫 탭(sanitize가 범위
    // 밖을 0으로 접는 것과 같은 정책). showActiveTab은 활성이 첫 탭이어도 부른다 — 뷰는 만들어질
    // 때 전부 보이는 상태라(createTab은 가시성을 손대지 않는다) 비활성 뷰를 숨기는 일이 남아 있다
    const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.savedIndex === saved.activeTab))
    registry.setActiveTab(windowId, tabIds[activeIndex]!)
    showActiveTab(windowId)
    created += 1
  }
  // 저장된 창이 없거나 전부 사라졌으면 빈 창 하나 — 창 없이 시작하면 macOS에서 되살릴 길이
  // 독 아이콘 클릭(activate)뿐이다
  if (created === 0) createWindow()
}

// macOS에서는 앱 실행 자체가 활성화되며 포커스를 훔칠 수 있다 — E2E에서는 dock 아이콘째 숨긴다
if (isE2E && !isE2EShow) app.dock?.hide()

app
  .whenReady()
  .then(async () => {
    registerGitHandlers(registry)
    registerSettingsHandlers(registry, pushLayoutToSiblings)
    registerHostingHandlers()
    registerTerminalHandlers()
    registerWindowHandlers()
    registerTabHandlers()
    // 종료 직전의 스냅샷을 남긴다 (E15b). ⌘Q(app.quit)는 before-quit → 창 닫기 순서라 이
    // 시점의 레지스트리에 창들이 아직 다 있다 (실측: Playwright의 app.close()도 main에서
    // app.quit()을 부르므로 그대로 발화한다).
    //
    // 이제 여기는 **유일한 영속 지점이 아니라 마지막 한 번**이다 (E15b 리뷰 I-1) — 디바운스가
    // 아직 안 터진 레이아웃까지 확실히 담기게 한다. 창을 하나씩 다 닫고 종료해 목록이 비면
    // saveWindows가 무시하므로 디스크의 마지막 목록이 그대로 남는다(그 함수의 주석 참조)
    app.on('before-quit', () => {
      persistLayout.dispose()
      saveWindows(registry.snapshot())
      // 여기서부터 목록을 얼린다 — 뒤이어 창들이 하나씩 닫히는 것은 사용자의 조작이 아니다
      quitting = true
    })
    app.on('activate', () => {
      if (BaseWindow.getAllWindows().length === 0) createWindow()
    })
    // GIT_GUI_E2E_REPO는 "**시작할 때** 이 저장소를 열어라"지 "새 창마다 열어라"가 아니다.
    // 예전엔 repo:initial-path가 씨앗이 없을 때마다 이 환경변수로 되돌아가, ⌘N이 만든 빈 창이
    // E2E에서만 조용히 그 저장소를 열었다 — 빈 창(RepoPicker) 경로가 E2E로 검증 불가능해진다
    // (E15b Task 5 실측: 최근 목록 테스트가 여기서 빨갛게 났다). 씨앗은 첫 창에만 준다
    await createStartupWindows()
  })
  .catch((error) => {
    console.error('앱 초기화 실패:', error)
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
