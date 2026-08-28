import type { Appearance } from '@git-gui/ipc-contract'
import { appearancePreference } from '../../../shared/appearance'

function writeDocumentAppearance(appearance: Appearance): void {
  const root = document.documentElement
  // 토큰 전환이 호버 transition과 겹쳐 화면 전체가 물결치지 않도록 새 값이 한 프레임
  // 페인트될 때까지 transition을 잠깐 끈다.
  root.classList.add('theme-switching')
  root.dataset.colorMode = appearance.mode
  root.dataset.theme = appearance.theme
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove('theme-switching')
    })
  })
}

export const appAppearance = {
  initial: {
    get(): Appearance {
      const appearance = appearancePreference.initial.get(
        window.settingsApi.initial,
        window.matchMedia('(prefers-color-scheme: dark)').matches,
      )
      document.documentElement.dataset.colorMode = appearance.mode
      document.documentElement.dataset.theme = appearance.theme
      return appearance
    },
  },
  selection: {
    apply(appearance: Appearance): void {
      writeDocumentAppearance(appearance)
      void window.settingsApi.set({ colorMode: appearance.mode, colorTheme: appearance.theme })
    },
  },
}
