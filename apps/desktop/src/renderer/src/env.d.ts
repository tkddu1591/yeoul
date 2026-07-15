import type { GitApi } from '@git-gui/ipc-contract'

declare global {
  interface Window {
    gitApi: GitApi
  }
}

export {}
