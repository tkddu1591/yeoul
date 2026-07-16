import { describe, expect, it } from 'vitest'
import { clampRightWidth, parseStoredWidth, RIGHT_COLUMN_DEFAULT } from '../src/renderer/src/ui/column-resize'

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
