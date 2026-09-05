import { listNavigation, type ListNavigation, type ListNavigationKey } from './list-navigation'
import type { ReactNode } from 'react'
import { useVirtualList } from '../hook/use-virtual-list'

interface VirtualListProps<T> {
  items: T[]
  rowHeight: number
  getKey(item: T): string
  renderItem(item: T, index: number): ReactNode
  testId?: string
  isFocusable?(item: T): boolean
  onNavigate?(navigation: ListNavigation): void
}

/** Generic fixed-height list. Geometry is the only runtime style; presentation uses theme utilities. */
export function VirtualList<T>({
  items,
  rowHeight,
  getKey,
  renderItem,
  testId,
  isFocusable,
  onNavigate,
}: VirtualListProps<T>) {
  const { data, viewport: viewportRef, scroll } = useVirtualList(items.length, rowHeight)
  return (
    <div
      ref={viewportRef}
      className="min-h-0 flex-1 overflow-auto overscroll-contain"
      data-testid={testId}
      onScroll={(event) => scroll.update(event.currentTarget.scrollTop)}
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        const element = event.target as HTMLElement
        const row = element.closest<HTMLElement>('[data-row-index]')
        if (!row) return
        event.preventDefault()
        const current = Number(row.dataset.rowIndex)
        const next = listNavigation.index.find(
          current,
          event.key as ListNavigationKey,
          items.length,
          (index) => isFocusable?.(items[index]!) ?? true,
        )
        if (next === null) return
        onNavigate?.({ from: current, to: next, extend: event.shiftKey })
        const viewport = event.currentTarget
        const top = next * rowHeight
        if (top < viewport.scrollTop) viewport.scrollTop = top
        if (top + rowHeight > viewport.scrollTop + viewport.clientHeight)
          viewport.scrollTop = top + rowHeight - viewport.clientHeight
        scroll.update(viewport.scrollTop)
        requestAnimationFrame(() =>
          viewport
            .querySelector<HTMLElement>(`[data-row-index="${next}"] [data-navigation]`)
            ?.focus(),
        )
      }}
    >
      <div aria-hidden="true" style={{ height: data.before }} />
      {items.slice(data.first, data.end).map((item, offset) => (
        <div key={getKey(item)} data-row-index={data.first + offset} style={{ height: rowHeight }}>
          {renderItem(item, data.first + offset)}
        </div>
      ))}
      <div aria-hidden="true" style={{ height: data.after }} />
    </div>
  )
}
