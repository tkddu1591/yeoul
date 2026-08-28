import type { WorkspaceOverview } from '@git-gui/ipc-contract'

async function getOverview(): Promise<WorkspaceOverview | null> {
  return window.gitApi.workspace.overview()
}

/** 워크스페이스 통합 조회의 renderer API 경계. 상태와 표시 정책은 소유하지 않는다. */
export const workspaceOverviewQuery = {
  data: {
    get: getOverview,
  },
}
