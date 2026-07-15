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
  commit(message: string): Promise<void>
}

async function guard(set: (partial: Partial<RepositoryStore>) => void, run: () => Promise<void>) {
  set({ busy: true, error: null })
  try {
    await run()
  } catch (cause) {
    set({ error: cause instanceof Error ? cause.message : String(cause) })
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
    const initial = await git().repo.initialPath()
    if (initial) {
      set({ repoPath: initial })
      await get().refresh()
    }
  },

  async openRepository() {
    await guard(set, async () => {
      const path = await git().repo.select()
      if (!path) return
      set({ repoPath: path, selected: null, diffText: '' })
      await get().refresh()
    })
  },

  async refresh() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, async () => {
      const status = await git().repo.status(repoPath)
      set({ status })
    })
  },

  async stage(paths) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, async () => {
      await git().changes.stage(repoPath, paths)
      set({ status: await git().repo.status(repoPath) })
    })
  },

  async unstage(paths) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, async () => {
      await git().changes.unstage(repoPath, paths)
      set({ status: await git().repo.status(repoPath) })
    })
  },

  async selectFile(selected) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, async () => {
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
    if (!repoPath) return
    await guard(set, async () => {
      await git().commits.create(repoPath, message)
      set({ selected: null, diffText: '', status: await git().repo.status(repoPath) })
    })
  },
}))
