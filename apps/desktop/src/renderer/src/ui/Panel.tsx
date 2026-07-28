import type { ReactNode } from 'react'
import { Tooltip } from './Tooltip'
import './panel.css'

interface PanelProps {
  title: string
  /** 원어 병기(E8) — 있으면 툴팁 본문이 "title (titleHint)"가 된다. 보이는 <h2>는 title 그대로 */
  titleHint?: string
  /** 제목 옆 배지 등 */
  accessory?: ReactNode
  children: ReactNode
  testId?: string
}

export function Panel({ title, titleHint, accessory, children, testId }: PanelProps) {
  const tooltipContent = titleHint !== undefined ? `${title} (${titleHint})` : title
  return (
    <section className="ui-panel" data-testid={testId}>
      <header className="ui-panel__head">
        <Tooltip content={tooltipContent} summary={title}>
          <h2>{title}</h2>
        </Tooltip>
        {accessory}
      </header>
      <div className="ui-panel__body">{children}</div>
    </section>
  )
}
