import type { CommitSummary } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { Panel } from '../ui/Panel'
import { Pictogram } from '../ui/Pictogram'
import { formatRelativeTime } from './relative-time'
import './history-panel.css'

interface HistoryPanelProps {
  history: CommitSummary[]
  /** 조회 상한 — 목록이 상한에 닿으면 "N+"로 표기해 잘렸음을 알린다 */
  limit: number
}

export function HistoryPanel({ history, limit }: HistoryPanelProps) {
  return (
    <Panel
      title="저장된 역사"
      accessory={
        <>
          <Badge tone="git">log</Badge>
          <Badge tone="count">
            <span data-testid="history-count">
              {history.length >= limit ? `${limit}+` : history.length}
            </span>
          </Badge>
        </>
      }
      testId="history-panel"
    >
      {history.length === 0 ? (
        <div className="history-panel__empty">
          <Pictogram kind="commit" size={20} label="저장 시점" />
          <p>
            아직 저장된 시점이 없어요.
            <br />
            저장할 때마다 여기에 쌓여요.
          </p>
        </div>
      ) : (
        <ol className="history-panel__list" data-testid="history-list">
          {history.map((commit) => (
            <li key={commit.hash} className="history-item">
              <span className="history-item__dot" aria-hidden="true" />
              <div className="history-item__body">
                <span className="history-item__subject" title={commit.subject}>
                  {commit.subject}
                </span>
                <span className="history-item__meta">
                  {formatRelativeTime(commit.committedAt, Date.now())} · {commit.authorName}
                </span>
              </div>
              <span className="history-item__hash">{commit.shortHash}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}
