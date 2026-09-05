export interface GitProcessActivity {
  id: number
  operation: string
  cwd: string
  startedAt: number
  status: 'running' | 'completed' | 'failed' | 'canceled'
  durationMs: number
}
let nextId = 0
const listeners = new Set<(entry: GitProcessActivity) => void>()
function publish(entry: GitProcessActivity) {
  for (const listener of listeners) {
    try {
      listener(entry)
    } catch {
      /* Observers never interrupt a Git operation. */
    }
  }
}
export const gitProcessActivity = {
  events: {
    subscribe: (listener: (entry: GitProcessActivity) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  },
  entry: {
    start: (operation: string, cwd: string): GitProcessActivity => {
      const entry: GitProcessActivity = {
        id: ++nextId,
        operation,
        cwd,
        startedAt: Date.now(),
        status: 'running',
        durationMs: 0,
      }
      publish(entry)
      return entry
    },
    finish: (entry: GitProcessActivity, status: GitProcessActivity['status']) =>
      publish({ ...entry, status, durationMs: Date.now() - entry.startedAt }),
  },
}
