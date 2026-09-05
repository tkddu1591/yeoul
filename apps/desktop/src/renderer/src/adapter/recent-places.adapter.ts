export interface RecentPlacesHistory {
  paths: string[]
  roots: Record<string, string>
}
function toList(history: RecentPlacesHistory, pins: string[], query: string, home: string) {
  const needle = query.trim().toLocaleLowerCase()
  return [...new Set([...pins, ...history.paths])]
    .filter((path) => path.toLocaleLowerCase().includes(needle))
    .map((path) => {
      const root = history.roots[path]
      const name = path.split('/').filter(Boolean).pop() ?? path
      const workspaceName = root?.split('/').filter(Boolean).pop()
      return {
        path,
        name: root && root !== path ? `${workspaceName} / ${name}` : name,
        kind: root ? '작업 공간' : '저장소',
        label: home && path.startsWith(home + '/') ? '~' + path.slice(home.length) : path,
        pinned: pins.includes(path),
      }
    })
}
export const recentPlacesAdapter = { list: { toList } }
