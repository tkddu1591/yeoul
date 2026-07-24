import { useEffect, useRef } from 'react'
import './find-bar.css'

interface FindBarProps {
  query: string
  /** 현재 매치 위치(0-based) — 매치 없으면 -1 */
  position: number
  count: number
  placeholder: string
  /** 필터형(E7h ⑥ 편차) — 위치 개념이 없는 목록 필터(CommitDetailPanel·ChangesPanel)에서 카운트만 렌더 */
  mode?: 'filter'
  /** 이미 열려 있는 상태에서 재⌘F할 때마다 바뀌는 카운터 — 재포커스 트리거 (E7h ⑥ 보완) */
  focusSignal: number
  onQuery(query: string): void
  onNext(): void
  onPrev(): void
  onClose(): void
}

/** 패널 우상단 검색 오버레이 (E7h ⑥) — Enter/↓ 다음, ⇧Enter/↑ 이전, ESC 닫기 */
export function FindBar({
  query,
  position,
  count,
  placeholder,
  mode,
  focusSignal,
  onQuery,
  onNext,
  onPrev,
  onClose,
}: FindBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [focusSignal])
  return (
    <div className="find-bar" data-testid="find-bar">
      <input
        ref={inputRef}
        className={`find-bar__input${query !== '' && count === 0 ? ' find-bar__input--empty' : ''}`}
        value={query}
        placeholder={placeholder}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          } else if (event.key === 'Enter' || event.key === 'ArrowDown') {
            event.preventDefault()
            if (event.key === 'Enter' && event.shiftKey) onPrev()
            else onNext()
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            onPrev()
          }
        }}
        data-testid="find-bar-input"
      />
      <span className="find-bar__count" data-testid="find-bar-count">
        {mode === 'filter' ? `${count}개` : count === 0 ? '0/0' : `${position + 1}/${count}`}
      </span>
      <button type="button" className="find-bar__nav" onClick={onPrev} aria-label="이전 결과">
        ↑
      </button>
      <button type="button" className="find-bar__nav" onClick={onNext} aria-label="다음 결과">
        ↓
      </button>
      <button
        type="button"
        className="find-bar__nav"
        onClick={onClose}
        aria-label="검색 닫기"
        data-testid="find-bar-close"
      >
        ✕
      </button>
    </div>
  )
}
