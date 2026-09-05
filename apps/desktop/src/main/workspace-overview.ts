import { createGitClient } from '@git-gui/git-adapter'
import type {
  WorkspaceInfo,
  WorkspaceOverview,
  WorkspaceOverviewRequest,
  WorkspaceRepository,
  WorkspaceRepositoryOverview,
  WorkspaceWorktreeOverview,
} from '@git-gui/ipc-contract'

async function getRepository(
  repository: WorkspaceRepository,
  request: WorkspaceOverviewRequest,
): Promise<WorkspaceRepositoryOverview> {
  const client = createGitClient(repository.path)
  const limit = Math.max(1, Math.min(request.historyLimit ?? 50, 5000))
  const errors: NonNullable<WorkspaceRepositoryOverview['errors']> = {}
  const read = async <T>(area: keyof typeof errors, operation: Promise<T>): Promise<T | null> => {
    try {
      return await operation
    } catch (cause) {
      errors[area] = cause instanceof Error ? cause.message : String(cause)
      return null
    }
  }
  const historyQuery = async () => {
    if (!request.query?.trim()) return client.history.list(limit + 1)
    const result = await client.history.search(request.query.trim())
    if (result.indices.length === 0) return []
    const history = await client.history.list(Math.max(...result.indices) + 1)
    const hashes = new Set(result.hashes)
    return history.filter((commit) => hashes.has(commit.hash)).slice(0, limit + 1)
  }
  const [status, branches, worktrees, history] = await Promise.all([
    read('status', client.repo.status()),
    read('branches', client.branches.overview()),
    read('worktrees', client.worktrees.list()),
    read('history', historyQuery()),
  ])
  const workingTrees: WorkspaceWorktreeOverview[] = []
  // Bound subprocess concurrency. A large worktree collection must not spawn an unbounded batch.
  for (const worktree of worktrees ?? []) {
    if (worktree.path === repository.path) {
      workingTrees.push({
        worktree,
        status,
        error: status === null ? '상태를 읽지 못했어요.' : null,
      })
      continue
    }
    try {
      workingTrees.push({
        worktree,
        status: await createGitClient(worktree.path).repo.status(),
        error: null,
      })
    } catch (cause) {
      workingTrees.push({
        worktree,
        status: null,
        error: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }
  return {
    repository,
    status,
    branches,
    worktrees,
    workingTrees,
    history: history?.slice(0, limit) ?? null,
    historyMore: (history?.length ?? 0) > limit,
    errors,
    error: Object.values(errors).length === 0 ? null : Object.values(errors).join('\n'),
  }
}

async function getOverview(
  workspace: WorkspaceInfo,
  request: WorkspaceOverviewRequest = {},
): Promise<WorkspaceOverview> {
  const repositories: WorkspaceRepositoryOverview[] = []
  for (let offset = 0; offset < workspace.repositories.length; offset += 4) {
    repositories.push(
      ...(await Promise.all(
        workspace.repositories
          .slice(offset, offset + 4)
          .map((repository) => getRepository(repository, request)),
      )),
    )
  }
  return { workspace, repositories }
}

/** Application orchestration: adapters interpret Git; this boundary coordinates independent reads. */
export const workspaceOverview = { repositories: { get: getOverview } }
