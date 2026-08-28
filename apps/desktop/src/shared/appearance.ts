import type { Appearance, ColorMode, ColorTheme } from '@git-gui/ipc-contract'

const DEFAULT_THEME: ColorTheme = 'yeoul'

function getInitialMode(stored: unknown, systemDark: boolean): ColorMode {
  if (stored === 'light' || stored === 'dark') return stored
  return systemDark ? 'dark' : 'light'
}

function getInitialTheme(stored: unknown): ColorTheme {
  if (
    stored === 'yeoul' ||
    stored === 'blue' ||
    stored === 'forest' ||
    stored === 'retro' ||
    stored === 'violet'
  ) {
    return stored
  }
  return DEFAULT_THEME
}

export const appearancePreference = {
  initial: {
    get(
      stored: { colorMode?: unknown; colorTheme?: unknown },
      systemDark: boolean,
    ): Appearance {
      return {
        mode: getInitialMode(stored.colorMode, systemDark),
        theme: getInitialTheme(stored.colorTheme),
      }
    },
  },
}
