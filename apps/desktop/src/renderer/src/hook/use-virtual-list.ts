import { useEffect, useRef, useState } from 'react'

export function useVirtualList(count: number, rowHeight: number) {
  const viewport = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState(0)
  const [height, setHeight] = useState(400)
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const first = Math.max(0, Math.min(Math.floor(scroll / rowHeight) - 5, Math.max(0, count - 1)))
  const end = Math.min(count, first + Math.ceil(height / rowHeight) + 10)
  return {
    data: { first, end, before: first * rowHeight, after: Math.max(0, (count - end) * rowHeight) },
    viewport,
    scroll: { update: (top: number) => setScroll(top) },
  }
}
