import { describe, expect, it } from 'vitest'
import { sanitizeSettings } from '../src/index'

describe('sanitizeSettings', () => {
  it('알려진 필드만, 올바른 타입만 통과시킨다', () => {
    expect(
      sanitizeSettings({ theme: 'dark', rightWidth: 420, evil: 'x', __proto__: { a: 1 } }),
    ).toEqual({ theme: 'dark', rightWidth: 420 })
  })

  it('잘못된 값은 조용히 버린다 — 설정은 전부 선택적이다', () => {
    expect(sanitizeSettings({ theme: 'sepia', rightWidth: 'wide' })).toEqual({})
    expect(sanitizeSettings({ rightWidth: NaN })).toEqual({})
  })

  it('객체가 아니면 빈 설정', () => {
    expect(sanitizeSettings(null)).toEqual({})
    expect(sanitizeSettings('{}')).toEqual({})
    expect(sanitizeSettings([1, 2])).toEqual({})
  })
})
