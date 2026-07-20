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

/** 실험 공간(branch) 하나 — 스위처 목록용 */
export interface BranchSummary {
  name: string
  isCurrent: boolean
  /** epoch 초 — 이 공간의 마지막 저장 시점 */
  committedAt: number
  upstream: string | null
}

/** 보관함(stash) 항목 하나 */
export interface ShelfEntry {
  /** git stash ref — "stash@{n}". 목록 갱신 직후에만 유효하다(변이는 busy로 직렬화됨) */
  ref: string
  /** 보관 항목의 실제 커밋 해시 — 미리보기(커밋 상세 재사용)에 쓴다 (피드백 2) */
  hash: string
  /** epoch 초 */
  savedAt: number
  message: string
}

/** 실험 공간 전환 결과 — 자동 보관이 개입했으면 UI가 보관함 위치를 안내한다 */
export interface SwitchResult {
  autoShelved: boolean
}

/** 실험 공간 합치기 결과 */
export interface MergeResult {
  /** conflict면 충돌 상태가 남아 있다 — 해소·마무리(commit) 또는 취소(abort)가 필요하다 */
  outcome: 'fast-forward' | 'merged' | 'conflict' | 'up-to-date'
  /** 막혀서 변경을 보관함에 자동 저장했는가 (스펙: 덮기 전 자동 보관) */
  autoShelved: boolean
}

/** 받아오기(pull) 결과 — conflict면 MERGE_HEAD가 남아 기존 합치기 충돌 흐름을 그대로 쓴다 */
export interface PullResult {
  outcome: 'fast-forward' | 'merged' | 'conflict' | 'up-to-date'
  autoShelved: boolean
}

/** 되돌리기(revert) 결과 — conflict면 REVERT_HEAD가 남는다(상태 바 reverting) */
export interface RevertResult {
  outcome: 'reverted' | 'conflict'
  /** 막혀서 변경을 보관함에 자동 저장했는가 (스펙: 덮기 전 자동 보관) */
  autoShelved: boolean
}

/** 실험 공간 지우기 결과 — 합쳐지지 않은 저장이 있으면 지우지 않고 needsForce로 알린다 */
export interface RemoveBranchResult {
  removed: boolean
  needsForce: boolean
}

/** 리뷰 요청(PR) 전 검사용 — 현재 브랜치와 원격 연결(upstream) 여부 */
export interface SyncBranchStatus {
  /** detached HEAD면 null */
  branch: string | null
  hasUpstream: boolean
}
