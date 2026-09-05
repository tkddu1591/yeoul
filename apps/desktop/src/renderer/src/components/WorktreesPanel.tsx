import { workspaceSummary } from '../service/workspace-summary.service'
import { useState, type MouseEvent } from 'react'
import { ChevronDown, ChevronRight, FolderGit2, MoreHorizontal, RefreshCw } from 'lucide-react'
import type { WorktreeHeadInfo, WorktreeInfo } from '@git-gui/domain'
import type { WorkspaceRepository } from '@git-gui/ipc-contract'
import { formatRelativeTime } from './relative-time'
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu'
import { Panel } from '../ui/Panel'
import { Tooltip } from '../ui/Tooltip'
import { useNow } from '../ui/use-now'
import { shortenAbove, shortenBranch, sourceChip, uniqueNames } from './worktree-label'
import { T } from '../terms'
import type { WorkspaceOverviewView } from './workspace-overview-view'
import './worktrees-panel.css'

export type WorktreeAction =
  // 행 클릭 = 활성 지정 + 설정된 동작 (App이 worktreeSelectAction으로 분기)
  | { kind: 'select'; path: string; label: string }
  // 우클릭 "여기서 터미널 열기" = 설정 무관 항상 터미널
  | { kind: 'terminal'; path: string; label: string }
  | { kind: 'open'; path: string }
  // 우클릭 "새 탭에서 열기" — 이 탭은 그대로 두고 새 탭에서 그 워크트리를 연다 (E15c)
  | { kind: 'new-tab'; path: string }
  // 우클릭 "새 창에서 열기" — 이 창은 그대로 두고 새 창에서 그 워크트리를 연다 (E15b)
  | { kind: 'new-window'; path: string }
  | { kind: 'reveal'; path: string }
  | { kind: 'remove'; path: string }
  | { kind: 'add' }

interface WorktreesPanelProps {
  worktrees: WorktreeInfo[]
  /** null이면 기존 단일 저장소 목록, 값이 있으면 저장소를 최상위 노드로 감싼다. */
  workspaceView: WorkspaceOverviewView | null
  /** 앱이 지금 열고 있는 워크트리 경로 */
  currentPath: string | null
  /** 활성(터미널 대상) 워크트리 경로 */
  activePath: string | null
  /** OS 홈 디렉터리 — `~` 축약·출처 칩에 쓴다(못 구하면 빈 문자열, 축약 없이 동작) (E7j) */
  home: string
  /** HEAD 요약 캐시 — 키는 `경로::HEAD해시` (E7k) */
  headInfos: Record<string, WorktreeHeadInfo | null>
  /** 행에 마우스가 머물면 그 워크트리 하나만 조회한다 */
  onHoverWorktree(path: string, headHash: string | null): void
  busy: boolean
  onAction(action: WorktreeAction, repository?: WorkspaceRepository): void
  onRefreshWorkspace(): void
  onOpenWorkspaceRepository(
    repository: WorkspaceRepository,
    target?: { path: string; label: string },
  ): void
}

/** 워크트리 탭 (E7c) — 목록·활성 지정(클릭)·우클릭 관리. 폴더 이름으로 표시, 경로는 흐리게 */
export function WorktreesPanel({
  worktrees,
  workspaceView,
  currentPath,
  activePath,
  home,
  headInfos,
  onHoverWorktree,
  busy,
  onAction,
  onRefreshWorkspace,
  onOpenWorkspaceRepository,
}: WorktreesPanelProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; worktree: WorktreeInfo } | null>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  // E14b — 워크트리 행마다가 아니라 여기서 한 번만 구독한다 (행마다 부르면 워크트리 수만큼 구독자가 생긴다)
  const now = useNow()

  const folderName = (path: string) => path.split('/').filter(Boolean).pop() ?? path

  // E7j — 리프 이름이 겹치면(codex·claude 구조에서 흔하다) 구분되는 조상까지 붙여 유일화한다
  const names = uniqueNames(worktrees.map((worktree) => worktree.path))

  const buildMenu = (worktree: WorktreeInfo): ContextMenuEntry[] => {
    const isCurrent = worktree.path === currentPath
    const name = folderName(worktree.path)
    const owner = workspaceSummary.repository.find(workspaceView?.overview ?? null, worktree.path)
    const dispatch = (action: WorktreeAction) => onAction(action, owner ?? undefined)
    return [
      {
        key: 'terminal',
        label: '여기서 터미널 열기',
        disabled: busy || worktree.prunable,
        onSelect: () => dispatch({ kind: 'terminal', path: worktree.path, label: name }),
      },
      {
        key: 'open',
        label: isCurrent ? `앱에서 열기 — ${T.head}예요` : '앱에서 열기 (전체 전환)',
        disabled: busy || isCurrent || worktree.prunable,
        onSelect: () => dispatch({ kind: 'open', path: worktree.path }),
      },
      {
        // E15c — "새 창에서 열기"의 탭 짝 (브라우저 관례 순서 — 탭이 창보다 앞).
        // 지금 열고 있는 워크트리여도 막지 않는다 — main이 중복을 막아 그 탭을 활성화한다
        key: 'new-tab',
        label: '새 탭에서 열기',
        disabled: busy || worktree.prunable,
        onSelect: () => dispatch({ kind: 'new-tab', path: worktree.path }),
      },
      {
        // E15b — "앱에서 열기"가 이 창을 통째로 갈아타는 것이라면 이쪽은 이 창을 그대로 둔다.
        // 지금 열고 있는 워크트리여도 막지 않는다 — main이 중복을 막아 그 창을 앞으로 가져온다
        key: 'new-window',
        label: '새 창에서 열기',
        disabled: busy || worktree.prunable,
        onSelect: () => dispatch({ kind: 'new-window', path: worktree.path }),
      },
      { key: 'sep-1', separator: true },
      {
        key: 'reveal',
        label: 'Finder에서 보기',
        disabled: busy || worktree.prunable,
        onSelect: () => dispatch({ kind: 'reveal', path: worktree.path }),
      },
      {
        key: 'remove',
        label: worktree.isMain
          ? '지우기 — 본체는 지울 수 없어요'
          : isCurrent
            ? `지우기 — 지금 열고 있는 ${T.worktree}예요`
            : '지우기… (worktree remove)',
        disabled: busy || worktree.isMain || isCurrent,
        onSelect: () => dispatch({ kind: 'remove', path: worktree.path }),
      },
    ]
  }

  const openMenu = (event: MouseEvent, worktree: WorktreeInfo) => {
    event.preventDefault()
    // 키보드 활성(Enter/Space)은 좌표가 (0,0)으로 온다 — 행 위치에 붙인다 (E7a 품질 리뷰 관례)
    if (event.clientX === 0 && event.clientY === 0) {
      const rect = event.currentTarget.getBoundingClientRect()
      setMenu({ x: rect.left + 8, y: rect.bottom, worktree })
      return
    }
    setMenu({ x: event.clientX, y: event.clientY, worktree })
  }

  const branchLabel = (worktree: WorktreeInfo) =>
    worktree.prunable
      ? T.prunable
      : worktree.branch !== null
        ? shortenBranch(worktree.branch, 28)
        : `${T.detached} (${worktree.headHash?.slice(0, 7) ?? '?'})`

  const toggleRepository = (key: string) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (workspaceView !== null) {
    const repositoryOverviews = workspaceView.overview?.repositories ?? []
    return (
      <Panel
        title={T.worktree}
        titleHint="worktree"
        testId="worktrees-panel"
        pending={workspaceView.loading}
      >
        <div className="worktrees-panel">
          <div className="worktrees-panel__workspace-toolbar">
            <span>저장소별로 묶어 표시해요</span>
            <button
              type="button"
              disabled={workspaceView.loading}
              onClick={onRefreshWorkspace}
              data-testid="workspace-worktrees-refresh"
            >
              <RefreshCw size={13} aria-hidden="true" /> 전체 다시 읽기
            </button>
          </div>
          <div className="worktrees-panel__scroll" data-testid="worktrees-list">
            {workspaceView.error !== null && (
              <p className="worktrees-panel__workspace-error" role="alert">
                {workspaceView.error}
              </p>
            )}
            {repositoryOverviews.map((repositoryOverview) => {
              const { repository, worktrees: repositoryWorktrees } = repositoryOverview
              const error =
                repositoryOverview.errors?.worktrees ??
                (repositoryWorktrees === null ? repositoryOverview.error : null)
              const items = repositoryWorktrees ?? []
              const namesByPath = uniqueNames(items.map((worktree) => worktree.path))
              const key = `workspace-worktrees:${repository.path}`
              const repositoryCollapsed = collapsed.has(key)
              const currentRepository = repository.path === workspaceView.currentRepository?.path
              return (
                <section
                  className={`workspace-worktree-tree${currentRepository ? ' workspace-worktree-tree--current' : ''}`}
                  key={repository.path}
                  data-testid={`workspace-worktrees-${repository.relativePath}`}
                >
                  <div className="workspace-worktree-tree__repository">
                    <button
                      type="button"
                      className="workspace-worktree-tree__toggle"
                      aria-label={`${repository.name} ${repositoryCollapsed ? '펼치기' : '접기'}`}
                      aria-expanded={!repositoryCollapsed}
                      onClick={() => toggleRepository(key)}
                    >
                      {repositoryCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    </button>
                    <FolderGit2 size={14} aria-hidden="true" />
                    <button
                      type="button"
                      className="workspace-worktree-tree__name"
                      onClick={() => onOpenWorkspaceRepository(repository)}
                    >
                      <strong>{repository.name}</strong>
                      <span>{repository.relativePath}</span>
                    </button>
                    <span className="workspace-worktree-tree__count">{items.length}</span>
                    {currentRepository && (
                      <span className="workspace-worktree-tree__current">열림</span>
                    )}
                  </div>
                  {!repositoryCollapsed && (
                    <div className="workspace-worktree-tree__children">
                      {error !== null ? (
                        <p className="worktrees-panel__workspace-error">
                          이 저장소를 읽지 못했어요. {error}
                        </p>
                      ) : (
                        items.map((worktree) => {
                          const name = namesByPath.get(worktree.path) ?? folderName(worktree.path)
                          const summary = worktree.summary
                          const dirty =
                            summary != null &&
                            summary.staged +
                              summary.unstaged +
                              summary.untracked +
                              summary.conflicted >
                              0
                          return (
                            <div className="worktree-row-shell" key={worktree.path}>
                              <Tooltip content={worktree.path} summary={worktree.path}>
                                <button
                                  type="button"
                                  className={`worktree-row workspace-worktree-tree__row${worktree.prunable ? ' worktree-row--gone' : ''}`}
                                  onClick={(event) => {
                                    if (!currentRepository) {
                                      onOpenWorkspaceRepository(repository, {
                                        path: worktree.path,
                                        label: name,
                                      })
                                      return
                                    }
                                    if (worktree.prunable) openMenu(event, worktree)
                                    else
                                      onAction({ kind: 'select', path: worktree.path, label: name })
                                  }}
                                  onContextMenu={(event) => {
                                    openMenu(event, worktree)
                                  }}
                                  onMouseEnter={() => {
                                    if (currentRepository) {
                                      onHoverWorktree(worktree.path, worktree.headHash)
                                    }
                                  }}
                                  data-testid={`workspace-worktree-${repository.relativePath}-${folderName(worktree.path)}`}
                                >
                                  <span className="worktree-row__glyph">
                                    {worktree.path === currentPath ? '➤' : '⌂'}
                                  </span>
                                  <span className="workspace-worktree-tree__row-copy">
                                    <span>
                                      <strong>{branchLabel(worktree)}</strong>
                                      {worktree.isMain && <em>본체</em>}
                                    </span>
                                    <span>{name}</span>
                                  </span>
                                  {summary != null && (
                                    <span
                                      className={`workspace-worktree-tree__status${dirty ? ' workspace-worktree-tree__status--dirty' : ''}`}
                                    >
                                      {dirty
                                        ? [
                                            summary.conflicted > 0
                                              ? `충돌 ${summary.conflicted}`
                                              : null,
                                            summary.staged > 0 ? `S ${summary.staged}` : null,
                                            summary.unstaged > 0 ? `M ${summary.unstaged}` : null,
                                            summary.untracked > 0 ? `? ${summary.untracked}` : null,
                                          ]
                                            .filter(Boolean)
                                            .join(' · ')
                                        : '깨끗함'}
                                    </span>
                                  )}
                                </button>
                              </Tooltip>
                              {currentRepository && (
                                <button
                                  type="button"
                                  className="worktree-row__menu"
                                  aria-label={`${branchLabel(worktree)} 작업 메뉴`}
                                  disabled={busy}
                                  onClick={(event) => openMenu(event, worktree)}
                                >
                                  <MoreHorizontal size={16} aria-hidden="true" />
                                </button>
                              )}
                            </div>
                          )
                        })
                      )}
                      {items.length === 0 && error === null && (
                        <p className="worktrees-panel__workspace-error">워크트리가 없어요.</p>
                      )}
                      {currentRepository && error === null && (
                        <button
                          type="button"
                          className="worktree-row worktree-row--add"
                          onClick={() => onAction({ kind: 'add' })}
                          data-testid="worktree-add"
                        >
                          ＋ 새 {T.worktree}…
                        </button>
                      )}
                    </div>
                  )}
                </section>
              )
            })}
            {repositoryOverviews.length === 0 && workspaceView.error === null && (
              <p className="worktrees-panel__workspace-error">
                {workspaceView.loading ? '저장소들을 확인하고 있어요…' : '보여줄 저장소가 없어요.'}
              </p>
            )}
          </div>
        </div>
        {menu !== null && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={buildMenu(menu.worktree)}
            onClose={() => setMenu(null)}
          />
        )}
      </Panel>
    )
  }

  return (
    <Panel title={T.worktree} titleHint="worktree" testId="worktrees-panel">
      <div className="worktrees-panel">
        <div className="worktrees-panel__scroll" data-testid="worktrees-list">
          {worktrees.map((worktree) => {
            // E7j/E7k — store의 headInfos와 문자 단위로 일치해야 하는 캐시 키. 한 번만 계산해 재사용한다
            const headKey = `${worktree.path}::${worktree.headHash ?? ''}`
            const head = headInfos[headKey] ?? null
            const fork = head?.fork ?? null
            return (
              <div className="worktree-row-shell" key={worktree.path}>
                <Tooltip
                  summary={worktree.path}
                  content={
                    <>
                      <div className="ui-tooltip__title">
                        {worktree.branch ??
                          `${T.detached} (${worktree.headHash?.slice(0, 7) ?? '?'})`}
                      </div>
                      <div className="ui-tooltip__path">{worktree.path}</div>
                      <div className="ui-tooltip__meta">
                        출처 {sourceChip(worktree.path, home)}
                        {worktree.headHash !== null && ` · HEAD ${worktree.headHash.slice(0, 7)}`}
                        {head !== null && ` · ${head.subject}`}
                        {head !== null && ` · ${formatRelativeTime(head.committedAt, now)}`}
                        {worktree.path === currentPath && ` · ${T.head}`}
                        {worktree.locked && ' · 잠김'}
                      </div>
                      {worktree.prunable && (
                        <div className="ui-tooltip__meta">
                          폴더가 없어졌어요 — 목록에서 정리할 수 있어요
                        </div>
                      )}
                      {fork != null && (
                        <div className="ui-tooltip__meta">
                          {fork.base}에서 갈라짐 · {fork.ahead}개 앞섬 · {fork.behind}개 뒤처짐
                        </div>
                      )}
                      {worktree.branch === null && head !== null && head.containedIn.length > 0 && (
                        <div className="ui-tooltip__meta">
                          {head.containedIn.join('·')}
                          {head.containedTruncated && ' 외 여러 곳'}에 포함된 {T.commit}
                        </div>
                      )}
                    </>
                  }
                >
                  <button
                    type="button"
                    className={`worktree-row${worktree.prunable ? ' worktree-row--gone' : ''}`}
                    onClick={(event) =>
                      worktree.prunable
                        ? openMenu(event, worktree)
                        : onAction({
                            kind: 'select',
                            path: worktree.path,
                            label: names.get(worktree.path) ?? folderName(worktree.path),
                          })
                    }
                    onContextMenu={(event) => openMenu(event, worktree)}
                    onMouseEnter={() => onHoverWorktree(worktree.path, worktree.headHash)}
                    data-testid={`worktree-row-${folderName(worktree.path)}`}
                  >
                    <span className="worktree-row__lines">
                      <span className="worktree-row__line">
                        <span
                          className={`worktree-row__glyph${worktree.path === currentPath ? ' worktree-row__glyph--here' : ''}`}
                        >
                          {worktree.path === currentPath ? '➤' : '⌂'}
                        </span>
                        <span
                          className={`worktree-row__branch${worktree.path === currentPath ? ' worktree-row__branch--here' : ''}`}
                        >
                          {branchLabel(worktree)}
                        </span>
                        <span className="worktree-row__source">
                          {sourceChip(worktree.path, home)}
                        </span>
                        {worktree.path === activePath && (
                          <Tooltip
                            content="터미널 대상 — 새 터미널이 이 폴더에서 열려요"
                            summary="터미널 대상 — 새 터미널이 이 폴더에서 열려요"
                          >
                            <span className="worktree-row__terminal">❯_</span>
                          </Tooltip>
                        )}
                      </span>
                      <span className="worktree-row__line worktree-row__line--sub">
                        <span className="worktree-row__name">
                          {names.get(worktree.path) ?? folderName(worktree.path)}
                        </span>
                        <span className="worktree-row__dot">·</span>
                        <span className="worktree-row__path">
                          {shortenAbove(
                            worktree.path,
                            home,
                            (names.get(worktree.path) ?? '').split('/').length,
                          )}
                        </span>
                      </span>
                      {worktree.summary != null && (
                        <span className="worktree-row__line worktree-row__line--status">
                          {worktree.summary.conflicted > 0 && (
                            <span className="worktree-row__alert">
                              충돌 {worktree.summary.conflicted}
                            </span>
                          )}
                          {worktree.summary.staged > 0 && (
                            <span>스테이지 {worktree.summary.staged}</span>
                          )}
                          {worktree.summary.unstaged > 0 && (
                            <span>변경 {worktree.summary.unstaged}</span>
                          )}
                          {worktree.summary.untracked > 0 && (
                            <span>새 파일 {worktree.summary.untracked}</span>
                          )}
                          {worktree.summary.ahead !== null && worktree.summary.ahead > 0 && (
                            <span>↑{worktree.summary.ahead}</span>
                          )}
                          {worktree.summary.behind !== null && worktree.summary.behind > 0 && (
                            <span>↓{worktree.summary.behind}</span>
                          )}
                          {worktree.summary.staged === 0 &&
                            worktree.summary.unstaged === 0 &&
                            worktree.summary.untracked === 0 &&
                            worktree.summary.conflicted === 0 && <span>깨끗함</span>}
                          {worktree.summary.lastCommittedAt !== null && (
                            <span>{formatRelativeTime(worktree.summary.lastCommittedAt, now)}</span>
                          )}
                        </span>
                      )}
                    </span>
                  </button>
                </Tooltip>
                <button
                  type="button"
                  className="worktree-row__menu"
                  aria-label={`${branchLabel(worktree)} 작업 메뉴`}
                  disabled={busy}
                  onClick={(event) => openMenu(event, worktree)}
                  data-testid={`worktree-menu-${folderName(worktree.path)}`}
                >
                  <MoreHorizontal size={16} aria-hidden="true" />
                </button>
              </div>
            )
          })}
          <button
            type="button"
            className="worktree-row worktree-row--add"
            onClick={() => onAction({ kind: 'add' })}
            data-testid="worktree-add"
          >
            ＋ 새 {T.worktree}…
          </button>
        </div>
      </div>
      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenu(menu.worktree)}
          onClose={() => setMenu(null)}
        />
      )}
    </Panel>
  )
}
