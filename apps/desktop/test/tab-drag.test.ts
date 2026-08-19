import { describe, expect, it } from 'vitest'
import {
  dropIndexOf,
  exceedsDragThreshold,
  insertionIndexOf,
} from '../src/renderer/src/components/tab-drag'

/**
 * E15d 드래그 순수 계산 — TabBar가 이벤트 배선만 남기고 판정을 전부 여기서 가져간다
 * (tab-labels와 같은 분리: 컴포넌트는 프레젠테이션, 규칙은 순수 함수).
 */
describe('드래그 임계값 (E15d — 4px부터 드래그, 미만은 클릭)', () => {
  it('4px 미만 이동은 드래그가 아니다 — 기존 클릭·⌥클릭이 무변이어야 한다', () => {
    expect(exceedsDragThreshold(0, 0)).toBe(false)
    expect(exceedsDragThreshold(3, 0)).toBe(false)
    expect(exceedsDragThreshold(0, -3)).toBe(false)
    expect(exceedsDragThreshold(2, 2)).toBe(false) // 유클리드 ≈2.83
  })

  it('4px부터 드래그다 — 축 방향이든 대각이든 거리 기준', () => {
    expect(exceedsDragThreshold(4, 0)).toBe(true)
    expect(exceedsDragThreshold(0, 4)).toBe(true)
    expect(exceedsDragThreshold(-3, -3)).toBe(true) // 유클리드 ≈4.24
  })
})

describe('삽입 위치 (E15d — 탭 중심 x들 사이 어느 틈인가)', () => {
  it('포인터보다 왼쪽에 중심이 몇 개인가가 곧 틈 번호다', () => {
    const midpoints = [100, 200, 300]
    expect(insertionIndexOf(midpoints, 50)).toBe(0)
    expect(insertionIndexOf(midpoints, 150)).toBe(1)
    expect(insertionIndexOf(midpoints, 250)).toBe(2)
    expect(insertionIndexOf(midpoints, 350)).toBe(3) // 맨 끝 틈
  })

  it('중심과 정확히 같은 x는 그 탭의 왼쪽 틈이다 — 경계에서 흔들리지 않는다', () => {
    expect(insertionIndexOf([100, 200], 200)).toBe(1)
  })

  it('탭이 없으면 틈은 0뿐이다', () => {
    expect(insertionIndexOf([], 123)).toBe(0)
  })
})

describe('틈 번호 → moveTab의 toIndex (E15d — 뽑고 다시 끼우면 오른쪽 틈이 하나 당겨진다)', () => {
  it('제 탭보다 오른쪽 틈은 하나 줄어든 자리다', () => {
    expect(dropIndexOf(2, 0)).toBe(1)
    expect(dropIndexOf(3, 0)).toBe(2)
  })

  it('제 탭보다 왼쪽 틈은 그대로다', () => {
    expect(dropIndexOf(0, 2)).toBe(0)
    expect(dropIndexOf(1, 2)).toBe(1)
  })

  it('제자리 틈 둘(바로 왼쪽·바로 오른쪽)은 둘 다 제자리다', () => {
    expect(dropIndexOf(1, 1)).toBe(1) // 바로 왼쪽 틈
    expect(dropIndexOf(2, 1)).toBe(1) // 바로 오른쪽 틈
  })
})
