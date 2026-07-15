export type LineTone = 'add' | 'del' | 'hunk' | 'meta' | 'context'

/**
 * 표시용 diff 라인 분류 — hunk 구조 해석(diff 모델)은 1단계에서 adapter가 맡는다.
 * '---'/'+++' 파일 헤더는 첫 @@ 이전(헤더 구간)에만 나타난다 — 위치 기반으로 구분해
 * '--'로 시작하는 삭제 라인(SQL 주석 등)이나 '++' 추가 라인이 meta로 위장되지 않게 한다.
 */
export function classifyLines(lines: string[]): LineTone[] {
  let inHunk = false
  return lines.map((line) => {
    if (line.startsWith('diff ')) {
      inHunk = false
      return 'meta'
    }
    if (line.startsWith('@@')) {
      inHunk = true
      return 'hunk'
    }
    if (!inHunk) return 'meta'
    if (line.startsWith('\\')) return 'meta'
    if (line.startsWith('+')) return 'add'
    if (line.startsWith('-')) return 'del'
    return 'context'
  })
}
