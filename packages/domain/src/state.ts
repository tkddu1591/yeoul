import type { RepositoryStateKind } from './repository'

/** .git 디렉터리에서 관찰한 사실. 파일 접근은 adapter 계층 책임이다. */
export interface GitDirMarkers {
  mergeHead: boolean
  rebaseMerge: boolean
  rebaseApply: boolean
  cherryPickHead: boolean
  revertHead: boolean
  bisectLog: boolean
}

export function detectState(markers: GitDirMarkers): RepositoryStateKind {
  // rebase 도중 충돌 해결을 위해 MERGE_HEAD 등이 함께 존재할 수 있어 rebase를 먼저 본다
  if (markers.rebaseMerge || markers.rebaseApply) return 'rebasing'
  if (markers.mergeHead) return 'merging'
  if (markers.cherryPickHead) return 'cherry-picking'
  if (markers.revertHead) return 'reverting'
  if (markers.bisectLog) return 'bisecting'
  return 'normal'
}
