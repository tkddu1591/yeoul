export type ListNavigationKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'
export interface ListNavigation {
  from: number
  to: number
  extend: boolean
}
function find(
  current: number,
  key: ListNavigationKey,
  count: number,
  available: (index: number) => boolean,
): number | null {
  const direction = key === 'ArrowUp' || key === 'End' ? -1 : 1
  const start = key === 'Home' ? 0 : key === 'End' ? count - 1 : current + direction
  for (let index = start; index >= 0 && index < count; index += direction) {
    if (available(index)) return index
  }
  return null
}
export const listNavigation = { index: { find } }
