import type { CommitSummary } from '@git-gui/domain'
import type { WorkspaceOverview, WorkspaceRepository } from '@git-gui/ipc-contract'

export interface WorkspaceHistoryItem {
  repository: WorkspaceRepository
  commit: CommitSummary
}

function toHistoryList(overview: WorkspaceOverview | null): WorkspaceHistoryItem[] {
  if (overview === null) return []
  return overview.repositories
    .flatMap(({ repository, history }) => (history ?? []).map((commit) => ({ repository, commit })))
    .sort(
      (left, right) =>
        right.commit.committedAt - left.commit.committedAt ||
        left.repository.relativePath.localeCompare(right.repository.relativePath),
    )
}

/** 워크스페이스 집계 응답을 패널 전용 표시 항목으로 바꾸는 renderer 변환 경계. */
export const workspaceOverviewItems = {
  history: {
    toList: toHistoryList,
  },
}
