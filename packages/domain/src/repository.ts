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

/** diff 조회 대상 — index(staged) 쪽인지, untracked 신규 파일인지. adapter와 IPC 계약이 공유한다 */
export interface DiffOptions {
  staged: boolean
  untracked: boolean
  /** staged rename일 때 원래 경로 — pathspec에 함께 넣어야 rename으로 표시된다 (없으면 "새 파일 추가"로 위장) */
  origPath?: string | null
}

/** 저장된 역사 한 항목 — log의 요약 */
export interface CommitSummary {
  hash: string
  shortHash: string
  subject: string
  authorName: string
  /** epoch 초 */
  committedAt: number
  /** 이 커밋을 가리키는 브랜치·태그 이름들 (%D에서 "HEAD -> "·"tag: " 접두사 제거). 없으면 빈 배열 */
  refs: string[]
  /** 부모 커밋 해시 — 2개 이상이면 병합 커밋 */
  parents: string[]
}

/** 커밋에 담긴 파일 하나의 변경 — 커밋 상세에서 사용한다 */
export interface CommitFileChange {
  path: string
  /** rename/copy일 때 원래 경로 */
  origPath: string | null
  kind: ChangeKind
}

/** 커밋 클릭 상세 — 전체 메시지와 변경 파일 목록. diff는 파일 단위로 따로 조회한다 */
export interface CommitDetail {
  hash: string
  shortHash: string
  subject: string
  /** 본문(멀티라인). 없으면 빈 문자열 */
  body: string
  authorName: string
  /** epoch 초 */
  committedAt: number
  parents: string[]
  files: CommitFileChange[]
}
