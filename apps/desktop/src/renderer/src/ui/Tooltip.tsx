import {
  cloneElement,
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { placeTooltip, type TooltipPlacement } from './tooltip-position'
import './tooltip.css'

/** 중첩 트리거에서 바깥 카드가 남아 2장이 겹치는 것을 막는다 — 안쪽이 열리면 조상을 닫는다 (E7j 보완 I-1) */
const NestContext = createContext<(() => void) | null>(null)

interface TooltipProps {
  /** 카드 본문 — 여러 줄·요소 가능 */
  content: ReactNode
  /**
   * 평문 한 줄 요약 — 트리거의 data-tooltip으로 남아 E2E가 hover 없이도 단언할 수 있다.
   * 접근성 이름이 따로 없는 트리거에서는 이 문구가 aria-describedby 대상이 된다
   */
  summary: string
  /** 트리거 — 단일 요소여야 한다(cloneElement로 이벤트·속성을 얹는다: 레이아웃 무영향) */
  children: ReactElement
  /** 마우스 지연(ms) — 포커스는 즉시 */
  delay?: number
  /** 트리거에 이미 같은 문구의 aria-label이 있으면 끈다 — 중복 낭독 방지 (E7j 보완) */
  describedBy?: boolean
}

/**
 * 공용 호버 툴팁 (E7j) — 네이티브 title을 대체한다.
 * title은 OS가 1초쯤 뒤에 스타일 없이 그려서 앱 톤과 어긋나고 여러 줄·강조를 못 쓴다.
 */
export function Tooltip({ content, summary, children, delay = 400, describedBy }: TooltipProps) {
  const id = useId()
  const [place, setPlace] = useState<TooltipPlacement | null>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeAncestor = useContext(NestContext)

  const close = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = null
    setPlace(null)
  }

  const open = () => {
    // 중첩 트리거(행 버튼 안의 span 등)에서 안쪽이 열리면 바깥 카드부터 닫는다 — 2장 겹침 방지
    closeAncestor?.()
    const element = triggerRef.current
    if (element === null) return
    const rect = element.getBoundingClientRect()
    // 첫 배치는 대략치로 띄우고, 실제 크기를 잰 뒤 아래 이펙트가 보정한다
    setPlace(
      placeTooltip(
        { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        { width: 280, height: 80 },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    )
  }

  // 실제 카드 크기로 재배치 — 긴 경로 한 줄이 화면 밖으로 나가는 것 방지
  useEffect(() => {
    if (place === null) return
    const element = triggerRef.current
    const tip = tipRef.current
    if (element === null || tip === null) return
    const rect = element.getBoundingClientRect()
    const next = placeTooltip(
      { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      { width: tip.offsetWidth, height: tip.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    )
    if (next.top !== place.top || next.left !== place.left) setPlace(next)
    // place가 바뀔 때만 — 무한 보정을 막으려 좌표 동일하면 setState 안 한다
  }, [place])

  // 열려 있는 동안 스크롤·리사이즈·ESC는 즉시 닫는다 (트리거가 사라지는 상황 포함)
  useEffect(() => {
    if (place === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [place])

  useEffect(() => close, [])

  const trigger = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node
      const original = (children.props as { ref?: unknown }).ref
      if (typeof original === 'function') (original as (n: HTMLElement | null) => void)(node)
      else if (original !== null && typeof original === 'object')
        (original as { current: HTMLElement | null }).current = node
    },
    'data-tooltip': summary,
    'aria-describedby': describedBy !== false && place !== null ? id : undefined,
    onMouseEnter: (event: MouseEvent) => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(open, delay)
      ;(children.props as { onMouseEnter?: (e: MouseEvent) => void }).onMouseEnter?.(event)
    },
    onMouseLeave: (event: MouseEvent) => {
      close()
      ;(children.props as { onMouseLeave?: (e: MouseEvent) => void }).onMouseLeave?.(event)
    },
    onFocus: (event: FocusEvent) => {
      open()
      ;(children.props as { onFocus?: (e: FocusEvent) => void }).onFocus?.(event)
    },
    onBlur: (event: FocusEvent) => {
      close()
      ;(children.props as { onBlur?: (e: FocusEvent) => void }).onBlur?.(event)
    },
    onClick: (event: MouseEvent) => {
      close()
      ;(children.props as { onClick?: (e: MouseEvent) => void }).onClick?.(event)
    },
  } as Record<string, unknown>)

  return (
    <NestContext.Provider value={close}>
      {trigger}
      {place !== null &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className="ui-tooltip"
            style={{ top: place.top, left: place.left }}
            data-testid="tooltip"
          >
            {content}
          </div>,
          document.body,
        )}
    </NestContext.Provider>
  )
}
