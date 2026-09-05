import type { WorkspaceOverview } from '@git-gui/ipc-contract'
function count(overview: WorkspaceOverview | null) {
  return (
    overview?.repositories.reduce(
      (total, item) =>
        total +
        (item.workingTrees?.length
          ? item.workingTrees.reduce((sum, tree) => sum + (tree.status?.changes.length ?? 0), 0)
          : (item.status?.changes.length ?? 0)),
      0,
    ) ?? 0
  )
}
function find(overview: WorkspaceOverview | null, path: string | null) {
  return (
    overview?.repositories.find(
      (item) => item.repository.path === path || item.worktrees?.some((tree) => tree.path === path),
    )?.repository ?? null
  )
}
export const workspaceSummary = { change: { count }, repository: { find } }
