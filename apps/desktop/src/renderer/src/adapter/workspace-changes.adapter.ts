import type { WorkspaceRepository, WorkspaceRepositoryOverview } from '@git-gui/ipc-contract'
import type { RepositoryStatus } from '@git-gui/domain'
import type { WorkspaceChangeEntry } from '../store/workspace-change-command'

export interface WorkspaceChangeTarget {
  repository: WorkspaceRepository
  owner: WorkspaceRepository
  branch: string | null
  status: RepositoryStatus | null
  error: string | null
  entries: WorkspaceChangeEntry[]
}

function toTargets(items: WorkspaceRepositoryOverview[]): WorkspaceChangeTarget[] {
  return items.flatMap((item) => {
    const trees = item.workingTrees?.length
      ? item.workingTrees
      : [
          {
            worktree: { path: item.repository.path, branch: item.status?.branch.name ?? null },
            status: item.status,
            error: item.error,
          },
        ]
    return trees.map(({ worktree, status, error }) => {
      const main = worktree.path === item.repository.path
      const name = worktree.path.split('/').pop() ?? worktree.path
      const repository: WorkspaceRepository = main
        ? item.repository
        : {
            path: worktree.path,
            name: `${item.repository.name} / ${name}`,
            relativePath: `${item.repository.relativePath}/worktrees/${name}`,
          }
      return {
        repository,
        owner: item.repository,
        branch: status?.branch.name ?? worktree.branch,
        status,
        error,
        entries: (status?.changes ?? []).flatMap((change) => [
          ...(change.unstaged !== null ? [{ repository, change, staged: false }] : []),
          ...(change.staged !== null ? [{ repository, change, staged: true }] : []),
        ]),
      }
    })
  })
}

export const workspaceChangesAdapter = { target: { toList: toTargets } }
