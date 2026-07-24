/** ⌘F 패널 검색의 매치 계산 (E7h ⑥) — 대소문자 무시 부분 문자열, 정규식 아님 */
export function matchIndices(texts: string[], query: string): number[] {
  if (query === '') return []
  const needle = query.toLowerCase()
  const hits: number[] = []
  texts.forEach((text, index) => {
    if (text.toLowerCase().includes(needle)) hits.push(index)
  })
  return hits
}

/** 현재 위치에서 delta(±1)만큼 순환 이동 — 길이 0이면 -1 */
export function cycleIndex(current: number, delta: number, length: number): number {
  if (length === 0) return -1
  return (((current + delta) % length) + length) % length
}
