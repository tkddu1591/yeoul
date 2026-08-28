import type { FileChange } from '@git-gui/domain'
import type { WorkspaceRepository } from '@git-gui/ipc-contract'

export interface WorkspaceChangeGroup {
  repository: WorkspaceRepository
  changes: FileChange[]
}

export interface WorkspaceChangeEntry {
  repository: WorkspaceRepository
  change: FileChange
  staged: boolean
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

function getSelectionKey(entry: WorkspaceChangeEntry): string {
  return JSON.stringify([entry.repository.path, entry.staged, entry.change.path])
}

function toGroupList(entries: WorkspaceChangeEntry[]): WorkspaceChangeGroup[] {
  const groups = new Map<string, WorkspaceChangeGroup>()
  for (const entry of entries) {
    const group = groups.get(entry.repository.path)
    if (group === undefined) {
      groups.set(entry.repository.path, {
        repository: entry.repository,
        changes: [entry.change],
      })
      continue
    }
    group.changes.push(entry.change)
  }
  return [...groups.values()]
}

/** 멀티레포 변경 명령의 도메인 입력을 Git pathspec 목록으로 바꾸는 경계. */
export const workspaceChangeCommand = {
  group: {
    toList: toGroupList,
  },
  path: {
    toList: toPathList,
  },
  selection: {
    key: {
      get: getSelectionKey,
    },
  },
}
