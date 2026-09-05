export const recentPlacesStorage = {
  pin: {
    get: (): string[] => {
      try {
        const value: unknown = JSON.parse(localStorage.getItem('yeoul.pinned-places') ?? '[]')
        return Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string')
          : []
      } catch {
        return []
      }
    },
    set: (paths: string[]) => {
      try {
        localStorage.setItem('yeoul.pinned-places', JSON.stringify(paths))
      } catch {
        /* Keep session choices. */
      }
    },
  },
}
