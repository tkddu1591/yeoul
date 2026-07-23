import { describe, expect, it } from 'vitest'
import { terminalPalette } from '../src/renderer/src/ui/terminal/terminal-theme'

describe('terminalPalette', () => {
  it('두 테마 모두 필수 키(배경·전경·커서·선택)를 갖는다', () => {
    for (const theme of ['light', 'dark'] as const) {
      const palette = terminalPalette(theme)
      expect(palette.background).toMatch(/^#/)
      expect(palette.foreground).toMatch(/^#/)
      expect(palette.cursor).toMatch(/^#/)
      expect(palette.selectionBackground).toMatch(/^#/)
    }
  })

  it('라이트와 다크의 배경이 다르다 — 연동이 눈에 보이는 최소 조건', () => {
    expect(terminalPalette('light').background).not.toBe(terminalPalette('dark').background)
  })
})
