interface RecentPlaces {
  paths: string[]
  roots: Record<string, string>
}
function get(): RecentPlaces {
  return {
    paths: [...(window.settingsApi.initial.recentRepos ?? [])],
    roots: { ...(window.settingsApi.initial.recentWorkspaceRoots ?? {}) },
  }
}
function set(places: RecentPlaces) {
  void window.settingsApi.set({ recentRepos: places.paths, recentWorkspaceRoots: places.roots })
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('yeoul-recent-repositories')
    channel.postMessage(places)
    channel.close()
  }
}
function subscribe(listener: (places: RecentPlaces) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  const channel = new BroadcastChannel('yeoul-recent-repositories')
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const raw = event.data
    if (!raw || typeof raw !== 'object' || !('paths' in raw) || !('roots' in raw)) return
    if (!Array.isArray(raw.paths) || !raw.paths.every((path) => typeof path === 'string')) return
    if (!raw.roots || typeof raw.roots !== 'object' || Array.isArray(raw.roots)) return
    if (!Object.values(raw.roots).every((root) => typeof root === 'string')) return
    listener({ paths: [...raw.paths], roots: { ...raw.roots } as Record<string, string> })
  }
  return () => channel.close()
}
export const recentPlacesQuery = { data: { get }, selection: { set }, events: { subscribe } }
