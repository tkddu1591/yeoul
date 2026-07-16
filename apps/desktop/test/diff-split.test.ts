import { describe, expect, it } from 'vitest'
import type { DiffLine } from '@git-gui/domain'
import { pairHunkLines } from '../src/renderer/src/components/diff-split'

function line(kind: DiffLine['kind'], text: string): DiffLine {
  return { kind, oldLine: kind === 'add' || kind === 'note' ? null : 1, newLine: kind === 'del' || kind === 'note' ? null : 1, text }
}

describe('pairHunkLines', () => {
  it('context는 양쪽에 놓인다', () => {
    const rows = pairHunkLines([line('context', 'same')])
    expect(rows).toEqual([{ left: line('context', 'same'), right: line('context', 'same') }])
  })

  it('del 다음 add 런은 순서대로 짝지어진다', () => {
    const rows = pairHunkLines([
      line('del', 'a'),
      line('del', 'b'),
      line('add', 'A'),
      line('add', 'B'),
    ])
    expect(rows).toEqual([
      { left: line('del', 'a'), right: line('add', 'A') },
      { left: line('del', 'b'), right: line('add', 'B') },
    ])
  })

  it('짝이 남으면 한쪽이 비어 있다', () => {
    const rows = pairHunkLines([line('del', 'a'), line('add', 'A'), line('add', 'B')])
    expect(rows).toEqual([
      { left: line('del', 'a'), right: line('add', 'A') },
      { left: null, right: line('add', 'B') },
    ])
  })

  it('add만 있으면 왼쪽이 비고, del만 있으면 오른쪽이 빈다', () => {
    expect(pairHunkLines([line('add', 'A')])).toEqual([{ left: null, right: line('add', 'A') }])
    expect(pairHunkLines([line('del', 'a')])).toEqual([{ left: line('del', 'a'), right: null }])
  })

  it('note는 양쪽에 걸치는 단독 행이다', () => {
    const rows = pairHunkLines([line('note', '\\ No newline at end of file')])
    expect(rows).toEqual([
      { left: line('note', '\\ No newline at end of file'), right: line('note', '\\ No newline at end of file') },
    ])
  })

  it("del 런 뒤 note는 왼쪽, add 런 뒤 note는 오른쪽에 붙는다 (no-eol 실제 순서)", () => {
    const rows = pairHunkLines([
      line('del', 'old last'),
      line('note', '\\ No newline at end of file'),
      line('add', 'new last'),
      line('note', '\\ No newline at end of file'),
    ])
    expect(rows).toEqual([
      { left: line('del', 'old last'), right: line('add', 'new last') },
      {
        left: line('note', '\\ No newline at end of file'),
        right: line('note', '\\ No newline at end of file'),
      },
    ])
  })
})
