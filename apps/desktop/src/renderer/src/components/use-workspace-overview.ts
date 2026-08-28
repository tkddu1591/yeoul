import { useRef, useState } from 'react'
import type { WorkspaceInfo, WorkspaceOverview } from '@git-gui/ipc-contract'
import { workspaceOverviewQuery } from '../store/workspace-overview-query'

interface WorkspaceOverviewState {
  workspacePath: string | null
  overview: WorkspaceOverview | null
  loading: boolean
  error: string | null
}

const INITIAL_STATE: WorkspaceOverviewState = {
  workspacePath: null,
  overview: null,
  loading: false,
  error: null,
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** 브랜치·워크트리 탭 진입 이벤트에서만 워크스페이스 전체 조회를 시작한다. */
export function useWorkspaceOverview(workspace: WorkspaceInfo | null) {
  const [state, setState] = useState<WorkspaceOverviewState>(INITIAL_STATE)
  const requestId = useRef(0)
  const matchesWorkspace = workspace !== null && state.workspacePath === workspace.path

  const [query] = useState(() => ({
    refresh: async (targetWorkspace: WorkspaceInfo | null) => {
      if (targetWorkspace === null) return
      const workspacePath = targetWorkspace.path
      const id = ++requestId.current
      setState((current) => ({
        workspacePath,
        overview: current.workspacePath === workspacePath ? current.overview : null,
        loading: true,
        error: null,
      }))
      try {
        const overview = await workspaceOverviewQuery.data.get()
        setState((current) => {
          if (id !== requestId.current || current.workspacePath !== workspacePath) return current
          return {
            ...current,
            overview,
            loading: false,
            error: overview === null ? '워크스페이스를 다시 열어 주세요.' : null,
          }
        })
      } catch (cause) {
        setState((current) =>
          id === requestId.current && current.workspacePath === workspacePath
            ? { ...current, loading: false, error: errorMessage(cause) }
            : current,
        )
      }
    },
  }))

  return {
    data: {
      overview: matchesWorkspace ? state.overview : null,
      loading: matchesWorkspace && state.loading,
      error: matchesWorkspace ? state.error : null,
    },
    query,
  }
}
