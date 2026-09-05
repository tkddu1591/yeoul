import { ipcMain, webContents } from 'electron'
import { gitProcessActivity } from '@git-gui/git-process'
import { CHANNELS, type GitActivity } from '@git-gui/ipc-contract'

function register() {
  const entries = new Map<number, GitActivity>()
  const operations = new Set([
    'add',
    'commit',
    'reset',
    'restore',
    'checkout',
    'switch',
    'push',
    'pull',
    'fetch',
    'merge',
    'rebase',
    'cherry-pick',
    'revert',
    'clone',
    'init',
  ])
  gitProcessActivity.events.subscribe((entry) => {
    if (!operations.has(entry.operation)) return
    entries.set(entry.id, entry)
    if (entries.size > 100) {
      const oldest = [...entries.values()].find((item) => item.status !== 'running')
      if (oldest) entries.delete(oldest.id)
    }
    for (const contents of webContents.getAllWebContents()) {
      if (!contents.isDestroyed()) contents.send(CHANNELS.jobsChanged, entry)
    }
  })
  ipcMain.handle(CHANNELS.jobsHistory, () => [...entries.values()])
}
export const applicationActivity = { ipc: { register } }
