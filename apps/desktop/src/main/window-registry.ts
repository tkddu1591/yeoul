import type { WindowLayout } from '@git-gui/ipc-contract'

/**
 * 창의 정본 (E15b → E15c: 한 겹 깊어졌다 — 창이 저장소 하나가 아니라 탭들을 갖는다). main만 안다.
 *
 * electron을 import하지 않는다 — 창과 탭을 숫자 id로만 다뤄 단위 테스트가 된다.
 * 실제 BaseWindow·WebContentsView와의 연결은 index.ts가 한다(TerminalManager가 IPC를 모르는
 * 것과 같은 분리).
 *
 * **창 id와 탭 id는 다른 이름 공간이다** — 창 id는 index.ts가 발급하는 임의 숫자(뷰가 여럿이라
 * webContents.id를 창 키로 못 쓴다), 탭 id는 뷰의 webContents.id다. E15b의 sender.id 배선
 * (git-handlers·terminal-handlers·settings)은 키의 의미만 창→탭으로 바뀌고 그대로 산다
 */
export interface WindowState {
  /** 뷰(webContents) id — 배열 순서가 곧 탭 순서 */
  tabs: number[]
  /** tabs의 원소여야 한다. 탭이 붙기 전 과도기(addWindow 직후)에만 -1 */
  activeTab: number
  /** 창 단위 (스펙 §4 — 탭마다가 아니다) */
  layout: WindowLayout
}

/**
 * 레지스트리가 바뀐 이유 (E15b 리뷰 I-1) — 영속 정책이 둘로 갈린다.
 *
 * - `windows` — 창·탭이 늘거나 줄거나 활성이 바뀌거나 다른 저장소로 갈아탔다.
 *   사람의 조작이라 드물다: **즉시** 쓴다.
 * - `layout` — 도크 높이 드래그처럼 초당 여러 번 온다: **디바운스**한다.
 *
 * 둘을 안 가르고 전부 디바운스하면, 창 둘을 연달아 닫는 동안(디바운스 창 안) 종료가 겹칠 때
 * 닫은 창이 목록에 남는다. 반대로 전부 즉시 쓰면 드래그 한 번에 writeFileSync가 수십 번이다
 */
export type WindowChangeKind = 'windows' | 'layout'

export interface WindowRegistry {
  addWindow(windowId: number, layout: WindowLayout): void
  removeWindow(windowId: number): void
  getWindow(windowId: number): WindowState | undefined
  /** 탭을 창에 더한다 — index는 생략 시 끝. 같은 탭을 두 창에 넣으면 throw(프로그래밍 오류다) */
  addTab(windowId: number, tabId: number, repoPath: string | null, index?: number): void
  /** 탭을 뗀다. 마지막 탭이었으면 창 항목도 지운다(창 닫힘과 동치) */
  removeTab(tabId: number): void
  setActiveTab(windowId: number, tabId: number): void
  /**
   * 탭 렌더러의 크래시 표시 (E15e — E15c 리뷰 I-2). main의 render-process-gone이 true로,
   * did-finish-load(reload 완료)가 false로 부른다. 없는 탭·같은 값은 무해·무발화.
   *
   * **활성 탭이 크래시하면 산 이웃이 활성을 잇는다** — removeTab 승계와 같은 오른쪽 우선.
   * 이 승계가 여기(레지스트리) 몫인 이유: "activeTab은 쓸 수 있는 탭"이라는 불변식의 주인이
   * 레지스트리고, 후보에서 크래시 탭을 걸러야 하는데 크래시 여부도 레지스트리만 안다.
   * 산 이웃이 없으면(유일 탭·전부 크래시) 활성을 남겨 둔다 — main이 reload로 재시동한다.
   * 크래시는 영속되지 않는다(snapshot 무변) — 재시작은 어차피 전체 reload다
   */
  setCrashed(tabId: number, crashed: boolean): void
  isTabCrashed(tabId: number): boolean
  /** 탭이 갈아탄 저장소 — E15b setRepoPath의 후계 */
  setTabRepoPath(tabId: number, repoPath: string | null): void
  setLayout(windowId: number, patch: WindowLayout): void
  /** 탭 id → 그 탭이 사는 창 id */
  windowOfTab(tabId: number): number | undefined
  /** 탭 id → 그 탭이 사는 창의 레이아웃 (스펙 §4 — 레이아웃은 창 단위인데 IPC sender는 탭이다).
   * windowOfTab→getWindow 두 단계 조회가 settings:get-sync·씨앗 복사에 반복돼 헬퍼로 접었다 */
  layoutOfTab(tabId: number): WindowLayout | undefined
  /** 이 저장소를 연 탭 — 모든 창을 훑는다. { windowId, tabId } 또는 undefined */
  findTabByRepoPath(repoPath: string): { windowId: number; tabId: number } | undefined
  getTabRepoPath(tabId: number): string | null | undefined
  /** 등록 순서. 복원이 이 순서로 창을 만든다.
   *
   * ⚠️ 여기서만 `activeTab`이 **탭 id가 아니라 배열 인덱스**다 — id(webContents.id)는 재시작하면
   * 무의미해서 영속 경계에서 변환한다. 복원이 인덱스로 활성 탭을 고른다 */
  snapshot(): Array<{
    tabs: Array<{ repoPath: string | null }>
    activeTab: number
    layout: WindowLayout
  }>
}

/**
 * `onChange`는 이 레지스트리가 바뀔 때마다 불린다 (E15b 리뷰 I-1).
 *
 * 왜 콜백인가: 예전엔 영속 지점이 `before-quit` 한 번뿐이라, 그 시점에 창이 없으면
 * 창별 레이아웃이 통째로 증발했다(실측: `settings-after-close-then-quit={"windows":[]}`).
 * 영속을 호출부 네 곳에 손으로 흩으면 새 변경 경로가 생길 때마다 빠뜨린다 — 정본이 스스로 알린다
 */
export function createWindowRegistry(
  onChange: (kind: WindowChangeKind) => void = () => {},
): WindowRegistry {
  // Map은 삽입 순서를 보존한다 — snapshot()의 순서 보장이 여기서 온다.
  // 두 맵의 정합(탭이 정확히 한 창의 tabs에 있고 tabEntries에도 있다)은 addTab/removeTab/
  // removeWindow만 지나므로 거기서 지킨다 — 탭 검색·windowOfTab이 O(1)이 되는 대가다
  const windows = new Map<number, WindowState>()
  const tabEntries = new Map<number, { windowId: number; repoPath: string | null; crashed: boolean }>()

  /**
   * 활성 승계 — 떠나는 자리(fromIndex)에서 가장 가까운 오른쪽 후보, 없으면 가장 가까운 왼쪽
   * (브라우저 탭 관례). removeTab(탭이 떠날 때)과 setCrashed(활성이 죽을 때)가 **이 한 함수**를
   * 공유한다 (E15e) — 같은 규칙이 두 곳에서 다르게 굳으면 크래시 탭으로 승계해 창이 도로
   * 인질이 되는 종류의 어긋남이 생긴다. eligible이 후보를 거른다(산 탭만)
   */
  function pickSuccessor(
    tabs: number[],
    fromIndex: number,
    eligible: (tabId: number) => boolean,
  ): number | undefined {
    for (let i = fromIndex + 1; i < tabs.length; i++) if (eligible(tabs[i]!)) return tabs[i]
    for (let i = fromIndex - 1; i >= 0; i--) if (eligible(tabs[i]!)) return tabs[i]
    return undefined
  }

  return {
    addWindow(windowId, layout) {
      // layout을 복사해 담는다 — 호출자가 넘긴 객체(씨앗·디스크 캐시)를 나중에 고쳐도 이 창이 안 흔들린다
      windows.set(windowId, { tabs: [], activeTab: -1, layout: { ...layout } })
      onChange('windows')
    },
    removeWindow(windowId) {
      const state = windows.get(windowId)
      // 실제로 지웠을 때만 알린다 — 없는 id를 지우는 것은 변화가 아니다.
      // (removeTab이 마지막 탭과 함께 창을 이미 지운 뒤 BaseWindow 'closed'가 또 부르는 경로가
      // 정상적으로 여기 온다 — 조용히 무시해야 이중 알림·이중 저장이 없다)
      if (state === undefined) return
      // 정합 — 창만 지우고 탭 색인을 남기면 죽은 탭이 검색·조회에 계속 걸린다
      for (const tabId of state.tabs) tabEntries.delete(tabId)
      windows.delete(windowId)
      onChange('windows')
    },
    getWindow(windowId) {
      return windows.get(windowId)
    },
    addTab(windowId, tabId, repoPath, index) {
      const state = windows.get(windowId)
      // 여기 둘은 늦은 IPC가 아니라 프로그래밍 오류다(호출자가 main 자신뿐) — 조용히 넘기면
      // 두 맵의 정합이 깨진 채 굴러가 엉뚱한 창의 탭을 닫는 식으로 멀리서 터진다. 즉시 던진다
      if (state === undefined) throw new Error(`없는 창(${windowId})에 탭을 넣을 수 없어요`)
      if (tabEntries.has(tabId)) throw new Error(`탭(${tabId})은 이미 다른 창에 있어요 — 뷰는 한 창에만 산다`)
      state.tabs.splice(index ?? state.tabs.length, 0, tabId)
      tabEntries.set(tabId, { windowId, repoPath, crashed: false })
      // 첫 탭이 활성이 된다 — 이후 추가는 활성을 훔치지 않는다(활성 전환은 setActiveTab의 일)
      if (state.activeTab === -1) state.activeTab = tabId
      onChange('windows')
    },
    removeTab(tabId) {
      const entry = tabEntries.get(tabId)
      if (entry === undefined) return
      // 정합 불변식: tabEntries에 있으면 그 창과 tabs 배열에 반드시 있다 (addTab/removeWindow가 지킨다)
      const state = windows.get(entry.windowId)!
      const removedAt = state.tabs.indexOf(tabId)
      if (state.tabs.length === 1) {
        // 마지막 탭이 떠나면 창 항목도 지운다 — 탭 없는 창은 없다(창 닫힘과 동치).
        // 남기면 snapshot에 빈 창이 실려 복원이 껍데기 창을 만든다
        windows.delete(entry.windowId)
      } else if (state.activeTab === tabId) {
        // 활성 탭이 떠나면 이웃이 잇는다 — 오른쪽 우선, 없으면 왼쪽(브라우저 탭 관례).
        // **산 이웃 우선** (E15e): 크래시 탭으로 승계하면 그 창이 도로 인질이다. 남은 탭이
        // 전부 크래시면 관례대로라도 잇는다 — activeTab은 tabs의 원소여야 한다는 불변식이 먼저다
        const living = pickSuccessor(state.tabs, removedAt, (id) => !tabEntries.get(id)!.crashed)
        state.activeTab = living ?? pickSuccessor(state.tabs, removedAt, () => true)!
      }
      tabEntries.delete(tabId)
      state.tabs.splice(removedAt, 1)
      onChange('windows')
    },
    setActiveTab(windowId, tabId) {
      const state = windows.get(windowId)
      // 창이 닫히는 중에 늦은 IPC가 올 수 있다 — 조용히 무시한다(알리지도 않는다)
      if (state === undefined) return
      // tabId는 렌더러 입력이다 — 다른 창의 탭 id로 이 창의 활성을 바꾸는 통로가 되면 안 된다
      if (!state.tabs.includes(tabId)) return
      // 이미 활성인 탭의 재활성화는 변화가 아니다 — 탭 클릭마다 즉시 쓰기('windows')가 나가면 안 된다
      if (state.activeTab === tabId) return
      state.activeTab = tabId
      onChange('windows')
    },
    setCrashed(tabId, crashed) {
      const entry = tabEntries.get(tabId)
      // 크래시·로드 완료 이벤트가 닫힌 탭보다 늦게 올 수 있다 — 없는 탭은 조용히 무시
      if (entry === undefined) return
      // 같은 값 재표시는 변화가 아니다 — 산 탭의 정상 로드 완료(false)마다 디스크 쓰기·push가
      // 나가면 안 된다 (setActiveTab의 "이미 활성" 무발화와 같은 판단)
      if (entry.crashed === crashed) return
      entry.crashed = crashed
      const state = windows.get(entry.windowId)!
      if (crashed && state.activeTab === tabId) {
        // 인질 해방의 장부 절반 — 활성이 죽으면 산 이웃이 잇는다(오른쪽 우선, removeTab과 공유).
        // 산 이웃이 없으면 활성을 남겨 둔다 — main이 그 뷰를 reload로 재시동한다.
        // 해제(false)는 활성을 되돌리지 않는다 — 복구는 조용해야 한다(활성 안 훔침 관례)
        const living = pickSuccessor(
          state.tabs,
          state.tabs.indexOf(tabId),
          (id) => !tabEntries.get(id)!.crashed,
        )
        if (living !== undefined) state.activeTab = living
      }
      onChange('windows')
    },
    isTabCrashed(tabId) {
      return tabEntries.get(tabId)?.crashed === true
    },
    setTabRepoPath(tabId, repoPath) {
      const entry = tabEntries.get(tabId)
      if (entry === undefined) return
      entry.repoPath = repoPath
      onChange('windows')
    },
    setLayout(windowId, patch) {
      const state = windows.get(windowId)
      if (state === undefined) return
      // 렌더러는 바뀐 필드만 보낸다 — 병합한다
      state.layout = { ...state.layout, ...patch }
      onChange('layout')
    },
    windowOfTab(tabId) {
      return tabEntries.get(tabId)?.windowId
    },
    layoutOfTab(tabId) {
      const entry = tabEntries.get(tabId)
      if (entry === undefined) return undefined
      return windows.get(entry.windowId)?.layout
    },
    findTabByRepoPath(repoPath) {
      for (const [tabId, entry] of tabEntries) {
        // 빈 탭(repoPath === null)은 **어떤 인자로도** 걸리지 않는다 (E15b 리뷰 N-7 계승).
        // 시그니처가 string이라 정상 경로에선 null이 못 오지만, 호출부의 인자는 IPC 경계 너머에서
        // 오는 값이라 캐스팅 하나로 타입이 무너진다. 걸리면 중복 차단이 "이미 그 저장소를 연
        // 탭"으로 오인해 엉뚱한 빈 탭을 활성화한다
        if (entry.repoPath !== null && entry.repoPath === repoPath) {
          return { windowId: entry.windowId, tabId }
        }
      }
      return undefined
    },
    getTabRepoPath(tabId) {
      return tabEntries.get(tabId)?.repoPath
    },
    snapshot() {
      // 얕은 복사로는 부족하다 — layout까지 복사해야 받은 쪽의 수정이 안 샌다.
      // activeTab은 여기서만 id→인덱스 변환이다(인터페이스 주석 참조). 탭이 아직 없는 과도기
      // 창(indexOf가 -1)은 0으로 접는다 — Task 8의 sanitize가 범위 밖을 0으로 접는 것과 같은 정책
      return [...windows.values()].map((state) => ({
        tabs: state.tabs.map((tabId) => ({ repoPath: tabEntries.get(tabId)!.repoPath })),
        activeTab: Math.max(0, state.tabs.indexOf(state.activeTab)),
        layout: { ...state.layout },
      }))
    },
  }
}
