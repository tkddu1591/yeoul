import { contextBridge, ipcRenderer } from 'electron'
import type { DiffOptions, GitApi } from '@git-gui/ipc-contract'
import { CHANNELS, GIT_API_KEY } from '@git-gui/ipc-contract'

const api: GitApi = {
  repo: {
    select: () => ipcRenderer.invoke(CHANNELS.repoSelect),
    initialPath: () => ipcRenderer.invoke(CHANNELS.repoInitialPath),
    status: (repoPath) => ipcRenderer.invoke(CHANNELS.repoStatus, repoPath),
  },
  changes: {
    stage: (repoPath, paths) => ipcRenderer.invoke(CHANNELS.changesStage, repoPath, paths),
    unstage: (repoPath, paths) => ipcRenderer.invoke(CHANNELS.changesUnstage, repoPath, paths),
    discard: (repoPath, trackedPaths, untrackedPaths) =>
      ipcRenderer.invoke(CHANNELS.changesDiscard, repoPath, trackedPaths, untrackedPaths),
    diff: (repoPath, path, options: DiffOptions) =>
      ipcRenderer.invoke(CHANNELS.changesDiff, repoPath, path, options),
  },
  commits: {
    create: (repoPath, message) => ipcRenderer.invoke(CHANNELS.commitsCreate, repoPath, message),
    show: (repoPath, hash) => ipcRenderer.invoke(CHANNELS.commitsShow, repoPath, hash),
    diffFile: (repoPath, hash, path, origPath) =>
      ipcRenderer.invoke(CHANNELS.commitsDiffFile, repoPath, hash, path, origPath),
  },
  history: {
    list: (repoPath, limit) => ipcRenderer.invoke(CHANNELS.historyList, repoPath, limit),
  },
  sync: {
    push: (repoPath) => ipcRenderer.invoke(CHANNELS.syncPush, repoPath),
  },
}

contextBridge.exposeInMainWorld(GIT_API_KEY, api)
