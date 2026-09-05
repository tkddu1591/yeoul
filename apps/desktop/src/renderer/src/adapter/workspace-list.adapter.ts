import type { WorkspaceChangeTarget } from './workspace-changes.adapter'
import type { WorkspaceChangeEntry } from '../store/workspace-change-command'
import { workspaceChangeCommand } from '../store/workspace-change-command'

export type WorkspaceListRow =
  | { kind: 'target'; key: string; target: WorkspaceChangeTarget }
  | { kind: 'file'; key: string; entry: WorkspaceChangeEntry }
  | { kind: 'empty'; key: string; text: string }
function toRows(
  targets: WorkspaceChangeTarget[],
  collapsed: ReadonlySet<string>,
): WorkspaceListRow[] {
  return targets.flatMap((target): WorkspaceListRow[] => [
    { kind: 'target', key: target.repository.path, target },
    ...(collapsed.has(target.repository.path)
      ? []
      : target.entries.length
        ? target.entries.map(
            (entry): WorkspaceListRow => ({
              kind: 'file',
              key: workspaceChangeCommand.selection.key.get(entry),
              entry,
            }),
          )
        : [
            {
              kind: 'empty' as const,
              key: `${target.repository.path}:empty`,
              text: target.error ?? '변경 없음',
            },
          ]),
  ])
}
function toEntries(rows: WorkspaceListRow[], from: number, to: number): WorkspaceChangeEntry[] {
  return rows
    .slice(Math.min(from, to), Math.max(from, to) + 1)
    .flatMap((row) => (row.kind === 'file' ? [row.entry] : []))
}
export const workspaceListAdapter = { row: { toList: toRows }, entry: { toList: toEntries } }
