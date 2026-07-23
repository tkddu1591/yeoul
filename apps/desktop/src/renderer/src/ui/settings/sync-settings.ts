export type PullMode = 'merge' | 'rebase'

/** 받아오기 방식 — 미설정·깨진 값은 기존 방식(merge) (E7e 스펙 기본값) */
export function loadPullMode(): PullMode {
  return window.settingsApi.initial.pullMode === 'rebase' ? 'rebase' : 'merge'
}

export function savePullMode(mode: PullMode): void {
  void window.settingsApi.set({ pullMode: mode })
}

/** 자동 원격 새로고침 — 기본 켬 (E7e). 명시적으로 false일 때만 꺼진다 */
export function loadAutoFetch(): boolean {
  return window.settingsApi.initial.autoFetch !== false
}

export function saveAutoFetch(enabled: boolean): void {
  void window.settingsApi.set({ autoFetch: enabled })
}
