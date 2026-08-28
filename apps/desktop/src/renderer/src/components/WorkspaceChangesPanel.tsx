import { ChevronDown, ChevronRight, CircleMinus, CirclePlus, FolderGit2, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import type { FileChange } from '@git-gui/domain'
import type { WorkspaceRepository } from '@git-gui/ipc-contract'
import type { SelectedFile } from '../store/repository-store'
import type { WorkspaceChangeMoveRequest } from '../store/workspace-change-command'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { Tooltip } from '../ui/Tooltip'
import { KIND_GLYPHS, KIND_LABELS } from './change-kind'
import { FindBar } from './FindBar'
import type { WorkspaceOverviewView } from './workspace-overview-view'
import './workspace-changes-panel.css'

interface WorkspaceChangesPanelProps {
  workspaceView: WorkspaceOverviewView
  selected: SelectedFile | null
  busy: boolean
  findOpen: boolean
  findNonce: number
  onFindClose(): void
  onRefresh(): void
  onSelect(repository: WorkspaceRepository, selected: SelectedFile): void
  onMove(request: WorkspaceChangeMoveRequest): Promise<void>
}

interface WorkspaceChangeRowProps {
  repository: WorkspaceRepository
  change: FileChange
  staged: boolean
  current: boolean
  selected: boolean
  busy: boolean
  onSelect(): void
  onMove(): void
}

function WorkspaceChangeRow({
  repository,
  change,
  staged,
  current,
  selected,
  busy,
  onSelect,
  onMove,
}: WorkspaceChangeRowProps) {
  const kind = staged ? change.staged : change.unstaged
  const slashIndex = change.path.lastIndexOf('/')
  const directory = slashIndex >= 0 ? change.path.slice(0, slashIndex) : ''
  const basename = slashIndex >= 0 ? change.path.slice(slashIndex + 1) : change.path
  const label = `${repository.name}/${change.path} — ${kind === null ? '' : KIND_LABELS[kind]}`
  return (
    <div className={`workspace-change-row${selected ? ' workspace-change-row--selected' : ''}`}>
      <Tooltip content={label} summary={label} describedBy={false}>
        <button
          type="button"
          className={`workspace-change-row__main workspace-change-row__main--${kind ?? 'none'}`}
          disabled={busy}
          onClick={onSelect}
          data-testid={`workspace-file-${repository.relativePath}-${staged ? 'staged' : 'unstaged'}-${change.path}`}
        >
          <span className="workspace-change-row__kind" aria-hidden="true">
            {kind === null ? '' : KIND_GLYPHS[kind]}
          </span>
          <span className="workspace-change-row__copy">
            <strong>{basename}</strong>
            <span>{directory || '.'}</span>
          </span>
        </button>
      </Tooltip>
      <Tooltip
        content={`${repository.name}에서 ${staged ? '내리기' : '올리기'}`}
        summary={staged ? '내리기' : '올리기'}
        describedBy={false}
      >
        <button
          type="button"
          className="workspace-change-row__move"
          disabled={busy}
          onClick={onMove}
          aria-label={`${repository.name}/${change.path} ${staged ? '내리기' : '올리기'}`}
        >
          {staged ? <CircleMinus size={14} aria-hidden="true" /> : <CirclePlus size={14} aria-hidden="true" />}
        </button>
      </Tooltip>
      {!current && <span className="workspace-change-row__switch">전환</span>}
    </div>
  )
}

/** 여러 저장소의 변경 파일을 저장소 루트 아래 staged/unstaged 트리로 표시한다. */
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
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')
  const [moving, setMoving] = useState(false)
  const normalizedQuery = findOpen ? query.trim().toLowerCase() : ''
  const repositories = workspaceView.overview?.repositories ?? []
  const total = repositories.reduce((count, item) => count + (item.status?.changes.length ?? 0), 0)
  const workspaceUnstaged = repositories.flatMap(({ repository, status }) => {
    const changes = status?.changes.filter((change) => change.unstaged !== null) ?? []
    return changes.length === 0 ? [] : [{ repository, changes }]
  })
  const workspaceStaged = repositories.flatMap(({ repository, status }) => {
    const changes = status?.changes.filter((change) => change.staged !== null) ?? []
    return changes.length === 0 ? [] : [{ repository, changes }]
  })
  const interactionBusy = busy || moving

  const moveChanges = async (request: WorkspaceChangeMoveRequest) => {
    if (request.groups.length === 0) return
    setMoving(true)
    try {
      await onMove(request)
    } finally {
      setMoving(false)
    }
  }

  const toggleRepository = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <Panel
      title="변경"
      titleHint="workspace status"
      pending={workspaceView.loading || moving}
      testId="workspace-changes-panel"
      accessory={
        <>
          <Button variant="ghost" size="sm" isDisabled={workspaceView.loading} onPress={onRefresh} testId="workspace-changes-refresh">
            <RefreshCw size={13} aria-hidden="true" /> 전체
          </Button>
          <Badge tone="count">{total}</Badge>
        </>
      }
    >
      <div className="workspace-changes" data-find-scope="changes">
        {findOpen && (
          <FindBar
            query={query}
            position={total === 0 ? -1 : 0}
            count={total}
            mode="filter"
            focusSignal={findNonce}
            placeholder="저장소 또는 파일 찾기"
            onQuery={setQuery}
            onNext={() => {}}
            onPrev={() => {}}
            onClose={() => {
              setQuery('')
              onFindClose()
            }}
          />
        )}
        {workspaceView.error !== null && <p className="workspace-changes__empty" role="alert">{workspaceView.error}</p>}
        <div className="workspace-changes__toolbar" data-testid="workspace-changes-toolbar">
          <span>워크스페이스 전체</span>
          <Button
            variant="ghost"
            size="sm"
            isDisabled={interactionBusy || workspaceUnstaged.length === 0}
            onPress={() => void moveChanges({ target: 'staged', groups: workspaceUnstaged })}
            testId="workspace-stage-all"
          >
            <CirclePlus size={13} aria-hidden="true" /> 모두 올리기
          </Button>
          <Button
            variant="ghost"
            size="sm"
            isDisabled={interactionBusy || workspaceStaged.length === 0}
            onPress={() => void moveChanges({ target: 'unstaged', groups: workspaceStaged })}
            testId="workspace-unstage-all"
          >
            <CircleMinus size={13} aria-hidden="true" /> 모두 내리기
          </Button>
        </div>
        <div className="workspace-changes__scroll">
          {repositories.map(({ repository, status, error }) => {
            const repositoryMatches =
              normalizedQuery === '' ||
              repository.name.toLowerCase().includes(normalizedQuery) ||
              repository.relativePath.toLowerCase().includes(normalizedQuery)
            const allChanges = status?.changes ?? []
            const changes =
              allChanges.filter(
                (change) => repositoryMatches || change.path.toLowerCase().includes(normalizedQuery),
              )
            if (!repositoryMatches && changes.length === 0) return null
            const current = repository.path === workspaceView.currentRepository?.path
            const repositoryCollapsed = collapsed.has(repository.path) && normalizedQuery === ''
            const unstaged = changes.filter((change) => change.unstaged !== null)
            const staged = changes.filter((change) => change.staged !== null)
            const allUnstaged = allChanges.filter((change) => change.unstaged !== null)
            const allStaged = allChanges.filter((change) => change.staged !== null)
            return (
              <section
                className={`workspace-change-tree${current ? ' workspace-change-tree--current' : ''}`}
                key={repository.path}
                data-testid={`workspace-changes-${repository.relativePath}`}
              >
                <div className="workspace-change-tree__repository">
                  <button
                    type="button"
                    className="workspace-change-tree__toggle"
                    onClick={() => toggleRepository(repository.path)}
                    aria-expanded={!repositoryCollapsed}
                    aria-label={`${repository.name} ${repositoryCollapsed ? '펼치기' : '접기'}`}
                  >
                    {repositoryCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  </button>
                  <FolderGit2 size={14} aria-hidden="true" />
                  <span className="workspace-change-tree__identity">
                    <strong>{repository.name}</strong>
                    <span>{repository.relativePath}</span>
                  </span>
                  <span className="workspace-change-tree__actions">
                    <Tooltip content={`${repository.name} 변경 모두 올리기`} summary="모두 올리기" describedBy={false}>
                      <button
                        type="button"
                        disabled={interactionBusy || allUnstaged.length === 0}
                        onClick={() => void moveChanges({
                          target: 'staged',
                          groups: [{ repository, changes: allUnstaged }],
                        })}
                        aria-label={`${repository.name} 변경 모두 올리기`}
                        data-testid={`workspace-stage-all-${repository.relativePath}`}
                      >
                        <CirclePlus size={13} aria-hidden="true" />
                      </button>
                    </Tooltip>
                    <Tooltip content={`${repository.name} 변경 모두 내리기`} summary="모두 내리기" describedBy={false}>
                      <button
                        type="button"
                        disabled={interactionBusy || allStaged.length === 0}
                        onClick={() => void moveChanges({
                          target: 'unstaged',
                          groups: [{ repository, changes: allStaged }],
                        })}
                        aria-label={`${repository.name} 변경 모두 내리기`}
                        data-testid={`workspace-unstage-all-${repository.relativePath}`}
                      >
                        <CircleMinus size={13} aria-hidden="true" />
                      </button>
                    </Tooltip>
                  </span>
                  <span className="workspace-change-tree__count">{changes.length}</span>
                  {current && <span className="workspace-change-tree__current">작업 중</span>}
                </div>
                {!repositoryCollapsed && (
                  <div className="workspace-change-tree__children">
                    {error !== null ? (
                      <p className="workspace-changes__empty">이 저장소를 읽지 못했어요. {error}</p>
                    ) : (
                      <>
                        {unstaged.length > 0 && <p className="workspace-change-tree__group">변경사항</p>}
                        {unstaged.map((change) => (
                          <WorkspaceChangeRow
                            key={`unstaged:${change.path}`}
                            repository={repository}
                            change={change}
                            staged={false}
                            current={current}
                            selected={current && selected?.staged === false && selected.change.path === change.path}
                            busy={interactionBusy}
                            onSelect={() => onSelect(repository, { change, staged: false })}
                            onMove={() => void moveChanges({
                              target: 'staged',
                              groups: [{ repository, changes: [change] }],
                            })}
                          />
                        ))}
                        {staged.length > 0 && <p className="workspace-change-tree__group">저장 예정</p>}
                        {staged.map((change) => (
                          <WorkspaceChangeRow
                            key={`staged:${change.path}`}
                            repository={repository}
                            change={change}
                            staged
                            current={current}
                            selected={current && selected?.staged === true && selected.change.path === change.path}
                            busy={interactionBusy}
                            onSelect={() => onSelect(repository, { change, staged: true })}
                            onMove={() => void moveChanges({
                              target: 'unstaged',
                              groups: [{ repository, changes: [change] }],
                            })}
                          />
                        ))}
                        {changes.length === 0 && <p className="workspace-changes__empty">깨끗해요.</p>}
                      </>
                    )}
                  </div>
                )}
              </section>
            )
          })}
          {repositories.length === 0 && workspaceView.error === null && (
            <p className="workspace-changes__empty">
              {workspaceView.loading ? '저장소 변경사항을 모으고 있어요…' : '보여줄 저장소가 없어요.'}
            </p>
          )}
        </div>
      </div>
    </Panel>
  )
}
