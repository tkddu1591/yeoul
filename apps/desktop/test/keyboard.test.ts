import { describe, expect, it } from 'vitest'
import { isSubmitEnter } from '../src/renderer/src/ui/keyboard'

describe('isSubmitEnter', () => {
  it('조합 중이 아닌 Enter만 제출이다', () => {
    expect(isSubmitEnter('Enter', false)).toBe(true)
    expect(isSubmitEnter('Enter', true)).toBe(false)
  })

  it('다른 키는 제출이 아니다', () => {
    expect(isSubmitEnter('a', false)).toBe(false)
    expect(isSubmitEnter('Escape', false)).toBe(false)
  })
})
