import type { GitActivity } from '@git-gui/ipc-contract'
export const activityQuery = {
  list: { get: () => window.gitApi.jobs.history() },
  job: { cancel: (path?: string) => window.gitApi.jobs.cancel(path) },
  events: {
    subscribe: (listener: (entry: GitActivity) => void) => window.gitApi.jobs.onChanged(listener),
  },
}
