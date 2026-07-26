import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  DiffOptions,
  GitApi,
  HostingApi,
  SettingsApi,
  TerminalApi,
  WindowApi,
} from '@git-gui/ipc-contract'
import {
  CHANNELS,
  GIT_API_KEY,
  HOSTING_API_KEY,
  HOSTING_CHANNELS,
  SETTINGS_API_KEY,
  SETTINGS_CHANNELS,
  TERMINAL_API_KEY,
  TERMINAL_CHANNELS,
  WINDOW_API_KEY,
  WINDOW_CHANNELS,
} from '@git-gui/ipc-contract'

const api: GitApi = {
  repo: {
    select: () => ipcRenderer.invoke(CHANNELS.repoSelect),
    initialPath: () => ipcRenderer.invoke(CHANNELS.repoInitialPath),
    status: (repoPath) => ipcRenderer.invoke(CHANNELS.repoStatus, repoPath),
    watch: (repoPath) => ipcRenderer.invoke(CHANNELS.repoWatch, repoPath),
    // 이 앱 최초의 push 구독 브리지 — 콜백을 감싸 등록하고 해제 함수를 돌려준다 (E7b)
    onChanged: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, repoPath: string) => listener(repoPath)
      ipcRenderer.on(CHANNELS.repoChanged, wrapped)
      return () => ipcRenderer.removeListener(CHANNELS.repoChanged, wrapped)
    },
    openPath: (repoPath, worktreePath) =>
      ipcRenderer.invoke(CHANNELS.repoOpenPath, repoPath, worktreePath),
    home: () => ipcRenderer.invoke(CHANNELS.repoHome),
  },
  worktrees: {
    list: (repoPath) => ipcRenderer.invoke(CHANNELS.worktreesList, repoPath),
    add: (repoPath, path, branch, createBranch) =>
      ipcRenderer.invoke(CHANNELS.worktreesAdd, repoPath, path, branch, createBranch),
    remove: (repoPath, path, force) =>
      ipcRenderer.invoke(CHANNELS.worktreesRemove, repoPath, path, force),
    reveal: (repoPath, path) => ipcRenderer.invoke(CHANNELS.worktreesReveal, repoPath, path),
    headInfo: (repoPath, path) => ipcRenderer.invoke(CHANNELS.worktreeHeadInfo, repoPath, path),
  },
  branches: {
    list: (repoPath) => ipcRenderer.invoke(CHANNELS.branchesList, repoPath),
    overview: (repoPath) => ipcRenderer.invoke(CHANNELS.branchesOverview, repoPath),
    create: (repoPath, name, fromHash) =>
      ipcRenderer.invoke(CHANNELS.branchesCreate, repoPath, name, fromHash),
    switch: (repoPath, name) => ipcRenderer.invoke(CHANNELS.branchesSwitch, repoPath, name),
    merge: (repoPath, name) => ipcRenderer.invoke(CHANNELS.branchesMerge, repoPath, name),
    remove: (repoPath, name, force) =>
      ipcRenderer.invoke(CHANNELS.branchesRemove, repoPath, name, force),
    rename: (repoPath, oldName, newName) =>
      ipcRenderer.invoke(CHANNELS.branchesRename, repoPath, oldName, newName),
    update: (repoPath, name) => ipcRenderer.invoke(CHANNELS.branchesUpdate, repoPath, name),
    backup: (repoPath, name) => ipcRenderer.invoke(CHANNELS.branchesBackup, repoPath, name),
    checkoutRemote: (repoPath, name) =>
      ipcRenderer.invoke(CHANNELS.branchesCheckoutRemote, repoPath, name),
    removeRemote: (repoPath, name) =>
      ipcRenderer.invoke(CHANNELS.branchesRemoveRemote, repoPath, name),
    compare: (repoPath, name) => ipcRenderer.invoke(CHANNELS.branchesCompare, repoPath, name),
  },
  rebase: {
    start: (repoPath, onto) => ipcRenderer.invoke(CHANNELS.rebaseStart, repoPath, onto),
    continue: (repoPath) => ipcRenderer.invoke(CHANNELS.rebaseContinue, repoPath),
    abort: (repoPath) => ipcRenderer.invoke(CHANNELS.rebaseAbort, repoPath),
    progress: (repoPath) => ipcRenderer.invoke(CHANNELS.rebaseProgress, repoPath),
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
    removeFile: (repoPath, path) => ipcRenderer.invoke(CHANNELS.changesRemoveFile, repoPath, path),
    diff: (repoPath, path, options: DiffOptions) =>
      ipcRenderer.invoke(CHANNELS.changesDiff, repoPath, path, options),
  },
  commits: {
    create: (repoPath, message) => ipcRenderer.invoke(CHANNELS.commitsCreate, repoPath, message),
    show: (repoPath, hash) => ipcRenderer.invoke(CHANNELS.commitsShow, repoPath, hash),
    diffFile: (repoPath, hash, path, origPath) =>
      ipcRenderer.invoke(CHANNELS.commitsDiffFile, repoPath, hash, path, origPath),
    restoreFile: (repoPath, hash, path) =>
      ipcRenderer.invoke(CHANNELS.commitsRestoreFile, repoPath, hash, path),
    diffAgainstWorktree: (repoPath, hash, path, origPath) =>
      ipcRenderer.invoke(CHANNELS.commitsDiffWorktree, repoPath, hash, path, origPath),
    revert: (repoPath, hash) => ipcRenderer.invoke(CHANNELS.commitsRevert, repoPath, hash),
    revertAbort: (repoPath) => ipcRenderer.invoke(CHANNELS.commitsRevertAbort, repoPath),
    cherryPick: (repoPath, hash) => ipcRenderer.invoke(CHANNELS.commitsCherryPick, repoPath, hash),
    cherryPickAbort: (repoPath) => ipcRenderer.invoke(CHANNELS.commitsCherryPickAbort, repoPath),
    createTag: (repoPath, name, hash) =>
      ipcRenderer.invoke(CHANNELS.commitsCreateTag, repoPath, name, hash),
    undoLast: (repoPath, hash) => ipcRenderer.invoke(CHANNELS.commitsUndoLast, repoPath, hash),
    reword: (repoPath, hash, message) =>
      ipcRenderer.invoke(CHANNELS.commitsReword, repoPath, hash, message),
  },
  history: {
    list: (repoPath, limit, ref) => ipcRenderer.invoke(CHANNELS.historyList, repoPath, limit, ref),
    search: (repoPath, query, ref) =>
      ipcRenderer.invoke(CHANNELS.historySearch, repoPath, query, ref),
  },
  sync: {
    push: (repoPath) => ipcRenderer.invoke(CHANNELS.syncPush, repoPath),
    pull: (repoPath, mode) => ipcRenderer.invoke(CHANNELS.syncPull, repoPath, mode),
  },
  remotes: {
    fetch: (repoPath) => ipcRenderer.invoke(CHANNELS.remotesFetch, repoPath),
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
    detail: (repoPath, number) => ipcRenderer.invoke(HOSTING_CHANNELS.pullDetail, repoPath, number),
    comment: (repoPath, number, body) =>
      ipcRenderer.invoke(HOSTING_CHANNELS.pullComment, repoPath, number, body),
    approve: (repoPath, number) =>
      ipcRenderer.invoke(HOSTING_CHANNELS.pullApprove, repoPath, number),
    merge: (repoPath, number) => ipcRenderer.invoke(HOSTING_CHANNELS.pullMerge, repoPath, number),
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

const terminalApi: TerminalApi = {
  create: (repoPath, cwd) => ipcRenderer.invoke(TERMINAL_CHANNELS.create, repoPath, cwd),
  input: (sessionId, data) => ipcRenderer.invoke(TERMINAL_CHANNELS.input, sessionId, data),
  resize: (sessionId, cols, rows) =>
    ipcRenderer.invoke(TERMINAL_CHANNELS.resize, sessionId, cols, rows),
  kill: (sessionId) => ipcRenderer.invoke(TERMINAL_CHANNELS.kill, sessionId),
  onData: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, sessionId: string, chunk: string) =>
      listener(sessionId, chunk)
    ipcRenderer.on(TERMINAL_CHANNELS.data, wrapped)
    return () => ipcRenderer.removeListener(TERMINAL_CHANNELS.data, wrapped)
  },
  onExit: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, sessionId: string, exitCode: number) =>
      listener(sessionId, exitCode)
    ipcRenderer.on(TERMINAL_CHANNELS.exit, wrapped)
    return () => ipcRenderer.removeListener(TERMINAL_CHANNELS.exit, wrapped)
  },
}

contextBridge.exposeInMainWorld(TERMINAL_API_KEY, terminalApi)

const windowApi: WindowApi = {
  onFullScreen: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, isFullScreen: boolean) =>
      listener(isFullScreen)
    ipcRenderer.on(WINDOW_CHANNELS.fullScreen, wrapped)
    return () => ipcRenderer.removeListener(WINDOW_CHANNELS.fullScreen, wrapped)
  },
}

contextBridge.exposeInMainWorld(WINDOW_API_KEY, windowApi)
