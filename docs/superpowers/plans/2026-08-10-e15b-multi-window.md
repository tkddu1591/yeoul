# E15b 여러 창 + 네이티브 탭 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 저장소를 여러 창(맥에서는 탭)으로 동시에 열고, 껐다 켜면 그 창들이 돌아오게 한다.

**Architecture:** main이 창의 정본을 갖는 `window-registry`를 새로 둔다. "창이 하나"라는 전제가 박힌 세 곳(감시·터미널 상한·설정)을 그 레지스트리 위에서 창별로 바꾼다. 설정 분리는 main에서만 일어나고 **렌더러는 구분을 모른다** — `event.sender`로 창을 찾아 합쳐 주고 갈라 저장한다. 네이티브 탭은 `tabbingIdentifier` 한 줄로 OS에 맡긴다.

**Tech Stack:** TypeScript · Electron 35.7.5 · React 19 · zustand · react-aria-components · Vitest(단위) · Playwright Electron 1.61.1(E2E)

## Global Constraints

- **정본 스펙:** `docs/superpowers/specs/2026-08-10-e15b-multi-window-design.md`. 어긋나게 구현했다면 플랜에 편차로 기록한다.
- **언어:** 모든 주석·커밋 메시지·UI 문구는 한글. 주변 코드의 밀도를 따른다 — 이 저장소의 주석은 "왜"를 실측 숫자와 함께 적는다.
- **`pnpm lint`가 게이트다 (E14b).** `react-hooks` 규칙이 렌더러에 걸려 있고 **에러 0**이 조건이다. **`set-state-in-effect`는 에러다** — "무언가 바뀌면 로컬 상태를 리셋"은 이펙트가 아니라 **렌더 중 파생**으로 쓴다(`App.tsx:409`의 `boundRepo` 관용구가 본보기).
- **`useMemo`·`useCallback` 사용 지양** (사용자 전역 지침 — React Compiler에 위임).
- **E2E는 반드시 단일 포그라운드 Bash 호출 + `timeout: 600000`.** 기본 120초 상한은 실행을 조용히 백그라운드로 보내고 멈춘다.
- **`npx playwright test`는 빌드하지 않는다.** `pnpm --filter @git-gui/desktop e2e`만 `electron-vite build &&`가 붙는다. 소스를 고친 뒤 `npx playwright test`를 돌리면 낡은 번들을 테스트하는 것이고 반증은 무의미해진다.
- **E2E 환경변수:** `GIT_GUI_E2E_REPO`(저장소 즉시 열기) · `GIT_GUI_USER_DATA`(설정 격리 — **하네스가 없으면 자동 주입한다**, `e2e/harness.ts:33`) · `GIT_GUI_E2E_SHOW=1`(실제 창).
- **OS 전체 화면 캡처 금지.** 사용자의 다른 창에 사적 정보가 있다. Playwright 창 캡처만 쓰고 `/private/tmp/claude-501/-Users-sangyeop-kim-git-gui/b4ef6d32-042d-440c-8252-b8944659aa01/scratchpad/`에 쓴다.
- **사용자의 실행 중인 dev 앱을 건드리거나 재시작하지 않는다.**
- **기준 게이트(시작 시점):** lint **0 errors / 5 warnings** · typecheck 6/6 · 루트 `pnpm test` **639** · build 성공 · e2e **135**.
- **알려진 플레이크(오귀속 금지):** `packages/git-adapter` 단위 테스트가 루트 전체 병렬 실행에서 3회 중 2회꼴로 1건 타임아웃한다 — 매번 다른 테스트·항상 정확히 15000ms·단독 실행은 242/242 초록. 실제 git 서브프로세스를 띄우는 탓이고 이 에픽과 무관하다.
- **`packages/**`는 eslint 범위 밖이다** (E14b가 렌더러로 좁혔다). 거기 적는 `eslint-disable`은 죽은 주석이 되니 쓰지 않는다.

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| **생성** `apps/desktop/src/main/window-registry.ts` | 창의 정본 — 저장소·레이아웃·창 찾기. electron 무의존(순수) |
| **생성** `apps/desktop/test/window-registry.test.ts` | 위 단위 테스트 |
| **수정** `packages/ipc-contract/src/index.ts` | `WindowLayout` 타입 · `AppSettings` 분리 · `windows` 영속 필드 · `WINDOW_CHANNELS.open` · `sanitizeSettings` 방어 |
| **수정** `apps/desktop/src/main/index.ts` | `createWindow(seed)` 재호출 가능화 · `tabbingIdentifier` · 레지스트리 배선 · 복원 · `before-quit` 저장 |
| **수정** `apps/desktop/src/main/settings.ts` | 창별/앱공용 분리 저장 · `readWindows`/`saveWindows` |
| **수정** `apps/desktop/src/main/git-handlers.ts` | `stopWatching` 창별 `Map` · 해제 순서 · `registerRepoPath`가 레지스트리 갱신 |
| **수정** `apps/desktop/src/main/terminal-handlers.ts` | 창별 상한 8 |
| **수정** `apps/desktop/src/main/terminal-manager.ts` | 전역 `MAX_SESSIONS` 검사 제거 |
| **수정** `apps/desktop/src/main/app-menu.ts` (없으면 생성) | 창 메뉴 "모든 창 병합" |
| **수정** `apps/desktop/src/preload/index.ts` | `window.open` 노출 |
| **수정** `apps/desktop/src/renderer/src/components/RepoSwitcher.tsx` | ⌥클릭 · 우클릭 메뉴 |
| **수정** `apps/desktop/src/renderer/src/components/RepoPicker.tsx` | 최근 목록 |
| **수정** `apps/desktop/src/renderer/src/App.tsx` | ⌘N · 배선 |
| **수정** `apps/desktop/src/renderer/src/components/WorktreesPanel.tsx` | "새 창에서 열기" |
| **수정** `apps/desktop/e2e/harness.ts` | 두 번째 창 대기 헬퍼 |
| **수정** `apps/desktop/e2e/smoke.spec.ts` | E2E 6건 |

---

### Task 1: 여러 창 E2E가 되는지부터 확인한다 — 레지스트리 + `window:open` + 최소 E2E

> **이 태스크가 이 에픽의 유일한 미지수를 닫는다.** E2E 135건이 전부 창 하나를 전제로 짜여 있고
> `harness.ts`는 `firstWindow()` 기반이며, E2E는 창을 숨긴 채 띄운다(`GIT_GUI_E2E_SHOW`가 없으면).
> API는 있다(실측: Playwright 1.61.1 `types.d.ts:17131` `windows(): Array<Page>` · `:17125`
> `waitForEvent('window')`). **숨김 창·userData 격리와 맞물리는지가 미지수다.**
>
> **Step 6에서 두 창 E2E가 안 되면 거기서 멈추고 보고한다.** 나머지 7태스크가 전부 이 위에 선다.
> 우회를 지어내지 말고, 무엇이 어떻게 실패했는지 출력 그대로 적는다.

**Files:**
- Create: `apps/desktop/src/main/window-registry.ts` · `apps/desktop/test/window-registry.test.ts`
- Modify: `packages/ipc-contract/src/index.ts` (`WindowLayout` · `WINDOW_CHANNELS.open`)
- Modify: `apps/desktop/src/main/index.ts` (`createWindow(seed)` · 레지스트리 · 핸들러)
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/e2e/harness.ts` · `apps/desktop/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: `WindowLayout` · `WindowState` · `createWindowRegistry(): WindowRegistry` (아래 시그니처) · `window.gitApi.window.open(repoPath: string | null): Promise<void>` · `WINDOW_CHANNELS.open = 'window:open'` · e2e 헬퍼 `waitForSecondWindow(app)`. Task 2~8 전부가 쓴다.
- Consumes: E15a의 `assertAbsoluteRepoPath`(`main/repo-open-guard.ts:25`) — `window:open`의 경로 검증에 재사용.

- [ ] **Step 1: 레지스트리의 실패하는 테스트를 쓴다**

`apps/desktop/test/window-registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createWindowRegistry } from '../src/main/window-registry'

describe('창 레지스트리 (E15b)', () => {
  it('창을 등록하고 id로 찾는다', () => {
    const registry = createWindowRegistry()
    registry.add(1, { repoPath: '/a', layout: { leftCollapsed: true } })
    expect(registry.get(1)).toEqual({ repoPath: '/a', layout: { leftCollapsed: true } })
  })

  it('없는 id는 undefined', () => {
    expect(createWindowRegistry().get(99)).toBeUndefined()
  })

  it('같은 저장소를 연 창을 찾는다 — 중복 열기 차단의 근거', () => {
    const registry = createWindowRegistry()
    registry.add(1, { repoPath: '/a', layout: {} })
    registry.add(2, { repoPath: '/b', layout: {} })
    expect(registry.findByRepoPath('/b')).toBe(2)
    expect(registry.findByRepoPath('/zzz')).toBeUndefined()
  })

  it('저장소 없는 창(⌘N 빈 창)은 findByRepoPath에 안 걸린다', () => {
    const registry = createWindowRegistry()
    registry.add(1, { repoPath: null, layout: {} })
    // null을 찾아 달라고 할 수 없다 — 시그니처가 string만 받는다. 빈 창 둘이 서로를 덮지 않는지만 본다
    registry.add(2, { repoPath: null, layout: {} })
    expect(registry.snapshot()).toHaveLength(2)
  })

  it('창 안에서 저장소를 바꾸면 갱신된다 — E15a 전환기로 바꿔도 main이 안다', () => {
    const registry = createWindowRegistry()
    registry.add(1, { repoPath: '/a', layout: {} })
    registry.setRepoPath(1, '/b')
    expect(registry.findByRepoPath('/a')).toBeUndefined()
    expect(registry.findByRepoPath('/b')).toBe(1)
  })

  it('레이아웃은 병합한다 — 렌더러가 바뀐 필드만 보낸다', () => {
    const registry = createWindowRegistry()
    registry.add(1, { repoPath: null, layout: { leftCollapsed: true, rightWidth: 300 } })
    registry.setLayout(1, { rightWidth: 420 })
    expect(registry.get(1)?.layout).toEqual({ leftCollapsed: true, rightWidth: 420 })
  })

  it('없는 창에 써도 죽지 않는다 — 창이 닫히는 중에 설정이 날아올 수 있다', () => {
    const registry = createWindowRegistry()
    expect(() => registry.setLayout(99, { rightWidth: 1 })).not.toThrow()
    expect(() => registry.setRepoPath(99, '/a')).not.toThrow()
  })

  it('창을 지우면 스냅샷에서 빠진다', () => {
    const registry = createWindowRegistry()
    registry.add(1, { repoPath: '/a', layout: {} })
    registry.add(2, { repoPath: '/b', layout: {} })
    registry.remove(1)
    expect(registry.snapshot()).toEqual([{ repoPath: '/b', layout: {} }])
  })

  it('스냅샷은 등록 순서다 — 복원이 그 순서로 창을 만든다', () => {
    const registry = createWindowRegistry()
    registry.add(7, { repoPath: '/first', layout: {} })
    registry.add(3, { repoPath: '/second', layout: {} })
    expect(registry.snapshot().map((w) => w.repoPath)).toEqual(['/first', '/second'])
  })

  it('스냅샷은 복사본이다 — 받은 쪽이 고쳐도 레지스트리가 안 바뀐다', () => {
    const registry = createWindowRegistry()
    registry.add(1, { repoPath: '/a', layout: { rightWidth: 300 } })
    const snapshot = registry.snapshot()
    snapshot[0]!.layout.rightWidth = 999
    expect(registry.get(1)?.layout.rightWidth).toBe(300)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd "/Users/sangyeop_kim/git gui" && npx vitest run --root apps/desktop test/window-registry.test.ts`
Expected: FAIL — `Failed to resolve import ".../window-registry"`

- [ ] **Step 3: 계약서에 타입과 채널을 더한다**

`packages/ipc-contract/src/index.ts`. `AppSettings` **바로 위**에:

```ts
/**
 * 창별 레이아웃 (E15b) — 앱 공용 설정과 갈라진다.
 * 렌더러는 이 구분을 모른다: main이 `settings:get-sync`에서 앱 공용과 합쳐 평평하게 돌려주고,
 * `settings:set`에서 성격에 따라 갈라 저장한다. 소비처 코드는 그대로다
 */
export interface WindowLayout {
  /** 좌측 사이드(변경·브랜치·워크트리 탭) 접힘 (E12) */
  leftCollapsed?: boolean
  /** 우측 사이드(히스토리·상세) 접힘 (E12) */
  rightCollapsed?: boolean
  rightWidth?: number
  /** 터미널 도크 열림 (E7b) */
  terminalOpen?: boolean
  /** 터미널 도크 높이(px) (E7b) */
  terminalHeight?: number
}
```

`AppSettings`에서 그 다섯 필드를 **지우고** `extends WindowLayout`으로 바꾼다 — 렌더러가 보는 표면은 지금과 **완전히 동일**해야 한다(필드가 하나라도 사라지면 소비처가 깨진다):

```ts
/** renderer가 보는 설정 표면. 창별 필드(WindowLayout)와 앱 공용 필드가 여기서 평평하게 합쳐진다 (E15b) */
export interface AppSettings extends WindowLayout {
  theme?: 'light' | 'dark'
  /** 워크트리 선택 시 동작 — 클릭의 기본 동작만 결정한다(우클릭엔 항상 둘 다) (E7c) */
  worktreeSelectAction?: 'terminal' | 'switch-app'
  /** 받아오기 방식 — merge(기본)/rebase (E7e) */
  pullMode?: 'merge' | 'rebase'
  /** 주기적 원격 새로고침(10분) — 기본 켬 (E7e) */
  autoFetch?: boolean
  /** 최근 연 저장소 — 최신이 앞 (E15a) */
  recentRepos?: string[]
}
```

`WINDOW_CHANNELS`에 (이미 `fullScreen`·`focused`가 있다):

```ts
  /** 새 창에서 연다 — 경로가 null이면 빈 창 (E15b) */
  open: 'window:open',
```

`GitApi`에 새 네임스페이스를 더한다 (`repo` 옆):

```ts
  /** 창 (E15b) */
  window: {
    /**
     * 새 창에서 연다. `null`이면 저장소 없는 빈 창.
     * **경로 검증은 repo.open과 동일**하다 — 이 인자도 디스크 설정에서 온 렌더러 입력이다.
     * 이미 그 저장소를 연 창이 있으면 새로 만들지 않고 그 창을 앞으로 가져온다
     */
    open(repoPath: string | null): Promise<void>
  }
```

- [ ] **Step 4: 레지스트리를 구현한다**

`apps/desktop/src/main/window-registry.ts`:

```ts
import type { WindowLayout } from '@git-gui/ipc-contract'

/**
 * 창의 정본 (E15b). main만 안다.
 *
 * electron을 import하지 않는다 — 창을 `webContents.id`(숫자)로만 다뤄 단위 테스트가 된다.
 * 실제 BrowserWindow와의 연결은 index.ts가 한다(TerminalManager가 IPC를 모르는 것과 같은 분리).
 *
 * 답하는 것은 넷뿐이다: 어느 창이 어느 저장소를 열었나(중복 차단·복원) · 그 창의 레이아웃(설정
 * 분리) · (감시·터미널은 각자 자리에서 Map을 갖는다). 그 이상을 담지 않는다
 */
export interface WindowState {
  repoPath: string | null
  layout: WindowLayout
}

export interface WindowRegistry {
  add(id: number, state: WindowState): void
  remove(id: number): void
  get(id: number): WindowState | undefined
  /** 창 안에서 저장소를 바꾸면(E15a 전환기·⌘O) 여기로 알려야 중복 차단과 복원이 맞는다 */
  setRepoPath(id: number, repoPath: string | null): void
  /** 렌더러는 바뀐 필드만 보낸다 — 병합한다 */
  setLayout(id: number, patch: WindowLayout): void
  findByRepoPath(repoPath: string): number | undefined
  /** 등록 순서. 복원이 이 순서로 창을 만든다 */
  snapshot(): WindowState[]
}

export function createWindowRegistry(): WindowRegistry {
  // Map은 삽입 순서를 보존한다 — snapshot()의 순서 보장이 여기서 온다
  const windows = new Map<number, WindowState>()
  return {
    add(id, state) {
      windows.set(id, { repoPath: state.repoPath, layout: { ...state.layout } })
    },
    remove(id) {
      windows.delete(id)
    },
    get(id) {
      return windows.get(id)
    },
    setRepoPath(id, repoPath) {
      const state = windows.get(id)
      // 창이 닫히는 중에 늦은 IPC가 올 수 있다 — 조용히 무시한다
      if (state !== undefined) state.repoPath = repoPath
    },
    setLayout(id, patch) {
      const state = windows.get(id)
      if (state !== undefined) state.layout = { ...state.layout, ...patch }
    },
    findByRepoPath(repoPath) {
      for (const [id, state] of windows) {
        if (state.repoPath === repoPath) return id
      }
      return undefined
    },
    snapshot() {
      // 얕은 복사로는 부족하다 — layout까지 복사해야 받은 쪽의 수정이 안 샌다
      return [...windows.values()].map((state) => ({
        repoPath: state.repoPath,
        layout: { ...state.layout },
      }))
    },
  }
}
```

- [ ] **Step 5: 통과를 확인하고 반증한다**

Run: `cd "/Users/sangyeop_kim/git gui" && npx vitest run --root apps/desktop test/window-registry.test.ts`
Expected: PASS — 10 passed

그다음 **세 변이를 각각 넣고 어느 테스트가 빨개지는지 실제로 확인한 뒤 원복**한다. 빨강/초록 출력을 그대로 보고에 붙인다.
1. `add`의 `{ ...state.layout }`를 `state.layout`으로 (복사 제거)
2. `snapshot()`의 `{ ...state.layout }`를 `state.layout`으로
3. `setLayout`의 `{ ...state.layout, ...patch }`를 `patch`로 (병합 아닌 교체)

> **예상 개수를 적지 않는다.** 이 에픽 시리즈에서 컨트롤러가 반증 예상을 적을 때마다 틀렸다.
> **어느 변이가 어느 테스트를 무는지 실제 대응을 보고하고**, 어떤 변이에도 안 물리는 테스트가
> 있으면 그것도 그대로 적는다.

- [ ] **Step 6: `createWindow`를 다시 부를 수 있게 고치고 `window:open`을 연다**

`apps/desktop/src/main/index.ts`. 지금 `createWindow()`(`:53`)는 인자가 없고 `app.whenReady()`에서 한 번, `activate`에서 조건부로 불린다. 씨앗을 받게 고친다:

```ts
interface WindowSeed {
  repoPath: string | null
  layout: WindowLayout
}

function createWindow(seed: WindowSeed = { repoPath: null, layout: {} }): BrowserWindow {
  const window = new BrowserWindow({
    // …기존 옵션 그대로…
  })
  // 레지스트리 등록은 **여기서 동기적으로** 한다. preload의 settings:get-sync가 이보다 늦게 돌고,
  // 그때 이 창의 layout 씨앗을 읽어야 새 창이 열어준 창을 닮는다. loadFile 뒤로 미루면 늦는다
  registry.add(window.webContents.id, { repoPath: seed.repoPath, layout: seed.layout })
  window.on('closed', () => registry.remove(window.webContents.id))
  // …기존 이벤트 배선 그대로…
  return window
}
```

`repoPath` 씨앗을 렌더러에 알리는 방법은 **기존 `repo:initial-path` 핸들러를 확장**한다. 지금은 `GIT_GUI_E2E_REPO`만 본다(`git-handlers.ts:167`). 그 앞에 레지스트리를 먼저 보게 한다:

```ts
  ipcMain.handle(CHANNELS.repoInitialPath, async (event) => {
    // 이 창에 씨앗 저장소가 있으면 그것부터 (E15b — 새 창·복원). 없으면 기존 E2E 주입 경로
    const seeded = registry.get(event.sender.id)?.repoPath
    const initial = seeded ?? process.env.GIT_GUI_E2E_REPO
    if (!initial) return null
    return registerRepoPath(initial)
  })
```

**핸들러 등록 함수들이 레지스트리를 받게 한다** — 모듈 전역을 새로 만들지 말고 주입한다(`TerminalManager`가 이벤트를 주입받는 관례). `registerGitHandlers(registry)`로 시그니처를 바꾸고 `index.ts`가 넘긴다.

**창 안에서 저장소를 바꿔도 레지스트리가 알아야 한다 — 이걸 빠뜨리면 나머지가 전부 틀어진다.**
E15a의 전환기·⌘O는 `repo:select`/`repo:open`을 거쳐 저장소를 바꾸는데, 그건 창을 새로 만들지
않으므로 `createWindow`의 씨앗은 그대로다. 갱신하지 않으면 **중복 차단이 옛 경로를 보고**(A가
이미 B로 갈아탔는데 B를 열려 하면 새 창이 뜬다) **복원이 옛 저장소를 되살린다.**

**진입점은 셋이 아니라 넷이다** (실측 정정 — 초안이 `repo:open-path`를 빠뜨렸다):
`repo:select` · `repo:open` · `repo:initial-path` · **`repo:open-path`(워크트리 열기)**. 넷째도
`registerRepoPath`를 지나고 렌더러 스토어의 `repoPath`를 실제로 바꾼다(`repository-store.ts:1276`
`openWorktree`). 빠뜨리면 **워크트리로 전환한 창이 레지스트리에 옛 경로로 남는다.**

`registerRepoPath`(실제 위치 **`git-handlers.ts:121`** — 초안의 `:109`는 틀렸다)가 그 길목이다.
다만 **`registerRepoPath`에 `senderId`를 얹지 않는다**: `openRepoPath`가 모듈 레벨 export인데
그 함수를 쓰므로, 그러면 `git-handlers`에 모듈 전역 registry가 필요해진다(이 플랜이 금지한
것이다). 대신 `registerGitHandlers(registry)` **클로저 안**에 갱신 지점을 하나 두고 네 핸들러가
그것을 지나게 한다 — 계약("창의 저장소를 바꾸는 핸들러는 전부 한 함수를 지난다")은 동일하다:

```ts
/** 하위 폴더를 선택해도 저장소 루트로 정규화해 allowlist에 기록한다.
 * 이 창이 무엇을 열었는지도 함께 갱신한다 (E15b) — 세 진입점이 전부 여기를 지나므로
 * 여기 한 곳이면 충분하다. 안 하면 중복 차단이 옛 경로를 보고 복원이 옛 저장소를 되살린다 */
async function registerRepoPath(path: string, senderId?: number): Promise<string> {
  const topLevel = (
    await execGitOrThrow(['rev-parse', '--show-toplevel'], { cwd: path })
  ).stdout.trim()
  allowedRepoPaths.add(topLevel)
  if (senderId !== undefined) registry.setRepoPath(senderId, topLevel)
  return topLevel
}
```

세 호출부에 `event.sender.id`를 넘긴다. `senderId`를 **선택 인자**로 둔 이유는 `openRepoPath`가
창 없이도(복원 경로 — Task 7) 이 함수를 쓰기 때문이다.

`window:open` 핸들러는 `index.ts`에 둔다(창을 만드는 것은 여기 책임이다):

```ts
  // 새 창에서 연다 (E15b). 인자는 디스크 설정에서 온 렌더러 입력이라 repo.open과 **같은 검증**을
  // 거친다 — 검증 없이 씨앗으로 넣으면 그 창이 임의 디렉터리에서 git을 돌리는 통로가 된다
  ipcMain.handle(WINDOW_CHANNELS.open, async (event, repoPath: unknown) => {
    if (repoPath === null) {
      createWindow({ repoPath: null, layout: seedLayoutFrom(event.sender.id) })
      return
    }
    const path = assertAbsoluteRepoPath(repoPath)
    const opened = await openRepoPath(path)
    if (!opened.ok) throw new Error(opened.message)
    // 이미 그 저장소를 연 창이 있으면 새로 만들지 않고 앞으로 가져온다 (사용자 결정)
    const existing = registry.findByRepoPath(opened.path)
    if (existing !== undefined) {
      const window = BrowserWindow.getAllWindows().find((w) => w.webContents.id === existing)
      // 탭으로 묶여 있어도 focus()면 macOS가 그 탭을 앞으로 가져온다
      window?.show()
      window?.focus()
      return
    }
    createWindow({ repoPath: opened.path, layout: seedLayoutFrom(event.sender.id) })
  })
```

`openRepoPath(path)`는 `git-handlers.ts`의 `repo:open` 핸들러 **본문을 함수로 뽑아 export**한 것이다 — 핸들러는 그 함수를 부르게 바꾼다(같은 검증을 두 번 쓰지 않는다). 시그니처: `export async function openRepoPath(path: string): Promise<RepoOpenResult>`.

`seedLayoutFrom(id)`는 `index.ts`의 작은 헬퍼다:

```ts
/** 새 창은 열어준 창의 레이아웃을 씨앗으로 받는다 (사용자 결정). 그 창이 없으면(⌘N을 창 없이
 * 부를 수는 없지만 복원 경로가 이 함수를 안 쓴다) 빈 레이아웃 — 렌더러가 기본값을 쓴다 */
function seedLayoutFrom(openerId: number): WindowLayout {
  return { ...(registry.get(openerId)?.layout ?? {}) }
}
```

preload에 노출한다 (`repo` 네임스페이스 옆):

```ts
  window: {
    open: (repoPath) => ipcRenderer.invoke(WINDOW_CHANNELS.open, repoPath),
  },
```

- [ ] **Step 7: 두 창 E2E 하네스 헬퍼 — 이 태스크의 핵심**

`apps/desktop/e2e/harness.ts`에 더한다:

```ts
/**
 * 두 번째 창이 뜰 때까지 기다린다 (E15b).
 *
 * 이 저장소의 E2E는 E15b 전까지 전부 창 하나(firstWindow)만 다뤘다. Playwright의
 * `waitForEvent('window')`는 **호출 시점 이후에 열리는** 창만 준다 — 이미 열린 창은 못 잡으니
 * 창을 여는 동작보다 **먼저** 이 함수를 부르고 나중에 await한다.
 */
export function nextWindow(app: ElectronApplication): Promise<Page> {
  return app.waitForEvent('window')
}
```

`Page` 타입을 import에 더한다(`type Page` — `@playwright/test`).

`smoke.spec.ts`에 최소 E2E 하나:

```ts
test('E15b — 새 창이 뜨고 두 창을 각각 조작할 수 있다', async () => {
  const repo = await createRepoWithFile('a')
  const other = await createRepoWithFile('b')
  const app = await electron.launch({ args: [APP_ROOT], env: { ...process.env, GIT_GUI_E2E_REPO: repo } })
  try {
    const first = await app.firstWindow()
    await first.locator('.app__header').waitFor()

    // 창을 여는 동작보다 **먼저** 대기를 걸어 둔다 — waitForEvent는 이후에 열리는 창만 준다
    const pending = nextWindow(app)
    await first.evaluate((path: string) => window.gitApi.window.open(path), other)
    const second = await pending
    await second.locator('.app__header').waitFor()

    // 두 창이 서로 다른 저장소를 보고, 각각 조작이 닿는다
    await expect(app.windows()).toHaveLength(2)
    await expect(first.getByTestId('repo-path')).toHaveText(repo)
    await expect(second.getByTestId('repo-path')).toHaveText(other)
    await expect(second.getByTestId('file-unstaged-b.txt')).toBeVisible()
  } finally {
    await app.close()
  }
})
```

**E2E 헬퍼 실측 정정** (플랜 초안이 지어낸 이름을 썼다 — 아래가 실제다):

| 플랜 초안 | 실제 (`smoke.spec.ts`) |
| --- | --- |
| `appEntry` | `APP_ROOT` (`:13` `const APP_ROOT = join(__dirname, '..')`) |
| `e2eEnv(repo)` | **없다.** 호출부마다 인라인 `env: { ...process.env, GIT_GUI_E2E_REPO: repo }` |
| `createRepoWithFile('a')` → `a.txt` | **`name`은 파일 이름 전체다** (`:25`). `createRepoWithFile('beta.txt')`로 쓴다. 변경 파일이 `app.txt`인 저장소는 `createRepoWithChange()`(`:39`) |

**`repo-path`는 realpath다** — `--show-toplevel`이 심링크를 풀어 macOS의 `/var`가 `/private/var`가 된다. 단언은 `realpathSync(repo)`와 비교한다.

**`page.evaluate(fn, arg)`는 인자를 하나만 넘긴다.** `locator.evaluate(el, arg)`의 2인자 시그니처와 헷갈리기 쉽다 — 초안이 `(_, path) => …`로 써서 `path`가 `undefined`가 됐고, `finally`의 `app.close()`가 먼저 돌아 대기 중이던 `pending`이 `Target page… has been closed`로 reject되며 **진짜 오류가 가려졌다**(실측). 반드시 `(path: string) => …` 한 인자로 쓴다.

`app.windows()`는 동기 배열이라 `expect(...).toHaveLength`가 **재시도하지 않는다.** 위처럼 `second`를 await한 뒤에 세면 경합이 없다.

- [ ] **Step 8: 두 창 E2E가 실제로 도는지 확인한다 — 여기가 관문이다**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm --filter @git-gui/desktop e2e
```
Expected: **136 passed** (135 + 이 1건).

**안 되면 멈추고 보고한다.** 특히 이런 것들을 그대로 적는다: 두 번째 창이 `waitForEvent`에 안 잡히는지 · 잡히지만 렌더가 비었는지 · `GIT_GUI_USER_DATA` 격리가 두 창에서 어떻게 되는지 · 숨김(`show:false`+`ready-to-show`)이 두 번째 창에서 어떻게 되는지. **우회를 지어내지 말고 실패를 보고한다** — 나머지 7태스크가 이 위에 선다.

- [ ] **Step 9: 나머지 게이트**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm lint && pnpm typecheck && pnpm test
```
Expected: lint **0 errors / 5 warnings** · typecheck **6/6** · Tests **649** (639 + 레지스트리 10)

- [ ] **Step 10: 커밋**

```bash
cd "/Users/sangyeop_kim/git gui"
git add apps/desktop packages/ipc-contract
git commit -m "feat(desktop): E15b 창 레지스트리 + window.open — 여러 창의 토대

main이 창의 정본을 갖는다. electron 무의존이라 단위 테스트가 되고, 실제 BrowserWindow와의
연결은 index.ts가 한다(TerminalManager가 IPC를 모르는 것과 같은 분리).

window:open의 경로도 디스크 설정에서 온 렌더러 입력이라 repo.open과 같은 검증을 거친다 —
검증 함수를 복제하지 않고 핸들러 본문을 openRepoPath로 뽑아 둘이 함께 쓴다.

레지스트리 등록은 new BrowserWindow 직후 동기적으로 한다. preload의 settings:get-sync가
그보다 늦게 돌고 그때 이 창의 layout 씨앗을 읽어야 새 창이 열어준 창을 닮는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 창별 감시 — **테스트 먼저, 그다음 수정**

**Files:**
- Modify: `apps/desktop/src/main/git-handlers.ts:205-237` (`stopWatching`)
- Modify: `apps/desktop/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: Task 1의 `nextWindow(app)` · `window.gitApi.window.open(path)`.
- Produces: 없음(내부 수정).

> **이건 이미 결함이다 — 여러 창을 만들면서 생기는 게 아니라 이미 있다.** 지금 코드
> (`git-handlers.ts:207`):
>
> ```ts
> let stopWatching: (() => void) | null = null
> // …
> stopWatching?.()                    // ① 새 창이 열면 옛 창 감시를 끈다
> // …
> sender.once('destroyed', () => {
>   stopWatching?.()                  // ② 창 B를 닫으면
>   stopWatching = null               //    그 시점 A를 가리키던 감시까지 끈다
> })
> ```
>
> A는 조용히 E10(외부 변경 감지)을 잃는다. 사용자는 "왜 갱신이 안 되지"만 겪는다.
>
> **그리고 순서 결함이 하나 더 있다** (E15a 리뷰 발견): `--git-common-dir` 해석을 **먼저** 하고
> `stopWatching?.()`을 나중에 부른다. rev-parse가 실패하면 옛 감시가 살아남은 채 새 저장소는
> 감시되지 않는다. `Map`으로 바꾼다고 이게 자동으로 고쳐지지 않는다 — **해제를 먼저** 한다.

- [ ] **Step 1: 유출 E2E를 먼저 쓴다 (수정 전)**

`smoke.spec.ts`:

```ts
test('E15b — 창 B를 닫아도 창 A의 외부 변경 감지가 산다', async () => {
  const repo = await createRepoWithFile('a')
  const other = await createRepoWithFile('b')
  const app = await electron.launch({ args: [APP_ROOT], env: { ...process.env, GIT_GUI_E2E_REPO: repo } })
  try {
    const first = await app.firstWindow()
    await first.getByTestId('file-unstaged-a.txt').waitFor()

    const pending = nextWindow(app)
    await first.evaluate((path: string) => window.gitApi.window.open(path), other)
    const second = await pending
    await second.getByTestId('file-unstaged-b.txt').waitFor()

    // 창 B를 닫는다 — 지금 코드에서는 이때 A의 감시까지 죽는다
    await second.close()

    // A의 저장소에 밖에서 새 파일을 만든다. 감시가 살아 있으면 목록에 나타난다
    await writeFile(join(repo, 'watch-alive.txt'), '외부 변경\n')
    await expect(first.getByTestId('file-unstaged-watch-alive.txt')).toBeVisible({
      timeout: 15_000,
    })
  } finally {
    await app.close()
  }
})
```

`writeFile`·`join`이 이 스펙에 이미 import돼 있는지 먼저 확인하고, 없으면 더한다.

**대기는 창 포커스에 기대면 안 된다** — `window.on('focus')`가 재조회를 쏘므로(`index.ts:121`) 감시가 죽어 있어도 통과할 수 있다. 위 테스트는 포커스를 건드리지 않는다(B를 닫으면 A가 포커스를 받을 수 있는데, **그러면 이 테스트가 공허해진다**). Step 2에서 반드시 빨간지 확인하고, **초록이면 포커스 재조회가 가린 것이니 그렇게 보고한다** — 그때는 `GIT_GUI_E2E_SHOW` 없이(숨김 창) 포커스가 안 가는지 확인하거나, A를 명시적으로 blur시킬 방법을 찾는다.

- [ ] **Step 2: 현재 코드에서 빨간 것을 확인한다**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm --filter @git-gui/desktop e2e
```
Expected: **새 테스트가 빨강**(`file-unstaged-watch-alive.txt`가 15초 안에 안 뜬다). 초록이면 위에 적은 대로 보고한다.

- [ ] **Step 3: 창별 `Map`으로 고친다**

`git-handlers.ts`의 `repoWatch` 핸들러를 이렇게 바꾼다:

```ts
  // 저장소 감시 (E7b) — **창마다 하나**다 (E15b). 예전엔 모듈 하나의 let이라 새 창이 옛 창의
  // 감시를 끄고, 창 B를 닫으면 A를 가리키던 감시까지 껐다(A가 조용히 E10을 잃었다)
  const stopWatching = new Map<number, () => void>()
  const watchCleanupHooked = new WeakSet<Electron.WebContents>()
  ipcMain.handle(CHANNELS.repoWatch, async (event, repoPath: unknown) => {
    const path = assertAllowedRepo(repoPath)
    const sender = event.sender
    const senderId = sender.id
    // **해제를 먼저 한다** (E15a 리뷰 발견): 예전엔 --git-common-dir 해석이 앞이라, rev-parse가
    // 실패하면 옛 감시가 살아남은 채 새 저장소는 감시되지 않았다
    stopWatching.get(senderId)?.()
    stopWatching.delete(senderId)
    // 링크드 워크트리의 .git은 파일이라 그대로 감시하면 죽는다(실측 H1) — 공용 git dir을 해석해 감시한다
    const gitDir = (
      await execGitOrThrow(['rev-parse', '--path-format=absolute', '--git-common-dir'], {
        cwd: path,
      })
    ).stdout.trim()
    const notify = (): void => {
      if (!sender.isDestroyed()) sender.send(CHANNELS.repoChanged, path)
    }
    // .git 감시는 HEAD·refs·상태 마커를, 워킹트리 감시는 파일 내용을 본다 — 목적이 달라 둘 다 필요하다 (E10)
    const stopGit = watchRepository(gitDir, notify)
    const stopTree = watchWorkingTree(path, notify)
    stopWatching.set(senderId, () => {
      stopGit()
      stopTree()
    })
    // destroyed 정리는 sender당 1회만 등록한다 — watch 재호출마다 쌓이면 MaxListeners 경고
    if (!watchCleanupHooked.has(sender)) {
      watchCleanupHooked.add(sender)
      sender.once('destroyed', () => {
        // **이 창의 것만** 끈다
        stopWatching.get(senderId)?.()
        stopWatching.delete(senderId)
      })
    }
  })
```

`senderId`를 `once('destroyed')` 콜백 **밖에서** 잡아 두는 것이 중요하다 — `destroyed` 이후에는 `sender.id` 접근이 안전하지 않다.

- [ ] **Step 4: 초록을 확인하고 반증한다**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm --filter @git-gui/desktop e2e
```
Expected: **137 passed** (136 + 이 1건)

그다음 **두 수정을 하나씩 되돌려 재빌드해** 각각 빨개지는지 본다. 출력을 그대로 붙인다.
1. `Map`을 다시 `let` 하나로 (창별화 되돌리기) → 이 테스트가 빨개져야 한다
2. 해제를 다시 `--git-common-dir` 뒤로 옮기기 → **이건 이 테스트로는 안 잡힐 수 있다.** 안 잡히면 그렇게 보고하고, 그 순서를 무는 값싼 방법이 있는지 판단해 적는다(rev-parse 실패를 E2E로 만들기는 어렵다 — 못 만들면 못 만든다고 적는다).

- [ ] **Step 5: 나머지 게이트 + 커밋**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm lint && pnpm typecheck && pnpm test
```
Expected: lint 0 errors / 5 warnings · 6/6 · **649**

```bash
cd "/Users/sangyeop_kim/git gui"
git add apps/desktop
git commit -m "fix(desktop): E15b 감시를 창별로 — 창 B를 닫으면 A의 감시까지 죽던 것

stopWatching이 모듈 하나의 let이라 새 창이 옛 창의 감시를 끄고, 창 B를 닫으면
그 시점 A를 가리키던 감시까지 껐다. A는 조용히 E10(외부 변경 감지)을 잃고
사용자는 '왜 갱신이 안 되지'만 겪었다. 여러 창 이전에도 이미 결함이다.

해제 순서도 함께 고쳤다(E15a 리뷰 발견) — --git-common-dir 해석이 앞이라
rev-parse가 실패하면 옛 감시가 살아남은 채 새 저장소는 감시되지 않았다.

유출을 잡는 E2E를 먼저 써 현재 코드에서 빨간 것을 확인한 뒤 고쳤다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 창별 터미널 상한 8

**Files:**
- Modify: `apps/desktop/src/main/terminal-handlers.ts:29-48`
- Modify: `apps/desktop/src/main/terminal-manager.ts:5,35-37`
- Create: `apps/desktop/test/terminal-cap.test.ts`

**Interfaces:**
- Produces: `export const MAX_SESSIONS_PER_WINDOW = 8` · `export function countSessionsFor(targets: ReadonlyMap<string, T>, sender: T): number` (제네릭 — WebContents 무의존).
- Consumes: 없음.

> 지금 상한은 `TerminalManager` 하나의 `this.sessions.size`라 **앱 전체 8개**다(`terminal-manager.ts:35`).
> 창 3개면 셋이 8개를 나눠 쓰고, "안 쓰는 탭을 닫아 주세요"가 **다른 창에 있어 보이지도 않는
> 탭**을 가리킨다. 사용자 결정은 **창마다 8개**다.
>
> **어디서 세는가**: `TerminalManager`는 pty만 소유하고 창을 모른다. 창별 계수는 이미 창을 아는
> `terminal-handlers.ts`에서 한다 — `targets`(`Map<sessionId, WebContents>`, `:8`)에서
> `event.sender`와 같은 항목 수를 센다. **`TerminalManager`의 전역 검사는 제거한다** — 두 곳에서
> 세면 문구가 갈린다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/desktop/test/terminal-cap.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { countSessionsFor, MAX_SESSIONS_PER_WINDOW } from '../src/main/terminal-handlers'

// WebContents 대신 아무 참조나 쓴다 — countSessionsFor는 신원 비교만 한다
const windowA = { id: 1 }
const windowB = { id: 2 }

describe('창별 터미널 상한 (E15b)', () => {
  it('창마다 8개다 — 앱 전체가 아니다', () => {
    expect(MAX_SESSIONS_PER_WINDOW).toBe(8)
  })

  it('빈 상태는 0', () => {
    expect(countSessionsFor(new Map(), windowA)).toBe(0)
  })

  it('그 창의 세션만 센다 — 다른 창 것은 안 센다', () => {
    const targets = new Map([
      ['s1', windowA],
      ['s2', windowB],
      ['s3', windowA],
      ['s4', windowB],
    ])
    expect(countSessionsFor(targets, windowA)).toBe(2)
    expect(countSessionsFor(targets, windowB)).toBe(2)
  })

  it('한 창이 상한을 채워도 다른 창은 0이다 — 이게 이 변경의 전부다', () => {
    const targets = new Map(
      Array.from({ length: MAX_SESSIONS_PER_WINDOW }, (_, i) => [`s${i}`, windowA] as const),
    )
    expect(countSessionsFor(targets, windowA)).toBe(MAX_SESSIONS_PER_WINDOW)
    expect(countSessionsFor(targets, windowB)).toBe(0)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd "/Users/sangyeop_kim/git gui" && npx vitest run --root apps/desktop test/terminal-cap.test.ts`
Expected: FAIL — `countSessionsFor`·`MAX_SESSIONS_PER_WINDOW`가 export되지 않음

- [ ] **Step 3: 구현한다**

`terminal-handlers.ts` 파일 최상단(`registerTerminalHandlers` **밖**)에:

```ts
/** 창당 세션 상한 (E15b) — 무한 스폰 방어. 예전엔 앱 전체 8개라, 두 번째 창에서 터미널을
 * 열려다 "안 쓰는 탭을 닫아 주세요"를 보는데 정작 그 탭은 다른 창에 있어 보이지도 않았다 */
export const MAX_SESSIONS_PER_WINDOW = 8

/** targets에서 이 창의 세션 수 — WebContents를 모르게 제네릭으로 둬 단위 테스트가 된다 */
export function countSessionsFor<T>(targets: ReadonlyMap<string, T>, sender: T): number {
  let count = 0
  for (const target of targets.values()) {
    if (target === sender) count += 1
  }
  return count
}
```

`create` 핸들러(`:29`)의 `manager.create(target)` **앞**에:

```ts
    if (countSessionsFor(targets, event.sender) >= MAX_SESSIONS_PER_WINDOW) {
      throw new Error(
        `이 창에서는 터미널을 ${MAX_SESSIONS_PER_WINDOW}개까지 열 수 있어요. 안 쓰는 탭을 닫아 주세요.`,
      )
    }
```

문구가 **"이 창에서는"으로 시작**하는 것이 중요하다 — 다른 창의 탭을 닫으라고 읽히면 안 된다.

`terminal-manager.ts`에서 전역 검사를 제거한다: `const MAX_SESSIONS = 8`(`:5`)과 `create()`의 `if (this.sessions.size >= MAX_SESSIONS) { throw … }`(`:35-37`)를 **둘 다 지운다.** 그 자리에 한 줄:

```ts
  /** 세션 생성 — cwd는 호출자(핸들러)가 allowlist 검증을 마친 저장소 루트다 (E7c에서 워크트리 경로 확장점).
   * 상한은 여기서 안 본다 — 창별 상한이라 창을 아는 terminal-handlers가 센다 (E15b) */
```

- [ ] **Step 4: 통과를 확인하고 반증한다**

Run: `cd "/Users/sangyeop_kim/git gui" && npx vitest run --root apps/desktop test/terminal-cap.test.ts`
Expected: PASS — 4 passed

반증 둘(각각 원복):
1. `countSessionsFor`의 `if (target === sender)`를 무조건 `count += 1`로
2. `MAX_SESSIONS_PER_WINDOW`를 16으로

어느 변이가 어느 테스트를 무는지 실제 대응을 적는다.

**그리고 `MAX_SESSIONS`를 지운 것이 기존 터미널 E2E를 안 깨는지 확인한다** — E7b가 터미널 E2E 4건을 넣었다. 상한 초과를 무는 테스트가 있었다면 문구가 바뀌었으니 함께 고친다. `grep -n "터미널은 .*개까지" apps/desktop/e2e/smoke.spec.ts`로 먼저 확인한다.

- [ ] **Step 5: 게이트 + 커밋**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm lint && pnpm typecheck && pnpm test
cd "/Users/sangyeop_kim/git gui" && pnpm --filter @git-gui/desktop e2e
```
Expected: lint 0 errors / 5 warnings · 6/6 · **653** (649 + 4) · e2e **137**

```bash
cd "/Users/sangyeop_kim/git gui"
git add apps/desktop
git commit -m "fix(desktop): E15b 터미널 상한을 창마다 8개로

앱 전체 8개였다. 창 3개면 셋이 8개를 나눠 쓰고, 두 번째 창에서 터미널을 열려다
'안 쓰는 탭을 닫아 주세요'를 보는데 정작 그 탭은 다른 창에 있어 보이지도 않았다.

TerminalManager는 pty만 소유하고 창을 모른다 — 계수는 이미 창을 아는 handlers가
하고 매니저의 전역 검사는 지운다(두 곳에서 세면 문구가 갈린다).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 설정을 창별/앱공용으로 가른다

**Files:**
- Modify: `packages/ipc-contract/src/index.ts` (`sanitizeSettings` 분리 함수)
- Modify: `apps/desktop/src/main/settings.ts:45-54`
- Modify: `apps/desktop/src/main/index.ts` (`registerSettingsHandlers(registry)`)
- Modify: `packages/ipc-contract/test/settings.test.ts`
- Modify: `apps/desktop/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: Task 1의 `WindowLayout` · `WindowRegistry`.
- Produces: `splitSettings(value: unknown): { app: AppSettings; layout: WindowLayout }` (ipc-contract) — Task 7의 복원이 저장된 layout을 sanitize할 때 쓴다.

> **렌더러는 이 분리를 모른다.** 그것이 이 태스크를 값싸게 만드는 지점이다 —
> `sync-settings.ts`·`recent-repos-settings.ts`·`SettingsDialog`·스토어는 **한 줄도 안 바뀐다.**
> 소비처를 고치고 싶어지면 멈추고 왜 필요한지 보고한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/ipc-contract/test/settings.test.ts`에 더한다(이 파일에 이미 16건이 있다):

```ts
describe('splitSettings — 창별/앱공용 분리 (E15b)', () => {
  it('창별 다섯 필드는 layout으로 간다', () => {
    const { app, layout } = splitSettings({
      leftCollapsed: true,
      rightCollapsed: false,
      rightWidth: 420,
      terminalOpen: true,
      terminalHeight: 240,
    })
    expect(layout).toEqual({
      leftCollapsed: true,
      rightCollapsed: false,
      rightWidth: 420,
      terminalOpen: true,
      terminalHeight: 240,
    })
    expect(app).toEqual({})
  })

  it('앱 공용 필드는 app으로 간다', () => {
    const { app, layout } = splitSettings({ theme: 'dark', pullMode: 'rebase' })
    expect(app).toEqual({ theme: 'dark', pullMode: 'rebase' })
    expect(layout).toEqual({})
  })

  it('한 partial에 섞여 와도 각각 제 자리로 간다 — 렌더러가 갈라 보낼 의무가 없다', () => {
    const { app, layout } = splitSettings({ theme: 'light', rightWidth: 300 })
    expect(app).toEqual({ theme: 'light' })
    expect(layout).toEqual({ rightWidth: 300 })
  })

  it('sanitize를 거친다 — 타입이 틀린 값은 양쪽 다 안 받는다', () => {
    const { app, layout } = splitSettings({ theme: 'neon', rightWidth: '넓게', pullMode: 'rebase' })
    expect(app).toEqual({ pullMode: 'rebase' })
    expect(layout).toEqual({})
  })

  it('hosting 토큰은 어느 쪽에도 안 간다 — renderer 표면이 아니다', () => {
    const { app, layout } = splitSettings({ hosting: { github: { token: 'x', login: 'y' } } })
    expect(app).not.toHaveProperty('hosting')
    expect(layout).not.toHaveProperty('hosting')
  })

  it('빈 입력은 빈 둘', () => {
    expect(splitSettings({})).toEqual({ app: {}, layout: {} })
    expect(splitSettings(null)).toEqual({ app: {}, layout: {} })
  })
})
```

import에 `splitSettings`를 더한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `cd "/Users/sangyeop_kim/git gui" && npx vitest run --root packages/ipc-contract`
Expected: FAIL — `splitSettings` 없음

- [ ] **Step 3: `splitSettings`를 구현한다**

`packages/ipc-contract/src/index.ts`의 `sanitizeSettings` **아래**:

```ts
/** WindowLayout에 속하는 키 — splitSettings와 복원 sanitize가 함께 쓰는 정본 목록 (E15b) */
const WINDOW_LAYOUT_KEYS = [
  'leftCollapsed',
  'rightCollapsed',
  'rightWidth',
  'terminalOpen',
  'terminalHeight',
] as const satisfies readonly (keyof WindowLayout)[]

/**
 * renderer가 보낸 평평한 설정을 앱 공용과 창별로 가른다 (E15b).
 *
 * 렌더러는 이 구분을 모른다 — 한 `partial`에 두 성격이 섞여 와도 각각 제 자리로 간다.
 * sanitizeSettings를 먼저 거치므로 타입이 틀린 값과 hosting 토큰은 양쪽 다 못 들어온다
 */
export function splitSettings(value: unknown): { app: AppSettings; layout: WindowLayout } {
  const clean = sanitizeSettings(value)
  const layout: WindowLayout = {}
  const app: AppSettings = { ...clean }
  for (const key of WINDOW_LAYOUT_KEYS) {
    if (key in clean) {
      // 키마다 타입이 달라 좁히기 어렵다 — sanitizeSettings가 이미 타입을 보장하므로 통째로 옮긴다
      ;(layout as Record<string, unknown>)[key] = clean[key]
      delete (app as Record<string, unknown>)[key]
    }
  }
  return { app, layout }
}

/** 디스크에서 온 창별 레이아웃 방어 (E15b 복원) — 알려진 키·올바른 타입만 남긴다 */
export function sanitizeWindowLayout(value: unknown): WindowLayout {
  return splitSettings(value).layout
}
```

- [ ] **Step 4: main이 갈라 저장하게 한다**

`apps/desktop/src/main/settings.ts`. `registerSettingsHandlers`가 레지스트리를 받게 바꾼다:

```ts
import type { WindowRegistry } from './window-registry'

export function registerSettingsHandlers(registry: WindowRegistry): void {
  ipcMain.on(SETTINGS_CHANNELS.getSync, (event) => {
    // renderer 표면 필드만 추린다 — hosting(토큰)은 renderer로 절대 보내지 않는다.
    // 거기에 **이 창의** 레이아웃을 얹어 평평하게 돌려준다 (E15b) — 렌더러는 분리를 모른다.
    // 레지스트리 등록이 new BrowserWindow 직후 동기적으로 일어나므로 여기서 이미 있다
    const layout = registry.get(event.sender.id)?.layout ?? {}
    event.returnValue = { ...sanitizeSettings(current()), ...layout }
  })
  ipcMain.handle(SETTINGS_CHANNELS.set, (event, partial: unknown) => {
    // 성격에 따라 갈라 보낸다 — 앱 공용은 파일에, 창별은 그 창의 레지스트리 항목에 (E15b)
    const { app: appPart, layout } = splitSettings(partial)
    if (Object.keys(appPart).length > 0) save({ ...current(), ...appPart })
    if (Object.keys(layout).length > 0) registry.setLayout(event.sender.id, layout)
  })
}
```

`index.ts`의 `registerSettingsHandlers()` 호출(`:126`)에 `registry`를 넘긴다.

**빈 객체일 때 `save`를 건너뛰는 것이 중요하다** — 창별 필드만 담긴 `set`이 앱 설정 파일을 매번 다시 쓰게 두면 디스크 쓰기가 무의미하게 는다(도크 높이 드래그는 초당 여러 번 온다).

- [ ] **Step 5: 창별 설정 E2E**

```ts
test('E15b — 사이드 접힘은 창마다 따로 산다', async () => {
  const repo = await createRepoWithFile('a')
  const other = await createRepoWithFile('b')
  const app = await electron.launch({ args: [APP_ROOT], env: { ...process.env, GIT_GUI_E2E_REPO: repo } })
  try {
    const first = await app.firstWindow()
    await first.locator('.app__header').waitFor()

    const pending = nextWindow(app)
    await first.evaluate((path: string) => window.gitApi.window.open(path), other)
    const second = await pending
    await second.locator('.app__header').waitFor()

    // 두 창 다 펼쳐진 상태에서 시작한다(새 창은 열어준 창을 닮으므로 둘 다 펼침)
    await expect(first.getByTestId('left-collapse')).toBeVisible()
    await expect(second.getByTestId('left-collapse')).toBeVisible()

    // A만 접는다
    await first.getByTestId('left-collapse').click()

    // A는 접히고 B는 그대로
    await expect(first.getByTestId('changes-panel')).toBeHidden()
    await expect(second.getByTestId('changes-panel')).toBeVisible()
  } finally {
    await app.close()
  }
})
```

`left-collapse`·`changes-panel` testid는 **E12가 넣은 실제 이름을 먼저 확인하고 맞춘다** — `grep -n "left-collapse\|changes-panel" apps/desktop/e2e/smoke.spec.ts`로 기존 접기 E2E가 무엇을 쓰는지 보고 그것을 쓴다. 다르면 실제 것을 쓰고 보고한다.

- [ ] **Step 6: 게이트 + 반증**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm lint && pnpm typecheck && pnpm test
cd "/Users/sangyeop_kim/git gui" && pnpm --filter @git-gui/desktop e2e
```
Expected: lint 0 errors / 5 warnings · 6/6 · **659** (653 + 6) · e2e **138**

반증: `settings.ts`의 `registry.setLayout(...)`을 지우고(창별 저장 없애기) 위 E2E가 빨개지는지, `getSync`의 `...layout`을 지우고 재시작 유지가 깨지는지. 원복하고 출력을 붙인다.

**기존 접기·도크 E2E가 안 깨지는지 특히 본다** — 창 하나짜리 재시작 지속성 테스트가 있다면(E12가 넣었다) 그 값이 이제 레지스트리를 거쳐 저장되므로 Task 7(복원)이 끝나기 전까지 **재시작 후 유지가 깨진다.** 깨지면 그 테스트 이름을 그대로 보고한다 — Task 7이 복구한다. **깨진 채로 넘어가되 무엇이 깨졌는지 반드시 적는다.**

- [ ] **Step 7: 커밋**

```bash
cd "/Users/sangyeop_kim/git gui"
git add apps/desktop packages/ipc-contract
git commit -m "feat(desktop): E15b 설정을 창별/앱공용으로 가른다

레이아웃 다섯(사이드 접힘·폭·터미널)은 창마다, 나머지(테마·받아오기 방식·자동
새로고침·워크트리 동작·최근 목록)는 앱 공용이다.

렌더러는 이 구분을 모른다 — main이 event.sender로 창을 찾아 합쳐 주고 갈라
저장하므로 sync-settings·SettingsDialog·스토어가 한 줄도 안 바뀐다.

창별 필드만 온 set은 앱 설정 파일을 안 건드린다 — 도크 높이 드래그는 초당
여러 번 오고, 그때마다 파일을 다시 쓸 이유가 없다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 진입점 넷 + 중복 차단 + `RepoPicker` 최근 목록

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/RepoSwitcher.tsx` (⌥클릭 · 우클릭)
- Modify: `apps/desktop/src/renderer/src/components/RepoPicker.tsx` + `repo-picker.css` (최근 목록)
- Modify: `apps/desktop/src/renderer/src/App.tsx` (⌘N · RepoPicker 배선)
- Modify: `apps/desktop/src/renderer/src/components/WorktreesPanel.tsx` ("새 창에서 열기")
- Modify: `apps/desktop/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: Task 1의 `window.gitApi.window.open(path | null)` · E15a의 `pushRecentRepo`(`components/recent-repos.ts`) · 스토어의 `recentRepos`·`openRepository(path?)`.
- Produces: testid `repo-picker-recent-<path>` · `repo-switcher-item-<path>`(기존, ⌥클릭 대상).

> **⌘N이 선재 결함 하나를 드러낸다.** 지금 `RepoPicker`(`components/RepoPicker.tsx`)는 버튼
> 하나뿐이고 최근 목록을 안 보여 준다. 빈 창을 만들면서 그대로 두면 "새 창 = 항상 OS
> 다이얼로그부터"가 되어 최근 10개가 무의미해진다. 그래서 이 태스크에 포함한다.

- [ ] **Step 1: `RepoSwitcher`에 ⌥클릭과 우클릭을 더한다**

지금 `onAction`(`:68`)은 이렇다:

```tsx
          onAction={(key) => {
            if (key === BROWSE_KEY) onOpen()
            else if (key !== currentPath) onOpen(String(key))
          }}
```

react-aria의 `onAction`은 수식 키를 안 준다. **`MenuItem`의 `onPointerDown`에서 `event.altKey`를 기억**했다가 `onAction`에서 읽는다 — 이 관용구를 쓰는 이유를 주석으로 남긴다:

```tsx
  // react-aria의 onAction은 수식 키를 전달하지 않는다(키보드 활성화와 클릭을 같은 콜백으로
  // 합치기 때문). 항목의 포인터 이벤트에서 altKey를 기억해 두고 onAction에서 읽는다 (E15b)
  const altRef = useRef(false)
```

`MenuItem`에 `onPointerDown={(event) => { altRef.current = event.altKey }}`를 더하고, `onAction`을 이렇게 바꾼다:

```tsx
          onAction={(key) => {
            const newWindow = altRef.current
            altRef.current = false
            if (key === BROWSE_KEY) {
              onOpen()
              return
            }
            const path = String(key)
            // ⌥클릭이면 새 창. 현재 저장소여도 새 창으로 여는 것은 의미가 있다 — main이
            // 중복을 막아 그 창을 앞으로 가져온다(즉 아무 일도 안 일어난 것처럼 보인다)
            if (newWindow) void window.gitApi.window.open(path)
            else if (path !== currentPath) onOpen(path)
          }}
```

**우클릭 메뉴**는 이 저장소의 기존 `ContextMenu`를 쓴다(E1a가 만들었다). `grep -rn "ContextMenu" apps/desktop/src/renderer/src/components | head`로 실제 컴포넌트와 props를 먼저 읽고 그 관용구를 따른다. 항목은 **"새 창에서 열기"** 하나다(⌥의 발견 가능한 짝이므로 그 이상 담지 않는다).

트리거의 툴팁/`aria` 문구에 ⌥ 힌트를 넣지 않는다 — 트리거의 접근 가능한 이름은 저장소 이름이어야 한다(E15a 리뷰 ⑤).

- [ ] **Step 2: `⌘N`을 더한다**

`App.tsx`의 `onKeyDown`(`:457`), `⌘O` 분기(`:509`) **다음**에:

```tsx
      } else if ((event.metaKey || event.ctrlKey) && (event.key === 'n' || event.key === 'N')) {
        // ⌘N — 빈 새 창 (E15b). ⌘O·⌘F와 **같은 줄, 같은 이유**로 터미널 포커스면 가로채지 않는다.
        // 조건이 metaKey || ctrlKey라 macOS에서도 Ctrl+N이 잡히는데, 그건 도크 터미널에서
        // readline의 next-history(아래 화살표와 같다)다 — 삼키면 히스토리 이동이 죽는다
        if (document.activeElement?.closest('.terminal-dock') !== null) return
        event.preventDefault()
        void window.gitApi.window.open(null)
      }
```

**터미널 가드를 빼먹지 않는다** — E15a 리뷰가 ⌘O에서 정확히 이걸 잡았고(nano의 Ctrl+O), Ctrl+N은 readline의 next-history라 같은 부류다.

- [ ] **Step 3: `RepoPicker`에 최근 목록을 붙인다**

props를 넓힌다:

```tsx
interface RepoPickerProps {
  onOpen(): void
  /** 최근 연 저장소 — 최신이 앞 (E15a). 누르면 그 저장소를 이 창에서 연다 */
  recent: string[]
  home: string
  onOpenRecent(path: string): void
  error: string | null
}
```

버튼 아래에, `recent`가 비어 있지 않을 때만 목록을 그린다. 각 행은 **마지막 폴더명을 굵게, 그 위 경로를 흐리게** — `worktree-label.ts`의 `shortenParent(path, home)`를 쓴다(E15a Task 3이 저장소용으로 맞는 것을 실측 확인했다: 저장소 이름은 항상 깊이 1이라 `shortenAbove`가 필요 없다). testid는 `repo-picker-recent-${path}`.

`App.tsx:577`의 배선:

```tsx
    return (
      <RepoPicker
        onOpen={() => void store.openRepository()}
        recent={store.recentRepos}
        home={home}
        onOpenRecent={(path) => void store.openRepository(path)}
        error={store.error}
      />
    )
```

`home`은 `App.tsx`에 이미 있다(E7j가 `repo.home()`으로 넣었다). 실제 변수명을 확인하고 맞춘다.

- [ ] **Step 4: 워크트리 "새 창에서 열기"**

`WorktreesPanel.tsx`의 우클릭 메뉴에 항목을 더한다. 지금 그 메뉴에 "터미널에서 열기"·"앱에서 열기"·"Finder에서 보기"가 있다(E7c·E7d) — **먼저 읽고 그 옆에 같은 모양으로** 넣는다.

동작은 `void window.gitApi.window.open(worktreePath)`. **워크트리 경로는 `repo.openPath`가 이미 검증하는 대상이지만, `window:open`은 `repo.open`의 검증(절대 경로 + `rev-parse`)을 거치므로 그대로 넘겨도 안전하다** — 링크드 워크트리는 `--is-inside-work-tree`가 `true`이고 `--show-toplevel`이 그 워크트리 경로다(E15a 실측 매트릭스).

- [ ] **Step 5: E2E 3건**

```ts
test('E15b — 전환기 ⌥클릭이 새 창을 연다', async () => {
  const repo = await createRepoWithFile('a')
  const other = await createRepoWithFile('b')
  const userData = await mkdtemp(join(tmpdir(), 'gg-e15b-alt-'))
  try {
    // 전환기 목록에 other를 넣어 둔다 — browse는 네이티브 다이얼로그라 E2E에서 못 쓴다 (E15a 실측)
    await writeFile(
      join(userData, 'settings.json'),
      JSON.stringify({ recentRepos: [repo, other], autoFetch: false }),
    )
    const app = await electron.launch({
      args: [APP_ROOT],
      env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
    })
    try {
      const first = await app.firstWindow()
      await first.getByTestId('repo-switcher').click()

      const pending = nextWindow(app)
      await first.getByTestId(`repo-switcher-item-${other}`).click({ modifiers: ['Alt'] })
      const second = await pending
      await second.locator('.app__header').waitFor()

      // 새 창이 other를 열었고, **원래 창은 그대로 repo를 본다**(⌥는 전환이 아니라 새 창이다)
      await expect(second.getByTestId('repo-path')).toHaveText(other)
      await expect(first.getByTestId('repo-path')).toHaveText(repo)
    } finally {
      await app.close()
    }
  } finally {
    await rm(userData, { recursive: true, force: true })
  }
})

test('E15b — 이미 연 저장소를 새 창으로 열려 하면 창이 안 늘어난다', async () => {
  const repo = await createRepoWithFile('a')
  const app = await electron.launch({ args: [APP_ROOT], env: { ...process.env, GIT_GUI_E2E_REPO: repo } })
  try {
    const first = await app.firstWindow()
    await first.getByTestId('file-unstaged-a.txt').waitFor()

    // 지금 창이 연 그 저장소를 새 창으로 열어 달라고 한다.
    // **에러 없이 끝나는 것까지 단언한다** — throw했다면 evaluate가 거부되고 이 줄이 실패한다.
    // "창이 안 늘었다"만 보면 아무것도 안 해도 통과하는 공허한 테스트가 된다
    await first.evaluate((path: string) => window.gitApi.window.open(path), repo)

    // 창이 늘지 않았고, 그 창은 여전히 멀쩡히 그 저장소를 보고 있다
    expect(app.windows()).toHaveLength(1)
    await expect(first.getByTestId('repo-path')).toHaveText(repo)
    await expect(first.getByTestId('file-unstaged-a.txt')).toBeVisible()
  } finally {
    await app.close()
  }
})

test('E15b — 빈 창의 최근 목록에서 저장소를 연다', async () => {
  const repo = await createRepoWithFile('a')
  const other = await createRepoWithFile('b')
  const userData = await mkdtemp(join(tmpdir(), 'gg-e15b-picker-'))
  try {
    await writeFile(
      join(userData, 'settings.json'),
      JSON.stringify({ recentRepos: [repo, other], autoFetch: false }),
    )
    const app = await electron.launch({
      args: [APP_ROOT],
      env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
    })
    try {
      const first = await app.firstWindow()
      await first.locator('.app__header').waitFor()

      const pending = nextWindow(app)
      await first.evaluate(() => window.gitApi.window.open(null))
      const second = await pending

      // 빈 창은 RepoPicker가 나오고, 거기에 최근 목록이 있다 (이 에픽이 붙였다)
      await expect(second.getByTestId('open-repo')).toBeVisible()
      await second.getByTestId(`repo-picker-recent-${other}`).click()

      // 그 창이 other를 연다 — 다이얼로그를 한 번도 안 거쳤다
      await expect(second.getByTestId('repo-path')).toHaveText(other)
      await expect(second.getByTestId('file-unstaged-b.txt')).toBeVisible()
    } finally {
      await app.close()
    }
  } finally {
    await rm(userData, { recursive: true, force: true })
  }
})
```

`mkdtemp`·`tmpdir`·`writeFile`·`rm`·`join`이 이 스펙에 이미 import돼 있는지 확인하고 없으면 더한다. E15a Task 5가 같은 방식으로 `settings.json`을 심었으니 **그 테스트를 먼저 읽고 관용구를 그대로 따른다**(특히 `autoFetch: false` — 켜져 있으면 주기 작업이 단언을 흔든다).

`click({ modifiers: ['Alt'] })`가 `onPointerDown`에 `altKey`를 싣는지 **실측으로 확인한다.** 안 실리면 `keyboard.down('Alt')` → `click()` → `keyboard.up('Alt')`로 바꾸고, 그래도 안 되면 그렇게 보고한다 — 구현 쪽(`onPointerDown` 대신 다른 훅)을 바꿔야 할 수도 있다.

- [ ] **Step 6: 게이트 + 반증 + 커밋**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm lint && pnpm typecheck && pnpm test
cd "/Users/sangyeop_kim/git gui" && pnpm --filter @git-gui/desktop e2e
```
Expected: lint 0 errors / 5 warnings · 6/6 · **659** · e2e **141**

반증: ⌥ 분기 무력화 · `findByRepoPath` 반환을 `undefined`로 고정 · `RepoPicker`의 `recent` 렌더 제거 — 각각 해당 테스트가 빨개지는지 확인하고 원복.

```bash
cd "/Users/sangyeop_kim/git gui"
git add apps/desktop
git commit -m "feat(desktop): E15b 진입점 넷 + 중복 차단 + 빈 창의 최근 목록

전환기 ⌥클릭·우클릭 메뉴·⌘N·워크트리 넷이 전부 window:open 하나로 모인다.
이미 그 저장소를 연 창이 있으면 새로 만들지 않고 그 창을 앞으로 가져온다.

⌘N이 선재 결함을 드러낸다 — RepoPicker가 최근 목록을 안 보여 줘서 '새 창 =
항상 OS 다이얼로그부터'가 된다. 빈 창이 그걸 처음으로 아프게 만들어 함께 고쳤다.

⌘N에도 ⌘O·⌘F와 같은 터미널 가드를 단다. Ctrl+N은 readline의 next-history다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: 네이티브 탭 + 창 메뉴

**Files:**
- Modify: `apps/desktop/src/main/index.ts` (`tabbingIdentifier`)
- Create 또는 Modify: `apps/desktop/src/main/app-menu.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1의 `createWindow(seed)`.
- Produces: 없음.

> **실측(Electron 35.7.5)**: `BrowserWindowConstructorOptions.tabbingIdentifier`
> (`electron.d.ts:3735`) · `addTabbedWindow`(`:5142`) · `mergeAllWindows`(`:2860`) ·
> `selectNextTab`(`:2905`) 전부 존재.

- [ ] **Step 1: `tabbingIdentifier`를 준다**

`index.ts`의 `new BrowserWindow({...})`, macOS 분기(`:64-66`) 안에 더한다:

```ts
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hidden' as const,
          trafficLightPosition: { x: 20, y: 22 },
          // 네이티브 탭 (E15b) — 이 값을 공유하는 창들끼리 macOS가 탭으로 묶는다. 탭바·드래그
          // 분리·창 병합·⌘⇧[ ]가 전부 OS 기능으로 딸려오고 앱이 그릴 것도 관리할 것도 없다.
          // 묶일지는 사용자의 시스템 설정("탭 선호: 항상/전체화면에서/안 함")이 정한다 —
          // "안 함"이면 탭이 안 생기는데 그건 결함이 아니라 사용자가 고른 것이다(README에 적었다)
          tabbingIdentifier: 'dev.gitgui.repo',
        }
      : {}),
```

- [ ] **Step 2: 창 메뉴에 "모든 창 병합"**

`apps/desktop/src/main/app-menu.ts`가 있는지 먼저 본다(`ls apps/desktop/src/main/`). **없으면** 만들고 `index.ts`의 `whenReady()`에서 부른다:

```ts
import { BrowserWindow, Menu, MenuItem } from 'electron'

/**
 * 앱 메뉴 (E15b) — 지금은 창 메뉴의 "모든 창 병합" 하나 때문에 존재한다.
 * macOS의 탭 병합은 **앱이 메뉴 항목을 제공해야** 나온다(OS가 자동으로 넣어 주지 않는다).
 *
 * 메뉴 전체를 다시 만들지 않는다 — Electron의 기본 메뉴에는 편집(복사·붙여넣기·실행취소)과
 * 창·도움말이 이미 들어 있고, 직접 구성하면 그것들을 되살릴 책임이 생긴다. 기본 메뉴를
 * 가져와 창 서브메뉴에 한 항목만 얹는다
 */
export function registerAppMenu(): void {
  if (process.platform !== 'darwin') return
  const menu = Menu.getApplicationMenu()
  const windowMenu = menu?.items.find((item) => item.role === 'windowmenu')?.submenu
  if (menu === null || menu === undefined || windowMenu === undefined) return
  windowMenu.append(new MenuItem({ type: 'separator' }))
  windowMenu.append(
    new MenuItem({
      label: '모든 창 병합',
      click: () => BrowserWindow.getFocusedWindow()?.mergeAllWindows(),
    }),
  )
  // append만으로는 이미 설치된 네이티브 메뉴가 안 바뀐다 — 다시 설치해야 반영된다
  Menu.setApplicationMenu(menu)
}
```

`index.ts`의 `whenReady()`에서 `createWindow` **전에** 부른다.

> **실측 확인이 필요한 세 가지** — 되는 형태로 고치고 무엇이 달랐는지 보고한다:
> ① `Menu.getApplicationMenu()`가 `whenReady()` 시점에 `null`이 아닌지(Electron은 기본 메뉴를
> 지연 설치할 수 있다 — `null`이면 `app.on('browser-window-created')` 첫 발화 뒤로 옮긴다).
> ② `role === 'windowmenu'`로 실제로 찾히는지(`item.role`이 소문자 문자열인지 확인).
> ③ `Menu.setApplicationMenu(menu)` 재설치가 필요한지, 아니면 `append`만으로 반영되는지.
>
> **셋 다 실제로 앱을 띄워 메뉴를 확인해야 안다.** 안 되면 대안(기본 메뉴 템플릿을 직접
> 구성)으로 가되, **그 경우 편집·복사·붙여넣기가 그대로 사는지 반드시 확인하고 보고한다.**

- [ ] **Step 3: 실제로 탭이 되는지 눈으로 확인한다**

E2E로는 못 본다(네이티브 탭바는 OS가 그리고 Playwright의 `windows()`는 탭도 창으로 센다). **`GIT_GUI_E2E_SHOW=1`로 앱을 띄워 두 창을 열고 Playwright 창 캡처를 찍어** 스크래치패드에 저장하고 `ls -la`를 보고에 붙인다. 컨트롤러가 눈으로 검수한다.

**시스템 설정이 "안 함"이면 탭이 안 생긴다** — 캡처에 탭바가 없으면 그 사실과 함께 보고한다(결함이 아니다). `defaults read -g AppleWindowTabbingMode`로 현재 설정을 읽어 보고에 함께 적는다.

- [ ] **Step 4: README 한 줄**

`README.md`의 `§현재 상태` 에픽 문단에 E15b를 더하고, **탭이 시스템 설정에 달려 있다는 사실**을 적는다. 기존 문장들의 톤과 길이를 먼저 읽고 맞춘다.

- [ ] **Step 5: 게이트 + 커밋**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm lint && pnpm typecheck && pnpm test
cd "/Users/sangyeop_kim/git gui" && pnpm --filter @git-gui/desktop e2e
```
Expected: lint 0 errors / 5 warnings · 6/6 · **659** · e2e **141** (변동 없음 — 탭은 E2E로 안 본다)

```bash
cd "/Users/sangyeop_kim/git gui"
git add apps/desktop README.md
git commit -m "feat(desktop): E15b macOS 네이티브 탭

tabbingIdentifier 한 줄이면 macOS가 창들을 탭으로 묶고 탭바·드래그 분리·창 병합·
⌘⇧[ ]가 전부 OS 기능으로 딸려온다. 앱이 그릴 것도 관리할 것도 없다.

묶일지는 사용자의 시스템 설정이 정한다 — '탭 선호: 안 함'이면 탭이 안 생기고
그건 결함이 아니라 사용자가 고른 것이다. README에 적었다.

창 메뉴의 '모든 창 병합'은 앱이 항목을 제공해야 나온다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: 창 복원

**Files:**
- Modify: `packages/ipc-contract/src/index.ts` (`PersistedSettings.windows` · sanitize)
- Modify: `apps/desktop/src/main/settings.ts` (`readWindows`/`saveWindows`)
- Modify: `apps/desktop/src/main/index.ts` (`before-quit` 저장 · 시작 복원)
- Modify: `packages/ipc-contract/test/settings.test.ts`
- Modify: `apps/desktop/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: Task 1의 `registry.snapshot()` · `createWindow(seed)` · Task 4의 `sanitizeWindowLayout`.
- Produces: `readWindows(): PersistedWindow[]` · `saveWindows(list: PersistedWindow[]): void`.

- [ ] **Step 1: 계약서와 방어**

`packages/ipc-contract/src/index.ts`:

```ts
/** 마지막 종료 시점의 창 하나 (E15b) */
export interface PersistedWindow {
  repoPath: string | null
  layout: WindowLayout
}
```

`PersistedSettings`에 `windows?: PersistedWindow[]`를 더한다. **`AppSettings`에는 넣지 않는다** — 렌더러가 볼 이유가 없고, `sanitizeSettings`가 renderer 표면만 추리는 규칙이 그대로 지켜져야 한다.

`sanitizePersistedSettings`에 방어를 더한다 — E15a의 `recentRepos`와 같은 이유로, 이 값은 사람이 편집할 수 있는 디스크 파일에서 오고 `repoPath`가 **창을 만드는 인자**가 된다:

```ts
  if (Array.isArray(candidate.windows)) {
    settings.windows = [...(candidate.windows as unknown[])]
      .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
      .map((entry) => ({
        repoPath: typeof entry.repoPath === 'string' ? entry.repoPath : null,
        layout: sanitizeWindowLayout(entry.layout),
      }))
  }
```

테스트를 `packages/ipc-contract/test/settings.test.ts`에 더한다:

```ts
describe('sanitizePersistedSettings의 windows 방어 (E15b)', () => {
  it('정상 목록은 그대로 통과한다', () => {
    const value = { windows: [{ repoPath: '/a', layout: { rightWidth: 300 } }] }
    expect(sanitizePersistedSettings(value).windows).toEqual([
      { repoPath: '/a', layout: { rightWidth: 300 } },
    ])
  })

  it('배열이 아니면 필드째 버린다', () => {
    expect(sanitizePersistedSettings({ windows: '창' })).not.toHaveProperty('windows')
  })

  it('원소가 객체가 아니면 버린다', () => {
    expect(sanitizePersistedSettings({ windows: ['/a', null, 3] }).windows).toEqual([])
  })

  it('repoPath가 문자열이 아니면 빈 창으로 만든다 — 창을 만드는 인자라 통과시키지 않는다', () => {
    expect(sanitizePersistedSettings({ windows: [{ repoPath: 42 }] }).windows).toEqual([
      { repoPath: null, layout: {} },
    ])
  })

  it('layout의 알 수 없는 키·틀린 타입은 걷어낸다', () => {
    const value = { windows: [{ repoPath: '/a', layout: { rightWidth: '넓게', 몰래: 1, terminalOpen: true } }] }
    expect(sanitizePersistedSettings(value).windows).toEqual([
      { repoPath: '/a', layout: { terminalOpen: true } },
    ])
  })
})
```

- [ ] **Step 2: 실패를 확인하고 구현한다**

Run: `cd "/Users/sangyeop_kim/git gui" && npx vitest run --root packages/ipc-contract`
Expected: FAIL → 구현 후 PASS

- [ ] **Step 3: main에 저장·복원을 배선한다**

`settings.ts`:

```ts
/** 마지막 종료 시점의 창들 (E15b) — renderer 표면이 아니라 별도 export다 */
export function readWindows(): PersistedWindow[] {
  return current().windows ?? []
}

export function saveWindows(list: PersistedWindow[]): void {
  save({ ...current(), windows: list })
}
```

`index.ts`의 `whenReady()`에서 `createWindow()` 대신:

```ts
    // 복원 (E15b) — 없어진 저장소는 그 창을 만들지 않고 넘어간다. 알림은 띄우지 않는다:
    // 시작하자마자 배너를 보는 건 성가시고, 그 경로는 최근 목록에서도 곧 빠진다
    const restored = readWindows()
    let created = 0
    for (const saved of restored) {
      if (saved.repoPath !== null) {
        const opened = await openRepoPath(saved.repoPath)
        if (!opened.ok) continue
        createWindow({ repoPath: opened.path, layout: saved.layout })
      } else {
        createWindow({ repoPath: null, layout: saved.layout })
      }
      created += 1
    }
    // 저장된 창이 없거나 전부 사라졌으면 빈 창 하나
    if (created === 0) createWindow()
```

**`GIT_GUI_E2E_REPO`가 있으면 복원하지 않는다** — E2E는 그 저장소 하나로 시작하는 것을 전제로 135건이 짜여 있다. 위 블록 전체를 `if (!process.env.GIT_GUI_E2E_REPO)`로 감싸고, 아니면 지금처럼 `createWindow()` 하나. **이 가드를 빼면 기존 E2E가 대량으로 깨진다.**

`before-quit` 저장:

```ts
// 종료 직전의 스냅샷을 남긴다 (E15b). 창이 하나씩 닫히는 'closed'로 지우면 마지막 창을 닫아
// 종료할 때 목록이 비어 버린다 — 닫히는 중이 아니라 종료 직전에 한 번 찍는다
app.on('before-quit', () => {
  saveWindows(registry.snapshot())
})
```

- [ ] **Step 4: 복원 E2E**

같은 `GIT_GUI_USER_DATA`로 두 번 launch한다. **그 경우 호출자가 `GIT_GUI_USER_DATA`를 직접 넘겨야** 하네스가 존중한다(`harness.ts:33` — 안 넘기면 매번 새 `mkdtemp`를 주입한다).

```ts
test('E15b — 껐다 켜면 열려 있던 창들이 돌아온다', async () => {
  const repo = await createRepoWithFile('a')
  const other = await createRepoWithFile('b')
  const userData = await mkdtemp(join(tmpdir(), 'gg-e15b-restore-'))
  try {
    // ── 1회차: 창 둘을 열고 종료한다 ──
    const first = await electron.launch({
      args: [APP_ROOT],
      env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
    })
    const windowA = await first.firstWindow()
    await windowA.getByTestId('file-unstaged-a.txt').waitFor()
    const pending = nextWindow(first)
    await windowA.evaluate((path: string) => window.gitApi.window.open(path), other)
    await (await pending).getByTestId('file-unstaged-b.txt').waitFor()
    await first.close()

    // ── 2회차: GIT_GUI_E2E_REPO 없이 띄운다 — 그래야 복원 경로를 탄다 ──
    // (Step 3의 가드: 그 변수가 있으면 복원하지 않는다. 기존 E2E 135건이 저장소 하나로
    //  시작하는 것을 전제로 짜여 있기 때문이다)
    const second = await electron.launch({
      args: [APP_ROOT],
      env: { ...process.env, GIT_GUI_USER_DATA: userData, GIT_GUI_E2E_SHOW: '1' },
    })
    try {
      // 창 둘이 각자의 저장소로 돌아왔다. 순서는 등록 순서 = 저장 순서다
      await expect
        .poll(() => second.windows().length, { timeout: 30_000 })
        .toBe(2)
      const paths = await Promise.all(
        second.windows().map(async (page) => {
          await page.locator('.app__header').waitFor({ timeout: 30_000 })
          return page.getByTestId('repo-path').textContent()
        }),
      )
      expect(paths).toEqual([repo, other])
    } finally {
      await second.close()
    }
  } finally {
    await rm(userData, { recursive: true, force: true })
  }
})
```

**주의 셋:**

1. **2회차에 `GIT_GUI_E2E_REPO`를 주지 않는다** — Step 3의 가드 때문에 그게 있으면 복원을 건너뛴다. 그래서 `e2eEnv(repo)` 대신 `process.env`를 펼친다. `e2eEnv`가 무엇을 담는지 먼저 읽고, `GIT_GUI_E2E_REPO` 외에 꼭 필요한 키가 있으면 그것만 골라 넣는다.
2. **`GIT_GUI_E2E_SHOW: '1'`이 2회차에 필요한지 실측한다.** 없으면 `isE2E` 판정(`index.ts:48`)이 `GIT_GUI_E2E_REPO` 부재로 false가 되어 창이 그냥 보이는데, 그건 상관없다. 오히려 `backgroundThrottling`이 켜져 복원된 창의 렌더가 느려질 수 있다 — 타임아웃이 나면 이 값을 조정하고 무엇이 필요했는지 적는다.
3. **`app.close()`가 `before-quit`를 실제로 발화시키는지 확인한다.** 안 하면 저장이 안 되고 이 테스트가 구조적으로 통과할 수 없다. 그 경우 `await first.evaluate(({ app }) => app.quit())` 뒤에 `close()`를 부르는 등 되는 방법을 찾고, **무엇이 필요했는지 실행 기록에 적는다.**

`app.close()`가 `before-quit`를 실제로 발화시키는지 **실측으로 확인한다** — 안 하면 저장이 안 되고 이 테스트가 구조적으로 통과할 수 없다. 그 경우 `app.evaluate(({ app }) => app.quit())`로 바꾸는 등 되는 방법을 찾고, 무엇이 필요했는지 적는다.

- [ ] **Step 5: 게이트 + 반증**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm lint && pnpm typecheck && pnpm test
cd "/Users/sangyeop_kim/git gui" && pnpm --filter @git-gui/desktop e2e
```
Expected: lint 0 errors / 5 warnings · 6/6 · **664** (659 + 5) · e2e **142**

반증: `saveWindows(registry.snapshot())` 제거 · 복원 루프 제거 · `windows` sanitize 제거 — 각각 어느 테스트를 무는지 적는다.

**Task 4 Step 6에서 깨졌다고 보고한 재시작 지속성 테스트가 있으면, 여기서 초록으로 돌아왔는지 확인하고 보고한다.**

- [ ] **Step 6: 커밋**

```bash
cd "/Users/sangyeop_kim/git gui"
git add apps/desktop packages/ipc-contract
git commit -m "feat(desktop): E15b 창 복원 — 껐을 때 그대로

종료 직전의 레지스트리 스냅샷을 설정에 남기고 시작할 때 그 순서로 창을 만든다.
창이 하나씩 닫히는 closed로 지우면 마지막 창을 닫아 종료할 때 목록이 비므로
before-quit에 한 번 찍는다.

windows는 사람이 편집할 수 있는 디스크 파일에서 오고 repoPath가 창을 만드는
인자가 된다 — recentRepos와 같은 이유로 sanitizePersistedSettings가 방어한다.

없어진 저장소는 그 창을 만들지 않고 넘어간다. 알림은 안 띄운다 — 시작하자마자
배너를 보는 건 성가시고 그 경로는 최근 목록에서도 곧 빠진다.

GIT_GUI_E2E_REPO가 있으면 복원하지 않는다 — 기존 E2E 135건이 저장소 하나로
시작하는 것을 전제로 짜여 있다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: 최종 게이트 + 스크린샷 + 실행 기록

**Files:**
- Modify: `docs/superpowers/plans/2026-08-10-e15b-multi-window.md` (이 파일 — 실행 기록)
- Modify: `README.md` (해당하면)

- [ ] **Step 1: 다섯 게이트**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm lint
cd "/Users/sangyeop_kim/git gui" && pnpm typecheck
cd "/Users/sangyeop_kim/git gui" && pnpm test
cd "/Users/sangyeop_kim/git gui" && pnpm --filter @git-gui/desktop build
cd "/Users/sangyeop_kim/git gui" && pnpm --filter @git-gui/desktop e2e
```
Expected: lint **0 errors / 5 warnings** · 6/6 · **664** · 성공 · **142**

- [ ] **Step 2: 스크린샷 2장**

두 창이 각각 다른 저장소를 보고 있는 상태(가능하면 탭으로 묶인 상태)와, 빈 창의 최근 목록. Playwright **창** 캡처만 쓴다. 스크래치패드에 저장하고 `ls -la`를 붙인다.

- [ ] **Step 3: 실행 기록**

이 플랜 말미에 「실행 기록」절을 추가한다. 반드시 담을 것:
- **Task 1 Step 8의 결과** — 두 창 E2E가 우리 하네스에서 실제로 어떻게 됐는지(이 에픽의 유일한 미지수였다)
- 플랜과 다르게 구현한 모든 편차와 이유
- Task 2 Step 2에서 감시 E2E가 정말 빨갰는지, 포커스 재조회가 가리지 않았는지
- Task 2 Step 4 반증 2번(해제 순서)을 무는 방법을 찾았는지, 못 찾았으면 왜
- Task 4 Step 6에서 깨진 기존 테스트가 있었는지, Task 7에서 돌아왔는지
- Task 6 Step 3의 `defaults read -g AppleWindowTabbingMode` 값과 탭바가 보였는지
- Task 7 Step 4에서 `app.close()`가 `before-quit`를 발화시켰는지
- 각 반증의 빨강/초록 출력
- 최종 게이트 다섯

- [ ] **Step 4: 커밋**

```bash
cd "/Users/sangyeop_kim/git gui"
git add docs/superpowers README.md
git commit -m "docs: E15b 실행 기록

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 후속 노트 (이 에픽에서 하지 않음)

- **탭 그룹 복원** — `addTabbedWindow`로 재현할 수는 있으나 그룹·순서·활성 탭을 따로 저장해야 하고, 탭 선호가 "항상"이면 복원된 창들이 어차피 다시 묶인다.
- **Windows/Linux 탭** — 네이티브 탭은 macOS 전용이고 직접 탭바를 그리는 것은 이 에픽을 두 배로 키운다.
- **창 위치·크기 복원** — Electron 기본 동작에 맡긴다. 레이아웃(사이드 접힘)과 다른 문제다.
- **저장소별 레이아웃 기억** — 사용자가 "열어준 창을 따라간다"를 골랐다.
- **두 인스턴스의 `recentRepos` lost update** — 한 프로세스의 두 창은 `settings` 모듈 싱글턴이라 안전하다(E15a 리뷰 실측). 앱을 두 번 띄우는 경우만 남는데 그건 별개 문제다.
- **`registry.add`의 방어적 복사에 그물이 없다** (Task 1 반증 실측). 변이 ①(`add`의 `{ ...state.layout }` → `state.layout`)이 **10건 중 하나도 안 물었다.** 지금 유일한 호출부(`createWindow`)는 `seedLayoutFrom`이 갓 만든 객체를 넘겨서 문제가 안 되지만, **Task 7이 디스크에서 읽은 layout을 여러 창에 나눠 넣으면 여기가 물리는 자리가 된다** — Task 7에서 "같은 layout 객체로 두 창을 만들어도 서로 안 흔들린다"를 무는 테스트를 더할지 판단한다.
- E15a에서 넘어온 것: **`headInfos` 캐시가 한 저장소 안에서 만료 안 됨**(fetch 후에도 분기점이 옛 값이고, 실패로 캐시된 `null`은 `key in headInfos` 조기 반환에 걸려 영원히 재시도 안 됨 — `remotes.fetch` 성공 시 무효화가 필요) · **`packages/**`가 eslint 밖** · **`apps/desktop/test/**`가 tsconfig `include` 밖** · **`sanitizeSettings`의 `leftCollapsed`/`rightCollapsed`에 그물 없음**(이 에픽의 Task 4가 `splitSettings`로 일부 덮는다) · E14c(참조 안정화, `TerminalDock`의 `[]` 이펙트가 마운트 시점 `sessions`를 굳혀 사이드 접기 refit이 실제로 안 돎).

---

## 실행 중 실측 정정 (컨트롤러)

- **vitest에서 electron은 import가 아니라 호출이 막는다** (Task 3 프로브). 플랜·브리핑이 "`git-handlers.ts`가 최상단에서 electron을 import해 단위 테스트가 불가능하다"고 적었는데 틀렸다 — 모듈 로드는 정상이고(`registerTerminalHandlers`가 함수로 잡힌다), 네임드 export가 전부 `undefined`라 **핸들러를 실행할 수 없는** 것이다. 순수부 추출이 유일한 경로라는 결론은 그대로 옳지만 이유가 다르다.
- **검증 대상 상수를 픽스처에 기호로 쓰면 그 상수를 못 잡는다** (Task 3 반증 실측 — E15a Task 1에서도 같은 게 나왔다). `MAX_SESSIONS_PER_WINDOW`를 16으로 바꾸는 변이가 4건 중 **1건만** 물었다: 나머지가 `Array.from({ length: MAX_SESSIONS_PER_WINDOW })`로 그 상수를 써서 16이어도 자기모순이 없다. 숫자를 실제로 고정하는 것은 `toBe(8)` 하나뿐이다. **앞으로 상수를 무는 테스트는 리터럴로 쓴다.**
- **남은 간극(Task 3)**: 단위 테스트는 `countSessionsFor`라는 순수 함수만 물고, **핸들러가 그것을 부르는지는 `typecheck`가 타입으로만 고정한다.** 상한 검사가 `assertAllowedRepo`·`assertWorktreePath` 뒤에 있고 allowlist는 실제 git으로만 채워지므로, 값싼 자동 검증이 없다(검사를 검증 앞으로 당기면 테스트는 쉬워지지만 보안 가드 순서를 테스트 편의로 바꾸는 것이다). 미검증분은 `>=` 부등호와 throw 문구 두 줄이다.

### Task 4 실측 정정

- **testid가 셋 다 틀렸다** (컨트롤러가 확인 없이 적었다): `left-collapse` → **`left-collapse-toggle`**(`smoke.spec.ts:3448`) · `changes-panel`은 **testid가 없다** — E12 관용구는 `locator('.app__left')` + `not.toBeVisible()` + `boundingBox().width === 0`이다(E13이 접힘을 언마운트가 아니라 폭 0으로 바꿔 count는 1로 남는다).
- **플랜의 Step 5 E2E는 공허했다.** "A를 접고 B는 그대로"만 보면 **수정 전 코드도 통과한다** — 렌더러 상태는 원래 창마다 메모리에 따로 있고, `settings:set`이 파일을 갈아도 이미 뜬 B는 다시 안 읽는다. 순서를 바꿔 **A를 먼저 접고 그 다음 A에서 B를 열어야** 갈라 저장한 값이 다시 읽히는 길(`seedLayoutFrom(A)` → `registry.get(B).layout` → `getSync` 병합)을 문다. 원안 순서였으면 두 변이 모두 초록이었다.
- `AppSettings extends WindowLayout`은 Task 1이 이미 했다(`ipc-contract/src/index.ts:353,372`). `index.ts:126` → 실제 **`:176`**(호출이 한 곳이라 무해).

### Task 5 실측 정정

- **`GIT_GUI_E2E_REPO` 되돌림 때문에 "빈 창" E2E가 불가능했다** — 플랜의 Step 5 셋째 테스트(`window.open(null)` + `GIT_GUI_E2E_REPO`)는 **원안 그대로는 통과할 수 없다.** Task 1이 `repo:initial-path`에 `seeded ?? process.env.GIT_GUI_E2E_REPO`를 뒀는데, ⌘N이 만든 창의 씨앗은 `null`이라 그 되돌림에 걸려 **빈 창이 조용히 그 저장소를 열었다**(실측: `repo-path`가 B가 아니라 A로 나왔다). 고침은 `index.ts`가 **첫 창의 씨앗으로만** 환경변수를 넣고 핸들러에서 되돌림을 지우는 것 — 의미상으로도 "시작할 때 이 저장소"가 맞다. Task 7의 복원은 씨앗을 직접 주므로 영향받지 않는다.
- **`click({ modifiers: ['Alt'] })`는 `onPointerDown`의 `event.altKey`에 그대로 실린다** (실측 — 통과). 플랜이 대비해 둔 `keyboard.down('Alt')` 우회는 필요 없었다.
- **`ContextMenu`를 `MenuTrigger` 바깥(프래그먼트 형제)에 두고 우클릭 때 팝오버를 먼저 닫는다.** 팝오버 안쪽에 두면 RAC Popover의 바깥 클릭 처리와 `ariaHideOutside`가 body 포털 메뉴를 물어 간다. RAC `MenuItem`은 `filterDOMProps(props, { global: true })`라 `onPointerDown`·`onContextMenu`가 그대로 통과한다(실측 — `react-aria-components@1.19.0`).
- **`window.gitApi`를 렌더러 컴포넌트에서 직접 부르지 않는다** (플랜 코드와의 편차). 이 저장소에서 `window.gitApi`를 아는 렌더러 파일은 `App.tsx`뿐이라 전환기·워크트리 패널은 콜백(`onOpenInNewWindow` · `WorktreeAction { kind: 'new-window' }`)으로 올린다. ⌘N만 `App.tsx`에 있어 직접 부른다.
- **우클릭 두 곳은 영구 E2E가 없다** — 플랜이 E2E 3건만 요구해서다. 대신 임시 스펙으로 두 경로(전환기 항목 우클릭 → `context-new-window` → 새 창 · 워크트리 행 우클릭 → 새 창이 그 워크트리 경로)를 실제로 돌려 초록을 확인하고 지웠다. 회귀 그물은 없다.
- **반증 3종이 1:1로 물었다**: ⌥ 분기 제거 → ⌥클릭 테스트만 · `findByRepoPath` → `undefined` 고정 → 중복 차단 테스트만 · `RepoPicker`의 `recent` 렌더 제거 → 최근 목록 테스트만. 각각 나머지 5건은 초록.

### ⚠️ Task 7이 반드시 복구해야 하는 것 (Task 4가 깨뜨렸다 — 진짜 회귀가 아니다)

```
e2e/smoke.spec.ts:373:5  › 우측 열 폭을 드래그로 조절하고 재시작해도 기억한다
e2e/smoke.spec.ts:3500:5 › E12 — 좌측을 접은 채 재시작해도 접힘이 유지된다
```

`rightWidth`·`leftCollapsed`가 이제 레지스트리에만 살고 `settings.json`에 안 남는다. **Task 7이 `windows` 배열을 디스크에 영속하면 둘 다 초록으로 돌아와야 한다.** Task 7은 이 두 건이 실제로 돌아왔는지 **명시적으로 확인하고 보고한다** — 안 돌아오면 복원 설계에 구멍이 있다는 뜻이다(창 하나짜리 재시작도 복원 경로를 타야 한다).

### Task 5 실측 정정

- **Task 1의 `seeded ?? process.env.GIT_GUI_E2E_REPO` 되돌림이 결함이었다.** ⌘N이 만든 창은 씨앗이 `null`이라 그 되돌림에 걸려 **조용히 `GIT_GUI_E2E_REPO`를 열었다**(실측: 빈 창의 `repo-path`가 B가 아니라 A). 고침은 환경변수를 **첫 창의 씨앗으로만** 넣고 핸들러의 되돌림을 지우는 것 — 의미상으로도 "시작할 때 이 저장소"가 맞고, Task 7의 복원은 씨앗을 직접 주므로 영향받지 않는다.
- **컴포넌트가 `window.gitApi`를 직접 부르면 안 된다** (플랜이 그렇게 지시했으나 틀렸다). 이 저장소에서 `window.gitApi`를 아는 렌더러 파일은 **`App.tsx` 하나뿐**이다(실측: `components/` 전체에 0건). 사용자 전역 지침의 프레젠테이션/로직 분리와도 어긋난다 — 콜백으로 올린다(`RepoSwitcher`에 `onOpenInNewWindow(path)`, `WorktreesPanel`에 `WorktreeAction { kind: 'new-window' }`). ⌘N만 `App.tsx`에 있어 직접 부른다.
- **`ContextMenu`는 `MenuTrigger` 바깥(프래그먼트 형제)에 두고 우클릭 때 팝오버를 먼저 닫는다** — 팝오버 안에 두면 RAC Popover의 바깥 클릭 처리와 `ariaHideOutside`가 body 포털 메뉴를 물어 간다.
- **`click({ modifiers: ['Alt'] })`는 `onPointerDown`의 `altKey`에 실린다** (실측 — 우회 불필요). RAC `MenuItem`이 `filterDOMProps(props, { global: true })`를 쓰고 `globalEvents`에 `onPointerDown`·`onContextMenu`가 둘 다 있다(`react-aria-components@1.19.0`).
- **E2E 기대치 정정: 141 → 143.** 플랜은 진입점 넷 중 ⌥클릭만 물고 우클릭 둘을 그물 밖에 뒀는데, 그건 과하다 — 우클릭 메뉴가 얇은 껍데기인 건 맞지만 **메뉴 항목이 사라지거나 배선이 끊기는 것은 그 껍데기에서만 일어나고** ⌥클릭 테스트는 그걸 못 본다. 두 건을 더해 진입점 넷이 전부 그물 안에 있다. 이후 태스크의 기대치는 **143 기준**이다.

### Task 6 — **구현 불가로 닫는다** (실측)

**`tabbingIdentifier` 한 줄이면 된다는 스펙 §6과 플랜 Task 6은 이 앱에서 거짓이다.**

Electron 35.7.5의 `native_window_mac.mm`이 이렇게 잇는다:

```objc
// ① 표준 타이틀바가 아니면 프레임 없는 창으로 취급한다
if (title_bar_style_ != TitleBarStyle::kNormal) set_has_frame(false);
// ② 그래서 이 분기로 간다
if (tabbingIdentifier.empty() || transparent() || !has_frame())
  [window_ setTabbingMode:NSWindowTabbingModeDisallowed];
// ③ 게터는 Disallowed면 nullopt를 준다 → JS에서 undefined
```

이 앱은 E7f/E7h가 `titleBarStyle: 'hidden'`을 골랐다(신호등을 헤더 세로 중앙에 맞추려고). 따라서 **AppKit 수준에서 탭이 금지된다.**

실측 매트릭스 (같은 프로세스, 옵션만 바꿔 나란히 — 컨트롤러가 독립 재현):

| 창 옵션 | `tabbingIdentifier` 읽기 |
| --- | --- |
| 기본 타이틀바 | `"probe.plain"` ✅ |
| `hidden` | `(undefined)` ❌ |
| `hidden` + `trafficLightPosition` | `(undefined)` ❌ |
| `hiddenInset` | `(undefined)` ❌ |
| `frame: false` | `(undefined)` ❌ |

**컨트롤러의 실측이 틀렸던 지점**: `electron.d.ts:3735`에 `tabbingIdentifier`가 있다는 것은 확인했지만, **타입에 심볼이 있다는 것이 그 창에서 동작한다는 뜻이 아니다.** 스펙 §6이 그걸 혼동했다.

`defaults read -g AppleWindowTabbingMode`는 **키 자체가 없다**(시스템 기본값) — 즉 스펙이 예상한 실패 사유("사용자가 탭 선호를 '안 함'으로 뒀다")와 무관하다. 막은 것은 **앱 자신의 타이틀바 선택**이다.

**창 메뉴는 반대로 플랜 초안이 전부 맞았다** — `Menu.getApplicationMenu()`는 `whenReady()`에 `null`이 아니고, `role === 'windowmenu'`로 찾히며, `append` 뒤 `setApplicationMenu(menu)` 재설치가 필요하다. 다만 **넣지 않는다**: `mergeAllWindows()`가 할 일이 없어 죽은 메뉴 항목이 된다.

**사용자 결정(2026-08-11): 앱이 탭바를 직접 그린다 → E15c로 분리.** 실질은 "한 창 안에 저장소 여러 개"이고, 그러면 Task 1~5가 창별로 만든 감시·터미널·설정을 탭별로 다시 쪼개야 한다. **탭마다 `WebContentsView`를 두면 각 탭이 자기 `webContents.id`를 가지므로 이 에픽의 산출물이 그대로 살아난다**(전부 `sender` 기준으로 키를 잡았다) — E15c 브레인스토밍의 출발점으로 삼는다. 신호등·드래그 영역·헤더가 탭바와 어떻게 공존하는지는 설계가 필요하다.

### Task 7 실측 정정

- **플랜 Step 3의 가드 범위가 자기모순이었다.** "복원 블록 **전체**를 `if (!process.env.GIT_GUI_E2E_REPO)`로 감싸라"고 적었는데, 복구 대상인 두 테스트(`:373`·`:3500`)는 **두 번의 launch 모두 그 변수를 넘긴다**(`:376`·`:3503`). 원안대로면 2회차가 복원 경로를 안 타서 **영영 복구 불가능**이다. 플랜의 두 요구(가드 vs 2건 복구)가 서로 모순이었다.
  **가른 결론**: 가드는 **"창 목록"에만** 걸고 **"첫 창의 레이아웃"은 통과**시킨다. 환경변수의 의미는 "시작할 때 이 저장소"이지 "레이아웃을 잊어라"가 아니고, 창 하나짜리 재시작도 복원 경로를 타야 한다.
- **`app.close()`는 `before-quit`를 발화시킨다** (실측 — 우회 불필요). `playwright-core@1.61.1`의 `coreBundle.js:43376`이 커스텀 close 핸들러에서 `electronHandle.evaluate(({ app }) => app.quit())`를 부른다. 즉 main에서 진짜 `app.quit()`이라 `before-quit → 창 닫기` 순서가 그대로고, 그 시점 레지스트리에 창들이 아직 다 있다.
- **플랜 Step 4의 복원 E2E가 반쯤 공허했다.** 창 개수와 경로만 봐서 "레이아웃을 창별로 실어 나르는" 부분이 그물 밖이었다 — 변이 ③(첫 창 layout 씨앗 제거)이 원안 테스트를 **못 물었다.** 레이아웃 단언을 더해 셋(개수·저장소 순서·창별 레이아웃)을 함께 물게 한다. **순서 함정**: 1회차에서 A를 **B를 연 뒤에** 접어야 한다 — 먼저 접으면 `seedLayoutFrom`이 B에도 접힘을 심어 단언이 공허해진다.
- **Step 1 sanitize 스니펫에 구멍**: 원소 필터가 `typeof === 'object' && !== null`뿐이라 **배열 원소가 통과**해 `{ repoPath: null, layout: {} }`이 되고, 손상된 파일 한 줄이 유령 빈 창을 띄운다. `!Array.isArray(entry)`가 필요하다.
- **`sanitizePersistedSettings`의 삽입 위치**: hosting 파싱이 early-return 셋을 쓰므로 `windows` 블록을 그 **앞**에 놓아야 한다. 뒤에 놓으면 `hosting` 없는 파일에서 `windows`가 통째로 사라진다.
- **Step 4 주의 2번(`GIT_GUI_E2E_SHOW`)은 불필요했다** — 2회차는 `GIT_GUI_E2E_REPO`가 없어 `isE2E`가 false이므로 영향이 없다. `backgroundThrottling`이 켜진 채로도 창 둘이 3초 안에 복원됐다.
- **`registry.add` 그물이 Task 1에서 안 물린 진짜 이유**: `setLayout`이 `state.layout = { ... }`로 **재대입**하므로 "같은 객체로 두 창을 만들어도 안 흔들린다" 류로는 못 잡는다. 그럼에도 Task 7에서 넣은 이유는 **상황이 바뀌어서**다 — 이제 `readWindows()`가 돌려주는 **설정 모듈 캐시에 살아 있는 객체**가 `add`로 들어간다. 복사를 빼면 레지스트리가 디스크 캐시를 붙들고, 누가 `setLayout`을 `Object.assign`으로 "최적화"하는 순간 창 하나의 변경이 디스크 캐시로 샌다. **그 붙듦 자체를 무는 형태**로 써야 걸린다.
- **알고 남긴 것**: 사용자가 창을 하나씩 다 닫은 뒤 종료하면 `closed` → `registry.remove`가 이미 비워서 빈 목록이 저장된다. 되살리지 않는다 — **"닫은 창은 다음에 안 뜬다"가 맞는 동작**이다.
- **자기 신고된 공허한 단언 2건**: sanitize 테스트의 `배열이 아니면 필드째 버린다`(`not.toHaveProperty`)와 `windows는 renderer 표면이 아니다`는 구현 전에도 초록이었다(6건 중 4건만 빨감). 부정 단언이라 구조적으로 그렇고, 미래의 누출을 막는 그물로 남긴다.

---

## 실행 기록 (Task 8)

> 위의 「실행 중 실측 정정」과 Task 4/5/6/7 정정절이 각 태스크의 상세를 이미 담고 있다. 여기서는
> **그 절들이 안 담은 것**만 적는다 — 관문의 결과, Task 6을 닫은 이유 한 문단, 후속(E15c)의 출발점,
> 그리고 에픽 전체를 가로지르는 두 목록(플랜 오류·공허한 E2E)과 최종 숫자.

### 관문(Task 1 Step 8)의 결과 — 이 에픽의 유일한 미지수

**두 창 E2E는 우리 하네스에서 그대로 됐다. 우회가 필요 없었다.** 플랜이 걱정한 세 가지가 전부
문제가 아니었다:

- **숨김 창도 `waitForEvent('window')`에 잡힌다.** 이 앱은 모든 창을 `show: false`로 만들고
  (`index.ts:84`) E2E에서 `GIT_GUI_E2E_SHOW`가 없으면 `ready-to-show`에서도 **끝까지 안 보여준다**
  (`:108`). 그래도 두 번째 창은 정상적으로 이벤트에 잡히고 렌더도 비어 있지 않았다 — Playwright의
  window 이벤트는 `webContents` 생성에 붙지 창의 가시성과 무관하기 때문이다. E2E 144건 중 **9건이
  창 둘 이상**을 쓰는데 전부 이 방식이다.
- **`GIT_GUI_USER_DATA` 격리는 프로세스 단위라 두 창이 같은 디렉터리를 공유한다** (`index.ts:45`의
  `app.setPath('userData', …)`는 프로세스에 한 번). 창별 격리가 아니어서 **Task 4의 창별/앱공용
  분리가 필요했다** — 두 창이 같은 `settings.json`에 레이아웃을 쓰면 나중 창이 앞 창을 덮는다.
  관문 단계에서는 이게 결함으로 드러나지 않았다(창 하나짜리 테스트만 있었으니).
- **숨김 창의 `backgroundThrottling`**: `isE2E`면 끄고 있어(`:91`) 두 번째 창도 즉시 그려졌다.
  Task 7의 재시작 2회차는 `isE2E`가 false라 throttling이 켜진 채인데, 그래도 창 둘이 3초 안에
  복원됐다(→ 위 «Task 7 실측 정정»).

**관문에서 실제로 걸린 것은 하네스가 아니라 플랜의 E2E 코드였다** — `page.evaluate(fn, arg)`를
`locator.evaluate(el, arg)`의 2인자 시그니처로 잘못 써서 경로가 `undefined`로 갔고, `finally`의
`app.close()`가 먼저 돌아 대기 중이던 `pending`이 `Target page… has been closed`로 reject되며
**진짜 오류가 가려졌다.** 헬퍼 이름 셋(`appEntry`·`e2eEnv`·`createRepoWithFile`의 인자 의미)도
플랜이 지어낸 것이었다(→ Task 1 「E2E 헬퍼 실측 정정」 표).

### Task 6을 구현 불가로 닫은 이유 — 한 문단

스펙 §6과 플랜 Task 6은 "`tabbingIdentifier` 한 줄이면 네이티브 탭이 된다"고 적었는데,
**타입 정의에 심볼이 있다는 것과 그 창에서 그 심볼이 동작한다는 것은 다른 문제다.** 컨트롤러는
`electron.d.ts:3735`에 `tabbingIdentifier`가 있음을 확인하고 거기서 멈췄지만, Electron 35.7.5의
`native_window_mac.mm`은 **표준 타이틀바가 아닌 창을 프레임 없는 창으로 취급하고
(`title_bar_style_ != kNormal → set_has_frame(false)`), 프레임이 없으면 `NSWindowTabbingModeDisallowed`를
건다.** 이 앱은 E7f/E7h가 신호등을 헤더 세로 중앙에 맞추려고 `titleBarStyle: 'hidden'`을 골랐으므로
**AppKit 수준에서 탭이 금지된다** — 옵션만 바꿔 나란히 돌린 5행 매트릭스에서 기본 타이틀바만
`"probe.plain"`을 돌려주고 `hidden`·`hiddenInset`·`frame:false`는 전부 `undefined`였다(→ 위
«Task 6 — 구현 불가로 닫는다»). 즉 막은 것은 사용자의 OS 탭 선호가 아니라 **앱 자신의 타이틀바
선택**이고, 되돌리려면 한 줄 타이틀바를 포기해야 해서 **헤더를 지키고 탭을 버렸다.**

### 사용자 결정 — 탭은 E15c로 분리한다

**앱이 탭바를 직접 그린다.** 네이티브 탭이 막혔다고 요구("탭으로도 관리")가 사라지지는 않는다.
실질은 "한 창 안에 저장소 여러 개"이므로 Task 1~5가 **창별**로 만든 감시·터미널 상한·설정을
**탭별**로 다시 쪼개야 하는데, 여기가 이 에픽의 산출물이 버려지느냐 마느냐의 갈림길이다.

**출발점: 탭마다 `WebContentsView`를 둔다.** 그러면 각 탭이 자기 `webContents.id`를 가지고,
이 에픽이 만든 것들은 전부 `sender` 기준으로 키를 잡았으므로(레지스트리·감시 Map·터미널 상한·
설정 분리) **그대로 산다** — "창"이라고 부르던 단위가 "탭"이 될 뿐이다. 설계가 남은 것은
신호등·드래그 영역·헤더가 탭바와 어떻게 공존하는가다.

### 이 에픽에서 컨트롤러의 플랜이 틀린 곳 — 태스크별 한 줄

| 태스크 | 플랜이 틀린 것 | 근거 |
| --- | --- | --- |
| 1 | E2E 헬퍼 이름 셋을 지어냈고, `page.evaluate`를 2인자로 써서 진짜 오류를 가렸다 | Task 1 「E2E 헬퍼 실측 정정」 |
| 2 | 인용한 라인 번호가 전부 어긋났다 — **Task 1이 같은 파일을 늘렸는데 플랜은 늘기 전 번호였다** | `faa94b9` |
| 3 | "electron을 최상단 import해서 단위 테스트가 불가능하다"가 틀렸다 — 로드는 되고 **네임드 export가 `undefined`**라 실행이 안 되는 것이다 | 「실행 중 실측 정정」 |
| 4 | testid 셋이 전부 틀렸고, Step 5 E2E는 **순서 때문에 수정 전 코드도 통과**했다 | 「Task 4 실측 정정」 |
| 5 | 컴포넌트에서 `window.gitApi`를 직접 부르라고 지시했다(이 저장소는 `App.tsx`만 안다) · Task 1이 남긴 `GIT_GUI_E2E_REPO` 되돌림이 **빈 창을 조용히 옛 저장소로 열었다** · E2E 기대치 141 → 실제 143 | 「Task 5 실측 정정」 |
| 6 | "`tabbingIdentifier` 한 줄이면 된다" — **구현 불가** | 「Task 6」 |
| 7 | 가드 범위가 **자기모순**이었다(원안대로면 복구 대상 2건이 영영 복구 불가) · 복원 E2E가 반쯤 공허 · sanitize 스니펫에 배열 구멍 | 「Task 7 실측 정정」 |
| 8 | 게이트 기대치가 낮았다: `pnpm test` **664 → 실제 666** · e2e **142 → 실제 144** (Task 5가 우클릭 2건, Task 7이 sanitize 2건을 더했다) | 아래 최종 게이트 |

**여덟 태스크 중 일곱에서 플랜이 틀렸고 전부 구현자가 실측으로 잡았다.** 공통 원인은 하나다 —
플랜이 **읽지 않고 적은 것**(헬퍼 이름·testid·라인 번호·API 시그니처·타입에 있는 심볼)이 틀렸고,
**읽고 적은 것**(창 메뉴 API·`app.close()`의 `before-quit`·RAC의 `filterDOMProps`)은 맞았다.

### 공허했던 E2E — 이 에픽에서 3건

"통과했지만 수정 전 코드도 통과시켰을" 테스트다. 셋 다 **반증(고의 변이)을 돌려서** 드러났고,
반증을 안 돌렸으면 초록인 채로 병합됐다.

| 어디 | 무엇 때문에 공허했나 | 어떻게 고쳤나 |
| --- | --- | --- |
| Task 4 Step 5 — 사이드 접힘이 창마다 따로 산다 | **순서.** "A를 접고 B는 그대로"는 원래부터 참이다 — 렌더러 상태는 창마다 메모리에 따로 있고 이미 뜬 B는 파일을 다시 안 읽는다. 두 변이 모두 초록이었다 | A를 **먼저 접고 그 다음 A에서 B를 열어** 갈라 저장한 값이 씨앗으로 다시 읽히는 길을 물게 했다 |
| Task 7 Step 4 — 껐다 켜면 창들이 돌아온다 | **단언 부족.** 창 개수와 저장소 경로만 봐서 "레이아웃을 창별로 실어 나르는" 부분이 그물 밖 — 변이 ③(첫 창 layout 씨앗 제거)을 못 물었다 | 창별 레이아웃 단언을 더해 셋(개수·순서·레이아웃)을 함께 물게 했다. **순서 함정**: 1회차에서 A는 B를 연 **뒤에** 접어야 한다 |
| Task 5 Step 5 셋째 — ⌘N이 연 빈 창 | 공허를 넘어 **애초에 통과 불가능**했다. Task 1의 `seeded ?? GIT_GUI_E2E_REPO` 되돌림에 걸려 빈 창이 조용히 A를 열었다(실측: `repo-path`가 B가 아니라 A) | 환경변수를 **첫 창의 씨앗으로만** 넣고 핸들러의 되돌림을 지웠다 — 결함은 테스트가 아니라 제품에 있었다 |

같은 실패 방식이 **단위 테스트에서도 3건** 나왔다(다음 에픽이 같이 피하도록 적는다):
`MAX_SESSIONS_PER_WINDOW`를 픽스처에 **기호로** 써서 상수를 16으로 바꿔도 4건 중 3건이 자기모순이
없었고(Task 3), Task 7 sanitize의 **부정 단언 2건**(`not.toHaveProperty`류)은 구현 전에도 초록이었다
— 후자는 구조적으로 그런 것이라 미래의 누출을 막는 그물로 **알고 남겼다**.

**다음 에픽으로 가져갈 규칙 셋**: ① 검증 대상 상수는 픽스처에 **리터럴**로 쓴다. ② 여러 창(탭)이
얽히는 테스트는 **동작 순서**가 곧 단언이다 — "언제 접었나"가 "무엇을 접었나"보다 중요하다.
③ 부정 단언만으로 이루어진 테스트는 공허할 것을 **미리 알고** 쓰거나 쓰지 않는다.

### 최종 게이트 다섯 (실측)

| 게이트 | 플랜 기대 | 실측 |
| --- | --- | --- |
| `pnpm lint` | 0 errors / 5 warnings | **0 errors / 5 warnings** ✅ (전부 `react-hooks/incompatible-library` — TanStack Virtual, E14b부터 알고 남긴 것) |
| `pnpm typecheck` | 6/6 | **6/6** ✅ |
| `pnpm test` | 664 | **666 passed / 55 files** (38.9s) — 플랜보다 2건 많다 |
| `pnpm --filter @git-gui/desktop build` | 성공 | **성공** ✅ (renderer 1,732.75 kB, 1.52s) |
| `pnpm --filter @git-gui/desktop e2e` | 142 | **144 passed / 0 failed** (3.6m) — 플랜보다 2건 많다 |

E15b가 더한 것: 단위 **+27**(639 → 666) · E2E **+9**(135 → 144).

**스크린샷**(Playwright 창 캡처 — OS 화면 캡처 아님): 두 창이 각각 `git-gui`(app.txt)와
`design-system`(tokens.css)를 보고 있는 상태 2장 + ⌘N이 연 빈 창의 최근 목록 1장. 셋 다 헤더
전환기에 서로 다른 저장소 이름이 떠 있고, 빈 창에는 `저장소 열기` 아래 「최근 연 저장소」 3개가
그려진다(E15b가 `RepoPicker`에 붙인 것 — 이전에는 OS 다이얼로그 버튼 하나뿐이었다).
