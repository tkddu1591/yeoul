const PREFIX = 'yeoul.commit-draft:'
export const commitDraftStorage = {
  entry: {
    get: (key: string) => {
      try {
        return localStorage.getItem(PREFIX + key) ?? ''
      } catch {
        return ''
      }
    },
    set: (key: string, value: string) => {
      try {
        if (value) localStorage.setItem(PREFIX + key, value)
        else localStorage.removeItem(PREFIX + key)
      } catch {
        /* Session state still retains the draft. */
      }
    },
  },
}
