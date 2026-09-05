import type { WorkspaceChangeEntry } from '../store/workspace-change-command'
import { workspaceChangeCommand } from '../store/workspace-change-command'
import type { WorkspaceChangeTarget } from '../adapter/workspace-changes.adapter'

function filter(targets: WorkspaceChangeTarget[], query: string): WorkspaceChangeTarget[] {
  const value = query.trim().toLocaleLowerCase()
  if (!value) return targets
  return targets
    .map((target) => {
      const matches = [
        target.repository.name,
        target.repository.relativePath,
        target.branch ?? '',
      ].some((text) => text.toLocaleLowerCase().includes(value))
      return {
        ...target,
        entries: matches
          ? target.entries
          : target.entries.filter((entry) => entry.change.path.toLocaleLowerCase().includes(value)),
      }
    })
    .filter((target) => target.entries.length > 0)
}
function toggle(
  keys: ReadonlySet<string>,
  entries: WorkspaceChangeEntry[],
  select: boolean,
): Set<string> {
  const next = new Set(keys)
  for (const entry of entries) {
    const key = workspaceChangeCommand.selection.key.get(entry)
    if (select) next.add(key)
    else next.delete(key)
  }
  return next
}
export const workspaceSelection = { list: { filter }, selection: { toggle } }
