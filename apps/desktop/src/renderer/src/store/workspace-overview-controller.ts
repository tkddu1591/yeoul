import type {
  WorkspaceInfo,
  WorkspaceOverview,
  WorkspaceOverviewRequest,
} from '@git-gui/ipc-contract'
import { workspaceOverviewQuery } from './workspace-overview-query'

export interface WorkspaceOverviewState {
  workspacePath: string | null
  overview: WorkspaceOverview | null
  loading: boolean
  error: string | null
  historyLimit: number
  query: string
}
const initial = (): WorkspaceOverviewState => ({
  workspacePath: null,
  overview: null,
  loading: false,
  error: null,
  historyLimit: 50,
  query: '',
})

function create(
  publish: (state: WorkspaceOverviewState) => void,
  read = workspaceOverviewQuery.data.get,
) {
  let state = initial()
  let target: WorkspaceInfo | null = null
  let generation = 0
  let backgroundPending = false
  let queue: Promise<void> = Promise.resolve()
  const update = (patch: Partial<WorkspaceOverviewState>) => {
    state = { ...state, ...patch }
    publish(state)
  }

  const refresh = (
    workspace: WorkspaceInfo | null,
    request: WorkspaceOverviewRequest = {},
  ): Promise<void> => {
    const id = ++generation
    if (workspace === null) {
      target = null
      backgroundPending = false
      state = initial()
      publish(state)
      return Promise.resolve()
    }
    const changed = target?.path !== workspace.path
    target = workspace
    const options = {
      historyLimit: request.historyLimit ?? (changed ? 50 : state.historyLimit),
      query: request.query ?? (changed ? '' : state.query),
      discover: request.discover,
    }
    update({
      historyLimit: options.historyLimit,
      query: options.query,
      workspacePath: workspace.path,
      overview: changed ? null : state.overview,
      loading: true,
      error: null,
    })
    // Only one IPC query is in flight. Superseded user requests never reach the backend.
    const next = queue.then(async () => {
      if (id !== generation) return
      backgroundPending = false
      try {
        const overview = await read(options)
        if (id === generation)
          update({
            overview,
            loading: false,
            error: overview === null ? '작업 공간을 다시 열어 주세요.' : null,
          })
      } catch (cause) {
        if (id === generation)
          update({ loading: false, error: cause instanceof Error ? cause.message : String(cause) })
      } finally {
        // Publish the completed snapshot during continuous edits, then consume one trailing read.
        // Invalidating every response on every filesystem event would starve a busy workspace.
        if (backgroundPending && id === generation) {
          backgroundPending = false
          void refresh(target)
        }
      }
    })
    queue = next
    return next
  }
  return {
    refresh,
    reload: () => {
      if (state.loading) {
        backgroundPending = true
        return queue
      }
      return refresh(target)
    },
    search: (query: string) => refresh(target, { query, historyLimit: 50 }),
    more: () => refresh(target, { historyLimit: Math.min(state.historyLimit + 100, 5000) }),
  }
}
export const workspaceOverviewController = { state: { create: initial }, instance: { create } }
