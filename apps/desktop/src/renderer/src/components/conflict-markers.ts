/** 충돌 파일의 한 줄 — 마커 구간을 색으로 구분해 렌더하기 위한 분류 */
export interface ConflictRow {
  kind: 'context' | 'marker-ours' | 'ours' | 'marker-sep' | 'theirs' | 'marker-theirs'
  text: string
}

/**
 * 충돌 마커(<<<<<<< / ======= / >>>>>>>)를 구간으로 분류한다.
 * 비정상 순서의 마커는 죽지 않고 context로 취급한다(파일을 있는 그대로 보여주는 게 우선).
 */
export function parseConflictContent(content: string): ConflictRow[] {
  const lines = content.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  const rows: ConflictRow[] = []
  let zone: 'context' | 'ours' | 'theirs' = 'context'
  for (const line of lines) {
    if (zone === 'context' && line.startsWith('<<<<<<<')) {
      rows.push({ kind: 'marker-ours', text: line })
      zone = 'ours'
      continue
    }
    if (zone === 'ours' && line.startsWith('=======')) {
      rows.push({ kind: 'marker-sep', text: line })
      zone = 'theirs'
      continue
    }
    if (zone === 'theirs' && line.startsWith('>>>>>>>')) {
      rows.push({ kind: 'marker-theirs', text: line })
      zone = 'context'
      continue
    }
    rows.push({ kind: zone === 'context' ? 'context' : zone, text: line })
  }
  return rows
}

/** 충돌 블록이 남아 있는가 — "직접 수정했어요" 확인창 경고에 쓴다 */
export function hasConflictMarkers(content: string): boolean {
  return parseConflictContent(content).some((row) => row.kind === 'marker-ours')
}
