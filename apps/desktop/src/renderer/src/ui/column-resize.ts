const RIGHT_WIDTH_KEY = 'git-gui-right-width'

export const RIGHT_COLUMN_DEFAULT = 360

/** 우측 열 폭 제한 — 최소 260px(내용 붕괴 방지), 최대 뷰포트 45%(중앙 diff 생존) */
export function clampRightWidth(px: number, viewportWidth: number): number {
  const max = Math.max(260, Math.floor(viewportWidth * 0.45))
  return Math.min(Math.max(Math.round(px), 260), max)
}

/** localStorage 원문 → 폭. 깨진 값은 조용히 기본값으로 (드래그로 다시 정하면 된다) */
export function parseStoredWidth(raw: string | null): number {
  const parsed = Number(raw)
  if (raw === null || !Number.isFinite(parsed) || parsed < 260) return RIGHT_COLUMN_DEFAULT
  return Math.round(parsed)
}

export function loadRightWidth(): number {
  return parseStoredWidth(localStorage.getItem(RIGHT_WIDTH_KEY))
}

export function saveRightWidth(px: number): void {
  localStorage.setItem(RIGHT_WIDTH_KEY, String(px))
}

export function resetRightWidth(): void {
  localStorage.removeItem(RIGHT_WIDTH_KEY)
}
