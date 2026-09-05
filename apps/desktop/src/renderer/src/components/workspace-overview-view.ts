import type { WorkspaceOverview, WorkspaceRepository } from '@git-gui/ipc-contract'

/** 기존 브랜치·워크트리 패널이 워크스페이스 트리 모드에서 공유하는 읽기 전용 데이터. */
export interface WorkspaceOverviewView {
  overview: WorkspaceOverview | null
  currentRepository: WorkspaceRepository | null
  currentPath?: string | null
  loading: boolean
  error: string | null
}
