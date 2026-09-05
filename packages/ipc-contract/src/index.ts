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
  FileMutationGuard,
  DiscardChangesRequest,
  RemoveFileRequest,
  RemoteInfo,
  ForkPoint,
  HistorySearchResult,
  HunkStageRequest,
  LineStageRequest,
  MergeResult,
  PullResult,
  PushConfirmation,
  PushPreview,
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
  WorktreeRemoveResult,
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
export type RepoOpenFailureReason = 'missing' | 'not-a-repository' | 'failed'

export type RepoOpenResult =
  | { ok: true; path: string }
  | { ok: false; reason: RepoOpenFailureReason; message: string }

/**
 * 새 창에서 열기의 결과 (E15b 리뷰 I-2) — `repo.open`과 **같은 사인**을 돌려준다.
 *
 * 예전엔 `window:open`이 실패를 throw했고 렌더러가 `void`로 버려, 같은 최근 목록 항목이
 * 클릭이냐 ⌥클릭이냐에 따라 갈렸다: 평범한 클릭은 안내가 뜨고 목록에서 빠지는데 ⌥클릭은
 * **배너도 없고 목록도 그대로이고 콘솔에 uncaught rejection만** 남았다(실측:
 * `pageerror:Error invoking remote method 'window:open'`). E15a가 만든 사인 분리
 * (`missing`/`not-a-repository`/`failed`)가 이 진입점에서만 버려졌다.
 *
 * 성공에 경로를 싣지 않는 이유: 이 창은 아무것도 안 바뀐다 — 저장소는 **새 창**이 연다.
 * 형식이 잘못된 인자만 throw하는 것은 `repo.open`과 같다("예상된 실패는 예외가 아니다")
 */
export type WindowOpenResult =
  | { ok: true }
  | { ok: false; reason: RepoOpenFailureReason; message: string }

/** 워크스페이스 안에서 발견한 하나의 독립 Git 저장소. */
export interface WorkspaceRepository {
  /** Git이 정규화한 저장소 루트 절대 경로 */
  path: string
  /** 워크스페이스 루트 기준 경로. 루트 자체가 저장소면 `.` */
  relativePath: string
  /** 목록에서 쓰는 마지막 폴더 이름 */
  name: string
}

/** 여러 Git 저장소를 묶는 상위 작업 폴더. */
export interface WorkspaceInfo {
  /** 실제 경로로 정규화한 워크스페이스 루트 */
  path: string
  name: string
  repositories: WorkspaceRepository[]
}

export interface WorkspaceWorktreeOverview {
  worktree: WorktreeInfo
  status: RepositoryStatus | null
  error: string | null
}

export interface WorkspaceOverviewRequest {
  historyLimit?: number
  query?: string
  discover?: boolean
}

export interface WorkspaceChangeBatch {
  target: 'staged' | 'unstaged'
  groups: Array<{ path: string; paths: string[] }>
}

export interface WorkspaceChangeResult {
  results: Array<{ path: string; status: 'completed' | 'failed' | 'pending'; error: string | null }>
}

/** 워크스페이스 관제 화면에서 저장소 하나를 요약한 읽기 전용 데이터. */
export interface WorkspaceRepositoryOverview {
  repository: WorkspaceRepository
  status: RepositoryStatus | null
  branches: BranchOverview | null
  worktrees: WorktreeInfo[] | null
  history: CommitSummary[] | null
  workingTrees?: WorkspaceWorktreeOverview[]
  historyMore?: boolean
  errors?: Partial<Record<'status' | 'branches' | 'worktrees' | 'history', string>>
  /** 이 저장소만 읽지 못해도 나머지 저장소는 계속 보여 준다. */
  error: string | null
}

/** 여러 독립 저장소의 변경·브랜치·워크트리·이력을 한 시점에 모은 워크스페이스 개요. */
export interface WorkspaceOverview {
  workspace: WorkspaceInfo
  repositories: WorkspaceRepositoryOverview[]
}

/**
 * preload가 contextBridge로 노출하고 renderer가 사용하는 API 표면.
 *
 * 신뢰 규칙: `repoPath`는 repo.select()·repo.initialPath()·repo.open()이 반환한 값만 유효하다 —
 * main은 자신이 돌려준 경로만 allowlist로 신뢰하고 그 외는 거부한다. 셋 다 같은 검증
 * (rev-parse --is-inside-work-tree + 루트 정규화)을 거친 뒤에만 값을 돌려준다 (E15a).
 * 파일 `path`는 저장소 루트 상대 경로만 허용된다 (절대 경로·`..`·빈 문자열 거부).
 */
export interface GitActivity {
  id: number
  operation: string
  cwd: string
  startedAt: number
  status: 'running' | 'completed' | 'failed' | 'canceled'
  durationMs: number
}

export interface GitApi {
  jobs: {
    /** 현재 저장소에서 실행 중인 Git 프로세스를 중단한다. */
    cancel(repoPath?: string): Promise<number>
    history(): Promise<GitActivity[]>
    onChanged(listener: (entry: GitActivity) => void): () => void
  }
  repo: {
    /** 폴더 선택 다이얼로그. 취소하면 null. 반환 경로는 저장소 루트로 정규화된다 */
    select(): Promise<string | null>
    /** 원격 URL을 사용자가 고른 빈 폴더에 복제한다. 취소하면 null. */
    clone(url: string): Promise<string | null>
    /** 사용자가 고른 폴더를 새 Git 저장소로 초기화한다. 취소하면 null. */
    init(): Promise<string | null>
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
  /** 여러 독립 저장소를 한 작업 폴더로 묶는 멀티레포 워크스페이스. */
  workspace: {
    /** 폴더를 고르고 그 안의 Git 저장소를 찾는다. 취소하면 null. */
    select(): Promise<WorkspaceInfo | null>
    open(path: string): Promise<WorkspaceInfo>
    /** 복원된 이 탭의 워크스페이스를 다시 검색한다. 없거나 유효하지 않으면 null. */
    initial(): Promise<WorkspaceInfo | null>
    /** 현재 탭 워크스페이스의 저장소 목록을 다시 검색한다. */
    refresh(): Promise<WorkspaceInfo | null>
    /** 하위 모든 저장소의 로컬·원격 브랜치와 워크트리를 병렬로 모은다. */
    overview(request?: WorkspaceOverviewRequest): Promise<WorkspaceOverview | null>
    onChanged(listener: () => void): () => void
    move(request: WorkspaceChangeBatch): Promise<WorkspaceChangeResult>
    /** 현재 저장소는 유지하고 워크스페이스 문맥만 닫는다. */
    close(): Promise<void>
  }
  /** 창 (E15b) */
  window: {
    /**
     * 새 창에서 연다. `null`이면 저장소 없는 빈 창.
     * **경로 검증은 repo.open과 동일**하다 — 이 인자도 디스크 설정에서 온 렌더러 입력이다.
     * 이미 그 저장소를 연 창이 있으면 새로 만들지 않고 그 창을 앞으로 가져온다.
     *
     * 열기 실패는 `WindowOpenResult`로 온다 — 던지지 않는다 (E15b 리뷰 I-2)
     */
    open(repoPath: string | null): Promise<WindowOpenResult>
  }
  /** 탭 (E15c) — 한 창 안의 저장소들. 탭 id는 그 탭 뷰의 webContents.id다 */
  tabs: {
    /**
     * 이 저장소를 이 창의 새 탭으로 연다. `null`이면 빈 탭(RepoPicker) —
     * 어느 창에든 이미 열려 있으면 새로 만들지 않고 **그 탭을 활성화**한다 (스펙 §3 규칙 하나).
     *
     * 반환은 `WindowOpenResult`를 **그대로 재사용한다** — 실패 사유 집합이 동일하고(경로 검증·
     * missing·not-a-repository·failed), 렌더러의 최근 목록 제거 정책(reason !== 'failed')이
     * window.open과 이 진입점에서 **같은 코드**로 돌아야 한다(E15b 리뷰 I-2의 결론).
     * 타입을 하나 더 만들면 그 정책이 다시 갈라진다
     */
    open(repoPath: string | null): Promise<WindowOpenResult>
    /**
     * 이 저장소가 어느 창의 탭에든 이미 열려 있으면 그 창을 앞으로 + 그 탭을 활성화하고 true,
     * 아니면 아무것도 하지 않고 false (E15c Task 6 — 스펙 §3 전환기 행의 판정 절반).
     *
     * "갈아탄다" 실행은 여기 없다 — false를 받은 호출자가 기존 갈아타기 경로(스토어
     * openRepository)로 잇는다. E15a가 그 경로에 쌓은 것(상태 유출 정리·최근 목록 갱신·실패 시
     * 목록 제거)을 main이 대신할 수 없어서 판정만 main(정본 레지스트리)에 묻는 모양이다.
     * 비교는 레지스트리의 정규화된 저장소 루트와의 문자열 일치다 — 호출자는 main이 정규화해 준
     * 경로(최근 목록·현재 경로)만 넘긴다
     */
    showExisting(repoPath: string): Promise<boolean>
    /** 이 탭을 활성으로 — **자기 창의 탭만** 유효하다(main이 sender의 창과 대조해 검증) */
    activate(tabId: number): Promise<void>
    /** 탭 닫기 — 마지막 탭이면 창이 닫힌다(스펙 §5). 자기 창의 탭만 유효하다(main 검증) */
    close(tabId: number): Promise<void>
    /**
     * 탭 드래그 드롭 (E15d). screenX/screenY는 **렌더러가 clientX+window.screenX로 계산한
     * 절대 스크린 좌표**다 — event.screenX가 아니다: CDP 합성 입력(E2E)에서는 event.screenX가
     * 창 상대 좌표로 오고(실측 — 창 (360,84)에서 screenX===clientX), 실제 입력에서는 뷰가 창
     * 원점 전체 크기라(contentBounds==bounds 실측) 두 식이 같은 값이 된다. toIndex는 같은
     * 탭바 안 드롭일 때 옮겨 갈 자리(삽입선과 같은 계산) — main이 드롭 좌표가 제 창 탭바
     * 영역일 때만 쓰고 범위는 레지스트리가 클램프한다. 자기 창의 탭만 유효(main 검증).
     * 다른 창의 탭바 드롭은 그 창으로 이동(끝 삽입·이동한 탭이 활성), 어느 탭바도 아니면
     * 커서 위치의 새 창으로 떼어내기 — 판정은 전부 main의 z-순서 장부+getBounds() 몫이다.
     * 드래그 중 그 탭이 크래시했으면(E15e) 드롭은 통째로 취소된다
     */
    dragEnd(tabId: number, screenX: number, screenY: number, toIndex: number): Promise<void>
    /** 구독 — 등록 즉시 현재 목록이 한 번 오고, 이후 이 창의 탭이 바뀔 때마다 push가 온다 */
    onChanged(listener: (tabs: TabInfo[]) => void): () => void
  }
  worktrees: {
    /** 워크트리 목록 — 첫 항목이 본체 (E7c) */
    list(repoPath: string): Promise<WorktreeInfo[]>
    /** 새 워크트리 — path에 branch 체크아웃. createBranch면 HEAD에서 새 브랜치를 만들며(-b) (E7d) */
    add(repoPath: string, path: string, branch: string, createBranch: boolean): Promise<void>
    /** 지우기 — 미저장 변경이면 needsForce (branches.remove 관례) */
    remove(
      repoPath: string,
      path: string,
      force: boolean,
      guard?: string,
    ): Promise<WorktreeRemoveResult>
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
    resolve(
      repoPath: string,
      path: string,
      choice: 'ours' | 'theirs',
      expectedContent: string,
    ): Promise<void>
    markResolved(repoPath: string, path: string): Promise<void>
    /** 충돌 파일 내용 통째 저장(블록 선택·자세히 보기 직접 수정) — add하지 않는다. 비충돌 파일은 거부된다 */
    saveText(
      repoPath: string,
      path: string,
      content: string,
      expectedContent: string,
    ): Promise<void>
    /** 처음부터 다시 — 겹침 표시를 되살린다(checkout -m) */
    reset(repoPath: string, path: string, expectedContent: string): Promise<void>
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
    guard: {
      capture(repoPath: string, paths: string[]): Promise<FileMutationGuard>
    }
    stage(repoPath: string, paths: string[]): Promise<void>
    unstage(repoPath: string, paths: string[]): Promise<void>
    hunk: {
      stage(repoPath: string, request: HunkStageRequest): Promise<void>
      unstage(repoPath: string, request: HunkStageRequest): Promise<void>
    }
    line: {
      stage(repoPath: string, request: LineStageRequest): Promise<void>
      unstage(repoPath: string, request: LineStageRequest): Promise<void>
    }
    /** 선택 파일 변경 취소 — tracked는 복원, untracked는 삭제. 되돌릴 수 없다 (확인창은 renderer 책임) */
    discard(repoPath: string, request: DiscardChangesRequest): Promise<void>
    diff(repoPath: string, path: string, options: DiffOptions): Promise<FileDiff>
    /** 파일 하나를 디스크에서 삭제 — 되돌릴 수 없다 (확인창은 renderer 책임) */
    removeFile(repoPath: string, request: RemoveFileRequest): Promise<void>
  }
  commits: {
    create(repoPath: string, message: string): Promise<void>
    /** 커밋 상세 — hash는 40자 hex 전체 해시만 허용된다 */
    show(repoPath: string, hash: string): Promise<CommitDetail>
    /** 커밋 안 단일 파일 diff — 첫 부모 기준. rename이면 origPath 동봉 */
    diffFile(
      repoPath: string,
      hash: string,
      path: string,
      origPath: string | null,
    ): Promise<FileDiff>
    /** 이 파일만 그 시점 내용으로 적용(checkout) — 미저장 변경은 엔진이 파일 단위 자동 보관 후 진행 */
    restoreFile(repoPath: string, hash: string, path: string): Promise<RestoreFileResult>
    /** 그 시점과 지금 워크트리(미저장 포함)의 단일 파일 diff — rename이면 origPath 동봉 */
    diffAgainstWorktree(
      repoPath: string,
      hash: string,
      path: string,
      origPath: string | null,
    ): Promise<FileDiff>
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
    previewPush(repoPath: string): Promise<PushPreview>
    /** 현재 브랜치를 원격으로 백업(push) — 첫 연결이면 linked (E7e). 원격이 없으면 에러 */
    push(repoPath: string, confirmation?: PushConfirmation): Promise<BackupResult>
    /** 원격의 최신 저장을 받아온다 — merge는 기존 충돌 흐름, rebase는 rebasing 흐름 (E7e) */
    pull(repoPath: string, mode: 'merge' | 'rebase'): Promise<PullResult>
  }
  remotes: {
    /** 원격 최신 가져오기(fetch --all --prune) — 갱신은 감시가 담당 (E7e) */
    fetch(repoPath: string): Promise<void>
    list(repoPath: string): Promise<RemoteInfo[]>
    add(repoPath: string, name: string, url: string): Promise<void>
    remove(repoPath: string, name: string): Promise<void>
  }
}

export const GIT_API_KEY = 'gitApi' as const

export const CHANNELS = {
  repoSelect: 'repo:select',
  jobsCancel: 'jobs:cancel',
  jobsChanged: 'jobs:changed',
  jobsHistory: 'jobs:history',
  repoClone: 'repo:clone',
  repoInit: 'repo:init',
  repoInitialPath: 'repo:initial-path',
  repoStatus: 'repo:status',
  repoWatch: 'repo:watch',
  /** push(main→renderer) — invoke가 아니라 webContents.send 채널 (E7b) */
  repoChanged: 'repo:changed',
  repoOpen: 'repo:open',
  repoOpenPath: 'repo:open-path',
  repoHome: 'repo:home',
  workspaceSelect: 'workspace:select',
  workspaceOpen: 'workspace:open',
  workspaceInitial: 'workspace:initial',
  workspaceRefresh: 'workspace:refresh',
  workspaceOverview: 'workspace:overview',
  workspaceChanged: 'workspace:changed',
  workspaceMove: 'workspace:move',
  workspaceClose: 'workspace:close',
  remotesFetch: 'remotes:fetch',
  remotesList: 'remotes:list',
  remotesAdd: 'remotes:add',
  remotesRemove: 'remotes:remove',
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
  changesHunkStage: 'changes:hunk:stage',
  changesHunkUnstage: 'changes:hunk:unstage',
  changesLineStage: 'changes:line:stage',
  changesLineUnstage: 'changes:line:unstage',
  changesGuardCapture: 'changes:guard:capture',
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
  syncPushPreview: 'sync:push-preview',
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
    open(repoPath: string, number: number, section?: 'files' | 'checks'): Promise<void>
    /** 상세 + 코멘트 타임라인 한 번에 — 밖에서 닫힌 404는 친절 문구로 온다 */
    detail(repoPath: string, number: number): Promise<PullDetailView>
    /** 답변 달기 — 빈 본문은 main에서 거부된다 */
    comment(repoPath: string, number: number, body: string): Promise<void>
    /** 승인 — 자기 PR이면 친절 문구로 거부된다 */
    approve(repoPath: string, number: number): Promise<void>
    /** 병합(병합 커밋) — 로컬 동기화는 별도(기존 전환·받아오기 흐름을 UI가 제안) */
    merge(repoPath: string, number: number, sha?: string): Promise<void>
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
export type ColorMode = 'light' | 'dark'
export type ColorTheme = 'yeoul' | 'blue' | 'forest' | 'retro' | 'violet'

export interface Appearance {
  mode: ColorMode
  theme: ColorTheme
  followSystem?: boolean
}

export interface AppSettings extends WindowLayout {
  colorMode?: ColorMode
  colorTheme?: ColorTheme
  systemTheme?: boolean
  codeFontSize?: 12 | 14 | 16
  listDensity?: 'compact' | 'comfortable'
  /** 워크트리 선택 시 동작 — 클릭의 기본 동작만 결정한다(우클릭엔 항상 둘 다) (E7c) */
  worktreeSelectAction?: 'terminal' | 'switch-app'
  /** 받아오기 방식 — merge(기본)/rebase (E7e) */
  pullMode?: 'merge' | 'rebase'
  /** 주기적 원격 새로고침(10분) — 기본 켬 (E7e) */
  autoFetch?: boolean
  /** 최근 연 저장소 — 최신이 앞 (E15a) */
  recentRepos?: string[]
  recentWorkspaceRoots?: Record<string, string>
}

/** 알려진 필드·올바른 타입만 남긴다 — 렌더러 입력과 디스크 파일 양쪽에 적용하는 공용 방어 */
export function sanitizeSettings(value: unknown): AppSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const candidate = value as AppSettings
  const settings: AppSettings = {}
  if (candidate.colorMode === 'light' || candidate.colorMode === 'dark') {
    settings.colorMode = candidate.colorMode
  }
  if (
    candidate.colorTheme === 'yeoul' ||
    candidate.colorTheme === 'blue' ||
    candidate.colorTheme === 'forest' ||
    candidate.colorTheme === 'retro' ||
    candidate.colorTheme === 'violet'
  ) {
    settings.colorTheme = candidate.colorTheme
  }
  if (typeof candidate.rightWidth === 'number' && Number.isFinite(candidate.rightWidth)) {
    settings.rightWidth = candidate.rightWidth
  }
  if (typeof candidate.terminalOpen === 'boolean') settings.terminalOpen = candidate.terminalOpen
  if (typeof candidate.terminalHeight === 'number' && Number.isFinite(candidate.terminalHeight)) {
    settings.terminalHeight = candidate.terminalHeight
  }
  if (
    candidate.worktreeSelectAction === 'terminal' ||
    candidate.worktreeSelectAction === 'switch-app'
  ) {
    settings.worktreeSelectAction = candidate.worktreeSelectAction
  }
  if (candidate.pullMode === 'merge' || candidate.pullMode === 'rebase') {
    settings.pullMode = candidate.pullMode
  }
  if (typeof candidate.systemTheme === 'boolean') settings.systemTheme = candidate.systemTheme
  if ([12, 14, 16].includes(candidate.codeFontSize ?? 0))
    settings.codeFontSize = candidate.codeFontSize
  if (candidate.listDensity === 'compact' || candidate.listDensity === 'comfortable')
    settings.listDensity = candidate.listDensity
  if (typeof candidate.autoFetch === 'boolean') settings.autoFetch = candidate.autoFetch
  if (typeof candidate.leftCollapsed === 'boolean') settings.leftCollapsed = candidate.leftCollapsed
  if (typeof candidate.rightCollapsed === 'boolean') {
    settings.rightCollapsed = candidate.rightCollapsed
  }
  // 배열이 아니면 통째로 버리고, 문자열 아닌 원소만 골라낸다 — 이 목록은 디스크 파일에서 오고
  // 그 값이 repo.open의 인자가 된다 (E15a). sparse array의 hole은 spread로 실체화한 뒤
  // filter가 걷어낸다 (assertStringArray와 같은 이유)
  if (
    candidate.recentWorkspaceRoots &&
    typeof candidate.recentWorkspaceRoots === 'object' &&
    !Array.isArray(candidate.recentWorkspaceRoots)
  ) {
    settings.recentWorkspaceRoots = Object.fromEntries(
      Object.entries(candidate.recentWorkspaceRoots)
        .filter(
          ([path, root]) =>
            path.startsWith('/') && typeof root === 'string' && root.startsWith('/'),
        )
        .slice(-100),
    )
  }
  if (Array.isArray(candidate.recentRepos)) {
    settings.recentRepos = [...(candidate.recentRepos as unknown[])].filter(
      (entry): entry is string => typeof entry === 'string',
    )
  }
  return settings
}

/**
 * WindowLayout에 속하는 키 — splitSettings와 복원 sanitize가 함께 쓰는 정본 목록 (E15b).
 *
 * **배열이 아니라 객체로 적는다** (E15b 리뷰 N-3). 예전엔
 * `[...] as const satisfies readonly (keyof WindowLayout)[]`였는데 그건 **부분집합만** 본다 —
 * 실측: `'terminalHeight'`를 빼도 typecheck 6/6이 그대로 통과했다. 그래서 `WindowLayout`에
 * 새 필드를 더하고 이 목록을 잊으면 그 값이 **조용히 앱 공용**이 되어, 창마다 달라야 할 값이
 * 창끼리 서로를 덮는다(디버깅이 매우 어려운 종류다 — 화면은 멀쩡하고 값만 샌다).
 *
 * `Record<keyof WindowLayout, true>`는 키를 **전부** 요구하므로 빠뜨리면 여기서 빨개지고,
 * 없는 키를 더해도 객체 리터럴 초과 속성으로 빨개진다 — 양방향이다 (실측으로 둘 다 확인)
 */
const WINDOW_LAYOUT_KEY_SET = {
  leftCollapsed: true,
  rightCollapsed: true,
  rightWidth: true,
  terminalOpen: true,
  terminalHeight: true,
} satisfies Record<keyof WindowLayout, true>

const WINDOW_LAYOUT_KEYS = Object.keys(WINDOW_LAYOUT_KEY_SET) as (keyof WindowLayout)[]

/**
 * renderer가 보낸 평평한 설정을 앱 공용과 창별로 가른다 (E15b).
 *
 * 렌더러는 이 구분을 모른다 — 한 `partial`에 두 성격이 섞여 와도 각각 제 자리로 간다.
 * sanitizeSettings를 먼저 거치므로 타입이 틀린 값과 hosting 토큰은 양쪽 다 못 들어온다
 */
export function splitSettings(value: unknown): { app: AppSettings; layout: WindowLayout } {
  const clean = sanitizeSettings(value)
  const layout: WindowLayout = {}
  const app: AppSettings = { ...clean }
  for (const key of WINDOW_LAYOUT_KEYS) {
    if (key in clean) {
      // 키마다 타입이 달라 좁히기 어렵다 — sanitizeSettings가 이미 타입을 보장하므로 통째로 옮긴다
      ;(layout as Record<string, unknown>)[key] = clean[key]
      delete (app as Record<string, unknown>)[key]
    }
  }
  return { app, layout }
}

/** 디스크에서 온 창별 레이아웃 방어 (E15b 복원) — 알려진 키·올바른 타입만 남긴다 */
export function sanitizeWindowLayout(value: unknown): WindowLayout {
  return splitSettings(value).layout
}

/** 마지막 종료 시점의 탭 하나 (E15c) — 빈 탭(RepoPicker)은 명시적 null이다 */
export interface PersistedTab {
  repoPath: string | null
  /** 멀티레포 상위 폴더. 옛 설정에는 없으므로 선택 필드다. */
  workspacePath?: string
}

/**
 * 마지막 종료 시점의 창 하나 (E15b → E15c: 창이 저장소 하나가 아니라 탭들을 갖는다 — 스펙 §6).
 * 창을 만드는 것은 main뿐이라 renderer 표면(AppSettings)에는 넣지 않는다.
 *
 * `activeTab`은 **tabs의 인덱스**다 — 탭 id(webContents.id)는 재시작하면 무의미해서
 * 영속 경계에서 변환한다(window-registry snapshot 주석과 켤레)
 */
export interface PersistedWindow {
  /** 배열 순서가 곧 탭 순서 */
  tabs: PersistedTab[]
  activeTab: number
  layout: WindowLayout
}

/**
 * 디스크(settings.json)에만 존재하는 확장 설정 — main 전용.
 * hosting.github.token은 safeStorage 암호문(base64)이며, getSync 응답은 sanitizeSettings로
 * renderer 표면 필드만 추리므로 renderer에는 토큰이 절대 전달되지 않는다.
 */
export interface PersistedSettings extends AppSettings {
  hosting?: { github?: { token?: string; login?: string } }
  /** 마지막 종료 시점의 창들 — 등록 순서대로 (E15b 복원) */
  windows?: PersistedWindow[]
}

/**
 * 탭 목록 방어 (E15c) — 배열이 아니면 undefined(호출자가 그 창째 버린다).
 *
 * E15b가 배운 것 그대로다:
 * - 배열 원소는 `typeof === 'object'`를 통과하므로 `!Array.isArray(entry)`가 따로 필요하다.
 * - **낮추지 않고 버린다** (E15b 리뷰 N-1): `repoPath`가 문자열이 아니면 `null`로 낮추는 대신
 *   그 탭을 버린다 — `null`은 빈 탭(RepoPicker)의 **정당한 값**이라, 낮추면 손상된 한 줄이
 *   유령 빈 탭을 띄우고 종료 때 `{"repoPath":null}`로 다시 저장돼 매 실행 고착된다.
 * - 키가 아예 없는 것도 버린다 — 이 파일을 쓰는 쪽(saveWindows ← registry.snapshot)은 빈 탭도
 *   항상 `repoPath: null`을 명시하므로, 없다는 것은 우리가 쓴 파일이 아니라는 뜻이다.
 * - sparse array의 hole은 spread로 실체화한 뒤 filter가 걷어낸다 (recentRepos와 같은 관례)
 */
function sanitizePersistedTabs(value: unknown): PersistedTab[] | undefined {
  if (!Array.isArray(value)) return undefined
  return [...(value as unknown[])]
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === 'object' && entry !== null && !Array.isArray(entry),
    )
    .filter(
      (entry) =>
        'repoPath' in entry && (typeof entry.repoPath === 'string' || entry.repoPath === null),
    )
    .map((entry) => ({
      repoPath: entry.repoPath as string | null,
      ...(typeof entry.workspacePath === 'string' ? { workspacePath: entry.workspacePath } : {}),
    }))
}

/** 디스크 파일용 방어 — renderer 표면 sanitize에 hosting.github(token·login)과 windows를 더한다 */
export function sanitizePersistedSettings(value: unknown): PersistedSettings {
  const settings: PersistedSettings = sanitizeSettings(value)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return settings
  // E7d 옛 설정은 light/dark를 `theme` 하나에 저장했다. 이제 모드와 색상 테마가 분리됐으므로
  // 기존 사용자의 선택을 colorMode로 한 번 마이그레이션하고 색상 테마는 기본 여울을 쓴다.
  const legacyTheme = (value as { theme?: unknown }).theme
  if (settings.colorMode === undefined && (legacyTheme === 'light' || legacyTheme === 'dark')) {
    settings.colorMode = legacyTheme
  }
  // 창 목록 (E15b → E15c) — recentRepos와 **같은 이유로** 방어한다: 이 값은 사람이 편집할 수
  // 있는 디스크 파일에서 오고 각 탭의 repoPath가 **뷰를 만드는 인자**가 된다.
  //
  // 형식이 둘이다 (E15c Task 8): `tabs` 키가 있으면 E15c 형식, 없고 `repoPath` 키가 있으면
  // E15b 옛 형식(`{ repoPath, layout }`)이라 **탭 하나짜리 창으로 마이그레이션한다** — 옛
  // 형식을 버리면 E15b 사용자의 복원이 첫 실행에서 조용히 사라진다. 종료 때 새 형식으로
  // 다시 저장되므로 마이그레이션은 한 번만 일어난다
  const candidate = value as { windows?: unknown; hosting?: unknown }
  if (Array.isArray(candidate.windows)) {
    const windows: PersistedWindow[] = []
    for (const entry of [...(candidate.windows as unknown[])]) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
      const record = entry as Record<string, unknown>
      if ('tabs' in record) {
        // E15c 형식. 탭이 전부 버려진(또는 원래 빈) 창도 버린다 — 탭 없는 창은 없다
        // (registry removeTab의 "마지막 탭이면 창 항목도 지움"과 같은 판단. 남기면 복원이
        // 껍데기 창을 만들거나, 복원 쪽 가드에 걸려 어차피 안 만들어질 죽은 항목만 남는다)
        const tabs = sanitizePersistedTabs(record.tabs)
        if (tabs === undefined || tabs.length === 0) continue
        // activeTab은 tabs의 **인덱스**다 — 정수가 아니거나 범위 밖이면 0으로 접는다
        // (registry snapshot이 과도기 -1을 0으로 접는 것과 같은 정책). 낮추기가 아니라 접기인
        // 이유: 활성 탭은 어차피 tabs 중 하나여야 하고, 첫 탭은 항상 존재한다(위 가드)
        const activeTab =
          typeof record.activeTab === 'number' &&
          Number.isInteger(record.activeTab) &&
          record.activeTab >= 0 &&
          record.activeTab < tabs.length
            ? record.activeTab
            : 0
        windows.push({ tabs, activeTab, layout: sanitizeWindowLayout(record.layout) })
        continue
      }
      // E15b 옛 형식 마이그레이션 — repoPath 검증 규칙은 E15b 그대로(명시적 null만 통과,
      // 타입이 틀리거나 키가 없으면 그 항목째 버린다 — 낮추면 유령 빈 창이 고착된다, 리뷰 N-1)
      if (
        'repoPath' in record &&
        (typeof record.repoPath === 'string' || record.repoPath === null)
      ) {
        windows.push({
          tabs: [{ repoPath: record.repoPath as string | null }],
          activeTab: 0,
          layout: sanitizeWindowLayout(record.layout),
        })
      }
    }
    settings.windows = windows
  }
  const hosting = candidate.hosting
  if (typeof hosting !== 'object' || hosting === null || Array.isArray(hosting)) return settings
  const github = (hosting as { github?: unknown }).github
  if (typeof github !== 'object' || github === null || Array.isArray(github)) return settings
  const githubFields = github as { token?: unknown; login?: unknown }
  const clean: { token?: string; login?: string } = {}
  if (typeof githubFields.token === 'string') clean.token = githubFields.token
  if (typeof githubFields.login === 'string') clean.login = githubFields.login
  if (clean.token !== undefined || clean.login !== undefined) settings.hosting = { github: clean }
  return settings
}

/** preload가 노출하는 설정 표면 — initial은 시작 시점 스냅샷(동기), set은 부분 갱신 */
export interface SettingsApi {
  initial: AppSettings
  set(partial: AppSettings): Promise<void>
  /**
   * 같은 창 **다른** 탭의 레이아웃 조작 push 구독 (E15c, 스펙 §4 — 레이아웃은 창 단위).
   * 받은 patch는 저장 없이 화면에만 적용해야 한다 — 다시 set을 부르면 main이 그 변경을 또
   * 이웃에 push해 두 탭이 무한히 서로를 갱신한다(메아리). 해제 함수를 반환한다
   */
  onLayoutChanged(listener: (layout: WindowLayout) => void): () => void
}

export const SETTINGS_API_KEY = 'settingsApi' as const

export const SETTINGS_CHANNELS = {
  /** preload 전용 동기 채널 — 첫 렌더 전에 테마를 결정해야 깜빡임이 없다 */
  getSync: 'settings:get-sync',
  set: 'settings:set',
  /** push(main→renderer) — 같은 창 다른 탭이 창별 레이아웃을 바꿨다 (E15c, 스펙 §4) */
  layoutChanged: 'settings:layout-changed',
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
  /** 로컬 진단 로그·크래시 덤프 폴더를 Finder에서 연다. */
  revealDiagnostics(): Promise<void>
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
  revealDiagnostics: 'window:reveal-diagnostics',
} as const

/** 탭바가 그리는 한 탭 (E15c) — main이 그 창의 **모든 뷰**(숨은 뷰 포함)에 push한다 */
export interface TabInfo {
  /** 뷰 webContents.id — 클릭·닫기 요청의 키 */
  id: number
  repoPath: string | null
  /** 멀티레포 탭이면 탭 이름의 최상위 문맥으로 쓰는 워크스페이스 경로 */
  workspacePath?: string
  active: boolean
  /** 렌더러가 크래시해 응답 없음 (E15e) — **없으면 산 것이다**(기존 소비처 무변). 산 형제의
   * 탭바가 죽음 표시를 그리고, 클릭(tabs:activate)이 reload를 겸해 되살린다 */
  crashed?: boolean
}

export const TAB_CHANNELS = {
  /** push(main→renderer) — 이 창의 탭 목록이 바뀌었다 */
  changed: 'tabs:changed',
  /**
   * preload 전용 invoke — onChanged 등록 즉시 현재 목록을 한 번 주기 위한 스냅샷 조회.
   * push(changed)만으로는 안 된다: 뷰가 페이지를 로드하기 **전**에 보낸 push는 리스너 등록
   * 이전이라 유실된다(웹콘텐츠 생성 직후 addTab이 정확히 그 시점이다) — 등록 시점의 pull이
   * 결정적이다. settings:get-sync가 같은 이유로 pull인 것과 같은 판단
   */
  list: 'tabs:list',
  /** 새 탭. repoPath null이면 빈 탭 */
  open: 'tabs:open',
  /** 이미 연 탭이면 데려가기 — 전환기 클릭의 판정 절반 (E15c Task 6, GitApi.tabs.showExisting 주석) */
  showExisting: 'tabs:show-existing',
  activate: 'tabs:activate',
  close: 'tabs:close',
  /** 탭 드래그 드롭 (E15d) — 좌표 의미는 GitApi.tabs.dragEnd 주석 참조 */
  dragEnd: 'tab-drag:end',
} as const
