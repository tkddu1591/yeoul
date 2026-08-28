import type { ITheme } from '@xterm/xterm'
import type { Appearance, ColorMode, ColorTheme } from '@git-gui/ipc-contract'

/**
 * xterm 팔레트 (E7d ③) — 앱 라이트/다크 2벌. 다크는 E7b 고정 팔레트 계승.
 * 쉘 출력 영역이라 CSS 변수를 못 쓴다 — 토큰과 어울리는 고정값을 둔다
 */
const PALETTES: Record<ColorTheme, Record<ColorMode, ITheme>> = {
  yeoul: {
    dark: { background: '#1a1b23', foreground: '#e2e2ea', cursor: '#75b9ba', selectionBackground: '#304449' },
    light: { background: '#f7f9f8', foreground: '#252b28', cursor: '#2f6670', selectionBackground: '#d9e6e4' },
  },
  blue: {
    dark: { background: '#131b27', foreground: '#e5edf8', cursor: '#78a9ff', selectionBackground: '#293d5b' },
    light: { background: '#f6f8fc', foreground: '#202b3b', cursor: '#285ea8', selectionBackground: '#dbe7f8' },
  },
  forest: {
    dark: { background: '#141d16', foreground: '#e1ebe3', cursor: '#76b98a', selectionBackground: '#2c4734' },
    light: { background: '#f5f8f5', foreground: '#233028', cursor: '#2f7048', selectionBackground: '#dbeadf' },
  },
  retro: {
    dark: { background: '#211a14', foreground: '#eee1ca', cursor: '#e2a557', selectionBackground: '#523c25' },
    light: { background: '#faf4e8', foreground: '#382d23', cursor: '#9a561f', selectionBackground: '#ead8b9' },
  },
  violet: {
    dark: { background: '#1b1722', foreground: '#ebe5f2', cursor: '#b39be2', selectionBackground: '#413357' },
    light: { background: '#f9f6fc', foreground: '#2f2938', cursor: '#7453a6', selectionBackground: '#e6dcf2' },
  },
}

export const terminalAppearance = {
  palette: {
    get(appearance: Appearance): ITheme {
      return PALETTES[appearance.theme][appearance.mode]
    },
  },
}
