import type { DiffHunk, DiffLine } from '@git-gui/domain'
import { diffSplitAdapter } from './diff-split.adapter'

/** 가상화를 위해 hunk 중첩 구조를 한 층의 행 배열로 편다 — 행 하나가 가상 아이템 하나다 */
export type DiffRow =
  | { kind: 'hunk'; hunk: DiffHunk }
  | { kind: 'line'; hunk: DiffHunk; line: DiffLine; lineIndex: number }
  | {
      kind: 'split'
      hunk: DiffHunk
      left: DiffLine | null
      right: DiffLine | null
      leftIndex: number
      rightIndex: number
    }

function toRows(hunks: DiffHunk[], view: 'unified' | 'split'): DiffRow[] {
  const rows: DiffRow[] = []
  for (const hunk of hunks) {
    rows.push({ kind: 'hunk', hunk })
    if (view === 'unified') {
      hunk.lines.forEach((line, lineIndex) => rows.push({ kind: 'line', hunk, line, lineIndex }))
    } else {
      const indices = new Map(hunk.lines.map((line, index) => [line, index]))
      for (const pair of diffSplitAdapter.hunk.pair(hunk.lines)) {
        rows.push({
          kind: 'split',
          hunk,
          left: pair.left,
          right: pair.right,
          leftIndex: pair.left ? indices.get(pair.left)! : -1,
          rightIndex: pair.right ? indices.get(pair.right)! : -1,
        })
      }
    }
  }
  return rows
}

export const diffRowsAdapter = { row: { toList: toRows } }
