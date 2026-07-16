import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef } from 'react'
import type { CommitSummary } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { Panel } from '../ui/Panel'
import { Pictogram } from '../ui/Pictogram'
import { formatRelativeTime } from './relative-time'
import './history-panel.css'
import './virtual.css'

interface HistoryPanelProps {
  history: CommitSummary[]
  /** 현재 조회 상한 — 목록이 상한에 닿으면 "N+"로 표기하고, 스크롤 끝에서 더 불러온다 (⑩) */
  historyLimit: number
  /** 현재 브랜치 — 같은 이름의 ref 배지를 강조한다 */
  currentBranch: string | null
  selectedHash: string | null
  busy: boolean
  onSelect(hash: string): void
  onLoadMore(): void
}

export function HistoryPanel({
  history,
  historyLimit,
  currentBranch,
  selectedHash,
  busy,
  onSelect,
  onLoadMore,
}: HistoryPanelProps) {
  const truncated = history.length >= historyLimit
  // 수천 커밋에서도 DOM은 가시 범위만 유지한다 (#4)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: history.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 52,
    overscan: 10,
  })
  const virtualItems = virtualizer.getVirtualItems()
  const lastRendered = virtualItems[virtualItems.length - 1]?.index ?? -1

  // 마지막 행이 렌더 범위에 들어오면 다음 페이지를 불러온다 (⑩) — busy·상한은 store가 이중 방어한다
  useEffect(() => {
    if (truncated && !busy && lastRendered >= history.length - 1) onLoadMore()
  }, [truncated, busy, lastRendered, history.length, onLoadMore])

  return (
    <Panel
      title="저장된 역사"
      accessory={
        <>
          <Badge tone="git">log</Badge>
          <Badge tone="count">
            <span data-testid="history-count">
              {truncated ? `${historyLimit}+` : history.length}
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
        <div ref={scrollRef} className="virtual-scroll" data-testid="history-scroll">
          <ol
            className="history-panel__list"
            data-testid="history-list"
            style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
          >
            {virtualItems.map((item) => {
              const commit = history[item.index]!
              // 가상화에서는 :last-child가 "전체의 마지막"이 아니다 — 커넥터·잘림 표시는 index로 판정한다
              const isLast = item.index === history.length - 1
              const connected = !isLast || truncated
              return (
                <li
                  key={commit.hash}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="virtual-row"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <button
                    type="button"
                    className={[
                      'history-item',
                      item.index === 0 ? 'history-item--head' : '',
                      connected ? 'history-item--connected' : '',
                      isLast && truncated ? 'history-item--truncated' : '',
                      selectedHash === commit.hash ? 'history-item--selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    disabled={busy}
                    onClick={() => onSelect(commit.hash)}
                    data-testid={`history-item-${commit.hash}`}
                  >
                    <span className="history-item__dot" aria-hidden="true" />
                    <div className="history-item__body">
                      <span className="history-item__title">
                        {commit.refs.map((ref) => (
                          <span
                            key={ref}
                            className={`history-item__ref${
                              ref === currentBranch ? ' history-item__ref--head' : ''
                            }`}
                          >
                            {ref}
                          </span>
                        ))}
                        {commit.parents.length >= 2 && (
                          <span className="history-item__mergemark">병합</span>
                        )}
                        <span className="history-item__subject" title={commit.subject}>
                          {commit.subject}
                        </span>
                      </span>
                      <span className="history-item__meta">
                        {formatRelativeTime(commit.committedAt, Date.now())} · {commit.authorName}
                      </span>
                    </div>
                    <span className="history-item__hash">{commit.shortHash}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </Panel>
  )
}
