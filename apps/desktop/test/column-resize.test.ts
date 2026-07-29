import { describe, expect, it } from 'vitest'
import {
  clampRightWidth,
  computeColumns,
  isCompactHeader,
  LEFT_COLUMN_DEFAULT,
  parseStoredWidth,
  RIGHT_COLUMN_DEFAULT,
} from '../src/renderer/src/ui/column-resize'

describe('clampRightWidth', () => {
  it('최소 260px, 최대 뷰포트 45%로 자른다', () => {
    expect(clampRightWidth(100, 1440)).toBe(260)
    expect(clampRightWidth(2000, 1440)).toBe(648)
    expect(clampRightWidth(400, 1440)).toBe(400)
  })

  it('좁은 뷰포트에서도 최소폭이 이긴다 (창이 줄어도 열이 사라지지 않는다)', () => {
    expect(clampRightWidth(400, 500)).toBe(260)
  })
})

describe('parseStoredWidth', () => {
  it('저장된 숫자를 복원하고, 없거나 깨진 값은 기본값으로', () => {
    expect(parseStoredWidth('420')).toBe(420)
    expect(parseStoredWidth(null)).toBe(RIGHT_COLUMN_DEFAULT)
    expect(parseStoredWidth('abc')).toBe(RIGHT_COLUMN_DEFAULT)
    expect(parseStoredWidth('-50')).toBe(RIGHT_COLUMN_DEFAULT)
  })
})

describe('computeColumns (E6a 반응형)', () => {
  it('넓은 창(1440)은 기본 그대로 — 좌 380·우 저장값', () => {
    expect(computeColumns(1440, 360)).toEqual({ left: 380, right: 360 })
  })

  it('960px 최소 창 — 좌·우가 함께 줄어 중앙 380px이 정확히 남는다', () => {
    // 검산: 960 - 94(패딩 40 + gap 48 + 리사이저 6) - 260 - 226 = 380
    expect(computeColumns(960, 360)).toEqual({ left: 260, right: 226 })
  })

  it('중간 폭(1200)은 좌측부터 줄어든다 — 우측(사용자 폭)은 그대로', () => {
    expect(computeColumns(1200, 360)).toEqual({ left: 366, right: 360 })
  })

  it('우측을 크게 넓혀도 중앙 보장이 이긴다 — 좌측 하한 뒤 우측 상한', () => {
    expect(computeColumns(1200, 480)).toEqual({ left: 260, right: 466 })
  })

  it('과대 저장값은 기존 45% 클램프가 먼저 자르고, 남으면 좌측이 줄어든다', () => {
    expect(computeColumns(1440, 2000)).toEqual({ left: 318, right: 648 })
  })
})

describe('computeColumns — 사이드 접기 (E12)', () => {
  it('좌측을 접으면 좌측 폭이 0이고 그만큼 중앙이 넓어진다', () => {
    const open = computeColumns(1400, 360)
    const collapsed = computeColumns(1400, 360, { left: true })
    expect(collapsed.left).toBe(0)
    expect(collapsed.right).toBe(open.right)
  })

  it('우측을 접으면 우측 폭이 0이고 좌측은 기본 폭을 되찾는다', () => {
    const collapsed = computeColumns(1400, 360, { right: true })
    expect(collapsed.right).toBe(0)
    expect(collapsed.left).toBe(LEFT_COLUMN_DEFAULT)
  })

  it('양쪽을 접으면 둘 다 0 — 중앙 전폭은 정당한 상태다', () => {
    expect(computeColumns(1400, 360, { left: true, right: true })).toEqual({ left: 0, right: 0 })
  })

  it('최소 창(960)에서 좌측을 접어도 우측이 클램프 하한 아래로 찌그러지지 않는다', () => {
    const { left, right } = computeColumns(960, 360, { left: true })
    expect(left).toBe(0)
    expect(right).toBeGreaterThanOrEqual(260)
  })

  it('접힘 인자를 주지 않으면 기존 동작 그대로다', () => {
    expect(computeColumns(1400, 360)).toEqual(computeColumns(1400, 360, {}))
  })
})

describe('isCompactHeader (E7k)', () => {
  it('임계값 미만이면 접는다', () => {
    expect(isCompactHeader(1179)).toBe(true)
  })

  it('임계값과 같으면 펴 둔다', () => {
    expect(isCompactHeader(1180)).toBe(false)
  })

  it('넓으면 펴 둔다', () => {
    expect(isCompactHeader(1600)).toBe(false)
  })
})
