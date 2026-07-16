import type { DiffLine } from '@git-gui/domain'

export interface SplitRow {
  left: DiffLine | null
  right: DiffLine | null
}

/**
 * hunk 라인을 좌(변경 전)/우(변경 후) 행으로 짝짓는다.
 * 연속된 del 런과 그 뒤의 add 런을 순서대로 zip — 남는 쪽은 반대편을 비운다.
 */
export function pairHunkLines(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let index = 0
  while (index < lines.length) {
    const current = lines[index]!
    if (current.kind === 'context' || current.kind === 'note') {
      rows.push({ left: current, right: current })
      index += 1
      continue
    }
    const dels: DiffLine[] = []
    while (index < lines.length && lines[index]!.kind === 'del') {
      dels.push(lines[index]!)
      index += 1
    }
    const adds: DiffLine[] = []
    while (index < lines.length && lines[index]!.kind === 'add') {
      adds.push(lines[index]!)
      index += 1
    }
    const rowCount = Math.max(dels.length, adds.length)
    for (let i = 0; i < rowCount; i += 1) {
      rows.push({ left: dels[i] ?? null, right: adds[i] ?? null })
    }
  }
  return rows
}
