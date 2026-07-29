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
  const root = document.documentElement
  // E11 — 호버·눌림 배경색 전환(Task 2)이 테마 토큰이 바뀌는 이 순간에도 동시 발화해 화면
  // 전체가 물결친다(실측: Step 4). 전환 값이 화면에 반영될 때까지 한 프레임만 전부 끈다.
  // rAF 두 번인 이유 — 한 번만 걸면 브라우저가 클래스 추가·테마 속성 변경·클래스 제거를
  // 같은 프레임에서 배치해 버려 전환이 여전히 걸릴 수 있다(실측): 첫 rAF는 새 스타일이
  // 커밋된 뒤(페인트 직전) 잡히고, 그 안의 두 번째 rAF에서야 억제를 뗀다 — 억제가 걸려
  // 있는 상태로 최소 한 프레임은 실제로 페인트된 뒤에 풀리므로, 예외로 중간에 함수가 다시
  // 불려도(빠른 연속 토글) 기존 예약은 그대로 자기 차례에 클래스를 지울 뿐이라 걸려 있는
  // 채로 남지 않는다 — 매 호출이 스스로 켜고 스스로 끈다
  root.classList.add('theme-switching')
  root.dataset.theme = theme
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove('theme-switching')
    })
  })
  void window.settingsApi.set({ theme })
}
