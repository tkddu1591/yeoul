import { describe, expect, it } from 'vitest'
import type { DiffHunk, DiffLine } from '@git-gui/domain'
import { buildDiffRows } from '../src/renderer/src/components/diff-rows'

function line(kind: DiffLine['kind'], text: string): DiffLine {
  return { kind, oldLine: kind === 'add' ? null : 1, newLine: kind === 'del' ? null : 1, text }
}

describe('buildDiffRows', () => {
  const hunks: DiffHunk[] = [
    { header: '@@ -1,2 +1,2 @@', lines: [line('context', 'a'), line('del', 'b'), line('add', 'c')] },
    { header: '@@ -10,1 +10,1 @@', lines: [line('context', 'z')] },
  ]

  it('unified — hunk 헤더 행과 라인 행을 순서대로 평탄화한다', () => {
    const rows = buildDiffRows(hunks, 'unified')
    expect(rows.map((r) => r.kind)).toEqual(['hunk', 'line', 'line', 'line', 'hunk', 'line'])
    expect(rows[0]).toEqual({ kind: 'hunk', header: '@@ -1,2 +1,2 @@' })
    expect(rows[1]).toEqual({ kind: 'line', line: hunks[0]!.lines[0]! })
  })

  it('split — pairHunkLines 결과를 행으로 평탄화한다 (del|add가 한 행)', () => {
    const rows = buildDiffRows(hunks, 'split')
    expect(rows.map((r) => r.kind)).toEqual(['hunk', 'split', 'split', 'hunk', 'split'])
    const paired = rows[2]!
    if (paired.kind !== 'split') throw new Error('unreachable')
    expect(paired.left?.kind).toBe('del')
    expect(paired.right?.kind).toBe('add')
  })

  it('빈 hunks면 빈 배열', () => {
    expect(buildDiffRows([], 'unified')).toEqual([])
  })
})
