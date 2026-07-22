import { describe, expect, it } from 'vitest'
import {
  clampDockHeight,
  DOCK_HEIGHT_DEFAULT,
  parseStoredDockHeight,
} from '../src/renderer/src/ui/terminal/dock-height'

describe('clampDockHeight', () => {
  it('최소 120, 최대 뷰포트 60%로 자른다', () => {
    expect(clampDockHeight(50, 800)).toBe(120)
    expect(clampDockHeight(600, 800)).toBe(480)
    expect(clampDockHeight(240, 800)).toBe(240)
  })

  it('아주 낮은 창에서도 최소는 지킨다', () => {
    expect(clampDockHeight(240, 150)).toBe(120)
  })
})

describe('parseStoredDockHeight', () => {
  it('깨진 값·미설정은 기본값이다 (column-resize 관례)', () => {
    expect(parseStoredDockHeight(undefined)).toBe(DOCK_HEIGHT_DEFAULT)
    expect(parseStoredDockHeight('tall')).toBe(DOCK_HEIGHT_DEFAULT)
    expect(parseStoredDockHeight(10)).toBe(DOCK_HEIGHT_DEFAULT)
  })

  it('정상 값은 반올림해 쓴다', () => {
    expect(parseStoredDockHeight(240.6)).toBe(241)
  })
})
