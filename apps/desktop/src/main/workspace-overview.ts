import { createGitClient } from '@git-gui/git-adapter'
import type {
  WorkspaceInfo,
  WorkspaceOverview,
  WorkspaceRepositoryOverview,
} from '@git-gui/ipc-contract'

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

async function getRepositoryOverview(
  workspace: WorkspaceInfo,
): Promise<WorkspaceOverview> {
  const repositories = await Promise.all(
    workspace.repositories.map(async (repository): Promise<WorkspaceRepositoryOverview> => {
      const client = createGitClient(repository.path)
      try {
        const [status, branches, worktrees, history] = await Promise.all([
          client.repo.status(),
          client.branches.overview(),
          client.worktrees.list(),
          client.history.list(50),
        ])
        return { repository, status, branches, worktrees, history, error: null }
      } catch (cause) {
        return {
          repository,
          status: null,
          branches: null,
          worktrees: null,
          history: null,
          error: errorMessage(cause),
        }
      }
    }),
  )
  return { workspace, repositories }
}

/** 워크스페이스 경계에서 독립 저장소들의 읽기 전용 관제 데이터를 병렬 집계한다. */
export const workspaceOverview = {
  repositories: {
    get: getRepositoryOverview,
  },
}
