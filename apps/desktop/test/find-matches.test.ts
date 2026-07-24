import { describe, expect, it } from 'vitest'
import { cycleIndex, matchIndices } from '../src/renderer/src/components/find-matches'

describe('matchIndices', () => {
  it('대소문자 무시 부분 문자열 매치의 인덱스 목록', () => {
    expect(matchIndices(['Alpha', 'beta', 'ALPine'], 'al')).toEqual([0, 2])
  })
  it('빈 검색어는 매치 없음', () => {
    expect(matchIndices(['a'], '')).toEqual([])
  })
})

describe('cycleIndex', () => {
  it('다음·이전이 끝에서 순환한다', () => {
    expect(cycleIndex(2, 1, 3)).toBe(0)
    expect(cycleIndex(0, -1, 3)).toBe(2)
  })
  it('빈 목록은 -1', () => {
    expect(cycleIndex(0, 1, 0)).toBe(-1)
  })
})
