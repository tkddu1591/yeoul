import { GitCommitHorizontal, RefreshCw, Search } from 'lucide-react'
import { useState } from 'react'
import type { WorkspaceRepository } from '@git-gui/ipc-contract'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { VirtualList } from '../ui/VirtualList'
import { useNow } from '../ui/use-now'
import { formatAbsoluteTime, formatRelativeTime } from './relative-time'
import type { WorkspaceHistoryItem } from './workspace-overview-items'

interface WorkspaceHistoryModel {
  items: WorkspaceHistoryItem[]
  repository: WorkspaceRepository | null
  selectedHash: string | null
  error: string | null
  query: string
  hasMore: boolean
}
interface WorkspaceHistoryPanelProps {
  history: WorkspaceHistoryModel
  busy: boolean
  loading: boolean
  onRefresh(): void
  onSearch(query: string): void
  onLoadMore(): void
  onSelect(item: WorkspaceHistoryItem): void
}
export function WorkspaceHistoryPanel({
  history,
  busy,
  loading,
  onRefresh,
  onSearch,
  onLoadMore,
  onSelect,
}: WorkspaceHistoryPanelProps) {
  const [query, setQuery] = useState(history.query)
  const now = useNow()
  return (
    <Panel.Root testId="workspace-history-panel" className="min-h-0 flex-1 border-0! rounded-none!">
      <Panel.Header>
        <Panel.Title>작업 공간 이력</Panel.Title>
        <Panel.Actions>
          <Button
            variant="ghost"
            size="sm"
            isDisabled={loading}
            onPress={onRefresh}
            testId="workspace-history-refresh"
          >
            <RefreshCw size={14} /> 새로고침
          </Button>
        </Panel.Actions>
      </Panel.Header>
      <Panel.Body className="flex flex-col" data-find-scope="history">
        <form
          className="flex gap-1 border-b border-(--color-border) p-2"
          onSubmit={(event) => {
            event.preventDefault()
            onSearch(query)
          }}
        >
          <input
            className="min-w-0 flex-1 rounded border border-(--color-border) bg-(--color-surface) px-2 text-sm"
            aria-label="전체 커밋 검색"
            placeholder="전체 이력에서 메시지·해시 검색"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button variant="ghost" size="sm" type="submit" aria-label="검색" isDisabled={loading}>
            <Search size={14} />
          </Button>
          {history.query && (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => {
                setQuery('')
                onSearch('')
              }}
            >
              해제
            </Button>
          )}
        </form>
        <p className="m-0 px-3 py-1 text-xs text-(--color-text-muted)" role="status">
          {loading
            ? '이력 갱신 중…'
            : `${history.items.length}개 표시${history.query ? ` · 검색: ${history.query}` : ''}`}
        </p>
        {history.items.length >= 5000 && (
          <p className="m-0 px-3 py-1 text-xs text-(--color-text-muted)">
            전체 활동은 저장소당 최대 5,000개를 표시해요. 더 오래된 이력은 검색·현재 저장소
            그래프에서 확인하세요.
          </p>
        )}
        {history.error && (
          <p role="alert" className="px-3 text-xs text-(--color-danger)">
            {history.error}
          </p>
        )}
        {!history.items.length && !loading && (
          <p className="px-3 text-sm text-(--color-text-muted)">표시할 커밋이 없어요.</p>
        )}
        <VirtualList
          items={history.items}
          rowHeight={58}
          getKey={(item) => `${item.repository.path}:${item.commit.hash}`}
          testId="workspace-history-scroll"
          renderItem={(item) => {
            const selected =
              item.repository.path === history.repository?.path &&
              item.commit.hash === history.selectedHash
            return (
              <button
                type="button"
                data-navigation
                disabled={busy}
                onClick={() => onSelect(item)}
                aria-current={selected || undefined}
                className={`workspace-history__row flex h-full w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 text-left text-(--color-text) hover:bg-(--color-selection-bg) focus-visible:outline-2 focus-visible:outline-(--color-focus) ${selected ? 'bg-(--color-selection-bg)' : ''}`}
                title={`${item.repository.path}\n${item.commit.subject}\n${formatAbsoluteTime(item.commit.committedAt)}`}
                data-testid={`workspace-history-item-${item.repository.relativePath}-${item.commit.hash}`}
              >
                <GitCommitHorizontal size={14} className="shrink-0 text-(--color-accent)" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{item.commit.subject}</span>
                  <span className="block truncate text-xs text-(--color-text-muted)">
                    {item.repository.name} · {formatRelativeTime(item.commit.committedAt, now)} ·{' '}
                    {item.commit.authorName}
                  </span>
                </span>
                <span className="text-xs text-(--color-text-muted)">{item.commit.shortHash}</span>
              </button>
            )
          }}
        />
        {history.hasMore && (
          <Button
            variant="ghost"
            isDisabled={loading}
            onPress={onLoadMore}
            testId="workspace-history-more"
          >
            이전 커밋 더 보기
          </Button>
        )}
      </Panel.Body>
    </Panel.Root>
  )
}
