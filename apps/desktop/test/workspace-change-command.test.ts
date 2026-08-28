import { describe, expect, it } from 'vitest'
import type { FileChange } from '@git-gui/domain'
import type { WorkspaceRepository } from '@git-gui/ipc-contract'
import { workspaceChangeCommand } from '../src/renderer/src/store/workspace-change-command'

const renamed: FileChange = {
  path: 'new-name.ts',
  origPath: 'old-name.ts',
  staged: 'renamed',
  unstaged: null,
}

const modified: FileChange = {
  path: 'src/app.ts',
  origPath: null,
  staged: 'modified',
  unstaged: 'modified',
}

const back: WorkspaceRepository = { path: '/workspace/back', relativePath: 'back', name: 'back' }
const front: WorkspaceRepository = { path: '/workspace/front', relativePath: 'front', name: 'front' }

describe('workspaceChangeCommand.path.toList', () => {
  it('올리기는 표시 경로만 Git pathspec으로 만든다', () => {
    expect(workspaceChangeCommand.path.toList([renamed], 'staged')).toEqual(['new-name.ts'])
  })

  it('이름 변경을 내릴 때는 새 경로와 원래 경로를 함께 보낸다', () => {
    expect(workspaceChangeCommand.path.toList([renamed], 'unstaged')).toEqual([
      'new-name.ts',
      'old-name.ts',
    ])
  })
})

describe('workspaceChangeCommand.selection.key.get', () => {
  it('같은 파일도 저장 예정 여부와 저장소가 다르면 별도 선택으로 구분한다', () => {
    const unstaged = workspaceChangeCommand.selection.key.get({ repository: back, change: modified, staged: false })
    const staged = workspaceChangeCommand.selection.key.get({ repository: back, change: modified, staged: true })
    const otherRepository = workspaceChangeCommand.selection.key.get({
      repository: front,
      change: modified,
      staged: false,
    })

    expect(new Set([unstaged, staged, otherRepository]).size).toBe(3)
  })
})

describe('workspaceChangeCommand.group.toList', () => {
  it('선택한 변경을 저장소별 명령 그룹으로 묶는다', () => {
    expect(
      workspaceChangeCommand.group.toList([
        { repository: back, change: modified, staged: false },
        { repository: front, change: renamed, staged: true },
      ]),
    ).toEqual([
      { repository: back, changes: [modified] },
      { repository: front, changes: [renamed] },
    ])
  })
})
