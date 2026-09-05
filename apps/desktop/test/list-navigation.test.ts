import { describe, it, expect } from 'vitest'
import { listNavigation } from '../src/renderer/src/ui/list-navigation'
describe('listNavigation.index.find', () => {
  const available = (index: number) => [0, 2, 3].includes(index)
  it('안내 행을 건너뛰고 양방향으로 이동한다', () => {
    expect(listNavigation.index.find(0, 'ArrowDown', 5, available)).toBe(2)
    expect(listNavigation.index.find(2, 'ArrowUp', 5, available)).toBe(0)
  })
  it('처음·끝 탐색에서도 포커스 가능한 행을 선택한다', () => {
    expect(listNavigation.index.find(2, 'End', 5, available)).toBe(3)
    expect(listNavigation.index.find(2, 'Home', 5, available)).toBe(0)
  })
  it('경계를 넘거나 모든 행이 비활성이면 이동하지 않는다', () => {
    expect(listNavigation.index.find(3, 'ArrowDown', 5, available)).toBeNull()
    expect(listNavigation.index.find(0, 'ArrowUp', 5, available)).toBeNull()
    expect(listNavigation.index.find(0, 'Home', 0, () => true)).toBeNull()
  })
})
