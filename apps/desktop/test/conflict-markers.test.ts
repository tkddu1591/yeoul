import { describe, expect, it } from 'vitest'
import { parseConflictContent } from '../src/renderer/src/components/conflict-markers'

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
