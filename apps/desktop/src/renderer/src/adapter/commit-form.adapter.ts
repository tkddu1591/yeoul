import { suggestCommitMessage, type RepositoryStatus } from '@git-gui/domain'

export interface CommitFormModel {
  target: { path: string; name: string; branch: string }
  stagedCount: number
  conflicts: number
  merging: boolean
  suggestion: string
}
function from(path: string, status: RepositoryStatus | null): CommitFormModel {
  const stagedCount = status?.changes.filter((file) => file.staged !== null).length ?? 0
  const merging = status?.state === 'merging'
  return {
    target: {
      path,
      name: path.split('/').pop() ?? path,
      branch: status?.branch.name ?? '분리 HEAD',
    },
    stagedCount,
    conflicts: status?.changes.filter((file) => file.unstaged === 'conflicted').length ?? 0,
    merging,
    suggestion:
      merging && stagedCount === 0 ? '브랜치 병합' : suggestCommitMessage(status?.changes ?? []),
  }
}
export const commitFormAdapter = { model: { from } }
