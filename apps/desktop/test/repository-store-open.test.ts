/**
 * 저장소 경계 — `openRepository`가 옛 저장소에 매인 상태를 비우는지, 그리고 **전환 도중 출발한
 * 조회가 새 저장소 화면에 착지하지 않는지** 고정한다 (E15a · E15a 리뷰 ①).
 *
 * 왜 별도 파일인가: `repository-store-refresh.test.ts`는 "배경 새로고침 vs 사용자 클릭"이라는
 * 한 경합만 다루고, 그 하네스가 `hostingDelay`·`presentFiles`·`makeGitApi(diffDelay)`처럼
 * **지연 주입에 맞춰진 모듈 전역**을 쓴다. 여기서 필요한 건 `repo.open`·`worktrees.headInfo`·
 * `remotes.fetch`가 깔린 다른 표면이고, 지연도 "**옛 저장소의** 조회만 느리다"라는 다른 모양이라
 * (전환이 끝난 뒤에 착지시켜야 한다), 그 파일의 가짜를 넓히면 두 주제가 한 픽스처를 공유하게 된다.
 * 주제가 같은 쪽으로 모은다 — 여기는 처음부터 "저장소 경계" 파일이다. 스토어 모듈은 파일 단위로
 * 싱글턴이므로 파일을 가르면 상태도 안 샌다.
 *
 * 왜 E2E가 아니라 여기인가: 유출 3건 중 `headInfos`는 화면에 드러나지 않아 E2E가 물지 못했다
 * (실측 — `headInfos: {}`를 빼도 E2E는 초록이었다). 스토어를 renderer 밖으로 노출하지 않으므로
 * Playwright에서 읽을 길이 없다. `lastFetchAt`은 E2E도 물지만 3분이 걸린다 — 여기서도 문다.
 * 리뷰 ①의 경합은 더더욱 그렇다 — 착지 순서를 결정적으로 만들려면 지연 주입이 필요하다.
 */
import { beforeEach, describe, expect, it } from 'vitest'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** `repo.open`이 걸리는 시간 — 이 창 안에서 배경 조회를 출발시켜 "전환 도중"을 만든다 */
let openDelay = 0
/** **옛 저장소**(/repo)를 향한 조회만 느리다 — 전환이 끝난 **뒤에** 착지시키기 위한 장치다 */
let oldRepoDelay = 0
/** `remotes.fetch`가 걸리는 시간 — autoFetchRemotes를 전환 너머로 늘어뜨린다 */
let fetchDelay = 0

/** 이 테스트가 건드리는 표면만 깐다 — openRepository·refresh·autoFetchRemotes가 실제로 부르는 것들 */
function makeGitApi() {
  return {
    repo: {
      select: async () => '/other',
      // E15a Task 2가 더한 채널 — 최근 목록에서 고른 경로로 다이얼로그 없이 연다.
      // E15a 리뷰 ④로 반환이 결과 객체가 됐다(실패 원인을 렌더러가 알아야 목록 제거를 정한다)
      open: async (path: string) => {
        await sleep(openDelay)
        return { ok: true, path } as const
      },
      status: async (repoPath: string) => {
        if (repoPath === '/repo') await sleep(oldRepoDelay)
        return {
          state: 'clean',
          // 저장소별로 값이 달라야 "어느 쪽 데이터가 남았나"를 단언할 수 있다
          branch: repoPath === '/other' ? 'NEW-BRANCH' : 'main',
          changes: [],
          ahead: 0,
          behind: 0,
          upstream: null,
          repoPath,
        }
      },
      // 워크트리를 앱에서 연다 — 검증·정규화는 main이 하고 정규화 경로를 돌려준다 (E7c)
      openPath: async (_repoPath: string, path: string) => path,
      watch: () => {},
      unwatch: () => {},
      onChanged: () => () => {},
    },
    workspace: {
      select: async () => ({
        path: '/workspace',
        name: 'workspace',
        repositories: [
          { path: '/workspace/back', relativePath: 'back', name: 'back' },
          { path: '/workspace/front', relativePath: 'front', name: 'front' },
        ],
      }),
      initial: async () => null,
      refresh: async () => null,
      close: async () => {},
    },
    history: { list: async () => [] },
    branches: { list: async () => [], overview: async () => [] },
    shelf: { list: async () => [] },
    worktrees: {
      list: async () => [],
      headInfo: async () => ({ subject: '첫 저장', authoredAt: 0, author: 'E2E' }),
    },
    // E15c Task 6 — openRepository(path)는 갈아타기 전에 "이미 열려 있나"를 main에 묻는다.
    // 이 파일의 주제(저장소 경계)는 전부 "안 열려 있어서 갈아타는" 경로다 — 항상 false
    tabs: { showExisting: async () => false },
    rebase: { progress: async () => null },
    remotes: {
      list: async () => [],
      fetch: async () => {
        await sleep(fetchDelay)
      },
    },
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
type GuardModule = typeof import('../src/renderer/src/store/run-guard')
let mod: StoreModule
let guard: GuardModule

beforeEach(async () => {
  openDelay = 0
  oldRepoDelay = 0
  fetchDelay = 0
  mod = await import('../src/renderer/src/store/repository-store')
  guard = await import('../src/renderer/src/store/run-guard')
})

describe('저장소를 바꾸면 옛 저장소에 매인 상태가 남지 않는다 (E15a)', () => {
  it('껍데기 폴더를 고르면 하위 저장소를 워크스페이스로 열고 첫 저장소로 전환한다', async () => {
    const store = mod.useRepositoryStore
    store.setState({ repoPath: '/repo', workspace: null, workspaceRepository: null })

    await store.getState().openRepository()

    expect(store.getState().repoPath).toBe('/workspace/back')
    expect(store.getState().workspace?.path).toBe('/workspace')
    expect(store.getState().workspace?.repositories).toHaveLength(2)
  })

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

/**
 * 워크트리 전환(`openWorktree`)은 **저장소 경계가 아니다** (E15a 리뷰 후속).
 *
 * `openWorktree`도 `repoPath`를 갈아치우므로 "그럼 openRepository와 같은 초기화를 해야 하지
 * 않나"가 자연스러운 질문이고, 코드 주석도 "저장소 전환과 같은 초기화 (openRepository 관례)"
 * 라고 적혀 있었다. 하지만 **비워야 할 것과 비우면 안 되는 것이 갈린다.** 기준은 그 값이
 * 워크트리에 매였는가, 저장소에 매였는가다 — 링크드 워크트리는 HEAD·인덱스·워킹트리만 자기
 * 것이고 objects·refs·remotes는 공용 git dir을 함께 쓴다.
 *
 * 실측(git, macOS):
 * - 워크트리 B의 `--git-common-dir`는 A의 `.git`이다 — 공유가 맞다
 * - 워크트리 A에서**만** `git fetch`했는데 B가 보는 `origin/main`이 함께 바뀌었다
 *   (`c5cc7e6` → `7449ff6`). **fetch는 저장소 전체에 적용된다** → `lastFetchAt`은 저장소에 매였다
 * - `git worktree list`는 A에서 보든 B에서 보든 경로·HEAD가 **완전히 같다**
 *   → `headInfos`의 캐시 키(`경로::HEAD`)는 전환 뒤에도 그대로 읽힌다
 *
 * 그래서 이 둘은 `openWorktree`에서 **살아남는 것이 옳다.** 비우면 방금 갱신한 원격 refs를
 * 두고 "한 번도 안 가져왔어요"라고 말하게 되고(사용자는 불필요한 재fetch를 하게 된다), 아직
 * 유효하고 화면에 그려지는 캐시를 버려 호버마다 다시 조회하게 된다.
 *
 * 반면 `status`·`history`·`changes`·선택 상태는 워크트리마다 다르므로(HEAD·인덱스가 자기 것이다)
 * `openWorktree`가 지금도 CLEAR_SELECTIONS + 새 스냅샷으로 갈아엎는다. 지금의 갈림은 우연이
 * 아니라 정확하다 — 이 테스트가 그걸 고정한다.
 */
describe('워크트리 전환은 저장소 경계가 아니다 (E15a 리뷰 후속)', () => {
  it('openWorktree는 저장소에 매인 lastFetchAt·headInfos를 유지한다', async () => {
    const store = mod.useRepositoryStore
    store.setState({ repoPath: '/repo', headInfos: {}, lastFetchAt: null })

    // 실제 액션으로 채운다 — 키 형식까지 같이 고정된다 (위 openRepository 테스트 관례)
    await store.getState().loadHeadInfo('/repo', 'abc123')
    await store.getState().autoFetchRemotes()
    // 전제 확인 — 여기가 비어 있으면 아래 단언이 공허하게 통과한다
    expect(Object.keys(store.getState().headInfos)).toEqual(['/repo::abc123'])
    const fetchedAt = store.getState().lastFetchAt
    expect(fetchedAt).not.toBeNull()

    await store.getState().openWorktree('/repo-side')

    // 전환이 실제로 일어났는가 — 이것도 공허한 통과 방지용이다
    expect(store.getState().repoPath).toBe('/repo-side')
    // 같은 공용 git dir이다 — 방금 가져온 원격 refs는 이 워크트리에도 그대로 적용돼 있다
    expect(store.getState().lastFetchAt).toBe(fetchedAt)
    // 목록이 같으니 이 키는 새 화면에서도 그대로 읽힌다 — 버리면 호버마다 재조회다
    expect(Object.keys(store.getState().headInfos)).toEqual(['/repo::abc123'])
  })

  it('반면 워크트리에 매인 것은 갈아엎는다 — 새 워크트리의 스냅샷으로 바뀐다', async () => {
    const store = mod.useRepositoryStore
    store.setState({ repoPath: '/repo', status: null, historyRef: 'old-ref' })

    await store.getState().openWorktree('/repo-side')

    expect(store.getState().status?.repoPath).toBe('/repo-side')
    expect(store.getState().historyRef).toBeNull()
  })
})

/**
 * E15a 리뷰 ① — 전환 **도중** 출발한 조회는 seq로 안 잡힌다.
 *
 * `runWrite`의 `invalidateReads()`는 진입 시 1회라 그 *이전에* 시작된 조회만 무효화한다. 전환
 * 도중 시작된 조회는 자기 자리의 seq를 새로 선점하고, `openRepository`는 `runRead`를 안 거쳐
 * snapshot seq를 더 올리지 않으므로 착지 때 `isCurrent()`가 참이 된다. 그래서 **경로 비교**가
 * 따로 필요하다(`runRepoRead` / `boundTo`).
 *
 * 실제로 이 창이 열리는 경로 두 가지(리뷰어 실측):
 * - ⌘O·"다른 폴더 열기…" — `dialog.showOpenDialog`가 창을 blur시키고, 닫히며 focus가 돌아와
 *   `refresh()`가 옛 repoPath로 출발한다. resolve와 focus 이벤트의 선후는 보장되지 않는다.
 * - 최근 목록 — 전환 중 에디터 자동 저장 하나면 `repo:changed(A)`가 그 시점 `repoPath === A`라
 *   `init()`의 가드를 통과해 `externalRefresh()`가 출발한다.
 */
describe('전환 도중 출발한 조회는 새 저장소 화면에 착지하지 않는다 (E15a 리뷰 ①)', () => {
  it('refresh — 창 포커스 복귀로 시작된 배경 조회가 새 저장소의 상태를 덮지 않는다', async () => {
    const store = mod.useRepositoryStore
    store.setState({ repoPath: '/repo', status: null, selected: null, hostingStatus: null })

    openDelay = 30
    oldRepoDelay = 150
    const switching = store.getState().openRepository('/other')
    // repo.open을 기다리는 동안 — 이 시점 store.repoPath는 아직 '/repo'다
    await sleep(10)
    const refreshing = store.getState().refresh()
    await Promise.all([switching, refreshing])

    // 전환이 실제로 끝났는가 (공허한 통과 방지)
    expect(store.getState().repoPath).toBe('/other')
    expect(store.getState().status?.repoPath).toBe('/other')
    expect(store.getState().status?.branch).toBe('NEW-BRANCH')
  })

  it('externalRefresh — 감시 이벤트로 시작된 배경 조회가 새 저장소의 상태를 덮지 않는다', async () => {
    const store = mod.useRepositoryStore
    store.setState({ repoPath: '/repo', status: null, selected: null })
    // 앞 테스트의 쓰기가 무장한 억제 창(800ms)에 걸리면 externalRefresh가 시작조차 안 해
    // 이 테스트가 공허하게 통과한다 — 명시적으로 연다
    guard.resetSuppression()

    openDelay = 30
    oldRepoDelay = 150
    const switching = store.getState().openRepository('/other')
    await sleep(10)
    const refreshing = store.getState().externalRefresh()
    await Promise.all([switching, refreshing])

    expect(store.getState().repoPath).toBe('/other')
    expect(store.getState().status?.repoPath).toBe('/other')
    expect(store.getState().status?.branch).toBe('NEW-BRANCH')
  })

  it('autoFetchRemotes — 전환 너머로 늘어진 주기 조회가 비운 lastFetchAt을 되살리지 않는다', async () => {
    const store = mod.useRepositoryStore
    store.setState({ repoPath: '/repo', lastFetchAt: null })

    fetchDelay = 80
    // 이건 runWrite도 runRead도 아니라 전환 **이전**에 출발해도 무효화되지 않는다
    const fetching = store.getState().autoFetchRemotes()
    const switching = store.getState().openRepository('/other')
    await Promise.all([fetching, switching])

    expect(store.getState().repoPath).toBe('/other')
    expect(store.getState().lastFetchAt).toBeNull()
  })

  it('저장소가 그대로면 조회는 평소처럼 착지한다 — 결합이 과잉이 아니다', async () => {
    const store = mod.useRepositoryStore
    store.setState({ repoPath: '/repo', status: null, lastFetchAt: null })

    await store.getState().refresh()
    await store.getState().autoFetchRemotes()

    expect(store.getState().status?.repoPath).toBe('/repo')
    expect(store.getState().lastFetchAt).not.toBeNull()
  })
})
