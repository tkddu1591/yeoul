import type { GitApi, SettingsApi } from '@git-gui/ipc-contract'

declare global {
  interface Window {
    gitApi: GitApi
    settingsApi: SettingsApi
  }
}

export {}
