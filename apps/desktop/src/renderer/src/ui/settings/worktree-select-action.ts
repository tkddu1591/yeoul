export type WorktreeSelectAction = 'terminal' | 'switch-app'

/** 저장값 → 동작. 미설정·깨진 값은 앱과 터미널의 Git 대상을 함께 맞추는 안전한 기본으로. */
export function loadWorktreeSelectAction(): WorktreeSelectAction {
  return window.settingsApi.initial.worktreeSelectAction === 'terminal' ? 'terminal' : 'switch-app'
}

export function saveWorktreeSelectAction(action: WorktreeSelectAction): void {
  void window.settingsApi.set({ worktreeSelectAction: action })
}
