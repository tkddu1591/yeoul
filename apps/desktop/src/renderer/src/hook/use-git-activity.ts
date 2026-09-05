import { useEffect, useState } from 'react'
import type { GitActivity } from '@git-gui/ipc-contract'
import { activityQuery } from '../store/activity-query'
export function useGitActivity() {
  const [entries, setEntries] = useState<GitActivity[]>([])
  useEffect(() => {
    let alive = true
    const unsubscribe = activityQuery.events.subscribe((entry) =>
      setEntries((previous) =>
        [...previous.filter((item) => item.id !== entry.id), entry].slice(-100),
      ),
    )
    void activityQuery.list.get().then((initial) => {
      if (alive)
        setEntries((previous) => [
          ...new Map([...initial, ...previous].map((item) => [item.id, item])).values(),
        ])
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])
  return {
    data: { entries, running: entries.filter((item) => item.status === 'running') },
    job: { cancel: activityQuery.job.cancel },
  }
}
