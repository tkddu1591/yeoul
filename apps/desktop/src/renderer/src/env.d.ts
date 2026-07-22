import type { GitApi, HostingApi, SettingsApi, TerminalApi } from '@git-gui/ipc-contract'

declare global {
  interface Window {
    gitApi: GitApi
    hostingApi: HostingApi
    settingsApi: SettingsApi
    terminalApi: TerminalApi
  }
}

export {}
