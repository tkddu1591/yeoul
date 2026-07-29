import { describe, expect, it } from 'vitest'
import { nextTabNumber } from '../src/renderer/src/ui/terminal/tab-number'

describe('nextTabNumber', () => {
  it('비어 있으면 1', () => {
    expect(nextTabNumber([])).toBe(1)
  })

  it('연속이면 다음 번호', () => {
    expect(nextTabNumber([1, 2, 3])).toBe(4)
  })

  it('가운데가 비면 그 자리를 재사용한다 — 닫은 자리를 메워야 "몇 번째"가 거짓말을 안 한다', () => {
    expect(nextTabNumber([1, 3])).toBe(2)
    expect(nextTabNumber([2, 3])).toBe(1)
  })

  it('순서가 뒤죽박죽이어도 같은 답', () => {
    expect(nextTabNumber([3, 1])).toBe(2)
  })

  it('중복이 들어와도 견딘다', () => {
    expect(nextTabNumber([1, 1, 2])).toBe(3)
  })
})
