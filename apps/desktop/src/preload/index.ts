import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, DiffOptions, GitApi, HostingApi, SettingsApi } from '@git-gui/ipc-contract'
import {
  CHANNELS,
  GIT_API_KEY,
  HOSTING_API_KEY,
  HOSTING_CHANNELS,
  SETTINGS_API_KEY,
  SETTINGS_CHANNELS,
} from '@git-gui/ipc-contract'

const api: GitApi = {
  repo: {
    select: () => ipcRenderer.invoke(CHANNELS.repoSelect),
    initialPath: () => ipcRenderer.invoke(CHANNELS.repoInitialPath),
    status: (repoPath) => ipcRenderer.invoke(CHANNELS.repoStatus, repoPath),
  },
  branches: {
    list: (repoPath) => ipcRenderer.invoke(CHANNELS.branchesList, repoPath),
    create: (repoPath, name, fromHash) =>
      ipcRenderer.invoke(CHANNELS.branchesCreate, repoPath, name, fromHash),
    switch: (repoPath, name) => ipcRenderer.invoke(CHANNELS.branchesSwitch, repoPath, name),
    merge: (repoPath, name) => ipcRenderer.invoke(CHANNELS.branchesMerge, repoPath, name),
    remove: (repoPath, name, force) =>
      ipcRenderer.invoke(CHANNELS.branchesRemove, repoPath, name, force),
    rename: (repoPath, oldName, newName) =>
      ipcRenderer.invoke(CHANNELS.branchesRename, repoPath, oldName, newName),
  },
  merge: {
    abort: (repoPath) => ipcRenderer.invoke(CHANNELS.mergeAbort, repoPath),
  },
  conflicts: {
    resolve: (repoPath, path, choice) =>
      ipcRenderer.invoke(CHANNELS.conflictsResolve, repoPath, path, choice),
    markResolved: (repoPath, path) =>
      ipcRenderer.invoke(CHANNELS.conflictsMarkResolved, repoPath, path),
    saveText: (repoPath, path, content) =>
      ipcRenderer.invoke(CHANNELS.conflictsSaveText, repoPath, path, content),
    reset: (repoPath, path) => ipcRenderer.invoke(CHANNELS.conflictsReset, repoPath, path),
  },
  files: {
    readText: (repoPath, path) => ipcRenderer.invoke(CHANNELS.filesReadText, repoPath, path),
  },
  shelf: {
    save: (repoPath, message) => ipcRenderer.invoke(CHANNELS.shelfSave, repoPath, message),
    list: (repoPath) => ipcRenderer.invoke(CHANNELS.shelfList, repoPath),
    restore: (repoPath, ref) => ipcRenderer.invoke(CHANNELS.shelfRestore, repoPath, ref),
    drop: (repoPath, ref) => ipcRenderer.invoke(CHANNELS.shelfDrop, repoPath, ref),
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
    revert: (repoPath, hash) => ipcRenderer.invoke(CHANNELS.commitsRevert, repoPath, hash),
    revertAbort: (repoPath) => ipcRenderer.invoke(CHANNELS.commitsRevertAbort, repoPath),
  },
  history: {
    list: (repoPath, limit) => ipcRenderer.invoke(CHANNELS.historyList, repoPath, limit),
  },
  sync: {
    push: (repoPath) => ipcRenderer.invoke(CHANNELS.syncPush, repoPath),
    pull: (repoPath) => ipcRenderer.invoke(CHANNELS.syncPull, repoPath),
  },
}

contextBridge.exposeInMainWorld(GIT_API_KEY, api)

const hostingApi: HostingApi = {
  status: (repoPath) => ipcRenderer.invoke(HOSTING_CHANNELS.status, repoPath),
  connect: {
    gh: () => ipcRenderer.invoke(HOSTING_CHANNELS.connectGh),
    token: (token) => ipcRenderer.invoke(HOSTING_CHANNELS.connectToken, token),
  },
  disconnect: () => ipcRenderer.invoke(HOSTING_CHANNELS.disconnect),
  pulls: {
    list: (repoPath) => ipcRenderer.invoke(HOSTING_CHANNELS.pullsList, repoPath),
    create: (repoPath, input) => ipcRenderer.invoke(HOSTING_CHANNELS.pullCreate, repoPath, input),
    open: (repoPath, number) => ipcRenderer.invoke(HOSTING_CHANNELS.pullOpen, repoPath, number),
  },
}

contextBridge.exposeInMainWorld(HOSTING_API_KEY, hostingApi)

// 시작 시점 설정을 동기로 읽는다 — 첫 렌더 전에 테마·폭이 결정되어 깜빡임이 없다
const initialSettings = ipcRenderer.sendSync(SETTINGS_CHANNELS.getSync) as AppSettings

const settingsApi: SettingsApi = {
  initial: initialSettings,
  set: (partial) => ipcRenderer.invoke(SETTINGS_CHANNELS.set, partial),
}

contextBridge.exposeInMainWorld(SETTINGS_API_KEY, settingsApi)
