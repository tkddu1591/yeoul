import type { DiffLine } from '@git-gui/domain'

export interface SplitRow {
  left: DiffLine | null
  right: DiffLine | null
}

/**
 * hunk 라인을 좌(변경 전)/우(변경 후) 행으로 짝짓는다.
 * 연속된 del 런과 그 뒤의 add 런을 순서대로 zip — 남는 쪽은 반대편을 비운다.
 * '\ No newline' note는 실제 git 출력에서 del 런과 add 런 "사이"에 온다 —
 * 런 뒤의 note를 해당 측에 귀속시켜 변경 쌍의 좌우 정렬이 깨지지 않게 한다.
 */
export function pairHunkLines(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let index = 0
  while (index < lines.length) {
    const current = lines[index]!
    if (current.kind === 'context') {
      rows.push({ left: current, right: current })
      index += 1
      continue
    }
    if (current.kind === 'note') {
      // 런 밖의 note(context 뒤 등) — 양쪽에 걸치는 단독 행
      rows.push({ left: current, right: current })
      index += 1
      continue
    }
    const dels: DiffLine[] = []
    while (index < lines.length && lines[index]!.kind === 'del') {
      dels.push(lines[index]!)
      index += 1
    }
    const leftNotes: DiffLine[] = []
    if (dels.length > 0) {
      while (index < lines.length && lines[index]!.kind === 'note') {
        leftNotes.push(lines[index]!)
        index += 1
      }
    }
    const adds: DiffLine[] = []
    while (index < lines.length && lines[index]!.kind === 'add') {
      adds.push(lines[index]!)
      index += 1
    }
    const rightNotes: DiffLine[] = []
    if (adds.length > 0) {
      while (index < lines.length && lines[index]!.kind === 'note') {
        rightNotes.push(lines[index]!)
        index += 1
      }
    }
    const rowCount = Math.max(dels.length, adds.length)
    for (let i = 0; i < rowCount; i += 1) {
      rows.push({ left: dels[i] ?? null, right: adds[i] ?? null })
    }
    // note는 실제로 한쪽 파일에만 해당한다 — 소속 측에만 배치
    const noteRows = Math.max(leftNotes.length, rightNotes.length)
    for (let i = 0; i < noteRows; i += 1) {
      rows.push({ left: leftNotes[i] ?? null, right: rightNotes[i] ?? null })
    }
  }
  return rows
}
