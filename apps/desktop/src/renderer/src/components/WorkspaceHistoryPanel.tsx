import { GitCommitHorizontal, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import type { WorkspaceRepository } from '@git-gui/ipc-contract'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { Tooltip } from '../ui/Tooltip'
import { useNow } from '../ui/use-now'
import { FindBar } from './FindBar'
import { RepositoryBadge } from './RepositoryBadge'
import { formatAbsoluteTime, formatRelativeTime } from './relative-time'
import type { WorkspaceHistoryItem } from './workspace-overview-items'
import { T } from '../terms'
import './workspace-history-panel.css'

interface WorkspaceHistoryPanelProps {
  items: WorkspaceHistoryItem[]
  repository: WorkspaceRepository | null
  selectedHash: string | null
  busy: boolean
  loading: boolean
  error: string | null
  findOpen: boolean
  findNonce: number
  onFindClose(): void
  onRefresh(): void
  onSelect(item: WorkspaceHistoryItem): void
}

/** 여러 저장소의 커밋을 시간순으로 합치고, 각 행에 저장소 출처를 보존한다. */
export function WorkspaceHistoryPanel({
  items,
  repository,
  selectedHash,
  busy,
  loading,
  error,
  findOpen,
  findNonce,
  onFindClose,
  onRefresh,
  onSelect,
}: WorkspaceHistoryPanelProps) {
  const [query, setQuery] = useState('')
  const normalizedQuery = findOpen ? query.trim().toLowerCase() : ''
  const visibleItems =
    normalizedQuery === ''
      ? items
      : items.filter(({ repository: itemRepository, commit }) =>
          [itemRepository.name, itemRepository.relativePath, commit.subject, commit.hash, commit.authorName]
            .some((value) => value.toLowerCase().includes(normalizedQuery)),
        )
  const now = useNow()
  return (
    <Panel
      title={T.history}
      titleHint="workspace log"
      pending={loading}
      testId="workspace-history-panel"
      accessory={
        <>
          <Button variant="ghost" size="sm" isDisabled={loading} onPress={onRefresh} testId="workspace-history-refresh">
            <RefreshCw size={13} aria-hidden="true" /> 전체
          </Button>
          <Badge tone="count">{visibleItems.length}</Badge>
        </>
      }
    >
      <div className="workspace-history">
        {findOpen && (
          <FindBar
            query={query}
            position={visibleItems.length === 0 ? -1 : 0}
            count={visibleItems.length}
            mode="filter"
            focusSignal={findNonce}
            placeholder="저장소·메시지·해시 찾기"
            onQuery={setQuery}
            onNext={() => {}}
            onPrev={() => {}}
            onClose={() => {
              setQuery('')
              onFindClose()
            }}
          />
        )}
        {error !== null && <p className="workspace-history__empty" role="alert">{error}</p>}
        {visibleItems.length === 0 && error === null ? (
          <p className="workspace-history__empty">
            {loading ? '저장소 이력을 모으고 있어요…' : '보여줄 커밋이 없어요.'}
          </p>
        ) : (
          <div className="workspace-history__scroll" data-testid="workspace-history-scroll">
            <ol className="workspace-history__list">
              {visibleItems.map((item) => {
                const currentRepository = item.repository.path === repository?.path
                const selected = currentRepository && item.commit.hash === selectedHash
                return (
                  <li className="workspace-history__row" key={`${item.repository.path}:${item.commit.hash}`}>
                    <Tooltip
                      content={
                        <>
                          <div className="ui-tooltip__title">{item.commit.subject}</div>
                          <div className="ui-tooltip__meta">
                            {item.repository.relativePath} · {formatAbsoluteTime(item.commit.committedAt)} · {item.commit.authorName}
                          </div>
                        </>
                      }
                      summary={item.commit.subject}
                    >
                      <button
                        type="button"
                        className={`workspace-history__item${selected ? ' workspace-history__item--selected' : ''}`}
                        disabled={busy}
                        onClick={() => onSelect(item)}
                        aria-current={selected ? 'true' : undefined}
                        data-testid={`workspace-history-item-${item.repository.relativePath}-${item.commit.hash}`}
                      >
                        <span className="workspace-history__rail" aria-hidden="true">
                          <GitCommitHorizontal size={15} />
                        </span>
                        <span className="workspace-history__body">
                          <span className="workspace-history__title">
                            <RepositoryBadge repository={item.repository} current={currentRepository} />
                            <strong>{item.commit.subject}</strong>
                          </span>
                          <span className="workspace-history__meta">
                            {formatRelativeTime(item.commit.committedAt, now)} · {item.commit.authorName}
                          </span>
                        </span>
                        <span className="workspace-history__hash">{item.commit.shortHash}</span>
                      </button>
                    </Tooltip>
                  </li>
                )
              })}
            </ol>
          </div>
        )}
      </div>
    </Panel>
  )
}
