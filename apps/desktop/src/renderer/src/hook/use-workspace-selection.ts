import type { ListNavigation } from '../ui/list-navigation'
import { useState } from 'react'
import type { WorkspaceOverview, WorkspaceChangeResult } from '@git-gui/ipc-contract'
import { workspaceChangesAdapter } from '../adapter/workspace-changes.adapter'
import { workspaceListAdapter } from '../adapter/workspace-list.adapter'
import { workspaceSelection } from '../service/workspace-selection.service'
import {
  workspaceChangeCommand,
  type WorkspaceChangeEntry,
  type WorkspaceChangeMoveRequest,
} from '../store/workspace-change-command'

export function useWorkspaceSelection(
  overview: WorkspaceOverview | null,
  onMove: (request: WorkspaceChangeMoveRequest) => Promise<WorkspaceChangeResult>,
) {
  const [query, setQuery] = useState('')
  const [anchor, setAnchor] = useState<number | null>(null)
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [moving, setMoving] = useState(false)
  const [result, setResult] = useState<WorkspaceChangeResult | null>(null)
  const targets = workspaceChangesAdapter.target.toList(overview?.repositories ?? [])
  const visible = workspaceSelection.list.filter(targets, query)
  const rows = workspaceListAdapter.row.toList(visible, query ? new Set() : collapsed)
  const entries = targets.flatMap((target) => target.entries)
  const visibleEntries = visible.flatMap((target) => target.entries)
  const selected = entries.filter((entry) =>
    checked.has(workspaceChangeCommand.selection.key.get(entry)),
  )
  const visibleSelected = visibleEntries.filter((entry) =>
    checked.has(workspaceChangeCommand.selection.key.get(entry)),
  )
  const move = async (
    items: WorkspaceChangeEntry[],
    target: WorkspaceChangeMoveRequest['target'],
  ) => {
    if (!items.length || moving) return
    setMoving(true)
    try {
      const next = await onMove({ target, groups: workspaceChangeCommand.group.toList(items) })
      setResult(next)
      const completed = new Set(
        next.results.filter((item) => item.status === 'completed').map((item) => item.path),
      )
      setChecked((keys) =>
        workspaceSelection.selection.toggle(
          keys,
          items.filter((item) => completed.has(item.repository.path)),
          false,
        ),
      )
    } finally {
      setMoving(false)
    }
  }
  return {
    data: {
      targets,
      visibleEntries,
      selected,
      hidden: selected.length - visibleSelected.length,
      checked,
      moving,
      result,
      rows,
      query,
      all: visibleEntries.length > 0 && visibleSelected.length === visibleEntries.length,
      collapsed,
    },
    filter: {
      set: (value: string) => {
        setQuery(value)
        setAnchor(null)
      },
    },
    selection: {
      navigate: ({ from, to, extend }: ListNavigation) => {
        if (!extend) {
          setAnchor(to)
          return
        }
        const start = anchor ?? from
        setAnchor(start)
        setChecked(
          workspaceSelection.selection.toggle(
            new Set(),
            workspaceListAdapter.entry.toList(rows, start, to),
            true,
          ),
        )
      },
      toggle: (items: WorkspaceChangeEntry[], select: boolean) =>
        setChecked((keys) => workspaceSelection.selection.toggle(keys, items, select)),
      clear: () => setChecked(new Set()),
    },
    group: {
      toggle: (path: string) =>
        setCollapsed((previous) => {
          const next = new Set(previous)
          if (next.has(path)) next.delete(path)
          else next.add(path)
          return next
        }),
    },
    change: { move },
  }
}
