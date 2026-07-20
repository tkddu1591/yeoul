import type { GitApi, HostingApi, SettingsApi } from '@git-gui/ipc-contract'

declare global {
  interface Window {
    gitApi: GitApi
    hostingApi: HostingApi
    settingsApi: SettingsApi
  }
}

export {}
