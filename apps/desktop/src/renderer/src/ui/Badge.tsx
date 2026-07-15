import type { ReactNode } from 'react'
import './badge.css'

interface BadgeProps {
  children: ReactNode
  /** git: Git 용어 병기(모노스페이스, 파랑) / count: 숫자 카운트 / neutral: 일반 */
  tone?: 'neutral' | 'git' | 'count'
}

export function Badge({ children, tone = 'neutral' }: BadgeProps) {
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>
}
