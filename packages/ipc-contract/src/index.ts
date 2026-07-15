import type { RepositoryStatus } from '@git-gui/domain'

export interface DiffOptions {
  staged: boolean
  untracked: boolean
}

/** preload가 contextBridge로 노출하고 renderer가 사용하는 API 표면 */
export interface GitApi {
  repo: {
    /** 폴더 선택 다이얼로그. 취소하면 null */
    select(): Promise<string | null>
    /** E2E 등에서 환경 변수로 주입한 초기 저장소 경로 */
    initialPath(): Promise<string | null>
    status(repoPath: string): Promise<RepositoryStatus>
  }
  changes: {
    stage(repoPath: string, paths: string[]): Promise<void>
    unstage(repoPath: string, paths: string[]): Promise<void>
    diff(repoPath: string, path: string, options: DiffOptions): Promise<string>
  }
  commits: {
    create(repoPath: string, message: string): Promise<void>
  }
}

export const GIT_API_KEY = 'gitApi' as const

export const CHANNELS = {
  repoSelect: 'repo:select',
  repoInitialPath: 'repo:initial-path',
  repoStatus: 'repo:status',
  changesStage: 'changes:stage',
  changesUnstage: 'changes:unstage',
  changesDiff: 'changes:diff',
  commitsCreate: 'commits:create',
} as const
