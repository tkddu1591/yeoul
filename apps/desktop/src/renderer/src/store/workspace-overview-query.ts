import type { WorkspaceChangeBatch, WorkspaceOverviewRequest } from '@git-gui/ipc-contract'

/** IPC boundary: raw contract results only. */
export const workspaceOverviewQuery = {
  data: { get: (request?: WorkspaceOverviewRequest) => window.gitApi.workspace.overview(request) },
  changes: { move: (request: WorkspaceChangeBatch) => window.gitApi.workspace.move(request) },
  events: { subscribe: (listener: () => void) => window.gitApi.workspace.onChanged(listener) },
}
