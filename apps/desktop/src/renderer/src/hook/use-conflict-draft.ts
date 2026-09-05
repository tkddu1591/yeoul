import { create } from 'zustand'
interface ConflictDraft {
  text: string
  base: string
}
interface ConflictDraftState {
  data: { drafts: Record<string, ConflictDraft | undefined> }
  entry: { set(key: string, draft?: ConflictDraft): void }
}
const useDrafts = create<ConflictDraftState>((set) => ({
  data: { drafts: {} },
  entry: {
    set: (key, draft) =>
      set((state) => ({ data: { drafts: { ...state.data.drafts, [key]: draft } } })),
  },
}))
export function useConflictDraft(identity: string) {
  const draft = useDrafts((state) => state.data.drafts[identity])
  const set = useDrafts((state) => state.entry.set)
  return {
    data: { draft },
    entry: {
      start: (base: string) => {
        if (!draft) set(identity, { base, text: base })
      },
      set: (text: string) => {
        if (draft) set(identity, { ...draft, text })
      },
      clear: () => set(identity),
    },
  }
}
