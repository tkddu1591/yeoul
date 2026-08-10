import type {
  BackupResult,
  BranchCompare,
  BranchOverview,
  BranchSummary,
  CherryPickResult,
  CommitDetail,
  CommitSummary,
  DiffOptions,
  FileDiff,
  ForkPoint,
  HistorySearchResult,
  MergeResult,
  PullResult,
  RebaseContinueResult,
  RebaseProgress,
  RebaseResult,
  RemoveBranchResult,
  RepositoryStatus,
  RestoreFileResult,
  RevertResult,
  ShelfEntry,
  SwitchResult,
  WorktreeHeadInfo,
  WorktreeInfo,
} from '@git-gui/domain'

export type { DiffOptions, ForkPoint, WorktreeHeadInfo } from '@git-gui/domain'
export type { PullComment, PullDetail, PullSummary } from '@git-gui/hosting'

import type { PullComment, PullDetail, PullSummary } from '@git-gui/hosting'

/**
 * `repo.open`의 결과 — **실패가 throw가 아니라 값이다** (E15a 리뷰 ④).
 *
 * 왜 예외가 아닌가: 렌더러는 실패 원인에 따라 **최근 목록에서 그 항목을 지울지**를 정해야 하는데,
 * 원인을 아는 쪽은 main이고 Electron IPC는 Error의 `message`만 실어 나른다(커스텀 속성은
 * 사라진다). 문구 문자열 매칭은 취약하니, 판단 근거를 계약서에 명시적인 값으로 둔다.
 * "최근 목록의 항목이 상해 있다"는 예상된 결과이므로 결과 객체로 표현하는 것이
 * 이 계약서의 관례이기도 하다 (RemoveBranchResult·SwitchResult·MergeResult…).
 *
 * `reason`은 **사실**이고 제거 여부는 **정책**이라 렌더러가 정한다(목록을 소유한 쪽이다):
 * - `missing` — 폴더가 정말 없다(fs가 ENOENT/ENOTDIR로 답했다). 확실하니 목록에서 빼도 된다
 * - `not-a-repository` — 폴더는 있는데 Git 저장소가 아니다. 이것도 확실하다
 * - `failed` — 확인 자체를 못 했다(권한, 마운트 안 된 외장 디스크, PATH에 git 없음).
 *   **목록을 건드리면 안 된다** — 멀쩡한 저장소가 사라진다
 *
 * `message`는 사용자에게 그대로 보이는 문구다(main이 만든다 — 다른 열기 실패 문구와 같은 자리).
 */
export type RepoOpenResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'missing' | 'not-a-repository' | 'failed'; message: string }

/**
 * preload가 contextBridge로 노출하고 renderer가 사용하는 API 표면.
 *
 * 신뢰 규칙: `repoPath`는 repo.select()·repo.initialPath()·repo.open()이 반환한 값만 유효하다 —
 * main은 자신이 돌려준 경로만 allowlist로 신뢰하고 그 외는 거부한다. 셋 다 같은 검증
 * (rev-parse --is-inside-work-tree + 루트 정규화)을 거친 뒤에만 값을 돌려준다 (E15a).
 * 파일 `path`는 저장소 루트 상대 경로만 허용된다 (절대 경로·`..`·빈 문자열 거부).
 */
export interface GitApi {
  repo: {
    /** 폴더 선택 다이얼로그. 취소하면 null. 반환 경로는 저장소 루트로 정규화된다 */
    select(): Promise<string | null>
    /** E2E 등에서 환경 변수로 주입한 초기 저장소 경로. 반환 경로는 저장소 루트로 정규화된다 */
    initialPath(): Promise<string | null>
    /**
     * 다이얼로그 없이 경로로 연다 — 최근 목록에서 고를 때 (E15a).
     * 성공하면 저장소 루트로 정규화된 경로가 `{ ok: true }`로 온다.
     *
     * 이 인자는 디스크 설정에서 온 렌더러 입력이라 신뢰할 수 없다 — **select()와 동일한 검증
     * (rev-parse --is-inside-work-tree + 루트 정규화)에 더해 절대 경로일 것을 요구한다.**
     * 절대 경로성은 select()가 OS 다이얼로그로 구조적으로 보장하던 것이라 여기만 따로 막는다
     * (E15a 리뷰 ③ 실측: `cwd: ''`는 main의 process.cwd()로 해석돼 앱 자신의 소스 저장소가 열린다).
     * 형식이 잘못된 인자만 throw하고, 열기 실패는 RepoOpenResult로 온다 (E15a 리뷰 ④)
     */
    open(path: string): Promise<RepoOpenResult>
    status(repoPath: string): Promise<RepositoryStatus>
    /** .git 감시 시작 — 이후 외부 변경이 repo:changed push로 온다. 새 경로로 부르면 이전 감시는 교체된다 (E7b) */
    watch(repoPath: string): Promise<void>
    /** repo:changed 구독 — 해제 함수를 반환한다. 이 앱 최초의 push 채널 (E7b) */
    onChanged(listener: (repoPath: string) => void): () => void
    /**
     * 워크트리를 앱에서 연다(전체 전환) — worktreePath가 이 저장소의 워크트리인지 main이
     * 검증한 뒤 allowlist에 등록하고 정규화 경로를 돌려준다 (E7c 보안 가드: select 없는 경로 열기)
     */
    openPath(repoPath: string, worktreePath: string): Promise<string>
    /** OS 홈 디렉터리 절대 경로 — 워크트리 행의 `~` 축약에 쓴다 (E7j) */
    home(): Promise<string>
  }
  /** 창 (E15b) */
  window: {
    /**
     * 새 창에서 연다. `null`이면 저장소 없는 빈 창.
     * **경로 검증은 repo.open과 동일**하다 — 이 인자도 디스크 설정에서 온 렌더러 입력이다.
     * 이미 그 저장소를 연 창이 있으면 새로 만들지 않고 그 창을 앞으로 가져온다
     */
    open(repoPath: string | null): Promise<void>
  }
  worktrees: {
    /** 워크트리 목록 — 첫 항목이 본체 (E7c) */
    list(repoPath: string): Promise<WorktreeInfo[]>
    /** 새 워크트리 — path에 branch 체크아웃. createBranch면 HEAD에서 새 브랜치를 만들며(-b) (E7d) */
    add(repoPath: string, path: string, branch: string, createBranch: boolean): Promise<void>
    /** 지우기 — 미저장 변경이면 needsForce (branches.remove 관례) */
    remove(repoPath: string, path: string, force: boolean): Promise<RemoveBranchResult>
    /** Finder에서 보기 — 경로는 워크트리 목록 검증 경유 (E7c) */
    reveal(repoPath: string, path: string): Promise<void>
    /** 워크트리 HEAD 요약 (E7k) — 호버 카드용. 실패·정보 없음은 null */
    headInfo(repoPath: string, path: string): Promise<WorktreeHeadInfo | null>
  }
  branches: {
    list(repoPath: string): Promise<BranchSummary[]>
    /** 패널용 일괄 개요 — 로컬(upstream·ahead/behind·gone)+원격 (E7a) */
    overview(repoPath: string): Promise<BranchOverview>
    /** fromHash는 40자 hex 전체 해시 또는 null(지금 위치에서) */
    create(repoPath: string, name: string, fromHash: string | null): Promise<void>
    switch(repoPath: string, name: string): Promise<SwitchResult>
    /** name 공간을 지금 공간으로 합친다(스마트 병합) — conflict면 충돌 상태가 남는다 */
    merge(repoPath: string, name: string): Promise<MergeResult>
    remove(repoPath: string, name: string, force: boolean): Promise<RemoveBranchResult>
    rename(repoPath: string, oldName: string, newName: string): Promise<void>
    /** 비현재 공간을 원격 최신으로(ff-only) — 현재 공간은 renderer가 pull로 보낸다 (E7a) */
    update(repoPath: string, name: string): Promise<void>
    /** 선택 공간을 checkout 없이 백업(push) — 첫 연결이면 linked (E7a, E7e) */
    backup(repoPath: string, name: string): Promise<BackupResult>
    /** 원격 공간을 추적 로컬로 가져와 이동 (E7a) */
    checkoutRemote(repoPath: string, name: string): Promise<SwitchResult>
    /** 원격에서 지우기(push --delete) — 확인창은 UI 책임 (E7a) */
    removeRemote(repoPath: string, name: string): Promise<void>
    /** 지금 공간과의 양방향 전용 저장 목록 (E7a) */
    compare(repoPath: string, name: string): Promise<BranchCompare>
  }
  rebase: {
    /** 현재 공간을 onto 위로 재배치 — conflict면 rebasing 상태가 남는다 (E7a) */
    start(repoPath: string, onto: string): Promise<RebaseResult>
    /** 겹침 해소(add) 후 다음 저장으로 — 빈 저장은 git이 자동으로 건너뛴다(실측) */
    continue(repoPath: string): Promise<RebaseContinueResult>
    abort(repoPath: string): Promise<void>
    /** 진행 위치 — rebasing이 아니면 null */
    progress(repoPath: string): Promise<RebaseProgress | null>
  }
  merge: {
    abort(repoPath: string): Promise<void>
  }
  conflicts: {
    /** choice는 'ours'(내 것 유지) | 'theirs'(가져온 것 사용)만 허용된다 */
    resolve(repoPath: string, path: string, choice: 'ours' | 'theirs'): Promise<void>
    markResolved(repoPath: string, path: string): Promise<void>
    /** 충돌 파일 내용 통째 저장(블록 선택·자세히 보기 직접 수정) — add하지 않는다. 비충돌 파일은 거부된다 */
    saveText(repoPath: string, path: string, content: string): Promise<void>
    /** 처음부터 다시 — 겹침 표시를 되살린다(checkout -m) */
    reset(repoPath: string, path: string): Promise<void>
  }
  files: {
    /** 워크트리 텍스트 읽기(충돌 뷰용) — 1MB 상한, 바이너리 거부 */
    readText(repoPath: string, path: string): Promise<string>
  }
  shelf: {
    save(repoPath: string, message: string): Promise<void>
    list(repoPath: string): Promise<ShelfEntry[]>
    restore(repoPath: string, ref: string): Promise<void>
    drop(repoPath: string, ref: string): Promise<void>
  }
  changes: {
    stage(repoPath: string, paths: string[]): Promise<void>
    unstage(repoPath: string, paths: string[]): Promise<void>
    /** 선택 파일 변경 취소 — tracked는 복원, untracked는 삭제. 되돌릴 수 없다 (확인창은 renderer 책임) */
    discard(repoPath: string, trackedPaths: string[], untrackedPaths: string[]): Promise<void>
    diff(repoPath: string, path: string, options: DiffOptions): Promise<FileDiff>
    /** 파일 하나를 디스크에서 삭제 — 되돌릴 수 없다 (확인창은 renderer 책임) */
    removeFile(repoPath: string, path: string): Promise<void>
  }
  commits: {
    create(repoPath: string, message: string): Promise<void>
    /** 커밋 상세 — hash는 40자 hex 전체 해시만 허용된다 */
    show(repoPath: string, hash: string): Promise<CommitDetail>
    /** 커밋 안 단일 파일 diff — 첫 부모 기준. rename이면 origPath 동봉 */
    diffFile(repoPath: string, hash: string, path: string, origPath: string | null): Promise<FileDiff>
    /** 이 파일만 그 시점 내용으로 적용(checkout) — 미저장 변경은 엔진이 파일 단위 자동 보관 후 진행 */
    restoreFile(repoPath: string, hash: string, path: string): Promise<RestoreFileResult>
    /** 그 시점과 지금 워크트리(미저장 포함)의 단일 파일 diff — rename이면 origPath 동봉 */
    diffAgainstWorktree(repoPath: string, hash: string, path: string, origPath: string | null): Promise<FileDiff>
    revert(repoPath: string, hash: string): Promise<RevertResult>
    revertAbort(repoPath: string): Promise<void>
    /** 이 저장 하나만 지금 공간으로 가져온다(cherry-pick) — 병합 커밋은 거부된다 */
    cherryPick(repoPath: string, hash: string): Promise<CherryPickResult>
    cherryPickAbort(repoPath: string): Promise<void>
    /** 이 시점에 태그(lightweight)를 만든다 — 이름·중복·사라진 해시는 친절 에러 */
    createTag(repoPath: string, name: string, hash: string): Promise<void>
    /** 마지막 저장 실행취소(reset --mixed) — hash는 화면이 아는 HEAD(낡은 목록이면 거부) */
    undoLast(repoPath: string, hash: string): Promise<void>
    /** 마지막 저장 메시지 고치기(amend, 메시지만) — staged가 있으면 거부된다 */
    reword(repoPath: string, hash: string, message: string): Promise<void>
  }
  history: {
    /** 최신순 커밋 요약. limit은 1~50000 정수 — 범위 밖은 IPC에서 거부된다 (adapter의 clamp는 심층 방어). ref는 조회 모드(E7g) */
    list(repoPath: string, limit: number, ref?: string): Promise<CommitSummary[]>
    /** 저장소 전체 커밋 검색 (E7i) — 로드 범위 밖 커밋도 찾는다. indices는 list 정렬 기준 위치 */
    search(repoPath: string, query: string, ref?: string): Promise<HistorySearchResult>
  }
  sync: {
    /** 현재 브랜치를 원격으로 백업(push) — 첫 연결이면 linked (E7e). 원격이 없으면 에러 */
    push(repoPath: string): Promise<BackupResult>
    /** 원격의 최신 저장을 받아온다 — merge는 기존 충돌 흐름, rebase는 rebasing 흐름 (E7e) */
    pull(repoPath: string, mode: 'merge' | 'rebase'): Promise<PullResult>
  }
  remotes: {
    /** 원격 최신 가져오기(fetch --all --prune) — 갱신은 감시가 담당 (E7e) */
    fetch(repoPath: string): Promise<void>
  }
}

export const GIT_API_KEY = 'gitApi' as const

export const CHANNELS = {
  repoSelect: 'repo:select',
  repoInitialPath: 'repo:initial-path',
  repoStatus: 'repo:status',
  repoWatch: 'repo:watch',
  /** push(main→renderer) — invoke가 아니라 webContents.send 채널 (E7b) */
  repoChanged: 'repo:changed',
  repoOpen: 'repo:open',
  repoOpenPath: 'repo:open-path',
  repoHome: 'repo:home',
  remotesFetch: 'remotes:fetch',
  worktreesList: 'worktrees:list',
  worktreesAdd: 'worktrees:add',
  worktreesRemove: 'worktrees:remove',
  worktreesReveal: 'worktrees:reveal',
  worktreeHeadInfo: 'worktree:head-info',
  branchesList: 'branches:list',
  branchesCreate: 'branches:create',
  branchesSwitch: 'branches:switch',
  branchesMerge: 'branches:merge',
  branchesRemove: 'branches:remove',
  branchesRename: 'branches:rename',
  branchesOverview: 'branches:overview',
  branchesUpdate: 'branches:update',
  branchesBackup: 'branches:backup',
  branchesCheckoutRemote: 'branches:checkout-remote',
  branchesRemoveRemote: 'branches:remove-remote',
  branchesCompare: 'branches:compare',
  rebaseStart: 'rebase:start',
  rebaseContinue: 'rebase:continue',
  rebaseAbort: 'rebase:abort',
  rebaseProgress: 'rebase:progress',
  mergeAbort: 'merge:abort',
  conflictsResolve: 'conflicts:resolve',
  conflictsMarkResolved: 'conflicts:mark-resolved',
  conflictsSaveText: 'conflicts:save-text',
  conflictsReset: 'conflicts:reset',
  filesReadText: 'files:read-text',
  shelfSave: 'shelf:save',
  shelfList: 'shelf:list',
  shelfRestore: 'shelf:restore',
  shelfDrop: 'shelf:drop',
  changesStage: 'changes:stage',
  changesUnstage: 'changes:unstage',
  changesDiscard: 'changes:discard',
  changesDiff: 'changes:diff',
  changesRemoveFile: 'changes:remove-file',
  commitsCreate: 'commits:create',
  commitsShow: 'commits:show',
  commitsDiffFile: 'commits:diff-file',
  commitsRestoreFile: 'commits:restore-file',
  commitsDiffWorktree: 'commits:diff-worktree',
  commitsRevert: 'commits:revert',
  commitsRevertAbort: 'commits:revert-abort',
  commitsCherryPick: 'commits:cherry-pick',
  commitsCherryPickAbort: 'commits:cherry-pick-abort',
  commitsCreateTag: 'commits:create-tag',
  commitsUndoLast: 'commits:undo-last',
  commitsReword: 'commits:reword',
  historyList: 'history:list',
  historySearch: 'history:search',
  syncPush: 'sync:push',
  syncPull: 'sync:pull',
} as const

/** 호스팅 연결 상태 — 토큰 자체는 절대 renderer로 오지 않는다(login만) */
export interface HostingStatus {
  connected: boolean
  /** 연결된 GitHub 계정 이름 — 미연결이면 null */
  login: string | null
  /** origin remote가 GitHub이면 그 좌표, 아니면(비GitHub·remote 없음) null */
  repo: { owner: string; repo: string } | null
  /** gh CLI 로그인 토큰을 감지했는가 — 미연결 화면의 [gh로 연결] 노출 여부 */
  ghAvailable: boolean
}

/** 리뷰 상세 화면 데이터 — 상세와 코멘트 타임라인을 한 번에(IPC 왕복 1회) */
export interface PullDetailView {
  detail: PullDetail
  comments: PullComment[]
}

/**
 * 호스팅(리뷰 요청) API 표면 — 네트워크·토큰은 전부 main 프로세스에서만 다룬다.
 * repoPath 신뢰 규칙은 GitApi와 동일(main의 allowlist).
 */
export interface HostingApi {
  /** 연결 상태 — 저장된 login이 있으면 네트워크 없이 응답한다. 실패해도 던지지 않고 미연결로 응답 */
  status(repoPath: string): Promise<HostingStatus>
  connect: {
    /** gh CLI 토큰으로 연결 — 감지·검증(user.current) 성공 시에만 저장하고 login 반환 */
    gh(): Promise<string>
    /** 붙여넣은 토큰으로 연결 — 검증 성공 시에만 저장하고 login 반환 */
    token(token: string): Promise<string>
  }
  /** 연결 해제 — 저장된 토큰을 지운다 */
  disconnect(): Promise<void>
  pulls: {
    /** 열린 리뷰 요청 목록 */
    list(repoPath: string): Promise<PullSummary[]>
    /** 리뷰 요청 생성 — main이 브랜치·기본 공간을 검사하고 upstream 없으면 백업(push) 후 생성한다 */
    create(repoPath: string, input: { title: string; body: string }): Promise<PullSummary>
    /** 리뷰 요청을 브라우저로 연다 — URL은 main이 보관한 목록에서만 찾는다(임의 URL 열기 금지) */
    open(repoPath: string, number: number): Promise<void>
    /** 상세 + 코멘트 타임라인 한 번에 — 밖에서 닫힌 404는 친절 문구로 온다 */
    detail(repoPath: string, number: number): Promise<PullDetailView>
    /** 답변 달기 — 빈 본문은 main에서 거부된다 */
    comment(repoPath: string, number: number, body: string): Promise<void>
    /** 승인 — 자기 PR이면 친절 문구로 거부된다 */
    approve(repoPath: string, number: number): Promise<void>
    /** 병합(병합 커밋) — 로컬 동기화는 별도(기존 전환·받아오기 흐름을 UI가 제안) */
    merge(repoPath: string, number: number): Promise<void>
  }
}

export const HOSTING_API_KEY = 'hostingApi' as const

export const HOSTING_CHANNELS = {
  status: 'hosting:status',
  connectGh: 'hosting:connect-gh',
  connectToken: 'hosting:connect-token',
  disconnect: 'hosting:disconnect',
  pullsList: 'hosting:pulls-list',
  pullCreate: 'hosting:pull-create',
  pullOpen: 'hosting:pull-open',
  pullDetail: 'hosting:pull-detail',
  pullComment: 'hosting:pull-comment',
  pullApprove: 'hosting:pull-approve',
  pullMerge: 'hosting:pull-merge',
} as const

/**
 * 창별 레이아웃 (E15b) — 앱 공용 설정과 갈라진다.
 * 렌더러는 이 구분을 모른다: main이 `settings:get-sync`에서 앱 공용과 합쳐 평평하게 돌려주고,
 * `settings:set`에서 성격에 따라 갈라 저장한다. 소비처 코드는 그대로다
 */
export interface WindowLayout {
  /** 좌측 사이드(변경·브랜치·워크트리 탭) 접힘 (E12) */
  leftCollapsed?: boolean
  /** 우측 사이드(히스토리·상세) 접힘 (E12) */
  rightCollapsed?: boolean
  rightWidth?: number
  /** 터미널 도크 열림 (E7b) */
  terminalOpen?: boolean
  /** 터미널 도크 높이(px) (E7b) */
  terminalHeight?: number
}

/**
 * 렌더러가 기억해야 하는 소량 설정. file:// origin의 localStorage는 앱 재시작 간
 * 유지되지 않아(실측) main이 userData/settings.json으로 영속화한다.
 *
 * 창별 필드(WindowLayout)와 앱 공용 필드가 여기서 평평하게 합쳐진다 (E15b) —
 * 렌더러가 보는 표면은 분리 이전과 완전히 동일하다
 */
export interface AppSettings extends WindowLayout {
  theme?: 'light' | 'dark'
  /** 워크트리 선택 시 동작 — 클릭의 기본 동작만 결정한다(우클릭엔 항상 둘 다) (E7c) */
  worktreeSelectAction?: 'terminal' | 'switch-app'
  /** 받아오기 방식 — merge(기본)/rebase (E7e) */
  pullMode?: 'merge' | 'rebase'
  /** 주기적 원격 새로고침(10분) — 기본 켬 (E7e) */
  autoFetch?: boolean
  /** 최근 연 저장소 — 최신이 앞 (E15a) */
  recentRepos?: string[]
}

/** 알려진 필드·올바른 타입만 남긴다 — 렌더러 입력과 디스크 파일 양쪽에 적용하는 공용 방어 */
export function sanitizeSettings(value: unknown): AppSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const candidate = value as AppSettings
  const settings: AppSettings = {}
  if (candidate.theme === 'light' || candidate.theme === 'dark') settings.theme = candidate.theme
  if (typeof candidate.rightWidth === 'number' && Number.isFinite(candidate.rightWidth)) {
    settings.rightWidth = candidate.rightWidth
  }
  if (typeof candidate.terminalOpen === 'boolean') settings.terminalOpen = candidate.terminalOpen
  if (typeof candidate.terminalHeight === 'number' && Number.isFinite(candidate.terminalHeight)) {
    settings.terminalHeight = candidate.terminalHeight
  }
  if (candidate.worktreeSelectAction === 'terminal' || candidate.worktreeSelectAction === 'switch-app') {
    settings.worktreeSelectAction = candidate.worktreeSelectAction
  }
  if (candidate.pullMode === 'merge' || candidate.pullMode === 'rebase') {
    settings.pullMode = candidate.pullMode
  }
  if (typeof candidate.autoFetch === 'boolean') settings.autoFetch = candidate.autoFetch
  if (typeof candidate.leftCollapsed === 'boolean') settings.leftCollapsed = candidate.leftCollapsed
  if (typeof candidate.rightCollapsed === 'boolean') {
    settings.rightCollapsed = candidate.rightCollapsed
  }
  // 배열이 아니면 통째로 버리고, 문자열 아닌 원소만 골라낸다 — 이 목록은 디스크 파일에서 오고
  // 그 값이 repo.open의 인자가 된다 (E15a). sparse array의 hole은 spread로 실체화한 뒤
  // filter가 걷어낸다 (assertStringArray와 같은 이유)
  if (Array.isArray(candidate.recentRepos)) {
    settings.recentRepos = [...(candidate.recentRepos as unknown[])].filter(
      (entry): entry is string => typeof entry === 'string',
    )
  }
  return settings
}

/**
 * 디스크(settings.json)에만 존재하는 확장 설정 — main 전용.
 * hosting.github.token은 safeStorage 암호문(base64)이며, getSync 응답은 sanitizeSettings로
 * renderer 표면 필드만 추리므로 renderer에는 토큰이 절대 전달되지 않는다.
 */
export interface PersistedSettings extends AppSettings {
  hosting?: { github?: { token?: string; login?: string } }
}

/** 디스크 파일용 방어 — renderer 표면 sanitize에 hosting.github(token·login)을 더한다 */
export function sanitizePersistedSettings(value: unknown): PersistedSettings {
  const settings: PersistedSettings = sanitizeSettings(value)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return settings
  const hosting = (value as { hosting?: unknown }).hosting
  if (typeof hosting !== 'object' || hosting === null || Array.isArray(hosting)) return settings
  const github = (hosting as { github?: unknown }).github
  if (typeof github !== 'object' || github === null || Array.isArray(github)) return settings
  const candidate = github as { token?: unknown; login?: unknown }
  const clean: { token?: string; login?: string } = {}
  if (typeof candidate.token === 'string') clean.token = candidate.token
  if (typeof candidate.login === 'string') clean.login = candidate.login
  if (clean.token !== undefined || clean.login !== undefined) settings.hosting = { github: clean }
  return settings
}

/** preload가 노출하는 설정 표면 — initial은 시작 시점 스냅샷(동기), set은 부분 갱신 */
export interface SettingsApi {
  initial: AppSettings
  set(partial: AppSettings): Promise<void>
}

export const SETTINGS_API_KEY = 'settingsApi' as const

export const SETTINGS_CHANNELS = {
  /** preload 전용 동기 채널 — 첫 렌더 전에 테마를 결정해야 깜빡임이 없다 */
  getSync: 'settings:get-sync',
  set: 'settings:set',
} as const

/** 터미널 표면 (E7b) — pty는 main 전용. renderer는 세션 id와 바이트 스트림만 다룬다 */
export interface TerminalApi {
  /** 세션 생성 — cwd 생략 시 저장소 루트. cwd는 그 저장소의 워크트리 경로만 허용(main 검증 — E7c) */
  create(repoPath: string, cwd?: string): Promise<{ sessionId: string }>
  input(sessionId: string, data: string): Promise<void>
  resize(sessionId: string, cols: number, rows: number): Promise<void>
  kill(sessionId: string): Promise<void>
  /** 출력 push 구독 — 해제 함수를 반환한다 */
  onData(listener: (sessionId: string, chunk: string) => void): () => void
  /** 종료 push 구독 — 쉘 exit·명시적 kill 모두 */
  onExit(listener: (sessionId: string, exitCode: number) => void): () => void
}

export const TERMINAL_API_KEY = 'terminalApi' as const

export const TERMINAL_CHANNELS = {
  create: 'terminal:create',
  input: 'terminal:input',
  resize: 'terminal:resize',
  kill: 'terminal:kill',
  /** push(main→renderer) — invoke가 아니라 webContents.send 채널 */
  data: 'terminal:data',
  exit: 'terminal:exit',
} as const

/** 창 상태 표면 (E7f) — 전체화면 여부 push. 신호등 패딩 접기에 쓴다(실측 2: CSS 신호 불가) */
export interface WindowApi {
  /** 전체화면 전환 push 구독 — 해제 함수를 반환한다 */
  onFullScreen(listener: (isFullScreen: boolean) => void): () => void
  /** 창 포커스 복귀 push 구독 — 해제 함수를 반환한다. 감시 사각지대(watch 조용히 죽음·놓친 이벤트)를
   *  메운다 (E10) */
  onFocused(listener: () => void): () => void
}

export const WINDOW_API_KEY = 'windowApi' as const

export const WINDOW_CHANNELS = {
  /** push(main→renderer) — enter/leave-full-screen (E7f) */
  fullScreen: 'window:full-screen',
  /** push(main→renderer) — 창이 포커스를 받을 때 (E10) */
  focused: 'window:focused',
  /** 새 창에서 연다 — 경로가 null이면 빈 창 (E15b) */
  open: 'window:open',
} as const
