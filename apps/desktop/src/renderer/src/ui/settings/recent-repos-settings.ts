/**
 * 최근 연 저장소 목록의 영속 (E15a) — 순서·상한 규칙은 components/recent-repos.ts가 갖는다.
 * 여기는 설정 파일과의 왕래만 담당한다 (sync-settings 관용구).
 */

/** 저장된 목록 — 없거나 깨졌으면 빈 목록(문자열 아닌 원소는 sanitizeSettings가 이미 걷어낸다) */
export function loadRecentRepos(): string[] {
  // initial은 시작 시점 스냅샷 객체다 — 그 배열을 그대로 들고 있지 않도록 복사해 넘긴다
  return [...(window.settingsApi.initial.recentRepos ?? [])]
}

export function saveRecentRepos(recent: string[]): void {
  void window.settingsApi.set({ recentRepos: recent })
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('yeoul-recent-repositories')
    channel.postMessage(recent)
    channel.close()
  }
}

export function onRecentReposChanged(listener: (recent: string[]) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  const channel = new BroadcastChannel('yeoul-recent-repositories')
  channel.onmessage = (event) => {
    if (Array.isArray(event.data) && event.data.every((path) => typeof path === 'string')) {
      listener([...event.data])
    }
  }
  return () => channel.close()
}
