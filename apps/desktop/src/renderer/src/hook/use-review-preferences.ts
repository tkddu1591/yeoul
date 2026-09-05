import { create } from 'zustand'
import { reviewPreferencesQuery } from '../store/review-preferences-query'
export interface ReviewPreferences {
  codeFontSize: 12 | 14 | 16
  listDensity: 'compact' | 'comfortable'
}
interface PreferenceState {
  data: ReviewPreferences
  selection: { set(value: ReviewPreferences): void }
}
const usePreferences = create<PreferenceState>((set) => ({
  data: {
    codeFontSize: reviewPreferencesQuery.data.get().codeFontSize ?? 12,
    listDensity: reviewPreferencesQuery.data.get().listDensity ?? 'comfortable',
  },
  selection: {
    set: (data) => {
      set({ data })
      void reviewPreferencesQuery.selection.set(data)
    },
  },
}))
export function useReviewPreferences() {
  const data = usePreferences((state) => state.data)
  const set = usePreferences((state) => state.selection.set)
  return { data, selection: { set } }
}
