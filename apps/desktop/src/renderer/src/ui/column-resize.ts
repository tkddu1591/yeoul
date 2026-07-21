export const RIGHT_COLUMN_DEFAULT = 360

/** 우측 열 폭 제한 — 최소 260px(내용 붕괴 방지), 최대 뷰포트 45%(중앙 diff 생존) */
export function clampRightWidth(px: number, viewportWidth: number): number {
  const max = Math.max(260, Math.floor(viewportWidth * 0.45))
  return Math.min(Math.max(Math.round(px), 260), max)
}

/** 저장값 → 폭. 깨진 값은 조용히 기본값으로 (드래그로 다시 정하면 된다) */
export function parseStoredWidth(raw: unknown): number {
  const parsed = Number(raw)
  if (raw == null || !Number.isFinite(parsed) || parsed < 260) return RIGHT_COLUMN_DEFAULT
  return Math.round(parsed)
}

export function loadRightWidth(): number {
  return parseStoredWidth(window.settingsApi.initial.rightWidth)
}

export function saveRightWidth(px: number): void {
  void window.settingsApi.set({ rightWidth: px })
}

export function resetRightWidth(): void {
  void window.settingsApi.set({ rightWidth: RIGHT_COLUMN_DEFAULT })
}

export const LEFT_COLUMN_DEFAULT = 380
/** 좌측(변경 목록+저장 폼) 하한 — 이 아래로는 체크박스·버튼 줄이 붕괴한다 */
export const LEFT_COLUMN_MIN = 260
/** 중앙(diff·충돌 뷰) 최소 보장 폭 — 960px 최소 창에서도 지킨다 (E2 후속 노트 해소) */
export const CENTER_MIN = 380
/** 그리드 고정 소모 폭 — main 좌우 패딩 20×2 + 열 간 gap 16×3 + 리사이저 6 (layout.css와 짝) */
const MAIN_CHROME = 94
/** 중앙 보장이 우측 클램프 하한(260)과 충돌할 때 우측이 내려가는 마지막 바닥 */
const RIGHT_COLUMN_FLOOR = 200

/**
 * 창 폭·저장된 우측 폭 → 실제 좌·우 열 폭 (E6a 반응형).
 * 우선순위: ① 중앙 ≥ CENTER_MIN ② 사용자가 정한 우측 폭 ③ 좌측 기본 폭.
 * 좁아지면 좌측이 먼저 260까지 줄고, 그래도 모자라면 우측이 클램프 하한 아래로 함께 줄어든다.
 * (960px 창: 좌 260·우 226·중앙 380 — 검산은 플랜 실측 표)
 */
export function computeColumns(
  viewportWidth: number,
  storedRight: number,
): { left: number; right: number } {
  const budget = viewportWidth - MAIN_CHROME - CENTER_MIN
  let right = clampRightWidth(storedRight, viewportWidth)
  const left = Math.min(LEFT_COLUMN_DEFAULT, Math.max(LEFT_COLUMN_MIN, budget - right))
  if (budget - right < LEFT_COLUMN_MIN) {
    right = Math.max(RIGHT_COLUMN_FLOOR, budget - LEFT_COLUMN_MIN)
  }
  return { left, right }
}
