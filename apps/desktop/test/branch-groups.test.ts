import { describe, expect, it } from 'vitest'
import type { BranchSummary } from '@git-gui/domain'
import { branchDisplayName, groupBranches } from '../src/renderer/src/components/branch-groups'

const b = (name: string, committedAt = 0): BranchSummary => ({
  name,
  isCurrent: false,
  committedAt,
  upstream: null,
})

describe('groupBranches', () => {
  it("'/' 없는 브랜치는 loose, 있는 브랜치는 첫 조각 폴더로 묶는다", () => {
    const grouped = groupBranches([b('main'), b('feature/a'), b('fix/x'), b('feature/b')])
    expect(grouped.loose.map((x) => x.name)).toEqual(['main'])
    expect(grouped.folders.map((f) => f.name)).toEqual(['feature', 'fix'])
    expect(grouped.folders[0]!.branches.map((x) => x.name)).toEqual(['feature/a', 'feature/b'])
  })

  it('폴더 순서는 폴더의 첫 등장 위치를 따른다 (입력은 최근 커밋순)', () => {
    const grouped = groupBranches([b('fix/hot'), b('feature/a'), b('fix/old')])
    expect(grouped.folders.map((f) => f.name)).toEqual(['fix', 'feature'])
  })

  it('깊은 경로는 첫 조각으로만 묶고 나머지는 표시 이름에 남긴다', () => {
    const grouped = groupBranches([b('feature/ui/dark')])
    expect(grouped.folders[0]!.name).toBe('feature')
    expect(branchDisplayName('feature/ui/dark')).toBe('ui/dark')
  })

  it("'/' 없는 이름의 표시 이름은 그대로다", () => {
    expect(branchDisplayName('main')).toBe('main')
  })
})
