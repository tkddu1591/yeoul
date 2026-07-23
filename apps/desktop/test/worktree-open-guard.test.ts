import { describe, expect, it } from 'vitest'
import type { WorktreeInfo } from '@git-gui/domain'
import { assertOpenableWorktree } from '../src/main/worktree-open-guard'

function entry(partial: Partial<WorktreeInfo>): WorktreeInfo {
  return {
    path: '/repo',
    isMain: true,
    branch: 'main',
    headHash: 'a'.repeat(40),
    prunable: false,
    locked: false,
    ...partial,
  }
}

describe('assertOpenableWorktree', () => {
  it('목록에 있는 정상 워크트리는 항목을 돌려준다', () => {
    const list = [entry({}), entry({ path: '/repo-feat', isMain: false, branch: 'feat' })]
    expect(assertOpenableWorktree(list, '/repo-feat').branch).toBe('feat')
  })

  it('목록에 없는 경로는 거부한다 (E7c 보안 가드 유지)', () => {
    expect(() => assertOpenableWorktree([entry({})], '/etc')).toThrow(/이 저장소의 워크트리가 아니에요/)
  })

  it('사라진 폴더(prunable)는 친절 메시지로 거부한다 (E7d ⑥ — 원어 ENOENT 노출 방지)', () => {
    const list = [entry({}), entry({ path: '/repo-gone', isMain: false, prunable: true })]
    expect(() => assertOpenableWorktree(list, '/repo-gone')).toThrow(
      /폴더가 사라진 워크트리예요/,
    )
  })
})
