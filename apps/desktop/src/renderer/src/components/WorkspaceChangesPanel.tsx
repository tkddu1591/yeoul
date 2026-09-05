import { useReviewPreferences } from '../hook/use-review-preferences'
import {
  ChevronDown,
  ChevronRight,
  CircleMinus,
  CirclePlus,
  FolderGit2,
  RefreshCw,
  Search,
} from 'lucide-react'
import { useState } from 'react'
import type { WorkspaceChangeResult, WorkspaceRepository } from '@git-gui/ipc-contract'
import type { SelectedFile } from '../store/repository-store'
import {
  workspaceChangeCommand,
  type WorkspaceChangeEntry,
  type WorkspaceChangeMoveRequest,
} from '../store/workspace-change-command'
import { useWorkspaceSelection } from '../hook/use-workspace-selection'
import { Button } from '../ui/Button'
import { ContextMenu } from '../ui/ContextMenu'
import { Panel } from '../ui/Panel'
import { VirtualList } from '../ui/VirtualList'
import { FindBar } from './FindBar'
import { KIND_CLASSES, KIND_GLYPHS, KIND_LABELS } from './change-kind'
import type { WorkspaceOverviewView } from './workspace-overview-view'

interface WorkspaceChangesPanelProps {
  workspaceView: WorkspaceOverviewView
  selected: SelectedFile | null
  busy: boolean
  findOpen: boolean
  findNonce: number
  onFindClose(): void
  onRefresh(): void
  onSelect(repository: WorkspaceRepository, selected: SelectedFile): void
  onMove(request: WorkspaceChangeMoveRequest): Promise<WorkspaceChangeResult>
}

export function WorkspaceChangesPanel({
  workspaceView,
  selected,
  busy,
  findOpen,
  findNonce,
  onFindClose,
  onRefresh,
  onSelect,
  onMove,
}: WorkspaceChangesPanelProps) {
  const preference = useReviewPreferences()
  const list = useWorkspaceSelection(workspaceView.overview, onMove)
  const [searchOpen, setSearchOpen] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; entry: WorkspaceChangeEntry } | null>(
    null,
  )
  const { data } = list
  const disabled = busy || data.moving
  const staged = data.selected.filter((entry) => entry.staged)
  const unstaged = data.selected.filter((entry) => !entry.staged)
  return (
    <Panel.Root testId="workspace-changes-panel" className="border-0! rounded-none!">
      <Panel.Header>
        <Panel.Title>저장소 · 워크트리</Panel.Title>
        <Panel.Actions>
          <Button
            variant="ghost"
            size="sm"
            aria-label="변경 검색"
            onPress={() => setSearchOpen(true)}
          >
            <Search size={14} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            isDisabled={workspaceView.loading}
            onPress={onRefresh}
            testId="workspace-changes-refresh"
          >
            <RefreshCw size={14} /> 새로고침
          </Button>
        </Panel.Actions>
      </Panel.Header>
      <Panel.Body className="flex flex-col" data-find-scope="changes">
        {(findOpen || searchOpen) && (
          <FindBar
            query={data.query}
            position={data.visibleEntries.length ? 0 : -1}
            count={data.visibleEntries.length}
            mode="filter"
            focusSignal={findNonce}
            placeholder="저장소·워크트리·파일 검색"
            onQuery={list.filter.set}
            onNext={() => {}}
            onPrev={() => {}}
            onClose={() => {
              list.filter.set('')
              setSearchOpen(false)
              onFindClose()
            }}
          />
        )}
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-(--color-border) px-3 py-2 text-xs"
          data-testid="workspace-changes-toolbar"
        >
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={data.all}
              disabled={disabled || !data.visibleEntries.length}
              ref={(element) => {
                if (element) element.indeterminate = !data.all && data.selected.length > 0
              }}
              onChange={() => list.selection.toggle(data.visibleEntries, !data.all)}
              data-testid="workspace-check-all"
            />
            {data.query ? '검색 결과 선택' : '모두 선택'}
            {data.selected.length ? ` (${data.selected.length})` : ''}
          </label>
          <Button
            variant="ghost"
            size="sm"
            isDisabled={disabled || !unstaged.length}
            onPress={() => void list.change.move(unstaged, 'staged')}
            testId="workspace-stage-selected"
            aria-label="선택한 파일을 스테이지에 추가"
          >
            <CirclePlus size={13} /> 추가
          </Button>
          <Button
            variant="ghost"
            size="sm"
            isDisabled={disabled || !staged.length}
            onPress={() => void list.change.move(staged, 'unstaged')}
            testId="workspace-unstage-selected"
          >
            <CircleMinus size={13} /> 제외
          </Button>
        </div>
        {data.hidden > 0 && (
          <div className="flex items-center justify-between px-3 py-1 text-xs text-(--color-danger)">
            검색 밖 {data.hidden}개 선택됨
            <Button variant="ghost" size="sm" onPress={list.selection.clear}>
              선택 해제
            </Button>
          </div>
        )}
        {workspaceView.loading && (
          <p role="status" className="m-0 px-3 py-1 text-xs text-(--color-text-muted)">
            작업 상태 갱신 중…
          </p>
        )}
        {workspaceView.error && (
          <p role="alert" className="px-3 text-sm text-(--color-danger)">
            {workspaceView.error}
          </p>
        )}
        {data.result && (
          <p
            role="status"
            data-testid="workspace-batch-result"
            className="m-0 px-3 py-1 text-xs text-(--color-text-muted)"
          >
            완료 {data.result.results.filter((item) => item.status === 'completed').length} · 실패{' '}
            {data.result.results.filter((item) => item.status === 'failed').length} · 대기{' '}
            {data.result.results.filter((item) => item.status === 'pending').length}
            {data.result.results.some((item) => item.status !== 'completed') &&
              ' — 선택된 남은 항목을 다시 실행할 수 있어요.'}
          </p>
        )}
        {data.rows.length === 0 && !workspaceView.loading && (
          <p className="px-3 text-sm text-(--color-text-muted)">
            {data.query ? '검색 결과가 없어요.' : '작업 공간에 변경이 없어요.'}
          </p>
        )}
        <VirtualList
          items={data.rows}
          isFocusable={(row) => row.kind !== 'empty'}
          onNavigate={list.selection.navigate}
          rowHeight={preference.data.listDensity === 'compact' ? 34 : 44}
          getKey={(row) => row.key}
          testId="workspace-file-list"
          renderItem={(row) => {
            if (row.kind === 'empty')
              return (
                <p className="m-0 truncate px-9 py-3 text-xs text-(--color-text-muted)">
                  {row.text}
                </p>
              )
            if (row.kind === 'target') {
              const target = row.target
              const current =
                target.repository.path ===
                (workspaceView.currentPath ?? workspaceView.currentRepository?.path)
              const all =
                target.entries.length > 0 &&
                target.entries.every((entry) =>
                  data.checked.has(workspaceChangeCommand.selection.key.get(entry)),
                )
              return (
                <div
                  className={`group flex h-full items-center gap-2 border-b border-(--color-border) px-2 text-xs ${current ? 'bg-(--color-selection-bg)' : ''}`}
                  data-testid={`workspace-changes-${target.repository.relativePath}`}
                >
                  <button
                    type="button"
                    className="flex shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 text-(--color-text)"
                    data-navigation
                    aria-label={`${target.repository.name} 접기·펼치기`}
                    aria-expanded={!data.collapsed.has(target.repository.path)}
                    onClick={() => list.group.toggle(target.repository.path)}
                  >
                    {data.collapsed.has(target.repository.path) ? (
                      <ChevronRight size={14} />
                    ) : (
                      <ChevronDown size={14} />
                    )}
                  </button>
                  <input
                    type="checkbox"
                    aria-label={`${target.repository.name} 변경 모두 선택`}
                    checked={all}
                    disabled={disabled || !target.entries.length}
                    onChange={() => list.selection.toggle(target.entries, !all)}
                    data-testid={`workspace-check-repository-${target.repository.relativePath}`}
                  />
                  <FolderGit2 size={14} className="shrink-0" />
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={`${target.repository.path}\n${target.branch ?? '분리 HEAD'}`}
                  >
                    <strong>{target.repository.name}</strong>
                    <span className="ml-2 hidden text-(--color-text-muted) min-[1200px]:inline">
                      {target.branch ?? '분리 HEAD'}
                    </span>
                  </span>
                  <span>{target.status?.changes.length ?? 0}</span>
                  {current && (
                    <span
                      className="shrink-0 text-(--color-accent)"
                      title="현재 작업 폴더"
                      role="img"
                      aria-label="현재 작업 폴더"
                    >
                      ●
                    </span>
                  )}
                  <button
                    type="button"
                    className="flex shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 text-(--color-text-muted) opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                    disabled={disabled}
                    aria-label={`${target.repository.name} 스테이지 추가`}
                    onClick={() =>
                      void list.change.move(
                        target.entries.filter((entry) => !entry.staged),
                        'staged',
                      )
                    }
                    data-testid={`workspace-stage-all-${target.repository.relativePath}`}
                  >
                    <CirclePlus size={14} />
                  </button>
                  <button
                    type="button"
                    className="flex shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 text-(--color-text-muted) opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                    disabled={disabled}
                    aria-label={`${target.repository.name} 스테이지 제외`}
                    onClick={() =>
                      void list.change.move(
                        target.entries.filter((entry) => entry.staged),
                        'unstaged',
                      )
                    }
                    data-testid={`workspace-unstage-all-${target.repository.relativePath}`}
                  >
                    <CircleMinus size={14} />
                  </button>
                </div>
              )
            }
            const { entry } = row
            const { repository, change } = entry
            const kind = entry.staged ? change.staged : change.unstaged
            const current =
              repository.path ===
              (workspaceView.currentPath ?? workspaceView.currentRepository?.path)
            const active =
              current && selected?.staged === entry.staged && selected.change.path === change.path
            return (
              <div
                className={`workspace-change-row flex h-full items-center gap-2 px-3 ${active ? 'bg-(--color-selection-bg)' : ''}`}
              >
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={data.checked.has(row.key)}
                  aria-label={`${repository.name}/${change.path} 선택`}
                  onChange={(event) => list.selection.toggle([entry], event.target.checked)}
                  data-testid={`workspace-check-${repository.relativePath}-${entry.staged ? 'staged' : 'unstaged'}-${change.path}`}
                />
                <button
                  type="button"
                  data-navigation
                  disabled={disabled}
                  aria-current={active || undefined}
                  className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 rounded border-0 bg-transparent px-2 text-left text-xs text-(--color-text) hover:bg-(--color-selection-bg) focus-visible:outline-2 focus-visible:outline-(--color-focus)"
                  title={`${repository.path}/${change.path}`}
                  onClick={() => onSelect(repository, { change, staged: entry.staged })}
                  onKeyDown={(event) => {
                    if (event.key === ' ') {
                      event.preventDefault()
                      list.selection.toggle([entry], !data.checked.has(row.key))
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setMenu({ x: event.clientX, y: event.clientY, entry })
                  }}
                  data-testid={`workspace-file-${repository.relativePath}-${entry.staged ? 'staged' : 'unstaged'}-${change.path}`}
                >
                  <span role="img" aria-label={kind ? KIND_LABELS[kind] : '변경'}>
                    {kind ? KIND_GLYPHS[kind] : ''}
                  </span>
                  <span className={`min-w-0 flex-1 truncate ${kind ? KIND_CLASSES[kind] : ''}`}>
                    {change.path}
                  </span>
                  {entry.staged && (
                    <span className="shrink-0 rounded bg-(--color-selection-bg) px-1 text-(--color-accent)">
                      스테이지
                    </span>
                  )}
                </button>
              </div>
            )
          }}
        />
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            items={[
              {
                key: menu.entry.staged ? 'workspace-unstage-file' : 'workspace-stage-file',
                label: menu.entry.staged ? '스테이지 제외' : '스테이지 추가',
                disabled,
                onSelect: () =>
                  void list.change.move([menu.entry], menu.entry.staged ? 'unstaged' : 'staged'),
              },
            ]}
          />
        )}
      </Panel.Body>
    </Panel.Root>
  )
}
