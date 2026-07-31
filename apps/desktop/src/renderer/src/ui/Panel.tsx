import type { ReactNode } from 'react'
import { Tooltip } from './Tooltip'
import './panel.css'

interface PanelProps {
  title: string
  /** 원어 병기(E8) — 있으면 툴팁 본문이 "title (titleHint)"가 된다. 보이는 <h2>는 title 그대로 */
  titleHint?: string
  /** 제목 옆 배지 등 */
  accessory?: ReactNode
  /** 이 패널로 떨어질 조회가 진행 중인가 — 느린 조회에만 스피너가 배어난다 (E14a) */
  pending?: boolean
  children: ReactNode
  testId?: string
}

export function Panel({ title, titleHint, accessory, pending, children, testId }: PanelProps) {
  const tooltipContent = titleHint !== undefined ? `${title} (${titleHint})` : title
  return (
    <section className="ui-panel" data-testid={testId}>
      <header className="ui-panel__head">
        <Tooltip content={tooltipContent} summary={title}>
          <h2>{title}</h2>
        </Tooltip>
        {accessory}
        {/* 조회 중에도 이전 내용은 그대로 둔다 — 비우면 그게 다시 깜빡임이다(E14a 스펙 §2-3).
            내용을 덮는 오버레이가 아니라 헤더 우측의 작은 표시 하나다 */}
        {pending === true ? (
          <span className="ui-pending" data-testid="panel-pending" aria-label="불러오는 중" />
        ) : null}
      </header>
      <div className="ui-panel__body">{children}</div>
    </section>
  )
}
