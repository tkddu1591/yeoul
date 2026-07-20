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

/** 충돌 블록 하나 — 카드 렌더와 블록 선택(applyBlockChoice)의 단위 */
export interface ConflictBlock {
  /** 파일 안에서 몇 번째 블록인가 (0-based, 지금 남아 있는 블록 기준) */
  index: number
  /** `<<<<<<<` 줄의 원본 라인 위치 (0-based) */
  start: number
  /** `>>>>>>>` 줄의 원본 라인 위치 (0-based) */
  end: number
  /** 내 것(HEAD) 쪽 줄들 */
  ours: string[]
  /** 가져온 것 쪽 줄들 */
  theirs: string[]
}

/** split('\n') 전처리 — 마지막 개행 유무를 기억해 재조립 시 그대로 보존한다 */
function toLines(content: string): { lines: string[]; trailingNewline: boolean } {
  const trailingNewline = content.endsWith('\n')
  const lines = content.split('\n')
  if (trailingNewline) lines.pop()
  return { lines, trailingNewline }
}

/** 완결된 마커 3종 구간만 블록으로 센다 — parseConflictContent와 동일한 상태기계 순서 규칙 */
function findBlocks(lines: string[]): ConflictBlock[] {
  const blocks: ConflictBlock[] = []
  let zone: 'context' | 'ours' | 'theirs' = 'context'
  let start = 0
  let ours: string[] = []
  let theirs: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    if (zone === 'context' && line.startsWith('<<<<<<<')) {
      zone = 'ours'
      start = i
      ours = []
      theirs = []
      continue
    }
    if (zone === 'ours' && line.startsWith('=======')) {
      zone = 'theirs'
      continue
    }
    if (zone === 'theirs' && line.startsWith('>>>>>>>')) {
      blocks.push({ index: blocks.length, start, end: i, ours, theirs })
      zone = 'context'
      continue
    }
    if (zone === 'ours') ours.push(line)
    if (zone === 'theirs') theirs.push(line)
  }
  // EOF까지 닫히지 않은 마커는 블록이 아니다 — 확정 시 hasConflictMarkers 경고가 잡는다
  return blocks
}

/**
 * 충돌 블록 목록 — 완결된 `<<<<<<<`/`=======`/`>>>>>>>` 구간만 블록이다.
 * 순서가 꼬였거나 닫히지 않은 마커는 parseConflictContent와 같은 원칙으로 블록으로 세지 않는다.
 */
export function listConflictBlocks(content: string): ConflictBlock[] {
  return findBlocks(toLines(content).lines)
}

/**
 * blockIndex번째 블록을 한쪽으로 골라 마커 3줄 + 반대쪽을 제거한 새 내용을 만든다.
 * 범위 밖이면 null — 파일이 그새 바뀐 경합이니 호출자가 새로고침을 안내한다.
 * 마지막 줄 개행 유무는 원본 그대로 보존한다(toLines 왕복).
 */
export function applyBlockChoice(
  content: string,
  blockIndex: number,
  choice: 'ours' | 'theirs',
): string | null {
  const { lines, trailingNewline } = toLines(content)
  const block = findBlocks(lines)[blockIndex]
  if (block === undefined) return null
  const chosen = choice === 'ours' ? block.ours : block.theirs
  const next = [...lines.slice(0, block.start), ...chosen, ...lines.slice(block.end + 1)]
  // 파일 전체가 블록이고 고른 쪽이 비면 빈 파일 — ''.join 후 개행만 남는 것을 막는다
  if (next.length === 0) return ''
  return next.join('\n') + (trailingNewline ? '\n' : '')
}

/** 선택형 화면의 렌더 단위 — 일반 줄은 그대로, 블록 하나는 카드 하나(단일 가상 row) */
export type ConflictViewItem =
  | { type: 'line'; text: string }
  | { type: 'block'; block: ConflictBlock }

/** 파일 내용을 카드 뷰 아이템으로 — 블록 구간은 카드 하나로 접고 나머지 줄은 그대로 나열한다 */
export function buildConflictView(content: string): ConflictViewItem[] {
  const { lines } = toLines(content)
  const blocks = findBlocks(lines)
  const items: ConflictViewItem[] = []
  let cursor = 0
  for (const block of blocks) {
    for (let i = cursor; i < block.start; i += 1) items.push({ type: 'line', text: lines[i]! })
    items.push({ type: 'block', block })
    cursor = block.end + 1
  }
  for (let i = cursor; i < lines.length; i += 1) items.push({ type: 'line', text: lines[i]! })
  return items
}
