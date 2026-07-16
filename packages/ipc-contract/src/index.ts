import type {
  CommitDetail,
  CommitSummary,
  DiffOptions,
  FileDiff,
  RepositoryStatus,
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
  }
  history: {
    /** 최신순 커밋 요약. limit은 1~10000 정수 — 범위 밖은 IPC에서 거부된다 (adapter의 clamp는 심층 방어) */
    list(repoPath: string, limit: number): Promise<CommitSummary[]>
  }
  sync: {
    /** 현재 브랜치를 원격으로 백업(push). 원격이 없으면 에러 */
    push(repoPath: string): Promise<void>
  }
}

export const GIT_API_KEY = 'gitApi' as const

export const CHANNELS = {
  repoSelect: 'repo:select',
  repoInitialPath: 'repo:initial-path',
  repoStatus: 'repo:status',
  changesStage: 'changes:stage',
  changesUnstage: 'changes:unstage',
  changesDiscard: 'changes:discard',
  changesDiff: 'changes:diff',
  commitsCreate: 'commits:create',
  commitsShow: 'commits:show',
  commitsDiffFile: 'commits:diff-file',
  historyList: 'history:list',
  syncPush: 'sync:push',
} as const
