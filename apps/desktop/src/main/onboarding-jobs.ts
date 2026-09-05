const jobs = new Map<number, { controller: AbortController; path?: string }>()
export const onboardingJobs = {
  target: { get: (id: number) => jobs.get(id)?.path },
  entry: {
    start: (id: number, path?: string) => {
      const controller = new AbortController()
      jobs.set(id, { controller, path })
      return controller.signal
    },
    finish: (id: number) => {
      jobs.delete(id)
    },
    cancel: (id: number) => {
      jobs.get(id)?.controller.abort()
    },
  },
}
