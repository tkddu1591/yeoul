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
  RebaseProgress,
  RepositoryStatus,
  ShelfEntry,
} from '@git-gui/domain'
import type { HostingStatus, PullDetailView, PullSummary } from '@git-gui/ipc-contract'
import { applyBlockChoice } from '../components/conflict-markers'

const git = () => window.gitApi
const hosting = () => window.hostingApi

/** 히스토리 첫 페이지 크기 — 스크롤 끝에서 HISTORY_PAGE씩 상한을 늘려 다시 불러온다 (⑩) */
export const HISTORY_LIMIT = 50
const HISTORY_PAGE = 200
/** IPC assertLimit와 동일한 상한 — 이 이상은 더 불러오지 않는다 */
const HISTORY_MAX = 10000
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

  init(): Promise<void>
  openRepository(): Promise<void>
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
  /** 실험 공간 지우기. 반환 true면 합쳐지지 않은 저장이 있어 강제 확인이 필요하다 */
  removeBranch(name: string, force: boolean): Promise<boolean>
  /** 이름 바꾸기 — 성공 여부 반환(실패 시 다이얼로그 유지·입력 보존) */
  renameBranch(oldName: string, newName: string): Promise<boolean>
  /** 비현재 공간을 원격 최신으로(ff-only) — 현재 공간은 UI가 pullLatest로 보낸다 (E7a) */
  updateBranch(name: string): Promise<void>
  /** 선택 공간을 checkout 없이 백업 — 현재 공간은 UI가 backup으로 보낸다 (E7a) */
  backupBranch(name: string): Promise<void>
  /** "지금과 비교" 열기 — 결과는 branchCompare로, 실험 공간 탭이 비교 뷰가 된다 (E7a) */
  compareBranch(name: string): Promise<void>
  /** 비교 뷰 닫기 — 동기라 guard 불필요 */
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
  /** 충돌 파일 열기 — 워크트리 내용을 읽어 충돌 뷰로 */
  selectConflict(path: string): Promise<void>
  /** 충돌 뷰 내용 재조회(외부 편집 반영) — 읽기 전용이라 guard 없이. 실패 시 null */
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
  /** diff 선택 해제 — 동기 상태 변경이라 guard 불필요 */
  clearSelection(): void
  selectCommit(hash: string): Promise<void>
  selectCommitFile(file: CommitFileChange): Promise<void>
  /** 이 파일만 그 시점 내용으로 적용(checkout) — 확인창(UI 책임) 경유. 미저장 변경은 엔진이 파일 단위 자동 보관 */
  restoreFileFromCommit(hash: string, path: string): Promise<void>
  /** 그 시점과 지금 워크트리의 비교를 공용 diff 슬롯에 띄운다 — 제목은 diffLabel로 구분 */
  compareFileWithWorktree(hash: string, path: string, origPath: string | null): Promise<void>
  /** 커밋 상세 닫기 — 동기 상태 변경이라 guard 불필요 */
  clearCommit(): void
  /** 커밋 상세 안의 파일 diff만 닫는다 — 상세(파일 목록)는 유지. 동기라 guard 불필요 */
  clearCommitFile(): void
  /** 전역 에러를 지운다 — 다이얼로그를 새로 열 때 이전 작업 에러가 인라인으로 새어들지 않게. 동기라 guard 불필요 */
  clearError(): void
  /** notice만 지운다 — 자동 소멸 타이머(App) 전용. 동기라 guard 불필요 */
  clearNotice(): void
  /** 스크롤 끝에서 히스토리 상한을 늘려 다시 불러온다 (⑩) */
  loadMoreHistory(): Promise<void>
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
  /** 리뷰 상세 닫기 — 동기 상태 변경이라 guard 불필요 */
  closePullDetail(): void
  /** 답변 달기 — 성공 여부 반환(성공 시에만 입력을 비운다). 성공 후 타임라인을 서버 상태로 재조회 */
  addPullComment(body: string): Promise<boolean>
  /** 승인 — 자기 PR이면 main이 친절 문구로 거부한다. 성공 후 상세 재조회(승인됨 배지 갱신) */
  approvePull(): Promise<void>
  /** 병합(병합 커밋) — 성공 여부 반환(App이 기본 공간 이동 제안을 연다). 성공 후 상세 재조회 */
  mergePull(): Promise<boolean>
}

/** IPC 에러 메시지의 Electron 래핑 접두사를 벗겨 사용자 메시지만 남긴다 (GitError 등 커스텀 이름 포함) */
function toErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
}

/** 상태·역사·실험 공간·보관함을 동시 조회해 같은 렌더에 함께 갱신한다 — 시점 차이를 최소화 (원자 스냅샷은 아님) */
async function fetchSnapshot(
  repoPath: string,
  limit: number,
): Promise<
  Pick<RepositoryStore, 'status' | 'history' | 'branches' | 'shelf' | 'branchOverview' | 'rebaseProgress'>
> {
  const [status, history, branches, shelf, branchOverview] = await Promise.all([
    git().repo.status(repoPath),
    git().history.list(repoPath, limit),
    git().branches.list(repoPath),
    git().shelf.list(repoPath),
    git().branches.overview(repoPath),
  ])
  // 재배치 중일 때만 진행 위치를 읽는다 — 상태 바 "M/N번째" (E7a)
  const rebaseProgress =
    status.state === 'rebasing' ? await git().rebase.progress(repoPath) : null
  return { status, history, branches, shelf, branchOverview, rebaseProgress }
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

type StoreSet = (partial: Partial<RepositoryStore>) => void
type StoreGet = () => RepositoryStore

/** busy 재진입을 거부하고 busy/error 처리를 일원화한다. 성공 여부를 반환한다 */
async function guard(set: StoreSet, get: StoreGet, run: () => Promise<void>): Promise<boolean> {
  if (get().busy) return false
  set({ busy: true, error: null, notice: null })
  try {
    await run()
    return true
  } catch (cause) {
    set({ error: toErrorMessage(cause) })
    return false
  } finally {
    set({ busy: false })
  }
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
  hostingStatus: null,
  branchOverview: null,
  branchCompare: null,
  rebaseProgress: null,
  pulls: [],
  pullDetail: null,

  async init() {
    await guard(set, get, async () => {
      const initial = await git().repo.initialPath()
      if (!initial) return
      set({
        repoPath: initial,
        hostingStatus: await hosting().status(initial),
        ...(await fetchSnapshot(initial, get().historyLimit)),
      })
    })
  },

  async openRepository() {
    await guard(set, get, async () => {
      const path = await git().repo.select()
      if (!path) return
      // guard가 재진입을 거부하므로 refresh()를 부르지 않고 직접 조회한다.
      // 다른 저장소다 — 히스토리 상한도 첫 페이지로 되돌린다
      set({
        repoPath: path,
        historyLimit: HISTORY_LIMIT,
        hostingStatus: await hosting().status(path),
        pulls: [],
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(path, HISTORY_LIMIT)),
      })
    })
  },

  async refresh() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      // 외부(CLI 등)에서 상태가 바뀌었을 수 있다 — 보고 있던 diff·상세도 함께 무효화한다
      set({
        ...CLEAR_SELECTIONS,
        hostingStatus: await hosting().status(repoPath),
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
      })
    })
  },

  async switchBranch(name) {
    const { repoPath } = get()
    if (!repoPath) return false
    return guard(set, get, async () => {
      const result = await git().branches.switch(repoPath, name)
      // 다른 공간이다 — 보던 것들을 비우고 역사도 첫 페이지부터
      set({
        historyLimit: HISTORY_LIMIT,
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, HISTORY_LIMIT)),
        notice: result.autoShelved
          ? '저장 안 된 변경이 겹쳐서 보관함에 넣어뒀어요. 오른쪽 위 보관함에서 꺼낼 수 있어요.'
          : null,
      })
    })
  },

  async syncAfterMerge(base) {
    // 전환 실패면 받아오기를 잇지 않는다 — 엉뚱한 브랜치에서 성공 notice로 실패를 덮지 않게 (통합 리뷰)
    if (!(await get().switchBranch(base))) return
    const shelfNotice =
      get().notice ===
      '저장 안 된 변경이 겹쳐서 보관함에 넣어뒀어요. 오른쪽 위 보관함에서 꺼낼 수 있어요.'
        ? ' 저장 안 된 변경은 보관함에 넣어뒀어요.'
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
    return guard(set, get, async () => {
      await git().branches.create(repoPath, name, fromHash)
      // 전환이 실패해도 브랜치는 이미 생겼다 — finally로 목록을 실제 상태에 맞춰
      // "만들었는데 안 보이고, 재시도하면 이미 있다"는 혼란을 막는다 (리뷰 반영)
      try {
        const result = await git().branches.switch(repoPath, name)
        set({
          notice: result.autoShelved
            ? '저장 안 된 변경이 겹쳐서 보관함에 넣어뒀어요. 오른쪽 위 보관함에서 꺼낼 수 있어요.'
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
    await guard(set, get, async () => {
      await git().shelf.save(repoPath, '직접 보관')
      set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async shelfRestore(ref) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
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
    await guard(set, get, async () => {
      await git().shelf.drop(repoPath, ref)
      // 지운 항목을 미리보기로 열어 둔 채면 stale 상세가 남는다 — restore와 대칭으로 선택을 지운다 (품질 리뷰)
      set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async stage(paths) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().changes.stage(repoPath, paths)
      // stage 후에는 보고 있던 diff의 의미가 달라진다(오인 커밋 방지) — 선택을 비운다
      set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async unstage(paths) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().changes.unstage(repoPath, paths)
      set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async discard(trackedPaths, untrackedPaths) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
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
    await guard(set, get, async () => {
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
    await guard(set, get, async () => {
      const untracked = selected.change.unstaged === 'untracked'
      const diff = await git().changes.diff(repoPath, selected.change.path, {
        staged: selected.staged,
        untracked,
        // staged rename은 원래 경로를 동봉해야 rename으로 표시된다 (unstage와 대칭)
        origPath: selected.staged ? selected.change.origPath : null,
      })
      // 파일 diff·커밋 상세·충돌 뷰는 상호 배타 — 중앙 패널이 하나다
      set({ selected, diff, diffLabel: null, commitDetail: null, commitFile: null, conflictFile: null })
    })
  },

  clearSelection() {
    set({ selected: null, diff: null, diffLabel: null })
  },

  async selectCommit(hash) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      const commitDetail = await git().commits.show(repoPath, hash)
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
    await guard(set, get, async () => {
      const diff = await git().commits.diffFile(repoPath, commitDetail.hash, file.path, file.origPath)
      set({ diff, commitFile: file, diffLabel: null })
    })
  },

  async restoreFileFromCommit(hash, path) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      // 파괴 작업 — 자동 보관까지 간 뒤 실패해도 보관함 카운트가 낡지 않게 스냅샷은 finally로 (revert 관례).
      // 실패 시에는 선택(커밋 상세)을 유지해 맥락을 잃지 않는다 (품질 리뷰)
      let succeeded = false
      let notice: string | null = null
      try {
        const result = await git().commits.restoreFile(repoPath, hash, path)
        succeeded = true
        // "이 시점" 어투를 빼 커밋·보관함 공통으로 읽히게, staged로 올라간 것도 함께 안내한다 (품질 리뷰)
        notice = `"${path}"에 이 내용을 적용하고 저장 예정에 올려뒀어요 — 저장하기로 확정해요.${
          result.autoShelved ? ' 저장 안 된 변경은 보관함에 넣어뒀어요.' : ''
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
    await guard(set, get, async () => {
      const diff = await git().commits.diffAgainstWorktree(repoPath, hash, path, origPath)
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
    await guard(set, get, async () => {
      // 자동 보관까지 간 뒤 2차 시도가 실패해도 보관함 카운트가 낡지 않게 — 스냅샷은 finally로 보장 (통합 리뷰)
      let notice: string | null = null
      try {
        const result = await git().branches.merge(repoPath, name)
        const notices: Record<typeof result.outcome, string | null> = {
          'fast-forward': `"${name}"의 저장 내용을 모두 가져왔어요.`,
          merged: `"${name}"와 합쳤어요 — 병합 저장이 만들어졌어요.`,
          // 충돌 안내는 머지 바가 상주하며 담당한다 — notice까지 겹치면 같은 문장이 2줄이 된다 (리뷰 반영)
          conflict: null,
          'up-to-date': '이미 모두 반영되어 있어요.',
        }
        const shelfNotice = result.autoShelved ? '저장 안 된 변경은 보관함에 넣어뒀어요.' : ''
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
    await guard(set, get, async () => {
      await git().merge.abort(repoPath)
      set({
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: '합치기를 취소하고 이전 상태로 돌아왔어요.',
      })
    })
  },

  async pullLatest() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      // 자동 보관까지 간 뒤 2차 시도가 실패해도 보관함 카운트가 낡지 않게 — 스냅샷은 finally로 보장 (통합 리뷰)
      let notice: string | null = null
      try {
        const result = await git().sync.pull(repoPath)
        const notices: Record<typeof result.outcome, string | null> = {
          'fast-forward': '원격의 최신 저장을 받아왔어요.',
          merged: '원격과 합쳐 새 병합 저장을 만들었어요.',
          // 충돌 안내는 머지 바가 상주하며 담당한다
          conflict: null,
          'up-to-date': '이미 최신이에요.',
        }
        const shelfNotice = result.autoShelved ? '저장 안 된 변경은 보관함에 넣어뒀어요.' : ''
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
    await guard(set, get, async () => {
      // 자동 보관까지 간 뒤 2차 시도가 실패해도 보관함 카운트가 낡지 않게 — 스냅샷은 finally로 보장 (통합 리뷰)
      let notice: string | null = null
      try {
        const result = await git().commits.revert(repoPath, hash)
        const shelfNotice = result.autoShelved ? '저장 안 된 변경은 보관함에 넣어뒀어요.' : ''
        // 충돌 안내는 reverting 상태 바가 담당한다 — 보관 안내만 남긴다 (join으로 선행 공백 방지)
        notice =
          [result.outcome === 'reverted' ? '되돌리는 새 저장을 만들었어요.' : null, shelfNotice]
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
    await guard(set, get, async () => {
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
    await guard(set, get, async () => {
      // 자동 보관까지 간 뒤 2차 시도가 실패해도 보관함 카운트가 낡지 않게 — 스냅샷은 finally로 보장 (revert 관례)
      let notice: string | null = null
      try {
        const result = await git().commits.cherryPick(repoPath, hash)
        const notices: Record<typeof result.outcome, string | null> = {
          picked: '이 저장을 가져와 새 저장을 만들었어요.',
          // 충돌 안내는 cherry-picking 상태 바가 담당한다 — 보관 안내만 남긴다
          conflict: null,
          empty: '이미 지금 내용에 들어 있는 저장이에요 — 새로 만든 저장은 없어요.',
        }
        const shelfNotice = result.autoShelved ? '저장 안 된 변경은 보관함에 넣어뒀어요.' : ''
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
    await guard(set, get, async () => {
      await git().commits.cherryPickAbort(repoPath)
      set({
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: '가져오기를 취소하고 이전 상태로 돌아왔어요.',
      })
    })
  },

  async createTag(name, hash) {
    const { repoPath } = get()
    if (!repoPath) return false
    return guard(set, get, async () => {
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
    await guard(set, get, async () => {
      // 이력을 바꾸는 파괴 작업 — 실패해도 낡은 목록을 남기지 않게 스냅샷은 finally로 (discard 관례)
      let notice: string | null = null
      try {
        await git().commits.undoLast(repoPath, hash)
        notice = '마지막 저장을 취소했어요. 바뀐 내용은 왼쪽 변경 목록에 그대로 남아 있어요.'
      } finally {
        set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)), notice })
      }
    })
  },

  async rewordLastCommit(hash, message) {
    const { repoPath } = get()
    if (!repoPath) return false
    return guard(set, get, async () => {
      await git().commits.reword(repoPath, hash, message)
      // HEAD 해시가 바뀐다 — 보던 상세·diff를 비우고 새 목록으로
      set({
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: '저장 메시지를 고쳤어요.',
      })
    })
  },

  async removeBranch(name, force) {
    const { repoPath } = get()
    if (!repoPath) return false
    let needsForce = false
    await guard(set, get, async () => {
      const result = await git().branches.remove(repoPath, name, force)
      needsForce = result.needsForce
      if (result.removed) {
        set({
          ...(await fetchSnapshot(repoPath, get().historyLimit)),
          notice: `"${name}" 실험 공간을 지웠어요.`,
        })
      }
    })
    return needsForce
  },

  async renameBranch(oldName, newName) {
    const { repoPath } = get()
    if (!repoPath) return false
    return guard(set, get, async () => {
      await git().branches.rename(repoPath, oldName, newName)
      set({ ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async updateBranch(name) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
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
    await guard(set, get, async () => {
      await git().branches.backup(repoPath, name)
      // push는 ref를 움직이지 않는다 — 비교 뷰 무효화 불필요 (update와의 비대칭은 의도 — 품질 리뷰)
      set({
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: `"${name}"을 백업(push)했어요.`,
      })
    })
  },

  async compareBranch(name) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      const result = await git().branches.compare(repoPath, name)
      set({ branchCompare: { name, result } })
    })
  },

  clearBranchCompare() {
    set({ branchCompare: null })
  },

  async checkoutRemoteBranch(name) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      const result = await git().branches.checkoutRemote(repoPath, name)
      // 다른 공간이다 — 보던 것들을 비우고 역사도 첫 페이지부터 (switchBranch 관례)
      set({
        historyLimit: HISTORY_LIMIT,
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, HISTORY_LIMIT)),
        notice: result.autoShelved
          ? `원격 "${name}"을 내 공간으로 가져와 이동했어요. 저장 안 된 변경은 보관함에 넣어뒀어요.`
          : `원격 "${name}"을 내 공간으로 가져와 이동했어요.`,
      })
    })
  },

  async removeRemoteBranch(name) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
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
    await guard(set, get, async () => {
      // 자동 보관까지 간 뒤 2차 시도가 실패해도 보관함 카운트가 낡지 않게 — 스냅샷은 finally로 보장 (merge 관례)
      let notice: string | null = null
      try {
        const result = await git().rebase.start(repoPath, name)
        const notices: Record<typeof result.outcome, string | null> = {
          completed: `"${name}" 위로 재배치했어요.`,
          'up-to-date': '이미 그 위에 있어요 — 재배치할 것이 없어요.',
          // 충돌 안내는 rebasing 상태 바가 상주하며 담당한다
          conflict: null,
        }
        const shelfNotice = result.autoShelved ? '저장 안 된 변경은 보관함에 넣어뒀어요.' : ''
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
    await guard(set, get, async () => {
      let notice: string | null = null
      try {
        const result = await git().rebase.continue(repoPath)
        // 다음 충돌 안내는 rebasing 상태 바(진행 M/N)가 담당한다 — 완료만 notice로
        notice = result.outcome === 'completed' ? '재배치를 마쳤어요.' : null
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
    await guard(set, get, async () => {
      await git().rebase.abort(repoPath)
      set({
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: '재배치를 취소하고 이전 상태로 돌아왔어요.',
      })
    })
  },

  async selectConflict(path) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      const content = await git().files.readText(repoPath, path)
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
    // 읽기 전용 재조회 — guard(busy)를 잡지 않아 확인 흐름을 막지 않는다
    try {
      const content = await git().files.readText(repoPath, path)
      set({ conflictFile: { path, content } })
      return content
    } catch (cause) {
      set({ error: toErrorMessage(cause) })
      return null
    }
  },

  async resolveConflict(path, choice) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().conflicts.resolve(repoPath, path, choice)
      set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async markConflictResolved(path) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().conflicts.markResolved(repoPath, path)
      set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async chooseConflictBlock(blockIndex, choice) {
    const { repoPath, conflictFile } = get()
    if (!repoPath || !conflictFile) return
    await guard(set, get, async () => {
      // 외부 편집과의 경합 — 열 때 읽어 둔 내용이 아니라 최신 내용에 적용한다
      const fresh = await git().files.readText(repoPath, conflictFile.path)
      const next = applyBlockChoice(fresh, blockIndex, choice)
      if (next === null) {
        // 그 블록이 더는 없다 — 최신 내용을 보여 주고 다시 고르게 안내한다
        set({
          conflictFile: { path: conflictFile.path, content: fresh },
          notice: '파일이 밖에서 바뀌어 겹침 목록을 새로 불러왔어요. 다시 골라 주세요.',
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
    return await guard(set, get, async () => {
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
    await guard(set, get, async () => {
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
    await guard(set, get, async () => {
      const next = Math.min(historyLimit + HISTORY_PAGE, HISTORY_MAX)
      const more = await git().history.list(repoPath, next)
      set({ history: more, historyLimit: next })
    })
  },

  async revealHead() {
    const { repoPath, status } = get()
    const headHash = status?.headHash ?? null
    if (!repoPath || headHash === null) return
    await guard(set, get, async () => {
      // 큰 저장소에서 HEAD가 한참 아래일 수 있다 — 찾을 때까지 상한을 넓힌다(상한 10회 × 2000)
      let limit = get().historyLimit
      for (let round = 0; round < 10; round += 1) {
        if (get().history.some((commit) => commit.hash === headHash)) return
        limit += 2000
        set({ historyLimit: limit, history: await git().history.list(repoPath, limit) })
      }
    })
  },

  async commit(message) {
    const { repoPath } = get()
    if (!repoPath) return false
    return guard(set, get, async () => {
      await git().commits.create(repoPath, message)
      set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async backup() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().sync.push(repoPath)
      // 백업 후 upstream/ahead/behind가 바뀐다 — 스냅샷 갱신
      set({ ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async refreshPulls() {
    const { repoPath, hostingStatus } = get()
    if (!repoPath || hostingStatus === null || !hostingStatus.connected || hostingStatus.repo === null) {
      return
    }
    await guard(set, get, async () => {
      try {
        set({ pulls: await hosting().pulls.list(repoPath) })
      } catch (cause) {
        // 실패를 빈 목록("없어요")으로 위장하지 않는다 — null은 "못 불러왔어요" 표시 (품질 리뷰)
        set({ pulls: null })
        throw cause
      }
    })
  },

  async connectGh() {
    const { repoPath } = get()
    if (!repoPath) return false
    return guard(set, get, async () => {
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
    return guard(set, get, async () => {
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
    await guard(set, get, async () => {
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
    return guard(set, get, async () => {
      const pull = await hosting().pulls.create(repoPath, { title, body: '' })
      // 백업(push)이 함께 일어났을 수 있다 — 리뷰 목록과 git 스냅샷(ahead/behind)을 함께 갱신한다
      set({
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        pulls: await hosting().pulls.list(repoPath),
        notice: `리뷰 요청 #${pull.number}을 만들었어요. 리뷰 팝오버에서 볼 수 있어요.`,
      })
    })
  },

  async openPull(number) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await hosting().pulls.open(repoPath, number)
    })
  },

  async openPullDetail(number) {
    const { repoPath } = get()
    if (!repoPath) return
    // 팝오버 열기 직후에는 refreshPulls가 busy를 잡고 있다 — 첫 클릭을 조용히 삼키지 않게
    // busy가 풀릴 때까지 잠깐 기다린다(상한 5초 — 넘으면 guard가 재진입 거부로 처리) (품질 리뷰)
    for (let waited = 0; get().busy && waited < 5000; waited += 50) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await guard(set, get, async () => {
      const pullDetail = await hosting().pulls.detail(repoPath, number)
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
    return guard(set, get, async () => {
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
    await guard(set, get, async () => {
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
        notice: `리뷰 요청 #${number}을 승인했어요.`,
      })
    })
  },

  async mergePull() {
    const { repoPath, pullDetail } = get()
    if (!repoPath || pullDetail === null) return false
    return guard(set, get, async () => {
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
        notice: `리뷰 요청 #${number}을 "${base}"에 병합했어요. 로컬은 아직 그대로예요 — 기본 공간에서 받아오기(pull)를 하면 반영돼요.`,
      })
    })
  },
}))
