import { describe, expect, it } from 'vitest'
import { terminalAppearance } from '../src/renderer/src/ui/terminal/terminal-theme'
import type { ColorMode, ColorTheme } from '@git-gui/ipc-contract'

describe('terminalAppearance.palette.get', () => {
  it('모든 모드와 테마 조합이 필수 키를 갖는다', () => {
    for (const mode of ['light', 'dark'] satisfies ColorMode[]) {
      for (const theme of [
        'yeoul',
        'blue',
        'forest',
        'retro',
        'violet',
      ] satisfies ColorTheme[]) {
        const palette = terminalAppearance.palette.get({ mode, theme })
        expect(palette.background).toMatch(/^#/)
        expect(palette.foreground).toMatch(/^#/)
        expect(palette.cursor).toMatch(/^#/)
        expect(palette.selectionBackground).toMatch(/^#/)
      }
    }
  })

  it('라이트와 다크의 배경이 다르다 — 연동이 눈에 보이는 최소 조건', () => {
    expect(terminalAppearance.palette.get({ mode: 'light', theme: 'yeoul' }).background).not.toBe(
      terminalAppearance.palette.get({ mode: 'dark', theme: 'yeoul' }).background,
    )
  })
})
