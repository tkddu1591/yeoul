import type { ReactNode } from 'react'
import { Tooltip } from './Tooltip'
import './panel.css'

interface PanelProps {
  title: string
  /** 제목 옆 배지 등 */
  accessory?: ReactNode
  children: ReactNode
  testId?: string
}

export function Panel({ title, accessory, children, testId }: PanelProps) {
  return (
    <section className="ui-panel" data-testid={testId}>
      <header className="ui-panel__head">
        <Tooltip content={title} summary={title}>
          <h2>{title}</h2>
        </Tooltip>
        {accessory}
      </header>
      <div className="ui-panel__body">{children}</div>
    </section>
  )
}
