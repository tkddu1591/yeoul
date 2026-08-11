import type { WindowLayout } from '@git-gui/ipc-contract'

/**
 * 창의 정본 (E15b). main만 안다.
 *
 * electron을 import하지 않는다 — 창을 `webContents.id`(숫자)로만 다뤄 단위 테스트가 된다.
 * 실제 BrowserWindow와의 연결은 index.ts가 한다(TerminalManager가 IPC를 모르는 것과 같은 분리).
 *
 * 답하는 것은 둘뿐이다: 어느 창이 어느 저장소를 열었나(중복 차단·복원) · 그 창의 레이아웃(설정
 * 분리). 감시·터미널은 각자 자리에서 자기 Map을 갖는다 — 그 이상을 담지 않는다
 */
export interface WindowState {
  repoPath: string | null
  layout: WindowLayout
}

/**
 * 레지스트리가 바뀐 이유 (E15b 리뷰 I-1) — 영속 정책이 둘로 갈린다.
 *
 * - `windows` — 창이 늘거나 줄거나 다른 저장소로 갈아탔다. 사람의 조작이라 드물다: **즉시** 쓴다.
 * - `layout` — 도크 높이 드래그처럼 초당 여러 번 온다: **디바운스**한다.
 *
 * 둘을 안 가르고 전부 디바운스하면, 창 둘을 연달아 닫는 동안(디바운스 창 안) 종료가 겹칠 때
 * 닫은 창이 목록에 남는다. 반대로 전부 즉시 쓰면 드래그 한 번에 writeFileSync가 수십 번이다
 */
export type WindowChangeKind = 'windows' | 'layout'

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
  // Map은 삽입 순서를 보존한다 — snapshot()의 순서 보장이 여기서 온다
  const windows = new Map<number, WindowState>()
  return {
    add(id, state) {
      // layout을 복사해 담는다 — 호출자가 넘긴 객체(씨앗)를 나중에 고쳐도 이 창이 안 흔들린다
      windows.set(id, { repoPath: state.repoPath, layout: { ...state.layout } })
      onChange('windows')
    },
    remove(id) {
      // 실제로 지웠을 때만 알린다 — 없는 id를 지우는 것은 변화가 아니다
      if (windows.delete(id)) onChange('windows')
    },
    get(id) {
      return windows.get(id)
    },
    setRepoPath(id, repoPath) {
      const state = windows.get(id)
      // 창이 닫히는 중에 늦은 IPC가 올 수 있다 — 조용히 무시한다(알리지도 않는다)
      if (state === undefined) return
      state.repoPath = repoPath
      onChange('windows')
    },
    setLayout(id, patch) {
      const state = windows.get(id)
      if (state === undefined) return
      state.layout = { ...state.layout, ...patch }
      onChange('layout')
    },
    findByRepoPath(repoPath) {
      for (const [id, state] of windows) {
        // 빈 창(repoPath === null)은 **어떤 인자로도** 걸리지 않는다 (E15b 리뷰 N-7).
        // 시그니처가 string이라 정상 경로에선 null이 못 오지만, 유일한 호출부(window:open)의
        // 인자는 IPC 경계 너머에서 오는 값이라 캐스팅 하나로 타입이 무너진다. 걸리면 중복
        // 차단이 "이미 그 저장소를 연 창"으로 오인해 엉뚱한 빈 창을 앞으로 가져온다
        if (state.repoPath !== null && state.repoPath === repoPath) return id
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
