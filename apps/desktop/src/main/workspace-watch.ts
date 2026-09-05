import { execGitOrThrow } from '@git-gui/git-process'
import type { WorkspaceOverview } from '@git-gui/ipc-contract'
import { watchRepository, watchWorkingTree } from './repo-watcher'
import { createTrailingDebounce } from './watch-filter'

async function subscribe(overview: WorkspaceOverview, notify: () => void): Promise<() => void> {
  const pending = createTrailingDebounce(350, notify, 1500)
  const stops: Array<() => void> = [() => pending.dispose()]
  const roots = new Set<string>()
  const directories = new Set<string>()
  for (const item of overview.repositories) {
    for (const path of [item.repository.path, ...(item.worktrees ?? []).map((tree) => tree.path)])
      roots.add(path)
  }
  for (const root of roots) {
    stops.push(watchWorkingTree(root, () => pending.hit()))
    try {
      const result = await execGitOrThrow(
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        { cwd: root },
      )
      directories.add(result.stdout.trim())
    } catch {
      /* The overview retains per-repository errors; manual refresh remains available. */
    }
  }
  for (const directory of directories) stops.push(watchRepository(directory, () => pending.hit()))
  return () => stops.forEach((stop) => stop())
}

export const workspaceWatch = { events: { subscribe } }
