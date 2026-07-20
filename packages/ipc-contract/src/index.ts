import type {
  BranchSummary,
  CommitDetail,
  CommitSummary,
  DiffOptions,
  FileDiff,
  MergeResult,
  PullResult,
  RemoveBranchResult,
  RepositoryStatus,
  RevertResult,
  ShelfEntry,
  SwitchResult,
} from '@git-gui/domain'

export type { DiffOptions } from '@git-gui/domain'

/**
 * preload가 contextBridge로 노출하고 renderer가 사용하는 API 표면.
 *
 * 신뢰 규칙: `repoPath`는 repo.select() 또는 repo.initialPath()가 반환한 값만 유효하다 —
 * main은 자신이 돌려준 경로만 allowlist로 신뢰하고 그 외는 거부한다.
 * 파일 `path`는 저장소 루트 상대 경로만 허용된다 (절대 경로·`..`·빈 문자열 거부).
 */
export interface GitApi {
  repo: {
    /** 폴더 선택 다이얼로그. 취소하면 null. 반환 경로는 저장소 루트로 정규화된다 */
    select(): Promise<string | null>
    /** E2E 등에서 환경 변수로 주입한 초기 저장소 경로. 반환 경로는 저장소 루트로 정규화된다 */
    initialPath(): Promise<string | null>
    status(repoPath: string): Promise<RepositoryStatus>
  }
  branches: {
    list(repoPath: string): Promise<BranchSummary[]>
    /** fromHash는 40자 hex 전체 해시 또는 null(지금 위치에서) */
    create(repoPath: string, name: string, fromHash: string | null): Promise<void>
    switch(repoPath: string, name: string): Promise<SwitchResult>
    /** name 공간을 지금 공간으로 합친다(스마트 병합) — conflict면 충돌 상태가 남는다 */
    merge(repoPath: string, name: string): Promise<MergeResult>
    remove(repoPath: string, name: string, force: boolean): Promise<RemoveBranchResult>
    rename(repoPath: string, oldName: string, newName: string): Promise<void>
  }
  merge: {
    abort(repoPath: string): Promise<void>
  }
  conflicts: {
    /** choice는 'ours'(내 것 유지) | 'theirs'(가져온 것 사용)만 허용된다 */
    resolve(repoPath: string, path: string, choice: 'ours' | 'theirs'): Promise<void>
    markResolved(repoPath: string, path: string): Promise<void>
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
  }
  commits: {
    create(repoPath: string, message: string): Promise<void>
    /** 커밋 상세 — hash는 40자 hex 전체 해시만 허용된다 */
    show(repoPath: string, hash: string): Promise<CommitDetail>
    /** 커밋 안 단일 파일 diff — 첫 부모 기준. rename이면 origPath 동봉 */
    diffFile(repoPath: string, hash: string, path: string, origPath: string | null): Promise<FileDiff>
    revert(repoPath: string, hash: string): Promise<RevertResult>
    revertAbort(repoPath: string): Promise<void>
  }
  history: {
    /** 최신순 커밋 요약. limit은 1~10000 정수 — 범위 밖은 IPC에서 거부된다 (adapter의 clamp는 심층 방어) */
    list(repoPath: string, limit: number): Promise<CommitSummary[]>
  }
  sync: {
    /** 현재 브랜치를 원격으로 백업(push). 원격이 없으면 에러 */
    push(repoPath: string): Promise<void>
    /** 원격의 최신 저장을 받아온다 — conflict면 기존 합치기 충돌 흐름이 이어진다 */
    pull(repoPath: string): Promise<PullResult>
  }
}

export const GIT_API_KEY = 'gitApi' as const

export const CHANNELS = {
  repoSelect: 'repo:select',
  repoInitialPath: 'repo:initial-path',
  repoStatus: 'repo:status',
  branchesList: 'branches:list',
  branchesCreate: 'branches:create',
  branchesSwitch: 'branches:switch',
  branchesMerge: 'branches:merge',
  branchesRemove: 'branches:remove',
  branchesRename: 'branches:rename',
  mergeAbort: 'merge:abort',
  conflictsResolve: 'conflicts:resolve',
  conflictsMarkResolved: 'conflicts:mark-resolved',
  filesReadText: 'files:read-text',
  shelfSave: 'shelf:save',
  shelfList: 'shelf:list',
  shelfRestore: 'shelf:restore',
  shelfDrop: 'shelf:drop',
  changesStage: 'changes:stage',
  changesUnstage: 'changes:unstage',
  changesDiscard: 'changes:discard',
  changesDiff: 'changes:diff',
  commitsCreate: 'commits:create',
  commitsShow: 'commits:show',
  commitsDiffFile: 'commits:diff-file',
  commitsRevert: 'commits:revert',
  commitsRevertAbort: 'commits:revert-abort',
  historyList: 'history:list',
  syncPush: 'sync:push',
  syncPull: 'sync:pull',
} as const

/**
 * 렌더러가 기억해야 하는 소량 설정. file:// origin의 localStorage는 앱 재시작 간
 * 유지되지 않아(실측) main이 userData/settings.json으로 영속화한다.
 */
export interface AppSettings {
  theme?: 'light' | 'dark'
  rightWidth?: number
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
