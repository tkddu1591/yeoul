import type { ColumnCollapse } from './column-resize'

/** layout.css의 gap과 짝 — 간격을 트랙으로 옮겼으므로 여기가 정본이다 (E13) */
export const MAIN_GAP = 16
/** 우측 폭 조절 손잡이 */
export const RESIZER_WIDTH = 6

/**
 * .app__main의 열 트랙 문자열 (E13) — 접힌 열도 **트랙을 유지하고 0px로** 둔다.
 * 트랙을 빼면 전환의 시작점이 사라지고, 트랙만 0으로 두면 grid의 gap이 남는다
 * (gap은 트랙 크기와 무관하게 계산된다 — E11 Task 4 실측). 그래서 gap도 트랙으로 옮겨
 * 열·간격·리사이저가 **한 속성 안에서 함께 보간**되게 한다. 트랙 개수는 항상 고정 —
 * 개수가 달라지면 보간이 아니라 점프가 된다
 */
export function buildMainColumns(
  columns: { left: number; right: number },
  collapse: ColumnCollapse,
): string {
  const leftGap = collapse.left === true ? 0 : MAIN_GAP
  const rightSide = collapse.right === true ? [0, 0, 0] : [MAIN_GAP, RESIZER_WIDTH, MAIN_GAP]
  return [
    `${columns.left}px`,
    `${leftGap}px`,
    'minmax(0, 1fr)',
    ...rightSide.map((px) => `${px}px`),
    `${columns.right}px`,
  ].join(' ')
}
