import { create } from 'zustand'
import type {
  CommitDetail,
  CommitFileChange,
  CommitSummary,
  FileChange,
  FileDiff,
  RepositoryStatus,
} from '@git-gui/domain'

const git = () => window.gitApi

/** 히스토리 첫 페이지 크기 — 스크롤 끝에서 HISTORY_PAGE씩 상한을 늘려 다시 불러온다 (⑩) */
export const HISTORY_LIMIT = 50
const HISTORY_PAGE = 200
/** IPC assertLimit와 동일한 상한 — 이 이상은 더 불러오지 않는다 */
const HISTORY_MAX = 10000

export interface SelectedFile {
  change: FileChange
  staged: boolean
}

interface RepositoryStore {
  repoPath: string | null
  status: RepositoryStatus | null
  history: CommitSummary[]
  /** 현재 히스토리 조회 상한 — history.length >= historyLimit이면 뒤가 더 있을 수 있다 */
  historyLimit: number
  selected: SelectedFile | null
  diff: FileDiff | null
  /** 커밋 클릭 상세 — 열려 있으면 중앙 패널이 커밋 상세로 바뀐다. 파일 diff 선택과 상호 배타 */
  commitDetail: CommitDetail | null
  /** 커밋 상세 안에서 선택된 파일 — diff는 공용 diff 슬롯을 쓴다 */
  commitFile: CommitFileChange | null
  error: string | null
  busy: boolean

  init(): Promise<void>
  openRepository(): Promise<void>
  refresh(): Promise<void>
  stage(paths: string[]): Promise<void>
  unstage(paths: string[]): Promise<void>
  /** 선택 파일 변경 취소 — 확인창(UI 책임)을 통과한 뒤에만 호출된다. 되돌릴 수 없다 (⑪) */
  discard(trackedPaths: string[], untrackedPaths: string[]): Promise<void>
  selectFile(selected: SelectedFile): Promise<void>
  /** diff 선택 해제 — 동기 상태 변경이라 guard 불필요 */
  clearSelection(): void
  selectCommit(hash: string): Promise<void>
  selectCommitFile(file: CommitFileChange): Promise<void>
  /** 커밋 상세 닫기 — 동기 상태 변경이라 guard 불필요 */
  clearCommit(): void
  /** 스크롤 끝에서 히스토리 상한을 늘려 다시 불러온다 (⑩) */
  loadMoreHistory(): Promise<void>
  /** 성공 여부를 반환한다 — 실패 시 입력 메시지를 보존하기 위해 */
  commit(message: string): Promise<boolean>
  backup(): Promise<void>
}

/** IPC 에러 메시지의 Electron 래핑 접두사를 벗겨 사용자 메시지만 남긴다 (GitError 등 커스텀 이름 포함) */
function toErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
}

/** 상태와 역사를 동시 조회해 같은 렌더에 함께 갱신한다 — 시점 차이를 최소화 (원자 스냅샷은 아님) */
async function fetchSnapshot(
  repoPath: string,
  limit: number,
): Promise<Pick<RepositoryStore, 'status' | 'history'>> {
  const [status, history] = await Promise.all([
    git().repo.status(repoPath),
    git().history.list(repoPath, limit),
  ])
  return { status, history }
}

/** 선택 상태 일괄 해제 — 저장소 내용이 바뀌는 모든 지점에서 보던 diff·상세를 무효화한다 */
const CLEAR_SELECTIONS = {
  selected: null,
  diff: null,
  commitDetail: null,
  commitFile: null,
} as const

type StoreSet = (partial: Partial<RepositoryStore>) => void
type StoreGet = () => RepositoryStore

/** busy 재진입을 거부하고 busy/error 처리를 일원화한다. 성공 여부를 반환한다 */
async function guard(set: StoreSet, get: StoreGet, run: () => Promise<void>): Promise<boolean> {
  if (get().busy) return false
  set({ busy: true, error: null })
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
  historyLimit: HISTORY_LIMIT,
  selected: null,
  diff: null,
  commitDetail: null,
  commitFile: null,
  error: null,
  busy: false,

  async init() {
    await guard(set, get, async () => {
      const initial = await git().repo.initialPath()
      if (!initial) return
      set({ repoPath: initial, ...(await fetchSnapshot(initial, get().historyLimit)) })
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

  async selectFile(selected) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      const untracked = selected.change.unstaged === 'untracked'
      const diff = await git().changes.diff(repoPath, selected.change.path, {
        staged: selected.staged,
        untracked,
        // staged rename은 원래 경로를 동봉해야 rename으로 표시된다 (unstage와 대칭)
        origPath: selected.staged ? selected.change.origPath : null,
      })
      // 파일 diff와 커밋 상세는 상호 배타 — 중앙 패널이 하나다
      set({ selected, diff, commitDetail: null, commitFile: null })
    })
  },

  clearSelection() {
    set({ selected: null, diff: null })
  },

  async selectCommit(hash) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      const commitDetail = await git().commits.show(repoPath, hash)
      set({ commitDetail, commitFile: null, selected: null, diff: null })
    })
  },

  async selectCommitFile(file) {
    const { repoPath, commitDetail } = get()
    if (!repoPath || !commitDetail) return
    await guard(set, get, async () => {
      const diff = await git().commits.diffFile(repoPath, commitDetail.hash, file.path, file.origPath)
      set({ diff, commitFile: file })
    })
  },

  clearCommit() {
    set({ commitDetail: null, commitFile: null, diff: null })
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
}))
