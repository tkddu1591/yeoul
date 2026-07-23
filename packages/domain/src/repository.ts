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
  /** HEAD 커밋 해시 — 아직 저장이 없으면(unborn) null. "지금 여기" 마커가 이 값을 따라간다 (E5b) */
  headHash: string | null
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
  /** refs 중 태그인 이름들 — 배지 모양(🏷)·우선순위 하위 분류용. refs에도 그대로 포함된다 (E4 후속, E6b) */
  tags: string[]
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

/** 실험 공간 패널 한 행(로컬) — 상태 배지·우클릭 대상 정보 (E7a) */
export interface LocalBranchStatus {
  name: string
  isCurrent: boolean
  /** 'origin/main' 형태. 연결된 적 없으면 null */
  upstream: string | null
  /** 원격이 지워진 upstream([gone]) — 업데이트 불가, "연결 끊김" 표시 */
  upstreamGone: boolean
  /** upstream 대비 차이 — upstream이 없거나 gone이면 null (0/0으로 위장하지 않는다) */
  ahead: number | null
  behind: number | null
  /** epoch 초 — 마지막 저장 시점 */
  committedAt: number
  /** 끝 커밋 해시(40자) — "여기서 새 실험 공간"의 fromHash로 쓴다 */
  hash: string
}

/** 원격 브랜치 한 행 — 표시 이름이 곧 조작 키다 (E7a) */
export interface RemoteBranchRef {
  /** 'origin' — 첫 '/' 앞 */
  remote: string
  /** 'origin/feature/pay' — 전체 이름 */
  name: string
}

/** 실험 공간 패널 데이터 — for-each-ref 1회 일괄 수집 (E7a 스펙 접근안 A) */
export interface BranchOverview {
  locals: LocalBranchStatus[]
  remotes: RemoteBranchRef[]
}

/** "지금과 비교" 결과 — 양방향 전용 커밋 목록 (각 100개 상한) */
export interface BranchCompare {
  /** 선택 공간에만 있는 저장 (HEAD..name) */
  onlyInSelected: CommitSummary[]
  selectedOverflow: boolean
  /** 지금 공간에만 있는 저장 (name..HEAD) */
  onlyInCurrent: CommitSummary[]
  currentOverflow: boolean
}

/** 재배치 시작 결과 — conflict면 rebasing 상태가 남는다 (E7a) */
export interface RebaseResult {
  outcome: 'completed' | 'up-to-date' | 'conflict'
  autoShelved: boolean
}

/** 재배치 계속 결과 — 다음 저장이 또 겹치면 conflict */
export interface RebaseContinueResult {
  outcome: 'completed' | 'conflict'
}

/** 재배치 진행 위치 — .git/rebase-merge/msgnum·end (실측 2) */
export interface RebaseProgress {
  current: number
  total: number
}

/** 워크트리 하나 — `git worktree list --porcelain` 항목 (E7c) */
export interface WorktreeInfo {
  /** 절대 경로 */
  path: string
  /** 첫 항목 = 본체(저장소 자체) */
  isMain: boolean
  /** 체크아웃 브랜치(refs/heads/ 제거). detached면 null */
  branch: string | null
  headHash: string | null
  /** 폴더가 사라진 등록 — remove로 그대로 정리된다 (실측 F) */
  prunable: boolean
  locked: boolean
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

/** 파일 하나를 특정 시점 내용으로 적용한 결과 — 자동 보관이 개입했으면 UI가 보관함 위치를 안내한다 */
export interface RestoreFileResult {
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
  /** rebased: 재배치로 받기(pull --rebase)가 내 저장을 원격 위로 다시 쌓았다 (E7e) */
  outcome: 'fast-forward' | 'merged' | 'conflict' | 'up-to-date' | 'rebased'
  autoShelved: boolean
}

/** 되돌리기(revert) 결과 — conflict면 REVERT_HEAD가 남는다(상태 바 reverting) */
export interface RevertResult {
  outcome: 'reverted' | 'conflict'
  /** 막혀서 변경을 보관함에 자동 저장했는가 (스펙: 덮기 전 자동 보관) */
  autoShelved: boolean
}

/** 가져오기(cherry-pick) 결과 — conflict면 CHERRY_PICK_HEAD가 남는다(상태 바 cherry-picking) */
export interface CherryPickResult {
  /** empty = 이미 반영된 저장 — 엔진이 빈 진행 상태(CHERRY_PICK_HEAD)를 정리(abort)하고 알려만 준다 */
  outcome: 'picked' | 'conflict' | 'empty'
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
  /** upstream 짧은 이름(예: origin/feature) — rename 뒤 옛 이름 잔존 감지에 쓴다. 없으면 null */
  upstream: string | null
}
