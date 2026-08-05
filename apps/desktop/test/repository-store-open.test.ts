/**
 * 저장소 경계 — `openRepository`가 옛 저장소에 매인 상태를 비우는지 고정한다 (E15a).
 *
 * 왜 별도 파일인가: `repository-store-refresh.test.ts`는 "배경 새로고침 vs 사용자 클릭"이라는
 * 한 경합만 다루고, 그 하네스가 `hostingDelay`·`presentFiles`·`makeGitApi(diffDelay)`처럼
 * **지연 주입에 맞춰진 모듈 전역**을 쓴다. 여기서 필요한 건 지연이 아니라 `repo.open`·
 * `worktrees.headInfo`·`remotes.fetch`가 깔린 다른 표면이라, 그 파일의 가짜를 넓히면 두 주제가
 * 한 픽스처를 공유하게 된다. 스토어 모듈은 파일 단위로 싱글턴이므로 파일을 가르면 상태도 안 샌다.
 *
 * 왜 E2E가 아니라 여기인가: 유출 3건 중 `headInfos`는 화면에 드러나지 않아 E2E가 물지 못했다
 * (실측 — `headInfos: {}`를 빼도 E2E는 초록이었다). 스토어를 renderer 밖으로 노출하지 않으므로
 * Playwright에서 읽을 길이 없다. `lastFetchAt`은 E2E도 물지만 3분이 걸린다 — 여기서도 문다.
 */
import { beforeEach, describe, expect, it } from 'vitest'

/** 이 테스트가 건드리는 표면만 깐다 — openRepository가 실제로 부르는 것들 */
function makeGitApi() {
  return {
    repo: {
      select: async () => '/other',
      // E15a Task 2가 더한 채널 — 최근 목록에서 고른 경로로 다이얼로그 없이 연다
      open: async (path: string) => path,
      status: async (repoPath: string) => ({
        state: 'clean',
        branch: 'main',
        changes: [],
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
    worktrees: {
      list: async () => [],
      headInfo: async () => ({ subject: '첫 저장', authoredAt: 0, author: 'E2E' }),
    },
    rebase: { progress: async () => null },
    remotes: { fetch: async () => {} },
  }
}

// 스토어 모듈이 로드 시점에 window.settingsApi를 읽으므로 import보다 먼저 깔아 둔다
;(globalThis as { window?: unknown }).window = {
  gitApi: makeGitApi(),
  hostingApi: { status: async () => ({ available: false, login: null, repo: null }) },
  windowApi: { setTitle: () => {}, onFocused: () => {} },
  // set은 saveRecentRepos가 부른다 — openRepository가 성공하면 최근 목록을 영속한다 (E15a)
  settingsApi: { initial: { pullMode: 'merge' }, set: () => {} },
}

type StoreModule = typeof import('../src/renderer/src/store/repository-store')
let mod: StoreModule

beforeEach(async () => {
  mod = await import('../src/renderer/src/store/repository-store')
})

describe('저장소를 바꾸면 옛 저장소에 매인 상태가 남지 않는다 (E15a)', () => {
  it('openRepository가 headInfos 캐시와 마지막 가져옴 시각을 비운다', async () => {
    const store = mod.useRepositoryStore
    store.setState({ repoPath: '/repo', headInfos: {}, lastFetchAt: null })

    // 저장소 A에서 흔적을 만든다 — 실제 액션으로 채운다(키 형식·설정 경로까지 같이 고정된다)
    await store.getState().loadHeadInfo('/repo', 'abc123')
    await store.getState().autoFetchRemotes()
    // 전제 확인 — 여기가 비어 있으면 아래 단언이 공허하게 통과한다
    expect(Object.keys(store.getState().headInfos)).toEqual(['/repo::abc123'])
    expect(store.getState().lastFetchAt).not.toBeNull()

    await store.getState().openRepository('/other')

    // 전환이 실제로 일어났는가 — 이것도 공허한 통과 방지용이다
    expect(store.getState().repoPath).toBe('/other')
    expect(store.getState().headInfos).toEqual({})
    expect(store.getState().lastFetchAt).toBeNull()
  })
})
