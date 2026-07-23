import { describe, expect, it } from 'vitest'
import type { FileChange } from '@git-gui/domain'
import { findRevivableChange } from '../src/renderer/src/store/selection-revive'

function change(partial: Partial<FileChange>): FileChange {
  return { path: 'a.txt', origPath: null, staged: null, unstaged: 'modified', ...partial }
}

describe('findRevivableChange', () => {
  it('같은 경로·같은 쪽 변경이 남아 있으면 새 항목을 돌려준다', () => {
    const next = [change({}), change({ path: 'b.txt' })]
    expect(findRevivableChange(next, 'a.txt', false)).toEqual(change({}))
  })

  it('경로가 목록에서 사라졌으면 null (외부 커밋으로 정리됨 — 닫기)', () => {
    expect(findRevivableChange([change({ path: 'b.txt' })], 'a.txt', false)).toBeNull()
  })

  it('보던 쪽(staged/unstaged)의 변경이 사라졌으면 null — 반대쪽만 남은 경우', () => {
    const next = [change({ staged: 'modified', unstaged: null })]
    expect(findRevivableChange(next, 'a.txt', false)).toBeNull()
    expect(findRevivableChange(next, 'a.txt', true)).toEqual(next[0])
  })

  it('충돌로 바뀌었으면 null — diff가 아니라 충돌 화면의 몫', () => {
    const next = [change({ unstaged: 'conflicted' })]
    expect(findRevivableChange(next, 'a.txt', false)).toBeNull()
  })
})
