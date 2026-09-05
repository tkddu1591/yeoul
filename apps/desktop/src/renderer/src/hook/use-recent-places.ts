import { useState } from 'react'
import { recentPlacesAdapter, type RecentPlacesHistory } from '../adapter/recent-places.adapter'
import { recentPlacesStorage } from '../store/recent-places-storage'
export function useRecentPlaces(history: RecentPlacesHistory, home: string) {
  const [query, setQuery] = useState('')
  const [pins, setPins] = useState<string[]>(recentPlacesStorage.pin.get)
  return {
    data: { query, items: recentPlacesAdapter.list.toList(history, pins, query, home) },
    filter: { set: setQuery },
    pin: {
      toggle: (path: string) => {
        const next = pins.includes(path) ? pins.filter((item) => item !== path) : [...pins, path]
        recentPlacesStorage.pin.set(next)
        setPins(next)
      },
    },
  }
}
