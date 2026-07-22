import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { clampPtyDims, resolveShell, TerminalManager } from '../src/main/terminal-manager'

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

describe('clampPtyDims', () => {
  it('0·음수·소수를 pty가 죽지 않는 바닥으로 자른다', () => {
    expect(clampPtyDims(0, 0)).toEqual({ cols: 2, rows: 1 })
    expect(clampPtyDims(120.7, 40.2)).toEqual({ cols: 120, rows: 40 })
  })

  it('정상 값은 그대로다', () => {
    expect(clampPtyDims(80, 24)).toEqual({ cols: 80, rows: 24 })
  })
})

describe('TerminalManager.create', () => {
  it('깨진 $SHELL이면 읽히는 메시지로 거부한다 (posix_spawnp 원어 차단 — 품질 리뷰)', () => {
    const manager = new TerminalManager({ onData() {}, onExit() {} })
    const original = process.env.SHELL
    process.env.SHELL = '/no/such/shell-e7b'
    try {
      expect(() => manager.create(tmpdir())).toThrow(/실행하지 못했어요/)
    } finally {
      if (original === undefined) delete process.env.SHELL
      else process.env.SHELL = original
    }
  })
})
