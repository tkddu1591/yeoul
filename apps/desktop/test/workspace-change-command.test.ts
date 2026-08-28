import { describe, expect, it } from 'vitest'
import type { FileChange } from '@git-gui/domain'
import { workspaceChangeCommand } from '../src/renderer/src/store/workspace-change-command'

const renamed: FileChange = {
  path: 'new-name.ts',
  origPath: 'old-name.ts',
  staged: 'renamed',
  unstaged: null,
}

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
