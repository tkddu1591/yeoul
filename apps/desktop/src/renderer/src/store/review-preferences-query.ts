import type { AppSettings } from '@git-gui/ipc-contract'
export const reviewPreferencesQuery = {
  data: { get: () => window.settingsApi.initial },
  selection: { set: (value: AppSettings) => window.settingsApi.set(value) },
}
