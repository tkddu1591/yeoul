/**
 * 탭 드래그의 순수 계산 (E15d) — TabBar에는 이벤트 배선만 남기고 판정은 전부 여기 둔다
 * (tab-labels와 같은 분리: 컴포넌트는 프레젠테이션, 규칙은 순수 함수라 vitest가 문다).
 */

/** pointerdown 후 이만큼 움직이면 드래그다 — 미만은 클릭 (스펙 §2. 기존 클릭·⌥클릭 무변의 경계) */
export const DRAG_THRESHOLD_PX = 4

/** 시작점에서의 이동이 드래그 임계값을 넘었는가 — 축 방향·대각 무관하게 유클리드 거리 기준 */
export function exceedsDragThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX
}

/**
 * 포인터 x가 탭들 사이 어느 틈(0..탭 수)에 있는가 — 삽입선과 드롭 위치가 같은 값을 쓴다.
 * 판정은 "왼쪽에 탭 중심이 몇 개 있는가"다: 탭 절반을 지나면 다음 틈으로 넘어가는 자연스러운
 * 드롭 감각(브라우저 탭 관례)이 이 한 줄에서 나온다. midpoints는 탭 순서대로의 중심 x들
 */
export function insertionIndexOf(midpointsX: number[], pointerX: number): number {
  let index = 0
  for (const midpoint of midpointsX) if (midpoint < pointerX) index += 1
  return index
}

/**
 * 틈 번호 → moveTab의 toIndex. 틈은 탭 수+1개인데 자리(toIndex)는 탭 수만큼이라 하나 접힌다:
 * 제 탭을 뽑아 다시 끼우므로 제 탭보다 오른쪽 틈은 전부 한 자리 당겨진다 — 제 탭의 양옆 틈
 * 둘이 똑같이 제자리가 되는 것도 이 접힘의 자연스러운 결과다(제자리 드롭은 moveTab이 무발화로 접는다)
 */
export function dropIndexOf(insertionIndex: number, fromIndex: number): number {
  return insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex
}
