/**
 * 배경 새로고침 vs 사용자 클릭 — 스토어 배선의 회귀 테스트 (E14a 스펙 §2-4-3).
 *
 * 왜 스토어를 직접 도는가: `run-guard`의 선점/양보는 `run-guard.test.ts`가 고정한다. 하지만
 * **`refresh`가 그걸 실제로 어떻게 쓰는지**(양보로 부르는가·되살린 필드를 제대로 빼는가)는 거기서
 * 안 잡힌다. `SNAPSHOT_DEFERS`를 `claims`로 바꿔도 run-guard 테스트는 전부 초록이다 —
 * 그 구멍이 이 에픽에서 실제로 회귀를 냈다(main에서 옳던 동작이 깨졌고 리뷰가 잡았다).
 *
 * repository-store.ts는 window.gitApi IPC 브리지에 묶여 있어 단위 테스트가 없었다. 여기서는
 * 지연을 주입할 수 있는 가짜 브리지를 깔아 **완료 순서를 결정적으로** 만든다 — 실제 시간에
 * 의존하지 않도록 지연은 전부 명시적이고, 두 시나리오의 차이는 오직 시작 순서다.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { FileChange } from '@git-gui/domain'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function change(path: string) {
  return { path, staged: 'none', unstaged: 'modified', origPath: null } as unknown as FileChange
}

/** hosting().status는 gh CLI 셸아웃이라 수백 ms급이다 — refresh의 지연 구간이 여기다 */
let hostingDelay = 0

/** 워킹트리에 남아 있는 파일 — 외부에서 사라지는 상황을 만들려고 테스트가 바꾼다 */
let presentFiles = ['a.txt', 'b.txt']

function makeGitApi(diffDelay: number) {
  return {
    repo: {
      select: async () => '/other',
      status: async (repoPath: string) => ({
        state: 'clean',
        branch: 'main',
        changes: presentFiles.map(change),
        ahead: 0,
        behind: 0,
        upstream: null,
        repoPath,
      }),
      watch: () => {},
      unwatch: () => {},
      onChanged: () => () => {},
    },
    history: { list: async () => [] },
    branches: { list: async () => [], overview: async () => [] },
    shelf: { list: async () => [] },
    worktrees: { list: async () => [] },
    rebase: { progress: async () => null },
    changes: {
      diff: async (_repoPath: string, path: string) => {
        await sleep(diffDelay)
        return { path, hunks: [], binary: false, origPath: null }
      },
    },
  }
}

// 스토어 모듈이 로드 시점에 window.settingsApi를 읽으므로 import보다 먼저 깔아 둔다
;(globalThis as { window?: unknown }).window = {
  gitApi: null,
  hostingApi: {
    status: async () => {
      await sleep(hostingDelay)
      return { available: false, login: null, repo: null }
    },
  },
  windowApi: { setTitle: () => {}, onFocused: () => {} },
  settingsApi: { initial: { pullMode: 'merge' } },
}

type StoreModule = typeof import('../src/renderer/src/store/repository-store')
let mod: StoreModule

beforeEach(async () => {
  presentFiles = ['a.txt', 'b.txt']
  mod = await import('../src/renderer/src/store/repository-store')
})

/** a.txt를 보고 있는 상태에서 시작한다 — "선택 없음 → 첫 선택"은 이 경합의 대상이 아니다 */
async function openedOnA(diffDelay: number) {
  ;(globalThis as { window: { gitApi: unknown } }).window.gitApi = makeGitApi(diffDelay)
  const store = mod.useRepositoryStore
  store.setState({ repoPath: '/repo', selected: null, diff: null, status: null })
  await store.getState().selectFile({ change: change('a.txt'), staged: false })
  expect(store.getState().selected?.change.path).toBe('a.txt')
  return store
}

describe('배경 새로고침은 사용자의 선택을 이기지 않는다 (스펙 §2-4-3)', () => {
  it('refresh가 먼저 시작해도, 그사이 누른 파일이 남는다', async () => {
    hostingDelay = 200
    const store = await openedOnA(0)

    // 창 포커스 복귀 → refresh 시작. 지연은 revive가 prev를 읽은 **뒤**의 hosting().status()다
    const refreshing = store.getState().refresh()
    await sleep(20)
    // 사용자가 b.txt 클릭 — 빠르게 끝난다
    await store.getState().selectFile({ change: change('b.txt'), staged: false })
    await refreshing

    expect(store.getState().selected?.change.path).toBe('b.txt')
  })

  it('사용자 클릭이 먼저 돌고 있으면, 늦게 시작한 refresh가 그 선택을 되돌리지 않는다', async () => {
    hostingDelay = 0
    const store = await openedOnA(200)

    // 사용자가 b.txt 클릭 — 큰 파일이라 조회가 느리다
    const clicking = store.getState().selectFile({ change: change('b.txt'), staged: false })
    await sleep(20)
    // 그 직후 외부 저장·포커스 복귀로 배경 갱신이 시작된다 (이쪽이 먼저 끝난다)
    const refreshing = store.getState().refresh()
    await Promise.all([clicking, refreshing])

    // main에서는 busy 재진입 거부가 이걸 지켜줬다 — E14a가 그걸 뺐으므로 양보로 지켜야 한다
    expect(store.getState().selected?.change.path).toBe('b.txt')
  })

  it('양보해도 스냅샷의 나머지는 버리지 않는다 — main처럼 통째로 포기하지 않는다', async () => {
    hostingDelay = 0
    const store = await openedOnA(200)

    const clicking = store.getState().selectFile({ change: change('b.txt'), staged: false })
    await sleep(20)
    const refreshing = store.getState().refresh()
    await Promise.all([clicking, refreshing])

    // main은 refresh 자체가 guard에 거부돼 status가 null로 남았다(실측). 여기서는 반영돼야 한다
    expect(store.getState().status).not.toBeNull()
    expect(store.getState().selected?.change.path).toBe('b.txt')
  })

  it('아무도 안 건드리면 refresh가 보던 선택을 되살린다 — 양보가 과잉이 아니다', async () => {
    hostingDelay = 0
    const store = await openedOnA(0)

    await store.getState().refresh()

    expect(store.getState().selected?.change.path).toBe('a.txt')
  })

  /**
   * 위 테스트만으로는 부족하다 — 양보가 늘 참이어도 "안 건드렸으니 그대로 남는다"로 통과한다
   * (실측: 그 변이에서 4건 전부 초록이었다). refresh가 **실제로 선택 상태를 쓴다**는 것은
   * 대상이 사라졌을 때 닫히는지로만 확인된다. CLEAR_SELECTIONS가 도는 경로다.
   */
  it('보던 파일이 외부에서 사라지면 refresh가 선택을 닫는다 — 양보가 CLEAR까지 삼키면 안 된다', async () => {
    hostingDelay = 0
    const store = await openedOnA(0)

    // 앱 밖에서 a.txt의 변경이 되돌려졌다 — 더는 목록에 없다
    presentFiles = ['b.txt']
    await store.getState().refresh()

    expect(store.getState().selected).toBeNull()
    expect(store.getState().diff).toBeNull()
  })
})
