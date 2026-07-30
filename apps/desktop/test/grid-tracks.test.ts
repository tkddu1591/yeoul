import { describe, expect, it } from 'vitest'
import {
  buildMainColumns,
  buildMainRows,
  MAIN_GAP,
  RESIZER_WIDTH,
} from '../src/renderer/src/ui/grid-tracks'

/** 트랙 문자열의 px 합 — 간격을 트랙으로 옮겼으므로 합이 곧 콘텐츠 폭이어야 한다 */
function sum(template: string): number {
  return template
    .split(' ')
    .filter((t) => t.endsWith('px'))
    .reduce((total, t) => total + Number(t.replace('px', '')), 0)
}

describe('buildMainColumns', () => {
  it('둘 다 펼침 — 좌·간격·중앙·간격·리사이저·간격·우 순서', () => {
    const template = buildMainColumns({ left: 380, right: 360 }, {})
    expect(template).toBe(
      `380px ${MAIN_GAP}px minmax(0, 1fr) ${MAIN_GAP}px ${RESIZER_WIDTH}px ${MAIN_GAP}px 360px`,
    )
  })

  it('좌측 접힘 — 트랙을 빼지 않고 0으로 둔다(전환의 시작점이 있어야 한다)', () => {
    const template = buildMainColumns({ left: 0, right: 360 }, { left: true })
    expect(template.startsWith('0px 0px minmax(0, 1fr)')).toBe(true)
  })

  it('우측 접힘 — 리사이저와 그 간격까지 0이다', () => {
    const template = buildMainColumns({ left: 380, right: 0 }, { right: true })
    expect(template).toBe(`380px ${MAIN_GAP}px minmax(0, 1fr) 0px 0px 0px 0px`)
  })

  it('양쪽 접힘 — 중앙만 남는다', () => {
    expect(buildMainColumns({ left: 0, right: 0 }, { left: true, right: true })).toBe(
      '0px 0px minmax(0, 1fr) 0px 0px 0px 0px',
    )
  })

  it('트랙 개수는 접힘과 무관하게 항상 같다 — 개수가 변하면 보간이 아니라 점프가 된다', () => {
    const count = (t: string) => t.split(' ').length
    const open = count(buildMainColumns({ left: 380, right: 360 }, {}))
    expect(count(buildMainColumns({ left: 0, right: 360 }, { left: true }))).toBe(open)
    expect(count(buildMainColumns({ left: 380, right: 0 }, { right: true }))).toBe(open)
    expect(count(buildMainColumns({ left: 0, right: 0 }, { left: true, right: true }))).toBe(open)
  })

  it('펼침 상태의 px 합 = 열 + 간격 3 + 리사이저', () => {
    expect(sum(buildMainColumns({ left: 380, right: 360 }, {}))).toBe(
      380 + 360 + MAIN_GAP * 3 + RESIZER_WIDTH,
    )
  })
})

describe('buildMainRows', () => {
  it('열림 — 콘텐츠·간격·도크 3트랙, 간격은 MAIN_GAP, 도크는 지정 높이', () => {
    expect(buildMainRows(true, 240)).toBe(`minmax(0, 1fr) ${MAIN_GAP}px 240px`)
  })

  it('닫힘 — 트랙을 빼지 않고 간격·도크 모두 0으로 둔다(전환의 시작점이 있어야 한다)', () => {
    expect(buildMainRows(false, 240)).toBe('minmax(0, 1fr) 0px 0px')
  })

  it('닫힘일 땐 저장된 높이가 몇이든 도크 트랙은 항상 0이다', () => {
    expect(buildMainRows(false, 600)).toBe('minmax(0, 1fr) 0px 0px')
  })

  it('트랙 개수는 열림·닫힘과 무관하게 항상 같다', () => {
    const count = (t: string) => t.split(' ').length
    expect(count(buildMainRows(true, 240))).toBe(count(buildMainRows(false, 240)))
  })
})
