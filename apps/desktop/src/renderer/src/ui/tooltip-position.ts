/** 툴팁 배치 계산 (E7j) — 렌더와 분리된 순수 함수라 단위 테스트가 된다 */
export interface TooltipRect {
  top: number
  left: number
  width: number
  height: number
}

export interface TooltipPlacement {
  top: number
  left: number
  placement: 'top' | 'bottom'
}

const GAP = 8
const MARGIN = 8

export function placeTooltip(
  trigger: TooltipRect,
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = GAP,
): TooltipPlacement {
  const below = viewport.height - (trigger.top + trigger.height)
  const above = trigger.top
  // 아래가 기본 — 안 들어가면 위로 뒤집고, 둘 다 부족하면 더 넓은 쪽
  const fitsBelow = below >= tip.height + gap
  const placement: 'top' | 'bottom' = fitsBelow || below >= above ? 'bottom' : 'top'
  const top =
    placement === 'bottom' ? trigger.top + trigger.height + gap : trigger.top - tip.height - gap
  const maxLeft = viewport.width - tip.width - MARGIN
  const left = Math.max(MARGIN, Math.min(trigger.left, maxLeft))
  return { top, left, placement }
}
