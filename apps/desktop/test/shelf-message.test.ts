import { describe, expect, it } from 'vitest'
import { parseShelfMessage } from '../src/renderer/src/components/shelf-message'

describe('parseShelfMessage', () => {
  it('"On <branch>: " 접두사를 브랜치와 본문으로 나눈다', () => {
    expect(parseShelfMessage('On main: 직접 보관')).toEqual({ branch: 'main', text: '직접 보관' })
  })

  it('"WIP on <branch>: " (메시지 없는 stash)도 나눈다', () => {
    expect(parseShelfMessage('WIP on feat/x: abc1234 subject')).toEqual({
      branch: 'feat/x',
      text: 'abc1234 subject',
    })
  })

  it('접두사가 없으면 원문 그대로', () => {
    expect(parseShelfMessage('그냥 메시지')).toEqual({ branch: null, text: '그냥 메시지' })
  })
})
