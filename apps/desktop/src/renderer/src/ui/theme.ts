export type Theme = 'light' | 'dark'

/** 저장된 값이 있으면 그것을, 없으면 시스템 설정을 따른다 — 순수 함수라 단위 테스트한다 */
export function resolveInitialTheme(stored: string | null, systemDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored
  return systemDark ? 'dark' : 'light'
}

/** 첫 렌더에서 호출해 문서 루트에 테마를 새기고 현재 값을 돌려준다 — preload의 동기 스냅샷이라 깜빡임이 없다 */
export function initTheme(): Theme {
  const theme = resolveInitialTheme(
    window.settingsApi.initial.theme ?? null,
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  document.documentElement.dataset.theme = theme
  return theme
}

/** 테마를 적용하고 기억한다 — main이 settings.json으로 영속화한다 (Task 8h) */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  void window.settingsApi.set({ theme })
}
