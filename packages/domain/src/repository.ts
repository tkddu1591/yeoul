export type RepositoryStateKind =
  | 'normal'
  | 'merging'
  | 'rebasing'
  | 'cherry-picking'
  | 'reverting'
  | 'bisecting'

export interface BranchInfo {
  /** detached HEAD면 null */
  name: string | null
  upstream: string | null
  /** upstream과의 차이. `branch.ab`를 확인하지 못했으면 null (예: upstream ref 소실) — 0/0(동기화됨)으로 추측하지 않는다 */
  ahead: number | null
  behind: number | null
}

export type ChangeKind =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'untracked'
  | 'conflicted'

export interface FileChange {
  path: string
  /** rename/copy일 때 원래 경로 */
  origPath: string | null
  /** index(staged) 쪽 변경. 없으면 null */
  staged: ChangeKind | null
  /** worktree(unstaged) 쪽 변경. 없으면 null */
  unstaged: ChangeKind | null
}

export interface RepositoryStatus {
  state: RepositoryStateKind
  branch: BranchInfo
  changes: FileChange[]
}
