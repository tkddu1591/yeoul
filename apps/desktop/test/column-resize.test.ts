import { describe, expect, it } from 'vitest'
import {
  clampRightWidth,
  computeColumns,
  isCompactHeader,
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
