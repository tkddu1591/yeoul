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
      // layout을 복사해 담는다 — 호출자가 넘긴 객체(씨앗)를 나중에 고쳐도 이 창이 안 흔들린다
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
