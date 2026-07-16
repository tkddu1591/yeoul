/** epoch 초를 한국어 상대 시간으로 바꾼다 — 표시 전용, 렌더 시점(nowMs) 기준 */
export function formatRelativeTime(epochSeconds: number, nowMs: number): string {
  const diffSeconds = Math.floor(nowMs / 1000) - epochSeconds
  if (diffSeconds < 60) return '방금 전'
  const minutes = Math.floor(diffSeconds / 60)
  if (minutes < 60) return `${minutes}분 전`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}시간 전`
  const days = Math.floor(hours / 24)
  if (days === 1) return '어제'
  if (days < 7) return `${days}일 전`
  const date = new Date(epochSeconds * 1000)
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`
}

/** 절대 시각(로컬 타임존) — 행 툴팁 등 "언제였는지 정확히"가 필요한 곳에 */
export function formatAbsoluteTime(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}
