import { create } from 'zustand'
import type { CommitFormModel } from '../adapter/commit-form.adapter'
import { commitDraftStorage } from '../store/commit-draft-storage'

interface DraftState {
  data: { drafts: Record<string, string> }
  entry: { set(key: string, value: string): void }
}
const useDraftStore = create<DraftState>((set) => ({
  data: { drafts: {} },
  entry: {
    set: (key, value) => {
      commitDraftStorage.entry.set(key, value)
      set((state) => ({ data: { drafts: { ...state.data.drafts, [key]: value } } }))
    },
  },
}))
export function useCommitDraft(target: CommitFormModel['target']) {
  const key = JSON.stringify([target.path, target.branch])
  const message = useDraftStore(
    (state) => state.data.drafts[key] ?? commitDraftStorage.entry.get(key),
  )
  const set = useDraftStore((state) => state.entry.set)
  return {
    data: { message },
    entry: { set: (value: string) => set(key, value), clear: () => set(key, '') },
  }
}
