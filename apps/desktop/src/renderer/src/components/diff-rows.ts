import type { DiffHunk, DiffLine } from '@git-gui/domain'
import { pairHunkLines } from './diff-split'

/** 가상화를 위해 hunk 중첩 구조를 한 층의 행 배열로 편다 — 행 하나가 가상 아이템 하나다 */
export type DiffRow =
  | { kind: 'hunk'; hunk: DiffHunk }
  | { kind: 'line'; hunk: DiffHunk; line: DiffLine; lineIndex: number }
  | { kind: 'split'; left: DiffLine | null; right: DiffLine | null }

export function buildDiffRows(hunks: DiffHunk[], view: 'unified' | 'split'): DiffRow[] {
  const rows: DiffRow[] = []
  for (const hunk of hunks) {
    rows.push({ kind: 'hunk', hunk })
    if (view === 'unified') {
      hunk.lines.forEach((line, lineIndex) => rows.push({ kind: 'line', hunk, line, lineIndex }))
    } else {
      for (const pair of pairHunkLines(hunk.lines)) {
        rows.push({ kind: 'split', left: pair.left, right: pair.right })
      }
    }
  }
  return rows
}
