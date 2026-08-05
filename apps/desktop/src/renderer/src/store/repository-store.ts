import { create } from 'zustand'
import type {
  BranchCompare,
  BranchOverview,
  BranchSummary,
  CommitDetail,
  CommitFileChange,
  CommitSummary,
  FileChange,
  FileDiff,
  HistorySearchResult,
  RebaseProgress,
  RepositoryStatus,
  ShelfEntry,
  WorktreeHeadInfo,
  WorktreeInfo,
} from '@git-gui/domain'
import type { HostingStatus, PullDetailView, PullSummary } from '@git-gui/ipc-contract'
import { applyBlockChoice } from '../components/conflict-markers'
import {
  createEmptyReads,
  invalidateReads,
  isWithinSuppressWindow,
  resetSuppression,
  runRead,
  runWrite,
  toErrorMessage,
  type ReadScope,
  type ReadTarget,
} from './run-guard'
import { findRevivableChange } from './selection-revive'
import { pushRecentRepo, removeRecentRepo } from '../components/recent-repos'
import { T } from '../terms'
import { loadPullMode, savePullMode, type PullMode } from '../ui/settings/sync-settings'
import { loadRecentRepos, saveRecentRepos } from '../ui/settings/recent-repos-settings'

const git = () => window.gitApi
const hosting = () => window.hostingApi
const windowApi = () => window.windowApi

/** 히스토리 첫 페이지 크기 — 스크롤 끝에서 HISTORY_PAGE씩 상한을 늘려 다시 불러온다 (⑩) */
export const HISTORY_LIMIT = 50
const HISTORY_PAGE = 200
/** 스크롤 페이지네이션 상한(IPC 상한과 별개, E7i) — 이 이상은 스크롤로 더 불러오지 않는다.
 *  IPC `assertLimit`는 50000까지 허용(검색 점프용, SEARCH_JUMP_MAX 참조) — 이 상수와 값이 다르다 */
const HISTORY_MAX = 10000
/** 검색 점프 전용 로드 상한 (E7i) — 스크롤 페이지네이션(HISTORY_MAX)보다 깊은 매치로도 이동할 수 있게 */
const SEARCH_JUMP_MAX = 50000
/** notice 자동 소멸 시간(ms) — 타이머는 renderer(App)가 건다. 에러·머지 바에는 적용하지 않는다 (E1d 후속) */
export const NOTICE_TTL_MS = 10_000

export interface SelectedFile {
  change: FileChange
  staged: boolean
}

interface RepositoryStore {
  repoPath: string | null
  status: RepositoryStatus | null
  branches: BranchSummary[]
  /** 실험 공간 탭 데이터 — 스냅샷마다 함께 갱신된다 (E7a) */
  branchOverview: BranchOverview | null
  /** "지금과 비교" 결과 — 열려 있으면 실험 공간 탭이 비교 뷰가 된다 */
  branchCompare: { name: string; result: BranchCompare } | null
  /** 재배치 진행 위치 — rebasing 상태에서만 non-null (상태 바 "M/N번째") */
  rebaseProgress: RebaseProgress | null
  /** 워크트리 목록 — 스냅샷마다 함께 갱신된다. 첫 항목이 본체 (E7c) */
  worktrees: WorktreeInfo[]
  /** 마지막 원격 새로고침(fetch) 성공 시각 — 자동·수동 공통, 영속 안 함 (E7e) */
  lastFetchAt: number | null
  /** 역사 조회 모드(E7g) — 더블클릭한 브랜치. null이면 전체 그래프(지금 여기 기준) */
  historyRef: string | null
  /** 받아오기 방식 — 설정 영속. syncAfterMerge 등 내부 호출자도 이 값을 읽는다 (E7e) */
  pullMode: PullMode
  /** 최근 연 저장소 — 최신이 앞. 성공한 열기만 들어간다. 설정 영속 (E15a) */
  recentRepos: string[]
  shelf: ShelfEntry[]
  history: CommitSummary[]
  /** 현재 히스토리 조회 상한 — history.length >= historyLimit이면 뒤가 더 있을 수 있다 */
  historyLimit: number
  selected: SelectedFile | null
  diff: FileDiff | null
  /** 공용 diff 슬롯의 제목 덮어쓰기 — "지금 코드와 비교"처럼 부모 대비 diff와 구분해야 할 때만 non-null */
  diffLabel: string | null
  /** 커밋 클릭 상세 — 열려 있으면 중앙 패널이 커밋 상세로 바뀐다. 파일 diff 선택과 상호 배타 */
  commitDetail: CommitDetail | null
  /** 커밋 상세 안에서 선택된 파일 — diff는 공용 diff 슬롯을 쓴다 */
  commitFile: CommitFileChange | null
  /** 충돌 뷰 — 열려 있으면 중앙 패널이 충돌 해결 화면이 된다. diff·커밋 상세와 상호 배타 */
  conflictFile: { path: string; content: string } | null
  /** GitHub 연결 상태 — git 스냅샷과 독립된 네트워크 상태. 토큰은 오지 않는다(login만) */
  hostingStatus: HostingStatus | null
  /** 열린 리뷰 요청 — null이면 마지막 조회 실패(빈 목록으로 위장하지 않는다 — 품질 리뷰) */
  pulls: PullSummary[] | null
  /** 리뷰 상세(상세+코멘트) — 열려 있으면 우측 열이 리뷰 상세로 전환된다. 커밋 상세와 상호 배타 */
  pullDetail: PullDetailView | null
  /** 안내 배너 — 에러가 아닌 정보(자동 보관 등). 다음 작업 시작 시 지워진다 */
  notice: string | null
  error: string | null
  busy: boolean
  /** 조회가 진행 중인 자리별 개수 — busy와 달리 전역을 잠그지 않고 그 패널만 로딩을 보인다 (E14a) */
  reads: Record<ReadTarget, number>

  init(): Promise<void>
  /**
   * 저장소를 연다 — path를 주면 최근 목록에서 고른 것(폴더 선택 다이얼로그를 건너뛴다),
   * 안 주면 다이얼로그를 연다 (E15a). 성공 여부를 반환한다.
   * 실패한 path는 최근 목록에서 빠진다(없어진 폴더가 계속 남지 않도록).
   */
  openRepository(path?: string): Promise<boolean>
  refresh(): Promise<void>
  /** 실험 공간 전환 — 막히면 엔진이 자동 보관한다. autoShelved면 notice로 안내 */
  /** 성공 여부를 반환한다 — 병합 후 이동 제안(syncAfterMerge)이 실패 시 받아오기를 잇지 않기 위해 */
  switchBranch(name: string): Promise<boolean>
  /** 병합 후 이동 제안 확인 — 전환(자동 보관)·받아오기를 안전하게 잇는다 (통합 리뷰) */
  syncAfterMerge(base: string): Promise<void>
  /** 새 실험 공간을 만들고 바로 전환한다. fromHash가 있으면 그 시점에서. 성공 여부 반환 — 실패 시 다이얼로그를 열어 둬 입력을 보존한다 */
  createBranch(name: string, fromHash: string | null): Promise<boolean>
  /** name 공간을 지금 공간으로 합친다(스마트 병합) — 결과를 notice로 안내한다 */
  mergeBranch(name: string): Promise<void>
  /** 합치기 취소 — 확인창(UI 책임)을 통과한 뒤에만 호출된다 */
  abortMerge(): Promise<void>
  /** 원격의 최신 저장을 받아온다 — 결과를 notice로, 충돌은 머지 바가 안내 */
  pullLatest(): Promise<void>
  /** 이 저장을 반대로 적용하는 새 저장 — 충돌이면 reverting 상태 바가 안내 */
  revertCommit(hash: string): Promise<void>
  /** 되돌리기 취소 — 확인창(UI 책임) 경유 */
  abortRevert(): Promise<void>
  /** 이 저장 하나만 가져오는 새 저장(cherry-pick) — 충돌이면 cherry-picking 상태 바가 안내 */
  cherryPickCommit(hash: string): Promise<void>
  /** 가져오기 취소 — 확인창(UI 책임) 경유 */
  abortCherryPick(): Promise<void>
  /** 이 시점에 태그 만들기 — 성공 여부 반환(실패 시 다이얼로그 유지·입력 보존) */
  createTag(name: string, hash: string): Promise<boolean>
  /** 마지막 저장 실행취소 — 확인창(UI 책임) 경유. 내용은 변경 목록으로 돌아온다 */
  undoLastCommit(hash: string): Promise<void>
  /** 마지막 저장 메시지 고치기 — 성공 여부 반환(실패 시 다이얼로그 유지·입력 보존) */
  rewordLastCommit(hash: string, message: string): Promise<boolean>
  /** 지우기 — needsForce면 2단 확인, usedByWorktree면 동반 삭제 확인으로 이어진다 (E7h ⑤) */
  removeBranch(
    name: string,
    force: boolean,
  ): Promise<{ needsForce: boolean; usedByWorktree: string | null }>
  /** 이름 바꾸기 — 성공 여부 반환(실패 시 다이얼로그 유지·입력 보존) */
  renameBranch(oldName: string, newName: string): Promise<boolean>
  /** 비현재 공간을 원격 최신으로(ff-only) — 현재 공간은 UI가 pullLatest로 보낸다 (E7a) */
  updateBranch(name: string): Promise<void>
  /** 선택 공간을 checkout 없이 백업 — 현재 공간은 UI가 backup으로 보낸다 (E7a) */
  backupBranch(name: string): Promise<void>
  /** "지금과 비교" 열기 — 결과는 branchCompare로, 실험 공간 탭이 비교 뷰가 된다 (E7a) */
  compareBranch(name: string): Promise<void>
  /** 비교 뷰 닫기 — 동기라 잠금 불필요 */
  clearBranchCompare(): void
  /** 원격 공간을 추적 로컬로 가져와 이동 (E7a) */
  checkoutRemoteBranch(name: string): Promise<void>
  /** 원격에서 지우기 — 확인창(UI 책임) 경유. 다른 사람에게도 영향 (E7a) */
  removeRemoteBranch(name: string): Promise<void>
  /** 현재 공간을 name 위로 재배치 — 확인창(UI 책임) 경유. conflict면 rebasing 바가 안내 (E7a) */
  rebaseOnto(name: string): Promise<void>
  /** 겹침을 모두 해소한 뒤 다음 저장으로 — rebasing 바의 계속하기 (E7a) */
  continueRebase(): Promise<void>
  /** 재배치 취소 — 확인창(UI 책임) 경유 (E7a) */
  abortRebase(): Promise<void>
  /** 새 워크트리 — 성공 여부 반환(실패 시 다이얼로그 유지·입력 보존). createBranch면 -b (E7c·E7d) */
  addWorktree(path: string, branch: string, createBranch?: boolean): Promise<boolean>
  /** 워크트리 지우기 — 반환 true면 미저장 변경이 있어 강제 확인 필요 (removeBranch 관례) (E7c) */
  removeWorktree(path: string, force: boolean): Promise<boolean>
  /** 워크트리를 앱에서 연다(전체 전환) — 경로 검증·allowlist 등록은 main (E7c).
   *  성공 여부 반환 — 호출부가 전환 완료 후에만 터미널 대상을 같이 바꾼다 (E7h ③) */
  openWorktree(path: string): Promise<boolean>
  /** Finder에서 보기 (E7c) */
  revealWorktree(path: string): Promise<void>
  /** 수동 원격 새로고침 — runWrite 경유(에러 배너). 억제 창이 감시 이벤트를 삼키므로 직접 스냅샷 (E7e 실측 6) */
  fetchRemotes(): Promise<void>
  /** 자동 원격 새로고침 — 조용히(배너·busy 없음), 실패 무시. 갱신은 감시가 담당 (E7e) */
  autoFetchRemotes(): Promise<void>
  /** 받아오기 방식 변경 — 즉시 영속 (E7e) */
  setPullMode(mode: PullMode): void
  /** 브랜치 더블클릭 조회 — 우측 역사가 그 계보로 바뀐다 (E7g) */
  viewHistory(ref: string): Promise<void>
  /** 조회 해제 — 전체 그래프 복귀 (E7g) */
  clearHistoryView(): Promise<void>
  /** 충돌 파일 열기 — 워크트리 내용을 읽어 충돌 뷰로 */
  selectConflict(path: string): Promise<void>
  /** 충돌 뷰 내용 재조회(외부 편집 반영) — 읽기 전용이라 잠금 없이. 실패 시 null */
  reloadConflict(path: string): Promise<string | null>
  /** 충돌을 한쪽으로 확정한다 */
  resolveConflict(path: string, choice: 'ours' | 'theirs'): Promise<void>
  /** 직접 수정을 마쳤다고 표시한다 */
  markConflictResolved(path: string): Promise<void>
  /** 열린 겹침 파일의 blockIndex번째 블록만 한쪽으로 골라 파일에 즉시 반영한다 — 확정(add) 아님 */
  chooseConflictBlock(blockIndex: number, choice: 'ours' | 'theirs'): Promise<void>
  /** 자세히 보기 저장 — 성공 여부를 반환한다(실패 시 편집 화면·초안 보존) */
  saveConflictText(content: string): Promise<boolean>
  /** 처음부터 다시 — 겹침 표시를 되살린다(checkout -m). 확인창(UI 책임) 경유 */
  resetConflict(): Promise<void>
  /** 지금 변경을 보관함에 저장한다 */
  shelfSave(): Promise<void>
  shelfRestore(ref: string): Promise<void>
  shelfDrop(ref: string): Promise<void>
  stage(paths: string[]): Promise<void>
  unstage(paths: string[]): Promise<void>
  /** 선택 파일 변경 취소 — 확인창(UI 책임)을 통과한 뒤에만 호출된다. 되돌릴 수 없다 (⑪) */
  discard(trackedPaths: string[], untrackedPaths: string[]): Promise<void>
  /** 파일 하나를 디스크에서 삭제한다 — 확인창(UI 책임)을 통과한 뒤에만 호출된다. 되돌릴 수 없다 */
  removeFile(path: string): Promise<void>
  selectFile(selected: SelectedFile): Promise<void>
  /** diff 선택 해제 — 동기 상태 변경이라 잠금 불필요 */
  clearSelection(): void
  selectCommit(hash: string): Promise<void>
  selectCommitFile(file: CommitFileChange): Promise<void>
  /** 이 파일만 그 시점 내용으로 적용(checkout) — 확인창(UI 책임) 경유. 미저장 변경은 엔진이 파일 단위 자동 보관 */
  restoreFileFromCommit(hash: string, path: string): Promise<void>
  /** 그 시점과 지금 워크트리의 비교를 공용 diff 슬롯에 띄운다 — 제목은 diffLabel로 구분 */
  compareFileWithWorktree(hash: string, path: string, origPath: string | null): Promise<void>
  /** 커밋 상세 닫기 — 동기 상태 변경이라 잠금 불필요 */
  clearCommit(): void
  /** 커밋 상세 안의 파일 diff만 닫는다 — 상세(파일 목록)는 유지. 동기라 잠금 불필요 */
  clearCommitFile(): void
  /** 전역 에러를 지운다 — 다이얼로그를 새로 열 때 이전 작업 에러가 인라인으로 새어들지 않게. 동기라 잠금 불필요 */
  clearError(): void
  /** notice만 지운다 — 자동 소멸 타이머(App) 전용. 동기라 잠금 불필요 */
  clearNotice(): void
  /**
   * 감시(repo:changed)발 재조회 (E7b) — 새로고침과 같은 의미론(선택 무효화)이되 hosting 호출은
   * 없다(감시 폭주가 네트워크를 때리지 않게). 작업 종료 직후 억제 창이 트레일링 이벤트를 흡수한다.
   * E14a 전에는 busy 재진입 거부가 자기 작업 이벤트를 함께 떨궜지만(실측 1), 이제 이 경로는
   * 조회라 busy를 보지 않는다 — 자기 꼬리 흡수는 억제 창 하나가 담당한다 (스펙 §2-4)
   */
  externalRefresh(): Promise<void>
  /** 스크롤 끝에서 히스토리 상한을 늘려 다시 불러온다 (⑩) */
  loadMoreHistory(): Promise<void>
  /** 저장소 전체 커밋 검색 (E7i) — 스코프(조회 중 ref)는 store가 넣는다. 실패는 조용히 빈 결과 */
  searchHistory(query: string): Promise<HistorySearchResult>
  /** 검색 점프용 — 그 인덱스가 목록에 들어오도록 필요한 만큼 더 불러온다 (E7i) */
  ensureHistoryLoaded(index: number): Promise<void>
  /** 워크트리 HEAD 요약 캐시 — 키는 `경로::HEAD해시` (E7k) */
  headInfos: Record<string, WorktreeHeadInfo | null>
  /** 호버 시점에만 그 워크트리 하나를 조회한다 (E7k) */
  loadHeadInfo(path: string, headHash: string | null): Promise<void>
  /** "지금 여기"(HEAD)가 로드 범위 밖일 때 — 찾을 때까지 역사 상한을 넓혀 다시 읽는다 (품질 리뷰) */
  revealHead(): Promise<void>
  /** 성공 여부를 반환한다 — 실패 시 입력 메시지를 보존하기 위해 */
  commit(message: string): Promise<boolean>
  backup(): Promise<void>
  /** 열린 리뷰 요청 목록 갱신 — 팝오버를 열 때. 미연결·비GitHub이면 조용히 무시 */
  refreshPulls(): Promise<void>
  /** gh CLI 토큰으로 연결 — 성공 여부 반환 */
  connectGh(): Promise<boolean>
  /** 붙여넣은 토큰으로 연결 — 실패 시 다이얼로그 유지·입력 보존을 위해 성공 여부 반환 */
  connectToken(token: string): Promise<boolean>
  /** GitHub 연결 해제 — 저장된 토큰을 지운다 */
  disconnectHosting(): Promise<void>
  /** 리뷰 요청 생성(빈 본문) — 성공 시 notice 안내 + 목록·스냅샷 갱신. 성공 여부 반환 */
  createPull(title: string): Promise<boolean>
  /** 리뷰 요청을 브라우저로 연다 — 주소는 main이 보관한 목록에서만 */
  openPull(number: number): Promise<void>
  /** 리뷰 상세 열기(상세+코멘트 한 번에) — 우측 열이 리뷰 상세로 전환된다. 커밋 상세와 상호 배타 */
  openPullDetail(number: number): Promise<void>
  /** 리뷰 상세 닫기 — 동기 상태 변경이라 잠금 불필요 */
  closePullDetail(): void
  /** 답변 달기 — 성공 여부 반환(성공 시에만 입력을 비운다). 성공 후 타임라인을 서버 상태로 재조회 */
  addPullComment(body: string): Promise<boolean>
  /** 승인 — 자기 PR이면 main이 친절 문구로 거부한다. 성공 후 상세 재조회(승인됨 배지 갱신) */
  approvePull(): Promise<void>
  /** 병합(병합 커밋) — 성공 여부 반환(App이 기본 공간 이동 제안을 연다). 성공 후 상세 재조회 */
  mergePull(): Promise<boolean>
}

/** 상태·역사·실험 공간·보관함을 동시 조회해 같은 렌더에 함께 갱신한다 — 시점 차이를 최소화 (원자 스냅샷은 아님) */
async function fetchSnapshot(
  repoPath: string,
  limit: number,
): Promise<
  Pick<
    RepositoryStore,
    'status' | 'history' | 'branches' | 'shelf' | 'branchOverview' | 'rebaseProgress' | 'worktrees'
  >
> {
  // 조회 모드(E7g) — 호출부 39곳을 바꾸지 않도록 스냅샷이 store에서 직접 읽는다.
  // 조회 브랜치가 사라졌으면 조용히 전체 그래프로 복귀(스펙 — 오류 아님)
  const loadHistory = async (): Promise<CommitSummary[]> => {
    const ref = useRepositoryStore.getState().historyRef
    if (ref === null) return git().history.list(repoPath, limit)
    try {
      return await git().history.list(repoPath, limit, ref)
    } catch {
      useRepositoryStore.setState({ historyRef: null })
      return git().history.list(repoPath, limit)
    }
  }
  const [status, history, branches, shelf, branchOverview, worktrees] = await Promise.all([
    git().repo.status(repoPath),
    loadHistory(),
    git().branches.list(repoPath),
    git().shelf.list(repoPath),
    git().branches.overview(repoPath),
    git().worktrees.list(repoPath),
  ])
  // 재배치 중일 때만 진행 위치를 읽는다 — 상태 바 "M/N번째" (E7a)
  const rebaseProgress =
    status.state === 'rebasing' ? await git().rebase.progress(repoPath) : null
  return { status, history, branches, shelf, branchOverview, rebaseProgress, worktrees }
}

/**
 * 갱신 후 선택 재조회 (E7d ⑤) — 새로고침의 의미는 '최신화'지 '닫기'가 아니다.
 * 재조회 가능한 선택은 새 데이터로 다시 채우고, 대상이 사라진 것만 조용히 닫는다(오류 아님 —
 * 외부 변경으로 대상이 사라진 것은 정상). CLEAR_SELECTIONS 위에 덮어쓸 부분 상태를 돌려준다.
 * 항목별 try/catch — 한 항목의 소멸이 다른 항목의 유지를 막지 않는다.
 * "지금 코드와 비교" diff(diffLabel)는 재조회 키(path·origPath)가 상태에 없어 v1은 닫는다(실측 4)
 */
async function reviveSelections(
  repoPath: string,
  prev: RepositoryStore,
  nextStatus: RepositoryStatus | null,
): Promise<Partial<RepositoryStore>> {
  if (nextStatus === null) return {}
  const revived: Partial<RepositoryStore> = {}
  // 1) 파일 diff — 같은 경로·같은 쪽 변경이 남아 있을 때만 (selectFile과 같은 조회 규칙)
  if (prev.selected !== null) {
    try {
      const match = findRevivableChange(
        nextStatus.changes,
        prev.selected.change.path,
        prev.selected.staged,
      )
      if (match !== null) {
        const selected = { change: match, staged: prev.selected.staged }
        revived.diff = await git().changes.diff(repoPath, match.path, {
          staged: selected.staged,
          untracked: match.unstaged === 'untracked',
          origPath: selected.staged ? match.origPath : null,
        })
        revived.selected = selected
        revived.diffLabel = null
      }
    } catch {
      // 재조회 실패 = 닫힌 채 둔다
    }
  }
  // 2) 커밋 상세 — 해시로 재조회(사라졌으면 throw → 닫힘). 파일 diff는 상세에 아직 있을 때만
  if (prev.commitDetail !== null) {
    try {
      const commitDetail = await git().commits.show(repoPath, prev.commitDetail.hash)
      revived.commitDetail = commitDetail
      if (prev.commitFile !== null) {
        const file = commitDetail.files.find((entry) => entry.path === prev.commitFile?.path)
        if (file !== undefined) {
          revived.diff = await git().commits.diffFile(
            repoPath,
            commitDetail.hash,
            file.path,
            file.origPath,
          )
          revived.commitFile = file
          revived.diffLabel = null
        }
      }
    } catch {
      // 커밋 소멸(강제 재작성 등) — 상세를 닫힌 채 둔다
    }
  }
  // 3) 비교 뷰 — 이름으로 재실행(브랜치가 사라졌으면 throw → 닫힘)
  if (prev.branchCompare !== null) {
    try {
      const result = await git().branches.compare(repoPath, prev.branchCompare.name)
      revived.branchCompare = { name: prev.branchCompare.name, result }
    } catch {
      // 브랜치 소멸 — 비교 뷰를 닫힌 채 둔다
    }
  }
  return revived
}

/** 선택 상태 일괄 해제 — 저장소 내용이 바뀌는 모든 지점에서 보던 diff·상세를 무효화한다 */
const CLEAR_SELECTIONS = {
  selected: null,
  diff: null,
  diffLabel: null,
  commitDetail: null,
  commitFile: null,
  conflictFile: null,
  pullDetail: null,
  branchCompare: null,
} as const

/**
 * 배경 새로고침(`refresh`·`externalRefresh`)이 **양보하는** 자리 (E14a 스펙 §2-4-3).
 *
 * 표시용 target은 'snapshot' 하나지만 이 둘은 `reviveSelections`를 거치며 선택 상태와 비교 뷰까지
 * 되살린다. 그렇다고 그 자리를 **선점**하면 안 된다 — 배경 갱신이 사용자의 클릭을 무효화하는
 * 거울상 버그가 된다(§2-4-3 실측). 쓰긴 하지만 소유하지는 않는다는 뜻으로 양보만 한다.
 */
const SNAPSHOT_DEFERS: ReadTarget[] = ['center', 'right', 'left']

/**
 * 배경 새로고침이 되살린 상태 중, 그사이 사용자가 가져간 자리를 빼고 돌려준다 (스펙 §2-4-3).
 *
 * **필드가 target별로 안 갈린다 — 실측으로 확인한 편차.** 스펙은 `selected`·`diff`는 center,
 * `commitDetail`·`commitFile`은 right로 갈릴 것이라고 봤지만, 실제로는 두 target의 액션이 같은
 * 필드 집합을 함께 쓴다: `selectFile`(center)은 `commitDetail`·`commitFile`을 null로 밀고,
 * `selectCommit`(right)은 `selected`·`diff`·`diffLabel`을 null로 민다. 가운데 패널이 하나뿐이라
 * 두 뷰가 **상호 배타**이기 때문이고, 그 배타를 각 액션이 스스로 유지한다.
 *
 * 그래서 선택 상태는 center∪right 한 덩어리로 양보한다. 이게 손해가 아닌 이유도 같다 — 사용자가
 * 파일을 눌렀다면 `commitDetail`은 이미 그 액션이 null로 만들어 뒀으므로, 통째로 안 건드려도
 * 결과가 같다. `branchCompare`만 left로 따로 논다(비교 뷰는 좌측의 독립된 자리다).
 */
const SELECTION_KEYS = (Object.keys(CLEAR_SELECTIONS) as (keyof typeof CLEAR_SELECTIONS)[]).filter(
  (key) => key !== 'branchCompare',
)

type StoreSet = (partial: Partial<RepositoryStore>) => void
type StoreGet = () => RepositoryStore

/**
 * **저장소에 매인 조회** — `runRead`에 "착지 시점에도 아직 그 저장소인가"를 얹는다 (E15a 리뷰 ①).
 *
 * 이 스토어의 조회는 예외 없이 진입 시 `repoPath`를 캡처해 그 저장소에 질문을 던진다. 그러니
 * 결과도 그 저장소의 것이다 — 착지했을 때 화면이 다른 저장소로 갔다면 그 결과는 낡은 게 아니라
 * **남의 것**이다. `isCurrent()`(seq)는 그 차이를 못 본다: `runWrite`의 `invalidateReads()`는
 * 진입 시 1회뿐이라 전환 *도중* 출발한 조회를 못 잡고, `openRepository`는 `runRead`를 안 거쳐
 * snapshot seq를 올리지도 않는다(run-guard의 `boundTo` 주석 참조).
 *
 * 왜 조회마다 판단하지 않고 `runRead` 대신 이걸 쓰게 만드는가: 어떤 조회가 위험한지의 근거가
 * 전부 "그 버튼이 busy 동안 `disabled`인가"로 흐르는데, E14a는 **"쓰기 중에도 조회는 시작된다"**를
 * 명시적 결정으로 삼았다(스펙 §2-4). 즉 `disabled`는 직렬화 장치가 아니라 UI 사정이고, 그 위에
 * 안전을 얹으면 버튼 하나 살릴 때마다 이 버그가 되살아난다. 결합을 기본값으로 두면 새 조회가
 * 늘어도 저절로 지켜진다.
 */
async function runRepoRead(
  set: StoreSet,
  get: StoreGet,
  target: ReadTarget,
  repoPath: string,
  run: (isCurrent: () => boolean, isTaken: (target: ReadTarget) => boolean) => Promise<void>,
  scope: ReadScope = {},
): Promise<boolean> {
  return runRead(set, get, target, run, {
    ...scope,
    boundTo: () => get().repoPath === repoPath,
  })
}

function deferSelections(
  patch: Partial<RepositoryStore>,
  isTaken: (target: ReadTarget) => boolean,
): Partial<RepositoryStore> {
  const next = { ...patch }
  if (isTaken('center') || isTaken('right')) for (const key of SELECTION_KEYS) delete next[key]
  if (isTaken('left')) delete next.branchCompare
  return next
}

export const useRepositoryStore = create<RepositoryStore>((set, get) => ({
  repoPath: null,
  status: null,
  history: [],
  branches: [],
  shelf: [],
  historyLimit: HISTORY_LIMIT,
  selected: null,
  diff: null,
  diffLabel: null,
  commitDetail: null,
  commitFile: null,
  conflictFile: null,
  notice: null,
  error: null,
  busy: false,
  reads: createEmptyReads(),
  hostingStatus: null,
  branchOverview: null,
  branchCompare: null,
  rebaseProgress: null,
  worktrees: [],
  headInfos: {},
  lastFetchAt: null,
  historyRef: null,
  pullMode: loadPullMode(),
  recentRepos: loadRecentRepos(),
  pulls: [],
  pullDetail: null,

  async init() {
    await runWrite(set, get, async () => {
      const initial = await git().repo.initialPath()
      if (!initial) return
      set({
        repoPath: initial,
        hostingStatus: await hosting().status(initial),
        ...(await fetchSnapshot(initial, get().historyLimit)),
      })
      void git().repo.watch(initial)
    })
    // 이 runWrite는 읽기 전용(상태 조회)이라 자기 꼬리 이벤트가 없다 — 시작 직후 도착하는 첫 감시
    // 이벤트까지 억제 창에 걸려 삼켜지지 않도록 초기화한다 (E7b: 실측 — 실제 앱 기동~외부 커밋
    // 간격이 800ms 억제 창보다 짧을 수 있어 재현됨)
    resetSuppression()
    // 감시 구독은 앱 수명 1회 — 이벤트가 온 저장소가 지금 저장소일 때만 재조회한다 (E7b)
    git().repo.onChanged((changedPath) => {
      if (get().repoPath === changedPath) void get().externalRefresh()
    })
    // 창 복귀 시 재조회 — 사용자가 명시적으로 돌아온 순간이라 최신화가 우선이다 (E10)
    windowApi().onFocused(() => {
      if (get().repoPath !== null) void get().refresh()
    })
  },

  async openRepository(path) {
    return runWrite(set, get, async () => {
      // 인자가 있으면 최근 목록에서 고른 것 — 다이얼로그를 건너뛴다. 검증은 main이 한다 (E15a)
      let opened: string | null
      if (path === undefined) {
        opened = await git().repo.select()
      } else {
        const result = await git().repo.open(path)
        if (!result.ok) {
          // E15a 리뷰 ④ — **원인이 확실할 때만** 목록에서 뺀다. 예전엔 catch 하나가 모든 실패를
          // "그 폴더는 이제 Git 저장소가 아니에요"로 뭉개고 항목을 실제로 지웠다: 마운트 안 된
          // 외장 디스크, EACCES, PATH에 git이 없는 경우까지. 멀쩡히 존재하는 저장소가 목록에서
          // 사라지고, 되살리려면 다이얼로그로 다시 열어야 했다.
          //
          // 판정은 계약서의 reason으로만 한다 — 예외(형식 오류 등)로는 절대 지우지 않는다.
          // 여기서만 지우는 이유는 그대로다: runWrite가 false를 주는 경우엔 재진입 거부(busy)도
          // 있어서, 호출부의 false 판정으로 지우면 멀쩡한 저장소를 목록에서 날린다 (E15a)
          if (result.reason !== 'failed') {
            const recentRepos = removeRecentRepo(get().recentRepos, path)
            set({ recentRepos })
            saveRecentRepos(recentRepos)
          }
          // 배너 문구는 main이 만든 것을 그대로 쓴다 — runWrite의 catch가 error로 옮긴다
          throw new Error(result.message)
        }
        opened = result.path
      }
      if (!opened) return
      // runWrite가 재진입을 거부하므로 refresh()를 부르지 않고 직접 조회한다.
      // 다른 저장소다 — 히스토리 상한도 첫 페이지로 되돌린다
      // 조회는 저장소 경계를 넘지 않는다 — 스냅샷(내부 loadHistory)이 구 ref를 읽기 전에 선해제 (품질 리뷰:
      // 같은 리터럴의 historyRef:null은 await 뒤에 적용돼 같은 이름 브랜치에서 '알약 없는 필터 역사' 모순)
      //
      // E15a 리뷰 ① — 선해제와 스냅샷 사이에 await가 있으면 그 틈이 다시 열린다. hosting().status()는
      // gh CLI 셸아웃이라 수백 ms급이고, 그사이 시작된 viewHistory가 historyRef를 도로 채우면
      // fetchSnapshot이 그 ref로 **새 저장소의** 역사를 걸러 읽는다. 아래 리터럴의 historyRef:null이
      // 알약은 지우므로 화면은 정확히 그 '알약 없는 필터 역사'가 된다 — 조회를 앞으로 빼 틈을 없앤다
      const hostingStatus = await hosting().status(opened)
      set({ historyRef: null })
      const snapshot = await fetchSnapshot(opened, HISTORY_LIMIT)
      set({
        repoPath: opened,
        historyLimit: HISTORY_LIMIT,
        historyRef: null,
        hostingStatus,
        pulls: [],
        // E15a — 다른 저장소다. 이 둘은 저장소에 매인 값이라 남으면 안 된다:
        // lastFetchAt은 옛 저장소에서 가져온 시각을 새 저장소의 "n분 전 가져옴"으로 그리고,
        // headInfos(경로::HEAD 캐시)는 전환할수록 옛 항목이 쌓인다
        lastFetchAt: null,
        headInfos: {},
        ...CLEAR_SELECTIONS,
        ...snapshot,
      })
      // 새 저장소로 감시 교체 (E7b) — 이전 저장소 감시는 main이 새 watch 호출에서 정리한다
      void git().repo.watch(opened)
      // 최근 목록 갱신 — 성공한 뒤에만. 넘긴 경로가 아니라 main이 정규화한 저장소 루트를 넣는다
      // (하위 폴더를 골랐을 수 있다 — 이후 IPC에서 유효한 값은 이쪽뿐이다)
      const recentRepos = pushRecentRepo(get().recentRepos, opened)
      set({ recentRepos })
      saveRecentRepos(recentRepos)
    })
  },

  async refresh() {
    const { repoPath } = get()
    if (!repoPath) return
    // 읽기 전용 조회 — 전역 busy를 켜지 않고 억제 창도 무장하지 않는다. 억제를 걸면 그사이
    // 도착한 진짜 외부 변경의 재조회를 막아버린다 (E10) (E14a)
    // 이 조회는 'snapshot'만 선점하고 center·right·left에는 **양보한다** — reviveSelections로
    // 그 자리를 쓰긴 하지만 소유하지는 않는다. 선점하면 배경 갱신이 사용자의 클릭을 무효화한다
    // (E14a 스펙 §2-4-3). 착지 때 남이 가져간 자리만 빼고 스냅샷 나머지는 그대로 반영한다
    await runRepoRead(set, get, 'snapshot', repoPath, async (isCurrent, isTaken) => {
      // 외부(CLI 등)에서 상태가 바뀌었을 수 있다 — 스냅샷을 새로 뜨되, 보고 있던 선택은
      // 재조회해 유지한다 (E7d ⑤: 새로고침은 '최신화'지 '닫기'가 아니다). 충돌 뷰 유지는 E7b 관례.
      // pullDetail(리뷰 상세 패널)·diffLabel도 같은 이유로 유지한다 — 재조회 키가 없어 revive
      // 대상이 아니지만, 그렇다고 CLEAR_SELECTIONS로 매번 닫아 버리면 저장할 때마다 열어 둔
      // 리뷰 패널이 사라진다 (E10 보완 — Important 3). diffLabel만 남고 diff는 못 살아난 경우도
      // DiffPanel이 diff===null이면 빈 상태를 그려 안전하다(실측 — apps/desktop/.../DiffPanel.tsx)
      const snapshot = await fetchSnapshot(repoPath, get().historyLimit)
      // 유지 항목은 revive 조회를 기다리기 전에 읽는다 — 예전 객체 리터럴의 평가 순서 그대로다
      const kept = {
        conflictFile: get().conflictFile,
        pullDetail: get().pullDetail,
        diffLabel: get().diffLabel,
      }
      const revived = await reviveSelections(repoPath, get(), snapshot.status)
      const hostingStatus = await hosting().status(repoPath)
      // 그 사이 더 최신 스냅샷 조회가 끝났다면 이 결과는 낡았다 — 덮지 않고 버린다 (E14a)
      if (!isCurrent()) return
      set({
        ...deferSelections({ ...CLEAR_SELECTIONS, ...kept, ...revived }, isTaken),
        hostingStatus,
        ...snapshot,
      })
    }, { defersTo: SNAPSHOT_DEFERS })
  },

  async externalRefresh() {
    const { repoPath } = get()
    if (!repoPath) return
    // 자기 작업 꼬리 이벤트 억제 — 작업(쓰기) 직후의 감시발 재조회는 방금 갱신한 화면을 다시 지울 뿐이다.
    // 이 억제는 마지막 "쓰기" 작업 기준으로만 걸린다(runWrite만 창을 무장한다) — 읽기 전용 재조회는
    // 여기 걸리지 않으므로, 연속된 외부 변경이 서로를 삼키지 않는다 (E10)
    if (isWithinSuppressWindow()) return
    // 읽기 전용 조회 — 전역 busy를 켜지 않는다. 이 경로는 워킹트리 감시가 붙잡은 **모든 외부
    // 저장마다** 도니, 켜면 에디터에서 파일을 저장하기만 해도 앱 전체가 깜빡인다
    // (E14a 실측: 외부 저장 1회에 헤더 속성 변형 20건). 억제 창도 무장하지 않는다 —
    // 걸면 이 재조회 자체가 다음 진짜 외부 변경을 삼킨다 (E10)
    // 선점·양보는 refresh와 같다 — 이 경로도 reviveSelections로 선택 상태를 쓰되 소유하진 않는다.
    // 오히려 여기가 더 중요하다: 에디터 자동 저장마다 도니, 선점하면 파일을 훑는 내내
    // 배경 갱신이 클릭을 되돌린다 (E14a 스펙 §2-4-3)
    await runRepoRead(set, get, 'snapshot', repoPath, async (isCurrent, isTaken) => {
      // 수동 새로고침과 같은 의미론 (E7d ⑤: 재조회 유지) — 충돌 뷰는 편집 초안(컴포넌트 로컬)
      // 보호를 위해 그대로 유지한다 (E7b 품질 리뷰). pullDetail·diffLabel도 refresh()와 같은
      // 이유로 유지한다 — 이 재조회는 워킹트리 감시가 붙잡은 모든 외부 저장마다 도니, 여기서
      // 지우면 에디터 자동 저장 한 번에 열어 둔 리뷰 패널이 닫힌다 (E10 보완 — Important 3)
      const snapshot = await fetchSnapshot(repoPath, get().historyLimit)
      // 유지 항목은 revive 조회를 기다리기 전에 읽는다 — 예전 객체 리터럴의 평가 순서 그대로다
      const kept = {
        conflictFile: get().conflictFile,
        pullDetail: get().pullDetail,
        diffLabel: get().diffLabel,
      }
      const revived = await reviveSelections(repoPath, get(), snapshot.status)
      // 그 사이 더 최신 스냅샷 조회가 끝났다면 이 결과는 낡았다 — 덮지 않고 버린다 (E14a)
      if (!isCurrent()) return
      set({ ...deferSelections({ ...CLEAR_SELECTIONS, ...kept, ...revived }, isTaken), ...snapshot })
    }, { defersTo: SNAPSHOT_DEFERS })
  },

  async switchBranch(name) {
    const { repoPath } = get()
    if (!repoPath) return false
    return runWrite(set, get, async () => {
      const result = await git().branches.switch(repoPath, name)
      // 다른 공간이다 — 보던 것들을 비우고 역사도 첫 페이지부터
      set({
        historyLimit: HISTORY_LIMIT,
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, HISTORY_LIMIT)),
        notice: result.autoShelved
          ? `${T.commit} 안 된 변경이 ${T.conflict}해서 ${T.stash}에 넣어뒀어요. 오른쪽 위 ${T.stash}에서 꺼낼 수 있어요.`
          : null,
      })
    })
  },

  async syncAfterMerge(base) {
    // 전환 실패면 받아오기를 잇지 않는다 — 엉뚱한 브랜치에서 성공 notice로 실패를 덮지 않게 (통합 리뷰)
    if (!(await get().switchBranch(base))) return
    const shelfNotice =
      get().notice ===
      `${T.commit} 안 된 변경이 ${T.conflict}해서 ${T.stash}에 넣어뒀어요. 오른쪽 위 ${T.stash}에서 꺼낼 수 있어요.`
        ? ` ${T.commit} 안 된 변경은 ${T.stash}에 넣어뒀어요.`
        : ''
    await get().pullLatest()
    // 전환의 자동 보관 안내가 pull notice에 덮여 사라지지 않게 이어붙인다 — 상태를 숨기지 않는다
    const { error, notice } = get()
    if (shelfNotice !== '' && error === null) {
      set({ notice: `${notice ?? ''}${shelfNotice}` })
    }
  },

  async createBranch(name, fromHash) {
    const { repoPath } = get()
    if (!repoPath) return false
    return runWrite(set, get, async () => {
      await git().branches.create(repoPath, name, fromHash)
      // 전환이 실패해도 브랜치는 이미 생겼다 — finally로 목록을 실제 상태에 맞춰
      // "만들었는데 안 보이고, 재시도하면 이미 있다"는 혼란을 막는다 (리뷰 반영)
      try {
        const result = await git().branches.switch(repoPath, name)
        set({
          notice: result.autoShelved
            ? `${T.commit} 안 된 변경이 ${T.conflict}해서 ${T.stash}에 넣어뒀어요. 오른쪽 위 ${T.stash}에서 꺼낼 수 있어요.`
            : null,
        })
      } finally {
        set({
          historyLimit: HISTORY_LIMIT,
          ...CLEAR_SELECTIONS,
          ...(await fetchSnapshot(repoPath, HISTORY_LIMIT)),
        })
      }
    })
  },

  async shelfSave() {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      await git().shelf.save(repoPath, '직접 스태시')
      set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async shelfRestore(ref) {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      // 겹침 에러가 나도 이미 충돌 표시가 적용됐을 수 있다 — finally로 실제 상태를 다시 읽는다
      try {
        await git().shelf.restore(repoPath, ref)
      } finally {
        set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
      }
    })
  },

  async shelfDrop(ref) {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      await git().shelf.drop(repoPath, ref)
      // 지운 항목을 미리보기로 열어 둔 채면 stale 상세가 남는다 — restore와 대칭으로 선택을 지운다 (품질 리뷰)
      set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async stage(paths) {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      await git().changes.stage(repoPath, paths)
      // stage 후에는 보고 있던 diff의 의미가 달라진다(오인 커밋 방지) — 선택을 비운다
      set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async unstage(paths) {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      await git().changes.unstage(repoPath, paths)
      set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async discard(trackedPaths, untrackedPaths) {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      // 파괴적 작업 — 부분 실행으로 실패해도 이미 지워진 것이 있다.
      // finally로 스냅샷을 갱신해 stale한 "수정됨" 표시를 남기지 않는다 (리뷰 실측 반영)
      try {
        await git().changes.discard(repoPath, trackedPaths, untrackedPaths)
      } finally {
        set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
      }
    })
  },

  async removeFile(path) {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      // 파괴적 작업 — 실패해도 디스크가 이미 바뀌었을 수 있다. finally로 실제 상태를 다시 읽는다 (discard 관례)
      try {
        await git().changes.removeFile(repoPath, path)
      } finally {
        set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
      }
    })
  },

  async selectFile(selected) {
    const { repoPath } = get()
    if (!repoPath) return
    // 충돌 파일은 diff가 아니라 충돌 해결 화면으로 — 한쪽을 고르거나 직접 수정한다
    if (selected.change.staged === 'conflicted' || selected.change.unstaged === 'conflicted') {
      await get().selectConflict(selected.change.path)
      return
    }
    // 읽기 전용 조회(diff만 읽는다) — 전역 busy를 켜지 않는다. 이 앱에서 가장 잦은 조작이라
    // 켜면 파일을 넘길 때마다 헤더·사이드바가 통째로 깜빡인다(E14a 실측: 헤더 속성 변형 30건,
    // 29ms). 억제 창도 무장하지 않는다 — 걸어두면 사용자가 diff를 훑어보는 내내 억제 창이 거의
    // 상시로 걸려 그사이 도착한 외부 변경이 조용히 삼켜진다 (E10 보완 — Important 2)
    await runRepoRead(set, get, 'center', repoPath, async (isCurrent) => {
      const untracked = selected.change.unstaged === 'untracked'
      const diff = await git().changes.diff(repoPath, selected.change.path, {
        staged: selected.staged,
        untracked,
        // staged rename은 원래 경로를 동봉해야 rename으로 표시된다 (unstage와 대칭)
        origPath: selected.staged ? selected.change.origPath : null,
      })
      // 그 사이 다른 파일을 눌렀다면 이 결과는 낡았다 — 덮지 않고 버린다 (E14a)
      if (!isCurrent()) return
      // 파일 diff·커밋 상세·충돌 뷰는 상호 배타 — 중앙 패널이 하나다
      set({ selected, diff, diffLabel: null, commitDetail: null, commitFile: null, conflictFile: null })
    })
  },

  clearSelection() {
    // "닫았으면 닫힌 채로" — 진행 중인 조회(selectFile의 diff, refresh의 revive)가 방금 닫은
    // 선택을 되살리는 것을 막는다. 예전엔 DiffPanel의 닫기 버튼을 busy로 잠가 이 경합을 피했는데,
    // 조회가 busy를 안 켜게 되면서 버튼이 살아나 경합이 UI로 도달 가능해졌다 (E14a 스펙 §2-4-2)
    invalidateReads()
    set({ selected: null, diff: null, diffLabel: null })
  },

  async selectCommit(hash) {
    const { repoPath } = get()
    if (!repoPath) return
    // 읽기 전용 조회 — 전역 busy도 억제 창도 건드리지 않는다 (E14a · E10 보완 — Important 2)
    await runRepoRead(set, get, 'right', repoPath, async (isCurrent) => {
      const commitDetail = await git().commits.show(repoPath, hash)
      // 그 사이 다른 커밋을 눌렀다면 이 결과는 낡았다 — 덮지 않고 버린다 (E14a)
      if (!isCurrent()) return
      // 우측 열은 하나 — 리뷰 상세가 열려 있었다면 닫고 커밋 상세로 전환한다 (상호 배타)
      set({
        commitDetail,
        commitFile: null,
        conflictFile: null,
        selected: null,
        diff: null,
        diffLabel: null,
        pullDetail: null,
      })
    })
  },

  async selectCommitFile(file) {
    const { repoPath, commitDetail } = get()
    if (!repoPath || !commitDetail) return
    // 읽기 전용 조회 — 전역 busy도 억제 창도 건드리지 않는다 (E14a · E10 보완 — Important 2)
    await runRepoRead(set, get, 'center', repoPath, async (isCurrent) => {
      const diff = await git().commits.diffFile(repoPath, commitDetail.hash, file.path, file.origPath)
      // 그 사이 다른 파일을 눌렀다면 이 결과는 낡았다 — 덮지 않고 버린다 (E14a)
      if (!isCurrent()) return
      set({ diff, commitFile: file, diffLabel: null })
    })
  },

  async restoreFileFromCommit(hash, path) {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      // 파괴 작업 — 자동 보관까지 간 뒤 실패해도 보관함 카운트가 낡지 않게 스냅샷은 finally로 (revert 관례).
      // 실패 시에는 선택(커밋 상세)을 유지해 맥락을 잃지 않는다 (품질 리뷰)
      let succeeded = false
      let notice: string | null = null
      try {
        const result = await git().commits.restoreFile(repoPath, hash, path)
        succeeded = true
        // "이 시점" 어투를 빼 커밋·보관함 공통으로 읽히게, staged로 올라간 것도 함께 안내한다 (품질 리뷰)
        notice = `"${path}"에 이 내용을 적용하고 ${T.staged}에 올려뒀어요 — ${T.commit}으로 확정해요.${
          result.autoShelved ? ` ${T.commit} 안 된 변경은 ${T.stash}에 넣어뒀어요.` : ''
        }`
      } finally {
        set({
          ...(succeeded ? CLEAR_SELECTIONS : {}),
          ...(await fetchSnapshot(repoPath, get().historyLimit)),
          notice,
        })
      }
    })
  },

  async compareFileWithWorktree(hash, path, origPath) {
    const { repoPath } = get()
    if (!repoPath) return
    // 읽기 전용 조회 — 전역 busy도 억제 창도 건드리지 않는다 (E14a · E10 보완 — Important 2)
    await runRepoRead(set, get, 'center', repoPath, async (isCurrent) => {
      const diff = await git().commits.diffAgainstWorktree(repoPath, hash, path, origPath)
      // 그 사이 가운데에 다른 것을 띄웠다면 이 결과는 낡았다 — 덮지 않고 버린다 (E14a)
      if (!isCurrent()) return
      // 같은 diff 슬롯 재사용 — 부모 대비 diff(commitFile 제목)와 오인하지 않게 제목만 diffLabel로 덮는다.
      // commitFile은 비워 부모 대비 제목 규칙이 끼어들지 않게 한다 (상세 파일 목록은 열린 채 유지)
      set({ diff, diffLabel: `${path} — 지금 코드와 비교`, commitFile: null })
    })
  },

  clearCommit() {
    set({ commitDetail: null, commitFile: null, diff: null, diffLabel: null })
  },

  async mergeBranch(name) {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      // 자동 보관까지 간 뒤 2차 시도가 실패해도 보관함 카운트가 낡지 않게 — 스냅샷은 finally로 보장 (통합 리뷰)
      let notice: string | null = null
      try {
        const result = await git().branches.merge(repoPath, name)
        const notices: Record<typeof result.outcome, string | null> = {
          'fast-forward': `"${name}"의 ${T.commit} 내용을 모두 가져왔어요.`,
          merged: `"${name}"와 ${T.merge}했어요 — ${T.merge} ${T.commit}이 만들어졌어요.`,
          // 충돌 안내는 머지 바가 상주하며 담당한다 — notice까지 겹치면 같은 문장이 2줄이 된다 (리뷰 반영)
          conflict: null,
          'up-to-date': '이미 모두 반영되어 있어요.',
        }
        const shelfNotice = result.autoShelved ? `${T.commit} 안 된 변경은 ${T.stash}에 넣어뒀어요.` : ''
        notice = [notices[result.outcome], shelfNotice].filter((part) => part).join(' ') || null
      } finally {
        set({
          ...CLEAR_SELECTIONS,
          ...(await fetchSnapshot(repoPath, get().historyLimit)),
          notice,
        })
      }
    })
  },

  async abortMerge() {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      await git().merge.abort(repoPath)
      set({
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: `${T.merge}을 취소하고 이전 상태로 돌아왔어요.`,
      })
    })
  },

  async pullLatest() {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      // 자동 보관까지 간 뒤 2차 시도가 실패해도 보관함 카운트가 낡지 않게 — 스냅샷은 finally로 보장 (통합 리뷰)
      let notice: string | null = null
      try {
        const result = await git().sync.pull(repoPath, get().pullMode)
        const notices: Record<typeof result.outcome, string | null> = {
          'fast-forward': `원격의 최신 ${T.commit}을 가져왔어요.`,
          merged: `원격과 ${T.merge}해 새 ${T.merge} ${T.commit}을 만들었어요.`,
          rebased: `원격 최신 위로 내 ${T.commit}을 다시 쌓았어요 — ${T.history}가 일직선이에요.`,
          // 충돌 안내는 머지 바·rebasing 바가 상주하며 담당한다 (모드별)
          conflict: null,
          'up-to-date': '이미 최신이에요.',
        }
        const shelfNotice = result.autoShelved ? `${T.commit} 안 된 변경은 ${T.stash}에 넣어뒀어요.` : ''
        notice = [notices[result.outcome], shelfNotice].filter((part) => part).join(' ') || null
      } finally {
        set({
          ...CLEAR_SELECTIONS,
          ...(await fetchSnapshot(repoPath, get().historyLimit)),
          notice,
        })
      }
    })
  },

  async revertCommit(hash) {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      // 자동 보관까지 간 뒤 2차 시도가 실패해도 보관함 카운트가 낡지 않게 — 스냅샷은 finally로 보장 (통합 리뷰)
      let notice: string | null = null
      try {
        const result = await git().commits.revert(repoPath, hash)
        const shelfNotice = result.autoShelved ? `${T.commit} 안 된 변경은 ${T.stash}에 넣어뒀어요.` : ''
        // 충돌 안내는 reverting 상태 바가 담당한다 — 보관 안내만 남긴다 (join으로 선행 공백 방지)
        notice =
          [result.outcome === 'reverted' ? `되돌리는 새 ${T.commit}을 만들었어요.` : null, shelfNotice]
            .filter((part) => part)
            .join(' ') || null
      } finally {
        set({
          ...CLEAR_SELECTIONS,
          ...(await fetchSnapshot(repoPath, get().historyLimit)),
          notice,
        })
      }
    })
  },

  async abortRevert() {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      await git().commits.revertAbort(repoPath)
      set({
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: '되돌리기를 취소하고 이전 상태로 돌아왔어요.',
      })
    })
  },

  async cherryPickCommit(hash) {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      // 자동 보관까지 간 뒤 2차 시도가 실패해도 보관함 카운트가 낡지 않게 — 스냅샷은 finally로 보장 (revert 관례)
      let notice: string | null = null
      try {
        const result = await git().commits.cherryPick(repoPath, hash)
        const notices: Record<typeof result.outcome, string | null> = {
          picked: `${T.cherryPick}해 새 ${T.commit}을 만들었어요.`,
          // 충돌 안내는 cherry-picking 상태 바가 담당한다 — 보관 안내만 남긴다
          conflict: null,
          empty: `이미 지금 내용에 들어 있는 ${T.commit}이에요 — 새로 만든 ${T.commit}은 없어요.`,
        }
        const shelfNotice = result.autoShelved ? `${T.commit} 안 된 변경은 ${T.stash}에 넣어뒀어요.` : ''
        // conflict(안내 null) + 자동 보관 조합에서 선행 공백이 남지 않게 join으로 조립한다 (품질 리뷰)
        notice = [notices[result.outcome], shelfNotice].filter((part) => part).join(' ') || null
      } finally {
        set({
          ...CLEAR_SELECTIONS,
          ...(await fetchSnapshot(repoPath, get().historyLimit)),
          notice,
        })
      }
    })
  },

  async abortCherryPick() {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      await git().commits.cherryPickAbort(repoPath)
      set({
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: `${T.cherryPick}을 취소하고 이전 상태로 돌아왔어요.`,
      })
    })
  },

  async createTag(name, hash) {
    const { repoPath } = get()
    if (!repoPath) return false
    return runWrite(set, get, async () => {
      await git().commits.createTag(repoPath, name, hash)
      // 파괴 작업이 아니다 — 보던 것은 유지하고 태그 배지만 스냅샷으로 반영한다
      set({
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: `"${name}" 태그를 만들었어요.`,
      })
    })
  },

  async undoLastCommit(hash) {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      // 이력을 바꾸는 파괴 작업 — 실패해도 낡은 목록을 남기지 않게 스냅샷은 finally로 (discard 관례)
      let notice: string | null = null
      try {
        await git().commits.undoLast(repoPath, hash)
        notice = `마지막 ${T.commit}을 취소했어요. 바뀐 내용은 왼쪽 변경 목록에 그대로 남아 있어요.`
      } finally {
        set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)), notice })
      }
    })
  },

  async rewordLastCommit(hash, message) {
    const { repoPath } = get()
    if (!repoPath) return false
    return runWrite(set, get, async () => {
      await git().commits.reword(repoPath, hash, message)
      // HEAD 해시가 바뀐다 — 보던 상세·diff를 비우고 새 목록으로
      set({
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: `${T.commitMessage}를 고쳤어요.`,
      })
    })
  },

  async removeBranch(name, force) {
    const { repoPath } = get()
    if (!repoPath) return { needsForce: false, usedByWorktree: null }
    let needsForce = false
    let usedByWorktree: string | null = null
    await runWrite(set, get, async () => {
      const result = await git().branches.remove(repoPath, name, force)
      needsForce = result.needsForce
      usedByWorktree = result.usedByWorktree
      if (result.removed) {
        set({
          ...(await fetchSnapshot(repoPath, get().historyLimit)),
          notice: `"${name}" ${T.branch}를 지웠어요.`,
        })
      }
    })
    return { needsForce, usedByWorktree }
  },

  async renameBranch(oldName, newName) {
    const { repoPath } = get()
    if (!repoPath) return false
    return runWrite(set, get, async () => {
      await git().branches.rename(repoPath, oldName, newName)
      set({ ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async updateBranch(name) {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      await git().branches.update(repoPath, name)
      // 비교 뷰가 바로 이 공간을 보고 있었다면 낡은 목록이 남는다 — 대상일 때만 닫는다 (품질 리뷰)
      const stale = get().branchCompare?.name === name ? { branchCompare: null } : {}
      set({
        ...stale,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: `"${name}"을 원격 최신으로 업데이트했어요.`,
      })
    })
  },

  async backupBranch(name) {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      const result = await git().branches.backup(repoPath, name)
      // push는 ref를 움직이지 않는다 — 비교 뷰 무효화 불필요 (update와의 비대칭은 의도 — 품질 리뷰)
      set({
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: result.linked
          ? `"${name}"을 원격과 연결하며 ${T.push}했어요 — 이제 ↑↓로 차이가 보여요.`
          : `"${name}"을 ${T.push}했어요.`,
      })
    })
  },

  async compareBranch(name) {
    const { repoPath } = get()
    if (!repoPath) return
    // 읽기 전용 조회 — 전역 busy도 억제 창도 건드리지 않는다 (E14a · E10 보완 — Important 2)
    await runRepoRead(set, get, 'left', repoPath, async (isCurrent) => {
      const result = await git().branches.compare(repoPath, name)
      // 그 사이 다른 공간을 비교했다면 이 결과는 낡았다 — 덮지 않고 버린다 (E14a)
      if (!isCurrent()) return
      set({ branchCompare: { name, result } })
    })
  },

  clearBranchCompare() {
    // clearSelection과 같은 이유 — 진행 중인 compareBranch·refresh의 revive가 방금 닫은
    // 비교 뷰를 되살리지 못하게 한다 (E14a 스펙 §2-4-2)
    invalidateReads()
    set({ branchCompare: null })
  },

  async checkoutRemoteBranch(name) {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      const result = await git().branches.checkoutRemote(repoPath, name)
      // 다른 공간이다 — 보던 것들을 비우고 역사도 첫 페이지부터 (switchBranch 관례)
      set({
        historyLimit: HISTORY_LIMIT,
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, HISTORY_LIMIT)),
        notice: result.autoShelved
          ? `원격 "${name}"을 내 ${T.branch}로 가져와 이동했어요. ${T.commit} 안 된 변경은 ${T.stash}에 넣어뒀어요.`
          : `원격 "${name}"을 내 ${T.branch}로 가져와 이동했어요.`,
      })
    })
  },

  async removeRemoteBranch(name) {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      await git().branches.removeRemote(repoPath, name)
      // 비교 뷰가 바로 이 공간을 보고 있었다면 낡은 목록이 남는다 — 대상일 때만 닫는다 (품질 리뷰)
      const stale = get().branchCompare?.name === name ? { branchCompare: null } : {}
      set({
        ...stale,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: `원격에서 "${name}"을 지웠어요.`,
      })
    })
  },

  async rebaseOnto(name) {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      // 자동 보관까지 간 뒤 2차 시도가 실패해도 보관함 카운트가 낡지 않게 — 스냅샷은 finally로 보장 (merge 관례)
      let notice: string | null = null
      try {
        const result = await git().rebase.start(repoPath, name)
        const notices: Record<typeof result.outcome, string | null> = {
          completed: `"${name}" 위로 ${T.rebase}했어요.`,
          'up-to-date': `이미 그 위에 있어요 — ${T.rebase}할 것이 없어요.`,
          // 충돌 안내는 rebasing 상태 바가 상주하며 담당한다
          conflict: null,
        }
        const shelfNotice = result.autoShelved ? `${T.commit} 안 된 변경은 ${T.stash}에 넣어뒀어요.` : ''
        notice = [notices[result.outcome], shelfNotice].filter((part) => part).join(' ') || null
      } finally {
        set({
          ...CLEAR_SELECTIONS,
          ...(await fetchSnapshot(repoPath, get().historyLimit)),
          notice,
        })
      }
    })
  },

  async continueRebase() {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      let notice: string | null = null
      try {
        const result = await git().rebase.continue(repoPath)
        // 다음 충돌 안내는 rebasing 상태 바(진행 M/N)가 담당한다 — 완료만 notice로
        notice = result.outcome === 'completed' ? `${T.rebase}를 마쳤어요.` : null
      } finally {
        set({
          ...CLEAR_SELECTIONS,
          ...(await fetchSnapshot(repoPath, get().historyLimit)),
          notice,
        })
      }
    })
  },

  async abortRebase() {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      await git().rebase.abort(repoPath)
      set({
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: `${T.rebase}를 취소하고 이전 상태로 돌아왔어요.`,
      })
    })
  },

  async addWorktree(path, branch, createBranch) {
    const { repoPath } = get()
    if (!repoPath) return false
    return runWrite(set, get, async () => {
      await git().worktrees.add(repoPath, path, branch, createBranch === true)
      set({
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: `"${branch}" ${T.worktree}를 만들었어요.`,
      })
    })
  },

  async removeWorktree(path, force) {
    const { repoPath } = get()
    if (!repoPath) return false
    let needsForce = false
    await runWrite(set, get, async () => {
      const result = await git().worktrees.remove(repoPath, path, force)
      needsForce = result.needsForce
      if (result.removed) {
        set({
          ...(await fetchSnapshot(repoPath, get().historyLimit)),
          notice: `${T.worktree}를 지웠어요.`,
        })
      }
    })
    return needsForce
  },

  async openWorktree(path) {
    const { repoPath } = get()
    if (!repoPath) return false
    return runWrite(set, get, async () => {
      // 검증·allowlist 등록은 main — 통과하면 정규화 경로가 돌아온다 (E7c 보안 가드)
      const opened = await git().repo.openPath(repoPath, path)
      // 다른 워크트리다 — 저장소 전환과 같은 초기화 (openRepository 관례)
      // 조회는 저장소 경계를 넘지 않는다 — 스냅샷(내부 loadHistory)이 구 ref를 읽기 전에 선해제 (품질 리뷰:
      // 같은 리터럴의 historyRef:null은 await 뒤에 적용돼 같은 이름 브랜치에서 '알약 없는 필터 역사' 모순)
      // 선해제와 스냅샷 사이에 await를 두지 않는다 — openRepository와 같은 이유 (E15a 리뷰 ①)
      const hostingStatus = await hosting().status(opened)
      set({ historyRef: null })
      const snapshot = await fetchSnapshot(opened, HISTORY_LIMIT)
      set({
        repoPath: opened,
        historyLimit: HISTORY_LIMIT,
        historyRef: null,
        hostingStatus,
        pulls: [],
        ...CLEAR_SELECTIONS,
        ...snapshot,
      })
      void git().repo.watch(opened)
    })
  },

  async revealWorktree(path) {
    const { repoPath } = get()
    if (!repoPath) return
    // 읽기 전용·즉발 — busy 직렬화(runWrite) 없이 언제나 동작한다. 실패만 배너로 (E7d ⑥)
    try {
      await git().worktrees.reveal(repoPath, path)
    } catch (cause) {
      set({ error: toErrorMessage(cause) })
    }
  },

  async fetchRemotes() {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      await git().remotes.fetch(repoPath)
      // 쓰기(runWrite) 종료 직후 억제 창(800ms)이 fetch발 감시 이벤트를 삼킨다(실측 6) —
      // 감시에 맡기지 않고 여기서 직접 스냅샷을 뜬다. 보던 화면은 유지(E7d ⑤ 관례)
      const snapshot = await fetchSnapshot(repoPath, get().historyLimit)
      set({
        lastFetchAt: Date.now(),
        ...CLEAR_SELECTIONS,
        conflictFile: get().conflictFile,
        ...(await reviveSelections(repoPath, get(), snapshot.status)),
        ...snapshot,
      })
    })
  },

  async autoFetchRemotes() {
    const { repoPath } = get()
    if (!repoPath) return
    // 주기 작업 — busy 잠금·에러 배너 없이 조용히. 화면 갱신은 감시(refs/remotes 변화)가 담당하고,
    // 무변화면 FETCH_HEAD 필터 제외 덕에 아무 일도 없다 (E7e ① — 실패는 다음 주기 재시도)
    try {
      await git().remotes.fetch(repoPath)
      // E15a 리뷰 ① — 이 주기 작업만은 runWrite도 runRead도 안 거쳐 seq 무효화 대상이 아니다.
      // 전환 중에 착지하면 openRepository가 방금 null로 비운 lastFetchAt이 되살아나, 새 저장소가
      // 한 번도 안 가져왔는데 "방금 가져옴"으로 보인다. 착지 시점에 같은 저장소일 때만 새긴다
      if (get().repoPath !== repoPath) return
      set({ lastFetchAt: Date.now() })
    } catch {
      // 오프라인·인증 실패 등 — 배너 도배 금지
    }
  },

  setPullMode(mode) {
    savePullMode(mode)
    set({ pullMode: mode })
  },

  async viewHistory(ref) {
    const { repoPath } = get()
    if (!repoPath) return
    // 읽기 전용 조회 — 전역 busy도 억제 창도 건드리지 않는다 (E14a · E10 보완 — Important 2)
    await runRepoRead(set, get, 'right', repoPath, async (isCurrent) => {
      // await 앞의 즉시 피드백 — "조회 중: <ref> ✕" 알약이 클릭 즉시 뜨게 한다 (E7g).
      // 조회 결과가 아니므로 isCurrent로 감싸지 않는다. fetchSnapshot이 이 값을 읽는다
      set({ historyRef: ref })
      const snapshot = await fetchSnapshot(repoPath, get().historyLimit)
      // 그 사이 다른 계보를 조회했다면 이 결과는 낡았다 — 덮지 않고 버린다 (E14a)
      if (!isCurrent()) return
      set({ ...snapshot })
    })
  },

  async clearHistoryView() {
    const { repoPath } = get()
    if (!repoPath) return
    // 읽기 전용 조회 — 전역 busy도 억제 창도 건드리지 않는다 (E14a · E10 보완 — Important 2)
    await runRepoRead(set, get, 'right', repoPath, async (isCurrent) => {
      // await 앞의 즉시 피드백 — 알약이 클릭 즉시 사라지게 한다 (E7g, viewHistory와 대칭)
      set({ historyRef: null })
      const snapshot = await fetchSnapshot(repoPath, get().historyLimit)
      // 그 사이 다른 계보를 조회했다면 이 결과는 낡았다 — 덮지 않고 버린다 (E14a)
      if (!isCurrent()) return
      set({ ...snapshot })
    })
  },

  async selectConflict(path) {
    const { repoPath } = get()
    if (!repoPath) return
    // 읽기 전용 조회(충돌 파일 내용만 읽는다) — 전역 busy도 억제 창도 건드리지 않는다
    // (E14a · E10 보완 — Important 2)
    await runRepoRead(set, get, 'center', repoPath, async (isCurrent) => {
      const content = await git().files.readText(repoPath, path)
      // 그 사이 가운데에 다른 것을 띄웠다면 이 결과는 낡았다 — 덮지 않고 버린다 (E14a)
      if (!isCurrent()) return
      set({
        conflictFile: { path, content },
        selected: null,
        diff: null,
        diffLabel: null,
        commitDetail: null,
        commitFile: null,
      })
    })
  },

  async reloadConflict(path) {
    const { repoPath } = get()
    if (!repoPath) return null
    // 읽기 전용 재조회 — 전역 잠금(busy)을 잡지 않아 확인 흐름을 막지 않는다.
    // E15a 리뷰 ① — 이것도 seq 밖이다. 전환 중 착지하면 옛 저장소의 겹침 파일이 새 저장소의
    // 가운데 패널에 되살아나고(openRepository가 CLEAR_SELECTIONS로 막 닫은 것이다), 실패하면
    // 남의 저장소 오류가 새 화면에 배너로 뜬다. 착지 시점에 같은 저장소일 때만 반영한다
    try {
      const content = await git().files.readText(repoPath, path)
      if (get().repoPath !== repoPath) return null
      set({ conflictFile: { path, content } })
      return content
    } catch (cause) {
      if (get().repoPath !== repoPath) return null
      set({ error: toErrorMessage(cause) })
      return null
    }
  },

  async resolveConflict(path, choice) {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      await git().conflicts.resolve(repoPath, path, choice)
      set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async markConflictResolved(path) {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      await git().conflicts.markResolved(repoPath, path)
      set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async chooseConflictBlock(blockIndex, choice) {
    const { repoPath, conflictFile } = get()
    if (!repoPath || !conflictFile) return
    await runWrite(set, get, async () => {
      // 외부 편집과의 경합 — 열 때 읽어 둔 내용이 아니라 최신 내용에 적용한다
      const fresh = await git().files.readText(repoPath, conflictFile.path)
      const next = applyBlockChoice(fresh, blockIndex, choice)
      if (next === null) {
        // 그 블록이 더는 없다 — 최신 내용을 보여 주고 다시 고르게 안내한다
        set({
          conflictFile: { path: conflictFile.path, content: fresh },
          notice: `파일이 밖에서 바뀌어 ${T.conflict} 목록을 새로 불러왔어요. 다시 골라 주세요.`,
        })
        return
      }
      await git().conflicts.saveText(repoPath, conflictFile.path, next)
      // 충돌 뷰는 연 채로 내용·상태만 갱신한다 — CLEAR_SELECTIONS를 쓰면 뷰가 닫힌다
      set({
        conflictFile: { path: conflictFile.path, content: next },
        status: await git().repo.status(repoPath),
      })
    })
  },

  async saveConflictText(content) {
    const { repoPath, conflictFile } = get()
    if (!repoPath || !conflictFile) return false
    return await runWrite(set, get, async () => {
      await git().conflicts.saveText(repoPath, conflictFile.path, content)
      set({
        conflictFile: { path: conflictFile.path, content },
        status: await git().repo.status(repoPath),
      })
    })
  },

  async resetConflict() {
    const { repoPath, conflictFile } = get()
    if (!repoPath || !conflictFile) return
    await runWrite(set, get, async () => {
      await git().conflicts.reset(repoPath, conflictFile.path)
      const content = await git().files.readText(repoPath, conflictFile.path)
      set({
        conflictFile: { path: conflictFile.path, content },
        status: await git().repo.status(repoPath),
      })
    })
  },

  clearCommitFile() {
    set({ commitFile: null, diff: null, diffLabel: null })
  },

  clearError() {
    set({ error: null })
  },

  clearNotice() {
    set({ notice: null })
  },

  async loadMoreHistory() {
    const { repoPath, history, historyLimit } = get()
    // 끝까지 다 봤거나(뒤가 없음) 상한에 닿았으면 더 부르지 않는다
    if (!repoPath || history.length < historyLimit || historyLimit >= HISTORY_MAX) return
    // 읽기 전용 조회 — 전역 busy도 억제 창도 건드리지 않는다 (E14a · E10 보완 — Important 2)
    await runRepoRead(set, get, 'right', repoPath, async (isCurrent) => {
      const next = Math.min(historyLimit + HISTORY_PAGE, HISTORY_MAX)
      const ref = get().historyRef ?? undefined
      try {
        const history = await git().history.list(repoPath, next, ref)
        // 그 사이 다른 역사 조회가 끝났다면 이 결과는 낡았다 — 덮지 않고 버린다 (E14a)
        if (!isCurrent()) return
        set({ history, historyLimit: next })
      } catch (error) {
        // 조회 브랜치가 사라졌으면 조용히 전체 그래프로 복귀(fetchSnapshot과 같은 원칙)
        if (ref === undefined) throw error
        const history = await git().history.list(repoPath, next)
        // 폴백도 결과를 쓰는 것은 마찬가지다 — 낡았으면 똑같이 버린다 (E14a)
        if (!isCurrent()) return
        set({ historyRef: null, history, historyLimit: next })
      }
    })
  },

  async searchHistory(query) {
    const { repoPath } = get()
    if (!repoPath) return { indices: [], hashes: [], truncated: false }
    // 검색은 조회성 — runWrite(busy 잠금·에러 배너)를 쓰지 않고, 실패해도 조용히 빈 결과를 준다
    try {
      return await git().history.search(repoPath, query, get().historyRef ?? undefined)
    } catch {
      return { indices: [], hashes: [], truncated: false }
    }
  },

  async loadHeadInfo(path, headHash) {
    const { repoPath, headInfos } = get()
    const key = `${path}::${headHash ?? ''}`
    if (!repoPath || key in headInfos) return
    // 조회성 — runWrite(busy 잠금·에러 배너)를 쓰지 않고 실패는 조용히 null로 캐시한다.
    // E15a 리뷰 ① — 이것도 seq 밖이다. 전환 중 착지하면 openRepository가 비운 캐시에 옛 저장소의
    // 워크트리 항목이 도로 들어간다(새 저장소는 그 키를 안 읽으니 화면엔 안 보이지만, 전환할수록
    // 쌓이지 않게 하려고 비운 것이라 그 의도가 깨진다). 착지 시점에 같은 저장소일 때만 캐시한다
    try {
      const info = await git().worktrees.headInfo(repoPath, path)
      if (get().repoPath !== repoPath) return
      set({ headInfos: { ...get().headInfos, [key]: info } })
    } catch {
      if (get().repoPath !== repoPath) return
      set({ headInfos: { ...get().headInfos, [key]: null } })
    }
  },

  async ensureHistoryLoaded(index) {
    const { repoPath, history, historyLimit } = get()
    if (!repoPath || index < history.length) return
    const next = Math.min(Math.max(index + 1, historyLimit + HISTORY_PAGE), SEARCH_JUMP_MAX)
    if (next <= historyLimit) return
    // 읽기 전용 조회 — 전역 busy도 억제 창도 건드리지 않는다 (E14a · E10 보완 — Important 2)
    await runRepoRead(set, get, 'right', repoPath, async (isCurrent) => {
      const ref = get().historyRef ?? undefined
      try {
        const history = await git().history.list(repoPath, next, ref)
        // 그 사이 다른 역사 조회가 끝났다면 이 결과는 낡았다 — 덮지 않고 버린다 (E14a)
        if (!isCurrent()) return
        set({ history, historyLimit: next })
      } catch (error) {
        // 조회 브랜치가 사라졌으면 조용히 전체 그래프로 복귀 (loadMoreHistory와 같은 원칙)
        if (ref === undefined) throw error
        const history = await git().history.list(repoPath, next)
        // 폴백도 결과를 쓰는 것은 마찬가지다 — 낡았으면 똑같이 버린다 (E14a)
        if (!isCurrent()) return
        set({ historyRef: null, history, historyLimit: next })
      }
    })
  },

  async revealHead() {
    const { repoPath, status } = get()
    const headHash = status?.headHash ?? null
    if (!repoPath || headHash === null) return
    // 읽기 전용 조회 — 전역 busy도 억제 창도 건드리지 않는다 (E14a · E10 보완 — Important 2)
    await runRepoRead(set, get, 'right', repoPath, async (isCurrent) => {
      // 큰 저장소에서 HEAD가 한참 아래일 수 있다 — 찾을 때까지 상한을 넓힌다(상한 10회 × 2000)
      let limit = get().historyLimit
      for (let round = 0; round < 10; round += 1) {
        if (get().history.some((commit) => commit.hash === headHash)) return
        limit += 2000
        const history = await git().history.list(repoPath, limit)
        // 그 사이 다른 역사 조회가 끝났다면 넓히던 이 결과는 낡았다 — 덮지 않고 그만둔다 (E14a)
        if (!isCurrent()) return
        set({ historyLimit: limit, history })
      }
    })
  },

  async commit(message) {
    const { repoPath } = get()
    if (!repoPath) return false
    return runWrite(set, get, async () => {
      await git().commits.create(repoPath, message)
      set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async backup() {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      const result = await git().sync.push(repoPath)
      // 백업 후 upstream/ahead/behind가 바뀐다 — 스냅샷 갱신. 첫 연결이면 알린다 (E7e ③)
      set({
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        // linked는 첫 연결뿐 아니라 rename 재연결·반쪽 수리에서도 참 — "만들어"를 피한 중립 문구 (Task 3 리뷰)
        notice: result.linked
          ? `이 ${T.branch}를 원격과 연결하며 ${T.push}했어요 — 이제 ↑↓로 차이가 보여요.`
          : null,
      })
    })
  },

  async refreshPulls() {
    const { repoPath, hostingStatus } = get()
    if (!repoPath || hostingStatus === null || !hostingStatus.connected || hostingStatus.repo === null) {
      return
    }
    // 읽기 전용 조회 — 전역 busy도 억제 창도 건드리지 않는다 (E14a · E10 보완 — Important 2)
    await runRepoRead(set, get, 'reviews', repoPath, async (isCurrent) => {
      try {
        const pulls = await hosting().pulls.list(repoPath)
        // 그 사이 더 최신 목록 조회가 끝났다면 이 결과는 낡았다 — 덮지 않고 버린다 (E14a)
        if (!isCurrent()) return
        set({ pulls })
      } catch (cause) {
        // 실패를 빈 목록("없어요")으로 위장하지 않는다 — null은 "못 불러왔어요" 표시 (품질 리뷰).
        // 늦게 온 실패가 최신 목록을 "못 불러왔어요"로 되돌리면 안 되므로 이것도 지킨다 (E14a)
        if (isCurrent()) set({ pulls: null })
        throw cause
      }
    })
  },

  async connectGh() {
    const { repoPath } = get()
    if (!repoPath) return false
    return runWrite(set, get, async () => {
      const login = await hosting().connect.gh()
      set({
        hostingStatus: await hosting().status(repoPath),
        notice: `@${login} 계정으로 GitHub와 연결했어요.`,
      })
    })
  },

  async connectToken(token) {
    const { repoPath } = get()
    if (!repoPath) return false
    return runWrite(set, get, async () => {
      const login = await hosting().connect.token(token)
      set({
        hostingStatus: await hosting().status(repoPath),
        notice: `@${login} 계정으로 GitHub와 연결했어요.`,
      })
    })
  },

  async disconnectHosting() {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      await hosting().disconnect()
      set({
        hostingStatus: await hosting().status(repoPath),
        pulls: [],
        notice: 'GitHub 연결을 해제했어요.',
      })
    })
  },

  async createPull(title) {
    const { repoPath } = get()
    if (!repoPath) return false
    return runWrite(set, get, async () => {
      const pull = await hosting().pulls.create(repoPath, { title, body: '' })
      // 백업(push)이 함께 일어났을 수 있다 — 리뷰 목록과 git 스냅샷(ahead/behind)을 함께 갱신한다
      set({
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        pulls: await hosting().pulls.list(repoPath),
        notice: `${T.pullRequest} #${pull.number}을 만들었어요. 리뷰 팝오버에서 볼 수 있어요.`,
      })
    })
  },

  async openPull(number) {
    const { repoPath } = get()
    if (!repoPath) return
    await runWrite(set, get, async () => {
      await hosting().pulls.open(repoPath, number)
    })
  },

  async openPullDetail(number) {
    const { repoPath } = get()
    if (!repoPath) return
    // 예전엔 여기서 busy가 풀릴 때까지 최대 5초 기다렸다 — 팝오버를 열자마자 도는 목록 조회
    // (refreshPulls)가 전역 busy를 잡아 첫 클릭이 조용히 삼켜졌기 때문이다(품질 리뷰). E14a가
    // 조회를 전역 잠금에서 빼면서 그 전제가 사라졌으므로 대기를 걷어낸다 — 남겨두면 진짜 쓰기가
    // 도는 동안 리뷰 열기만 멈춰, "쓰기 중에도 조회는 시작된다"는 결정(스펙 §2-4)을 어긴다
    // 읽기 전용 조회 — 전역 busy도 억제 창도 건드리지 않는다 (E14a · E10 보완 — Important 2)
    await runRepoRead(set, get, 'right', repoPath, async (isCurrent) => {
      const pullDetail = await hosting().pulls.detail(repoPath, number)
      // 그 사이 다른 리뷰를 열었다면 이 결과는 낡았다 — 덮지 않고 버린다 (E14a)
      if (!isCurrent()) return
      // 우측 열은 하나다 — 커밋 상세·diff·충돌 뷰를 정리하고 리뷰 상세로 전환한다
      set({ ...CLEAR_SELECTIONS, pullDetail })
    })
  },

  closePullDetail() {
    set({ pullDetail: null })
  },

  async addPullComment(body) {
    const { repoPath, pullDetail } = get()
    if (!repoPath || pullDetail === null) return false
    return runWrite(set, get, async () => {
      const number = pullDetail.detail.number
      await hosting().pulls.comment(repoPath, number, body)
      // 내 답변만 붙이지 않고 서버 상태로 다시 읽는다 — 그 사이 달린 다른 코멘트도 함께 온다.
      // 재조회 실패가 이미 성공한 전송을 에러로 뒤집지 않게 삼킨다(재전송=중복 유도 방지 — 품질 리뷰)
      try {
        set({ pullDetail: await hosting().pulls.detail(repoPath, number) })
      } catch {
        // 다음 열기에서 다시 읽는다
      }
    })
  },

  async approvePull() {
    const { repoPath, pullDetail } = get()
    if (!repoPath || pullDetail === null) return
    await runWrite(set, get, async () => {
      const number = pullDetail.detail.number
      await hosting().pulls.approve(repoPath, number)
      // 재조회 실패가 이미 성공한 승인을 에러로 뒤집지 않게 삼킨다 (품질 리뷰)
      let refreshed = get().pullDetail
      try {
        refreshed = await hosting().pulls.detail(repoPath, number)
      } catch {
        // 다음 열기에서 다시 읽는다
      }
      set({
        pullDetail: refreshed,
        notice: `${T.pullRequest} #${number}을 ${T.approve}했어요.`,
      })
    })
  },

  async mergePull() {
    const { repoPath, pullDetail } = get()
    if (!repoPath || pullDetail === null) return false
    return runWrite(set, get, async () => {
      const number = pullDetail.detail.number
      const base = pullDetail.detail.baseBranch
      await hosting().pulls.merge(repoPath, number)
      // 상세를 다시 읽어 '병합됨' 배지로 갱신한다. 로컬 반영은 App의 후속 제안(전환+받아오기)이 담당.
      // 재조회 실패가 이미 성공한 병합을 에러로 뒤집지 않게 삼킨다 (품질 리뷰)
      let refreshed = get().pullDetail
      try {
        refreshed = await hosting().pulls.detail(repoPath, number)
      } catch {
        // 다음 열기에서 다시 읽는다
      }
      set({
        pullDetail: refreshed,
        notice: `${T.pullRequest} #${number}을 "${base}"에 ${T.merge}했어요. 로컬은 아직 그대로예요 — 기본 브랜치에서 ${T.pull}를 하면 반영돼요.`,
      })
    })
  },
}))
