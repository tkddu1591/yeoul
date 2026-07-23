export type WorktreeSelectAction = 'terminal' | 'switch-app'

/** 저장값 → 동작. 미설정·깨진 값은 가벼운 기본(터미널만)으로 (스펙 확정 기본값) */
export function loadWorktreeSelectAction(): WorktreeSelectAction {
  return window.settingsApi.initial.worktreeSelectAction === 'switch-app' ? 'switch-app' : 'terminal'
}

export function saveWorktreeSelectAction(action: WorktreeSelectAction): void {
  void window.settingsApi.set({ worktreeSelectAction: action })
}
