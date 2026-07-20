import { describe, expect, it } from 'vitest'
import {
  applyBlockChoice,
  buildConflictView,
  listConflictBlocks,
  parseConflictContent,
} from '../src/renderer/src/components/conflict-markers'

const SAMPLE = [
  'line1',
  '<<<<<<< HEAD',
  'MINE',
  '=======',
  'THEIRS',
  '>>>>>>> feat',
  'line3',
].join('\n')

describe('parseConflictContent', () => {
  it('마커 구간을 내 것/가져온 것으로 분류한다', () => {
    const rows = parseConflictContent(SAMPLE)
    expect(rows.map((r) => r.kind)).toEqual([
      'context',
      'marker-ours',
      'ours',
      'marker-sep',
      'theirs',
      'marker-theirs',
      'context',
    ])
    expect(rows[1]!.text).toBe('<<<<<<< HEAD')
    expect(rows[2]!.text).toBe('MINE')
    expect(rows[4]!.text).toBe('THEIRS')
  })

  it('마커가 없으면 전부 context — hasConflictMarkers는 false', () => {
    const rows = parseConflictContent('a\nb\n')
    expect(rows.every((r) => r.kind === 'context')).toBe(true)
  })

  it('충돌 블록 수를 센다', () => {
    const twice = `${SAMPLE}\nmid\n${SAMPLE}`
    const rows = parseConflictContent(twice)
    expect(rows.filter((r) => r.kind === 'marker-ours')).toHaveLength(2)
  })

  it('중첩·비정상 마커에서도 죽지 않는다 — 알 수 없는 구간은 context로', () => {
    const weird = '=======\n>>>>>>> x\nplain\n'
    const rows = parseConflictContent(weird)
    expect(rows).toHaveLength(3)
    expect(rows[2]!.kind).toBe('context')
  })
})

/** 떨어진 두 변경 — 블록 2개, 마지막 개행 있음 */
const TWO_BLOCKS = [
  'top',
  '<<<<<<< HEAD',
  'mine-1',
  '=======',
  'theirs-1',
  '>>>>>>> rival',
  'mid-a',
  'mid-b',
  'mid-c',
  '<<<<<<< HEAD',
  'mine-2a',
  'mine-2b',
  '=======',
  'theirs-2',
  '>>>>>>> rival',
  'bottom',
  '',
].join('\n')

describe('listConflictBlocks', () => {
  it('두 블록의 내용과 라인 범위를 추출한다', () => {
    const blocks = listConflictBlocks(TWO_BLOCKS)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({ index: 0, start: 1, end: 5, ours: ['mine-1'], theirs: ['theirs-1'] })
    expect(blocks[1]).toEqual({
      index: 1,
      start: 9,
      end: 14,
      ours: ['mine-2a', 'mine-2b'],
      theirs: ['theirs-2'],
    })
  })

  it('마커가 없으면 빈 배열이다', () => {
    expect(listConflictBlocks('a\nb\n')).toEqual([])
  })

  it('비정상 마커(순서 꼬임·미완결)는 블록으로 세지 않는다', () => {
    // parseConflictContent와 같은 원칙 — 순서가 맞는 완결 구간만 블록이다
    expect(listConflictBlocks('=======\n>>>>>>> x\nplain\n')).toEqual([])
    expect(listConflictBlocks('<<<<<<< HEAD\nmine\n=======\ntheirs\n')).toEqual([])
  })
})

describe('applyBlockChoice', () => {
  it('첫 블록을 내 것으로 — 그 블록 마커·반대쪽만 사라지고 나머지는 그대로다', () => {
    const next = applyBlockChoice(TWO_BLOCKS, 0, 'ours')
    expect(next).toBe(
      [
        'top',
        'mine-1',
        'mid-a',
        'mid-b',
        'mid-c',
        '<<<<<<< HEAD',
        'mine-2a',
        'mine-2b',
        '=======',
        'theirs-2',
        '>>>>>>> rival',
        'bottom',
        '',
      ].join('\n'),
    )
    expect(listConflictBlocks(next!)).toHaveLength(1)
  })

  it('둘째 블록을 가져온 것으로 — 첫 블록은 건드리지 않는다', () => {
    const next = applyBlockChoice(TWO_BLOCKS, 1, 'theirs')
    expect(next).toContain('theirs-2')
    expect(next).not.toContain('mine-2a')
    expect(next).toContain('mine-1')
    expect(next).toContain('<<<<<<< HEAD')
  })

  it('범위 밖 blockIndex는 null — 파일이 그새 바뀐 경합을 호출자가 알 수 있다', () => {
    expect(applyBlockChoice(TWO_BLOCKS, 2, 'ours')).toBeNull()
    expect(applyBlockChoice('plain\n', 0, 'ours')).toBeNull()
  })

  it('마지막 줄 개행 유무를 원본 그대로 보존한다', () => {
    const noNewline = '<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> rival'
    expect(applyBlockChoice(noNewline, 0, 'ours')).toBe('mine')
    expect(applyBlockChoice(`${noNewline}\n`, 0, 'ours')).toBe('mine\n')
  })

  it('고른 쪽이 비어 있고 파일 전체가 블록이면 빈 파일이 된다', () => {
    const emptySide = '<<<<<<< HEAD\n=======\ntheirs\n>>>>>>> rival\n'
    expect(applyBlockChoice(emptySide, 0, 'ours')).toBe('')
  })
})

describe('buildConflictView', () => {
  it('일반 줄과 블록 카드를 원본 순서대로 배치한다', () => {
    const items = buildConflictView(TWO_BLOCKS)
    expect(items.map((item) => item.type)).toEqual([
      'line',
      'block',
      'line',
      'line',
      'line',
      'block',
      'line',
    ])
    expect(items[0]).toEqual({ type: 'line', text: 'top' })
    const second = items[1]!
    expect(second.type).toBe('block')
    if (second.type === 'block') expect(second.block.ours).toEqual(['mine-1'])
  })

  it('마커 없는 파일은 전부 line이다', () => {
    expect(buildConflictView('a\nb\n')).toEqual([
      { type: 'line', text: 'a' },
      { type: 'line', text: 'b' },
    ])
  })
})
