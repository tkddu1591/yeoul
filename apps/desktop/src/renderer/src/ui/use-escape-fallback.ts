import { useEffect } from 'react'

/**
 * react-aria 오버레이의 ESC 사각지대 보완 (E1a 잔여·E3b 리뷰 — 플랜 실측 2).
 * react-aria의 ESC 닫기는 오버레이 DOM 요소에 부착된 onKeyDown이라, busy로 포커스된
 * 버튼이 비활성화되어 포커스가 body로 떨어지면 keydown 경로에 오버레이가 없어 죽는다.
 * 포커스가 body일 때만 문서 수준에서 받아 닫는다 — react-aria가 처리한 ESC는
 * stopPropagation으로 여기까지 오지 않으므로(실측) 이중 닫힘이 없다.
 */
export function useEscapeFallback(isOpen: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.activeElement !== document.body) return
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])
}
