import { create } from 'zustand'
import type { FileChange, RepositoryStatus } from '@git-gui/domain'

const git = () => window.gitApi

export interface SelectedFile {
  change: FileChange
  staged: boolean
}

interface RepositoryStore {
  repoPath: string | null
  status: RepositoryStatus | null
  selected: SelectedFile | null
  diffText: string
  error: string | null
  busy: boolean

  init(): Promise<void>
  openRepository(): Promise<void>
  refresh(): Promise<void>
  stage(paths: string[]): Promise<void>
  unstage(paths: string[]): Promise<void>
  selectFile(selected: SelectedFile): Promise<void>
  /** 성공 여부를 반환한다 — 실패 시 입력 메시지를 보존하기 위해 */
  commit(message: string): Promise<boolean>
}

/** IPC 에러 메시지의 Electron 래핑 접두사를 벗겨 사용자 메시지만 남긴다 */
function toErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

type StoreSet = (partial: Partial<RepositoryStore>) => void
type StoreGet = () => RepositoryStore

/** busy 재진입을 거부하고 busy/error 처리를 일원화한다. 성공 여부를 반환한다 */
async function guard(set: StoreSet, get: StoreGet, run: () => Promise<void>): Promise<boolean> {
  if (get().busy) return false
  set({ busy: true, error: null })
  try {
    await run()
    return true
  } catch (cause) {
    set({ error: toErrorMessage(cause) })
    return false
  } finally {
    set({ busy: false })
  }
}

export const useRepositoryStore = create<RepositoryStore>((set, get) => ({
  repoPath: null,
  status: null,
  selected: null,
  diffText: '',
  error: null,
  busy: false,

  async init() {
    await guard(set, get, async () => {
      const initial = await git().repo.initialPath()
      if (!initial) return
      set({ repoPath: initial, status: await git().repo.status(initial) })
    })
  },

  async openRepository() {
    await guard(set, get, async () => {
      const path = await git().repo.select()
      if (!path) return
      // guard가 재진입을 거부하므로 refresh()를 부르지 않고 status를 직접 조회한다
      set({ repoPath: path, selected: null, diffText: '', status: await git().repo.status(path) })
    })
  },

  async refresh() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      set({ status: await git().repo.status(repoPath) })
    })
  },

  async stage(paths) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().changes.stage(repoPath, paths)
      // stage 후에는 보고 있던 diff의 의미가 달라진다(오인 커밋 방지) — 선택을 비운다
      set({ selected: null, diffText: '', status: await git().repo.status(repoPath) })
    })
  },

  async unstage(paths) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().changes.unstage(repoPath, paths)
      set({ selected: null, diffText: '', status: await git().repo.status(repoPath) })
    })
  },

  async selectFile(selected) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      const untracked = selected.change.unstaged === 'untracked'
      const diffText = await git().changes.diff(repoPath, selected.change.path, {
        staged: selected.staged,
        untracked,
      })
      set({ selected, diffText })
    })
  },

  async commit(message) {
    const { repoPath } = get()
    if (!repoPath) return false
    return guard(set, get, async () => {
      await git().commits.create(repoPath, message)
      set({ selected: null, diffText: '', status: await git().repo.status(repoPath) })
    })
  },
}))
