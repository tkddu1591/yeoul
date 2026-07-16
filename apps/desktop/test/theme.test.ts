import { describe, expect, it } from 'vitest'
import { resolveInitialTheme } from '../src/renderer/src/ui/theme'

describe('resolveInitialTheme', () => {
  it('저장된 값이 있으면 시스템 설정보다 우선한다', () => {
    expect(resolveInitialTheme('light', true)).toBe('light')
    expect(resolveInitialTheme('dark', false)).toBe('dark')
  })

  it('저장된 값이 없으면 시스템 설정을 따른다', () => {
    expect(resolveInitialTheme(null, true)).toBe('dark')
    expect(resolveInitialTheme(null, false)).toBe('light')
  })

  it('알 수 없는 저장값은 무시하고 시스템 설정을 따른다', () => {
    expect(resolveInitialTheme('sepia', true)).toBe('dark')
  })
})
