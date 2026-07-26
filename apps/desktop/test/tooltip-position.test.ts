import { describe, expect, it } from 'vitest'
import { placeTooltip } from '../src/renderer/src/ui/tooltip-position'

const VIEWPORT = { width: 1000, height: 800 }

describe('placeTooltip', () => {
  it('기본은 트리거 아래에 붙인다', () => {
    const place = placeTooltip(
      { top: 100, left: 200, width: 120, height: 24 },
      { width: 200, height: 80 },
      VIEWPORT,
    )
    expect(place.placement).toBe('bottom')
    expect(place.top).toBe(132) // 100 + 24 + gap 8
    expect(place.left).toBe(200)
  })

  it('아래 공간이 부족하면 위로 뒤집는다', () => {
    const place = placeTooltip(
      { top: 740, left: 200, width: 120, height: 24 },
      { width: 200, height: 80 },
      VIEWPORT,
    )
    expect(place.placement).toBe('top')
    expect(place.top).toBe(652) // 740 - 80 - gap 8
  })

  it('오른쪽으로 넘치면 뷰포트 안으로 민다', () => {
    const place = placeTooltip(
      { top: 100, left: 900, width: 60, height: 24 },
      { width: 300, height: 80 },
      VIEWPORT,
    )
    expect(place.left).toBe(692) // 1000 - 300 - margin 8
  })

  it('왼쪽으로 넘쳐도 최소 여백을 지킨다', () => {
    const place = placeTooltip(
      { top: 100, left: 2, width: 40, height: 24 },
      { width: 300, height: 80 },
      VIEWPORT,
    )
    expect(place.left).toBe(8)
  })

  it('위아래 모두 부족하면 공간이 더 큰 쪽을 고른다', () => {
    const place = placeTooltip(
      { top: 300, left: 100, width: 40, height: 24 },
      { width: 100, height: 700 },
      VIEWPORT,
    )
    // 아래 남은 공간 476 > 위 300 → bottom 유지
    expect(place.placement).toBe('bottom')
  })
})
