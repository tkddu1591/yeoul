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

/** buildMainColumns가 만드는 트랙 수(좌·간격·중앙·간격·리사이저·간격·우 = 7) — 접힘과 무관하게
 * 항상 고정이라 도크(터미널) grid-column 계산에도 그대로 쓴다 (E13) */
export const MAIN_TRACK_COUNT = 7

/** 터미널 도크가 덮는 열 범위 — 좌측 관리 존(좌 트랙+그 간격, 1~2번째)만 제외한 나머지 전부.
 * 트랙 개수가 이제 항상 고정이라(위 buildMainColumns 주석) 좌측 접힘 여부와 무관하게 항상
 * 3번째 트랙(중앙)부터 끝까지다 — 접히면 그 1~2번째 트랙이 0px가 될 뿐이라 시작선을 옮길
 * 필요가 없다(App.tsx 옛 dockGridColumn의 leftCollapsed 분기 대체, E13) */
export const MAIN_DOCK_GRID_COLUMN = `3 / ${MAIN_TRACK_COUNT + 1}`

/**
 * .app__main의 행 트랙 문자열 (E13 Task 3) — 열과 같은 원리: 도크가 닫혀도 행을 빼지 않고
 * **트랙을 유지하고 0px로** 둔다(전환의 시작점 보존). 간격도 열 쪽과 같은 이유로 트랙 하나로
 * 옮긴다 — grid gap은 트랙 크기와 무관하게 고정으로 붙어(E11 Task 4 실측) 도크 트랙만 0으로
 * 둬도 gap 몫이 남는 계단이 생긴다. 콘텐츠(1행)는 항상 minmax(0, 1fr) — 도크가 자라는 만큼
 * 콘텐츠가 줄어든다
 */
export function buildMainRows(dockOpen: boolean, dockHeightPx: number): string {
  const gap = dockOpen ? MAIN_GAP : 0
  const dock = dockOpen ? dockHeightPx : 0
  return `minmax(0, 1fr) ${gap}px ${dock}px`
}

/** buildMainRows가 만드는 행 트랙 수(콘텐츠·간격·도크 = 3) — 열림과 무관하게 항상 고정이다 (E13) */
export const MAIN_ROW_COUNT = 3

/** 좌측 관리 존이 덮는 행 범위 — 도크 행까지 전체 높이 (E7b 스펙 v2 그대로, 트랙 3개에 맞춰 갱신) */
export const MAIN_LEFT_GRID_ROW = `1 / ${MAIN_ROW_COUNT + 1}`

/** 중앙·리사이저·우측이 있는 행 — 암시적 배치에 맡기면 간격 행(2번째)에 잘못 올라갈 수 있어
 * (buildMainColumns의 grid-column 명시와 같은 이유, E13 Task 3) 항상 1번째(콘텐츠) 행으로 고정한다 */
export const MAIN_CONTENT_GRID_ROW = '1'

/** 터미널 도크가 있는 행 — 암시적 배치에 맡기면 간격 행에 잘못 올라갈 수 있어(위와 같은 이유)
 * 항상 3번째(도크) 행으로 고정한다 */
export const MAIN_DOCK_GRID_ROW = String(MAIN_ROW_COUNT)
