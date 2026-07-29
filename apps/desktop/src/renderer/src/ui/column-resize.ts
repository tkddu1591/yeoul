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
/** 좌측(변경 목록+커밋 폼) 하한 — 이 아래로는 체크박스·버튼 줄이 붕괴한다 */
export const LEFT_COLUMN_MIN = 260
/** 중앙(diff·충돌 뷰) 최소 보장 폭 — 960px 최소 창에서도 지킨다 (E2 후속 노트 해소) */
export const CENTER_MIN = 380
/** 그리드 고정 소모 폭 — main 좌우 패딩 20×2 + 열 간 gap 16×3 + 리사이저 6 (layout.css와 짝) */
const MAIN_CHROME = 94
/** 중앙 보장이 우측 클램프 하한(260)과 충돌할 때 우측이 내려가는 마지막 바닥 */
const RIGHT_COLUMN_FLOOR = 200
/** main 좌우 패딩 20×2 — 열이 몇 개 접히든 항상 남는다 (MAIN_CHROME 분해 성분) */
const MAIN_PADDING = 40
/** 열 간 gap — 접힌 열은 이 gap도 함께 사라진다(트랙 자체가 빠지므로) */
const GRID_GAP = 16
/** 리사이저 — 우측 폭 조절 전용이라 우측이 접히면 존재 이유가 없어져 함께 사라진다 */
const RESIZER_WIDTH = 6

/** 접힌 열 상태 — 없으면(undefined) 둘 다 펼쳐진 것으로 본다 */
export interface ColumnCollapse {
  left?: boolean
  right?: boolean
}

/**
 * 창 폭·저장된 우측 폭 → 실제 좌·우 열 폭 (E6a 반응형).
 * 우선순위: ① 중앙 ≥ CENTER_MIN ② 사용자가 정한 우측 폭 ③ 좌측 기본 폭.
 * 좁아지면 좌측이 먼저 260까지 줄고, 그래도 모자라면 우측이 클램프 하한 아래로 함께 줄어든다.
 * (960px 창: 좌 260·우 226·중앙 380 — 검산은 플랜 실측 표)
 *
 * 접힘(E12) — 접힌 열은 폭이 0일 뿐 아니라 그 열의 grid gap도 함께 없어진다(레이아웃이 트랙
 * 자체를 뺀다). 우측이 접히면 우측 전용 리사이저(6px)도 같이 사라진다. 그래서 MAIN_CHROME(94)를
 * 그대로 쓰지 않고 "지금 보이는 트랙이 몇 개인가"로 매번 다시 유도한다:
 * 트랙 = [좌?, 중앙, 리사이저?, 우?] → gap 개수 = 트랙 수 - 1.
 * 둘 다 펼쳐지면 트랙 4개·gap 3개·리사이저 6 = 94(MAIN_CHROME과 정확히 일치, 회귀 없음).
 * 좌측만 접히면 트랙 3개·gap 2개·리사이저 6 = 78. 우측만 접히면 트랙 2개·gap 1개·리사이저 0 = 56.
 * 좌측이 접히면 좌측 최소폭(LEFT_COLUMN_MIN)을 지킬 이유도 사라지므로, 우측을 그 최소폭 대신
 * 지켜주는 옛 스퀴즈(budget - right < LEFT_COLUMN_MIN)는 좌측이 접힌 동안 적용하지 않는다 —
 * 960px 최소 창에서 좌측을 접었는데 그 자리를 지켜주려고 우측까지 깎이면 접은 의미가 없다(테스트로 고정).
 */
export function computeColumns(
  viewportWidth: number,
  storedRight: number,
  collapse: ColumnCollapse = {},
): { left: number; right: number } {
  const leftCollapsed = collapse.left === true
  const rightCollapsed = collapse.right === true

  if (leftCollapsed && rightCollapsed) return { left: 0, right: 0 }

  const trackCount = (leftCollapsed ? 0 : 1) + 1 + (rightCollapsed ? 0 : 2)
  const chrome = MAIN_PADDING + (trackCount - 1) * GRID_GAP + (rightCollapsed ? 0 : RESIZER_WIDTH)
  const budget = viewportWidth - chrome - CENTER_MIN

  if (leftCollapsed) {
    const right = Math.min(clampRightWidth(storedRight, viewportWidth), Math.max(RIGHT_COLUMN_FLOOR, budget))
    return { left: 0, right }
  }

  if (rightCollapsed) {
    const left = Math.min(LEFT_COLUMN_DEFAULT, Math.max(LEFT_COLUMN_MIN, budget))
    return { left, right: 0 }
  }

  let right = clampRightWidth(storedRight, viewportWidth)
  const left = Math.min(LEFT_COLUMN_DEFAULT, Math.max(LEFT_COLUMN_MIN, budget - right))
  if (budget - right < LEFT_COLUMN_MIN) {
    right = Math.max(RIGHT_COLUMN_FLOOR, budget - LEFT_COLUMN_MIN)
  }
  return { left, right }
}

/** 좌측 사이드 접힘 — 저장값 없으면 펼침(false)이 기본 (E12, terminalOpen 관례) */
export function loadLeftCollapsed(): boolean {
  return window.settingsApi.initial.leftCollapsed === true
}

export function saveLeftCollapsed(collapsed: boolean): void {
  void window.settingsApi.set({ leftCollapsed: collapsed })
}

/** 우측 사이드 접힘 — 저장값 없으면 펼침(false)이 기본 (E12, terminalOpen 관례) */
export function loadRightCollapsed(): boolean {
  return window.settingsApi.initial.rightCollapsed === true
}

export function saveRightCollapsed(collapsed: boolean): void {
  void window.settingsApi.set({ rightCollapsed: collapsed })
}

/**
 * 헤더 접힘 임계 폭 (E7k) — 이 아래에서는 액션 버튼이 아이콘만 남는다.
 * 실측: 1200px 창에서 상태 394 + 액션 683 + gap 40 + padding 100 = 1217이라
 * 저장소 이름 자리가 0으로 뭉개졌다. 이름 자리를 지키는 지점이 1180이다.
 */
export const HEADER_COMPACT_WIDTH = 1180

/** 창이 좁아 헤더 라벨을 접어야 하는가 — 판정만 하고 숨김은 CSS가 한다 (E7k) */
export function isCompactHeader(viewportWidth: number): boolean {
  return viewportWidth < HEADER_COMPACT_WIDTH
}
