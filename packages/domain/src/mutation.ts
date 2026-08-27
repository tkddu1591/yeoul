export interface FileRevision {
  path: string
  /** 워킹트리 파일의 내용·종류 fingerprint. 파일이 없으면 `missing`. */
  worktree: string
  /** index entry 원문. 추적되지 않았으면 빈 문자열. */
  index: string
}

export interface FileMutationGuard {
  files: FileRevision[]
}

export interface DiscardChangesRequest {
  trackedPaths: string[]
  untrackedPaths: string[]
  guard: FileMutationGuard
}

export interface RemoveFileRequest {
  path: string
  guard: FileMutationGuard
}
