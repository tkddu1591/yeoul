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
      stored: { colorMode?: unknown; colorTheme?: unknown; systemTheme?: boolean },
      systemDark: boolean,
    ): Appearance {
      return {
        mode: getInitialMode(
          stored.systemTheme === true ? undefined : stored.colorMode,
          systemDark,
        ),
        theme: getInitialTheme(stored.colorTheme),
        ...(stored.systemTheme === true ? { followSystem: true } : {}),
      }
    },
  },
}
