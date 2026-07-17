import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import './context-menu.css'

export interface ContextMenuItem {
  key: string
  label: string
  onSelect(): void
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose(): void
}

/** 우클릭 메뉴 — 바깥 클릭·ESC로 닫힌다. 항목 실행 후에도 닫힌다 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    // 스크롤하면 메뉴가 행에서 분리되어 엉뚱한 행을 가리키게 된다 — 닫는다 (리뷰 실측)
    const onWheel = () => onClose()
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
  }, [onClose])
  // 화면 가장자리에서 잘리지 않게 최소한만 보정한다
  const left = Math.min(x, window.innerWidth - 240)
  const top = Math.min(y, window.innerHeight - items.length * 34 - 12)
  return createPortal(
    <div ref={ref} className="ui-context-menu" role="menu" style={{ left, top }}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className="ui-context-menu__item"
          onClick={() => {
            item.onSelect()
            onClose()
          }}
          data-testid={`context-${item.key}`}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
