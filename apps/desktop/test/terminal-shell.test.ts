import { describe, expect, it } from 'vitest'
import { resolveShell } from '../src/main/terminal-manager'

describe('resolveShell', () => {
  it('$SHELL이 있으면 그대로 쓴다 — 사용자 쉘 존중', () => {
    expect(resolveShell({ SHELL: '/opt/homebrew/bin/fish' })).toBe('/opt/homebrew/bin/fish')
  })

  it('$SHELL이 비어 있으면 macOS 기본 zsh로 폴백한다', () => {
    expect(resolveShell({})).toBe(process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
    expect(resolveShell({ SHELL: '' })).toBe(process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  })

  it('공백뿐인 $SHELL도 폴백한다 (깨진 env 방어)', () => {
    expect(resolveShell({ SHELL: '   ' })).toBe(process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  })
})
