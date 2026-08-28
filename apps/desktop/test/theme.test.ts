import { describe, expect, it } from 'vitest'
import { appearancePreference } from '../src/shared/appearance'

describe('appearancePreference.initial.get', () => {
  it('저장된 모드와 테마가 있으면 기본값보다 우선한다', () => {
    expect(
      appearancePreference.initial.get({ colorMode: 'light', colorTheme: 'retro' }, true),
    ).toEqual({ mode: 'light', theme: 'retro' })
    expect(
      appearancePreference.initial.get({ colorMode: 'dark', colorTheme: 'blue' }, false),
    ).toEqual({ mode: 'dark', theme: 'blue' })
  })

  it('저장값이 없으면 시스템 모드와 여울 테마를 쓴다', () => {
    expect(appearancePreference.initial.get({}, true)).toEqual({ mode: 'dark', theme: 'yeoul' })
    expect(appearancePreference.initial.get({}, false)).toEqual({ mode: 'light', theme: 'yeoul' })
  })

  it('알 수 없는 저장값은 무시하고 시스템 설정을 따른다', () => {
    expect(
      appearancePreference.initial.get({ colorMode: 'sepia', colorTheme: 'neon' }, true),
    ).toEqual({ mode: 'dark', theme: 'yeoul' })
  })
})
