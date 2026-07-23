import { describe, expect, it } from 'vitest'
import { sanitizePersistedSettings, sanitizeSettings } from '../src/index'

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

  it('터미널 도크 필드(terminalOpen·terminalHeight)를 통과시키고 잘못된 타입은 버린다 (E7b)', () => {
    expect(sanitizeSettings({ terminalOpen: true, terminalHeight: 240 })).toEqual({
      terminalOpen: true,
      terminalHeight: 240,
    })
    expect(sanitizeSettings({ terminalOpen: 'yes', terminalHeight: NaN })).toEqual({})
  })

  it('워크트리 선택 동작(worktreeSelectAction)은 두 값만 통과시킨다 (E7c)', () => {
    expect(sanitizeSettings({ worktreeSelectAction: 'terminal' })).toEqual({
      worktreeSelectAction: 'terminal',
    })
    expect(sanitizeSettings({ worktreeSelectAction: 'switch-app' })).toEqual({
      worktreeSelectAction: 'switch-app',
    })
    expect(sanitizeSettings({ worktreeSelectAction: 'always-ask' })).toEqual({})
  })
})

describe('sanitizePersistedSettings', () => {
  it('renderer 필드에 더해 hosting.github(token·login)을 통과시킨다', () => {
    expect(
      sanitizePersistedSettings({
        theme: 'dark',
        hosting: { github: { token: 'enc-base64', login: 'octocat', evil: 'x' } },
      }),
    ).toEqual({ theme: 'dark', hosting: { github: { token: 'enc-base64', login: 'octocat' } } })
  })

  it('hosting이 잘못된 형태면 조용히 버린다', () => {
    expect(sanitizePersistedSettings({ hosting: 'yes' })).toEqual({})
    expect(sanitizePersistedSettings({ hosting: { github: { token: 42 } } })).toEqual({})
    expect(sanitizePersistedSettings({ hosting: { github: [] } })).toEqual({})
  })

  it('sanitizeSettings(renderer 표면)는 hosting을 걷어낸다 — 토큰은 renderer로 가지 않는다', () => {
    expect(sanitizeSettings({ theme: 'light', hosting: { github: { token: 'enc' } } })).toEqual({
      theme: 'light',
    })
  })
})
