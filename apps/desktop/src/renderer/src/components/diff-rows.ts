import type { DiffHunk, DiffLine } from '@git-gui/domain'
import { pairHunkLines } from './diff-split'

/** 가상화를 위해 hunk 중첩 구조를 한 층의 행 배열로 편다 — 행 하나가 가상 아이템 하나다 */
export type DiffRow =
  | { kind: 'hunk'; header: string }
  | { kind: 'line'; line: DiffLine }
  | { kind: 'split'; left: DiffLine | null; right: DiffLine | null }

export function buildDiffRows(hunks: DiffHunk[], view: 'unified' | 'split'): DiffRow[] {
  const rows: DiffRow[] = []
  for (const hunk of hunks) {
    rows.push({ kind: 'hunk', header: hunk.header })
    if (view === 'unified') {
      for (const line of hunk.lines) rows.push({ kind: 'line', line })
    } else {
      for (const pair of pairHunkLines(hunk.lines)) {
        rows.push({ kind: 'split', left: pair.left, right: pair.right })
      }
    }
  }
  return rows
}
