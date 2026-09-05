import { useEffect, useState } from 'react'
import type { WorkspaceInfo } from '@git-gui/ipc-contract'
import { workspaceSummary } from '../service/workspace-summary.service'
import { workspaceOverviewQuery } from '../store/workspace-overview-query'
import { workspaceOverviewController } from '../store/workspace-overview-controller'

export function useWorkspaceOverview(workspace: WorkspaceInfo | null, currentPath: string | null) {
  const [state, setState] = useState(workspaceOverviewController.state.create)
  const [query] = useState(() => workspaceOverviewController.instance.create(setState))
  useEffect(
    () =>
      workspaceOverviewQuery.events.subscribe(() => {
        void query.reload()
      }),
    [query],
  )
  const matches = workspace !== null && state.workspacePath === workspace.path
  return {
    data: {
      overview: matches ? state.overview : null,
      loading: matches && state.loading,
      error: matches ? state.error : null,
      changeCount: matches ? workspaceSummary.change.count(state.overview) : 0,
      repository: matches ? workspaceSummary.repository.find(state.overview, currentPath) : null,
      historyLimit: state.historyLimit,
      query: state.query,
    },
    query,
  }
}
