import type { ReactNode } from 'react'
import './badge.css'

interface BadgeProps {
  children: ReactNode
  /** count: 숫자 카운트 / neutral: 일반 */
  tone?: 'neutral' | 'count'
}

export function Badge({ children, tone = 'neutral' }: BadgeProps) {
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>
}
