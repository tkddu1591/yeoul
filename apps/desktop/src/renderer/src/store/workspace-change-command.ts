import type { FileChange } from '@git-gui/domain'
import type { WorkspaceRepository } from '@git-gui/ipc-contract'

export interface WorkspaceChangeGroup {
  repository: WorkspaceRepository
  changes: FileChange[]
}

export interface WorkspaceChangeMoveRequest {
  target: 'staged' | 'unstaged'
  groups: WorkspaceChangeGroup[]
}

function toPathList(changes: FileChange[], target: WorkspaceChangeMoveRequest['target']): string[] {
  return changes.flatMap((change) =>
    target === 'unstaged' && change.staged === 'renamed' && change.origPath !== null
      ? [change.path, change.origPath]
      : [change.path],
  )
}

/** 멀티레포 변경 명령의 도메인 입력을 Git pathspec 목록으로 바꾸는 경계. */
export const workspaceChangeCommand = {
  path: {
    toList: toPathList,
  },
}
