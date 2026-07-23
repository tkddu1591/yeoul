import type { ITheme } from '@xterm/xterm'
import type { Theme } from '../theme'

/**
 * xterm 팔레트 (E7d ③) — 앱 라이트/다크 2벌. 다크는 E7b 고정 팔레트 계승.
 * 쉘 출력 영역이라 CSS 변수를 못 쓴다 — 토큰과 어울리는 고정값을 둔다
 */
const PALETTES: Record<Theme, ITheme> = {
  dark: {
    background: '#1a1b23',
    foreground: '#e2e2ea',
    cursor: '#9f8fff',
    selectionBackground: '#3b3d52',
  },
  light: {
    background: '#f7f7fa',
    foreground: '#2a2a33',
    cursor: '#6b5bd6',
    selectionBackground: '#d9d9e6',
  },
}

export function terminalPalette(theme: Theme): ITheme {
  return PALETTES[theme]
}
