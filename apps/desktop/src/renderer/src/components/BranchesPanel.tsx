import { useState, type MouseEvent } from 'react'
import { MoreHorizontal, RefreshCw } from 'lucide-react'
import type { BranchCompare, BranchOverview, CommitSummary, LocalBranchStatus, RemoteBranchRef } from '@git-gui/domain'
import { Button } from '../ui/Button'
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu'
import { Panel } from '../ui/Panel'
import { Tooltip } from '../ui/Tooltip'
import { useNow } from '../ui/use-now'
import { buildBranchTree, flatSearch, flattenBranchTree } from './branch-tree'
import { formatRelativeTime } from './relative-time'
import { T } from '../terms'
import './branches-panel.css'

export type BranchPanelAction =
  | { kind: 'switch'; name: string }
  | { kind: 'branch-from'; name: string; hash: string }
  | { kind: 'merge'; name: string }
  | { kind: 'rebase'; name: string }
  | { kind: 'compare'; name: string }
  | { kind: 'update'; name: string }
  | { kind: 'backup'; name: string }
  | { kind: 'rename'; name: string }
  | { kind: 'remove'; name: string }
  | { kind: 'checkout-remote'; name: string }
  | { kind: 'remove-remote'; name: string }
  /** 더블클릭 조회 — 우측 역사가 이 계보로 (E7g) */
  | { kind: 'view'; name: string }

interface BranchesPanelProps {
  overview: BranchOverview | null
  /** "지금과 비교" 결과 — non-null이면 목록 대신 비교 뷰를 보여준다 */
  compare: { name: string; result: BranchCompare } | null
  currentBranch: string | null
  /** 역사 조회 중인 브랜치 — 해당 행을 보라 하이라이트 (E7g) */
  historyRef: string | null
  busy: boolean
  /** 진행 중 작업(merging 등) — 파괴적 항목을 사유와 함께 비활성한다 */
  actionsDisabled: boolean
  /** 마지막 원격 새로고침 시각 — null이면 아직 없음 (E7e) */
  lastFetchAt: number | null
  /** 수동 원격 새로고침 (E7e) */
  onFetchRemotes(): void
  onAction(action: BranchPanelAction): void
  onCloseCompare(): void
  /** 이 패널로 떨어질 조회(좌측 비교)가 진행 중인가 (E14a) */
  pending: boolean
}

interface MenuState {
  x: number
  y: number
  target: { kind: 'local'; branch: LocalBranchStatus } | { kind: 'remote'; name: string }
}

/**
 * 실험 공간 패널 (E7a → E7g 개편) — depth 트리·3단 인터랙션.
 * 1클릭=선택만(중립) · 더블클릭=조회(view) · 우클릭=메뉴. 빠른 전환은 헤더 스위처가 담당
 */
export function BranchesPanel({
  overview,
  compare,
  currentBranch,
  historyRef,
  busy,
  actionsDisabled,
  lastFetchAt,
  onFetchRemotes,
  onAction,
  onCloseCompare,
  pending,
}: BranchesPanelProps) {
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  // E14b — "n분 전 가져옴" 표시용. 렌더 중 Date.now()를 부르면 렌더가 순수하지 않고,
  // 실제로도 다른 이유로 리렌더될 때까지 숫자가 멈춰 있었다
  const now = useNow()

  // 불가 항목은 숨기지 않고 사유와 함께 비활성한다 (HistoryPanel undo/reword 관례)
  const buildLocalMenu = (branch: LocalBranchStatus): ContextMenuEntry[] => {
    const isCurrent = branch.name === currentBranch
    const noUpstream = branch.upstream === null
    return [
      {
        key: 'switch',
        label: isCurrent
          ? `이 ${T.branch}로 이동 — ${T.head}예요`
          : `이 ${T.branch}로 이동`,
        disabled: busy || actionsDisabled || isCurrent,
        onSelect: () => onAction({ kind: 'switch', name: branch.name }),
      },
      {
        key: 'branch-from',
        label: `여기서 새 ${T.branch}…`,
        disabled: busy,
        onSelect: () => onAction({ kind: 'branch-from', name: branch.name, hash: branch.hash }),
      },
      { key: 'sep-1', separator: true },
      {
        key: 'merge',
        label: isCurrent
          ? `지금 것과 ${T.merge} — 자기 자신이에요`
          : `지금 것과 ${T.merge}`,
        disabled: busy || actionsDisabled || isCurrent,
        onSelect: () => onAction({ kind: 'merge', name: branch.name }),
      },
      {
        key: 'rebase',
        label: isCurrent
          ? `지금 것을 이 위로 ${T.rebase} — 자기 자신이에요`
          : `지금 것을 이 위로 ${T.rebase}`,
        disabled: busy || actionsDisabled || isCurrent,
        onSelect: () => onAction({ kind: 'rebase', name: branch.name }),
      },
      {
        key: 'compare',
        label: isCurrent ? '지금과 비교 — 자기 자신이에요' : '지금과 비교…',
        disabled: busy || isCurrent,
        onSelect: () => onAction({ kind: 'compare', name: branch.name }),
      },
      { key: 'sep-2', separator: true },
      {
        key: 'update',
        label: isCurrent
          ? '원격 최신으로 업데이트'
          : noUpstream
            ? '원격 최신으로 업데이트 — 원격과 연결된 적이 없어요'
            : branch.upstreamGone
              ? '원격 최신으로 업데이트 — 원격에서 지워졌어요'
              : '원격 최신으로 업데이트',
        disabled: busy || actionsDisabled || noUpstream || branch.upstreamGone,
        onSelect: () => onAction({ kind: 'update', name: branch.name }),
      },
      {
        key: 'backup',
        label: T.push,
        disabled: busy || actionsDisabled,
        onSelect: () => onAction({ kind: 'backup', name: branch.name }),
      },
      { key: 'sep-3', separator: true },
      {
        key: 'rename',
        label: '이름 바꾸기…',
        disabled: busy || actionsDisabled,
        onSelect: () => onAction({ kind: 'rename', name: branch.name }),
      },
      {
        key: 'remove',
        label: isCurrent ? `지우기 — 지금 있는 ${T.branch}예요` : '지우기…',
        disabled: busy || actionsDisabled || isCurrent,
        onSelect: () => onAction({ kind: 'remove', name: branch.name }),
      },
    ]
  }

  const buildRemoteMenu = (name: string): ContextMenuEntry[] => [
    {
      key: 'checkout-remote',
      label: `내 ${T.branch}로 가져오기`,
      disabled: busy || actionsDisabled,
      onSelect: () => onAction({ kind: 'checkout-remote', name }),
    },
    {
      key: 'compare-remote',
      label: '지금과 비교…',
      disabled: busy,
      onSelect: () => onAction({ kind: 'compare', name }),
    },
    { key: 'sep-1', separator: true },
    {
      key: 'remove-remote',
      label: '원격에서 지우기…',
      disabled: busy || actionsDisabled,
      onSelect: () => onAction({ kind: 'remove-remote', name }),
    },
  ]

  const openMenu = (event: MouseEvent, target: MenuState['target']) => {
    event.preventDefault()
    // 키보드(Enter/Space) 활성화는 좌표가 (0,0)으로 온다 — 커서 대신 행 자체에 앵커한다 (품질 리뷰)
    if (event.clientX === 0 && event.clientY === 0) {
      const rect = event.currentTarget.getBoundingClientRect()
      setMenu({ x: rect.left + 8, y: rect.bottom, target })
      return
    }
    setMenu({ x: event.clientX, y: event.clientY, target })
  }

  if (compare !== null) {
    const { result } = compare
    const section = (title: string, commits: CommitSummary[], overflow: boolean, empty: string) => (
      <>
        <p className="branch-compare__section">
          {title} <span className="branch-row__count">{commits.length}</span>
        </p>
        {commits.length === 0 ? (
          <p className="branches-panel__empty">{empty}</p>
        ) : (
          commits.map((commit) => (
            <div
              key={commit.hash}
              className="branch-compare__row"
              data-testid={`compare-row-${commit.hash}`}
            >
              <span className="branch-compare__hash">{commit.shortHash}</span>
              <span className="branch-row__name">{commit.subject}</span>
            </div>
          ))
        )}
        {overflow && <p className="branch-compare__overflow">100개까지만 보여요 — 더 있어요.</p>}
      </>
    )
    return (
      <Panel
        title={`지금 ↔ "${compare.name}"`}
        titleHint="compare"
        testId="branches-panel"
        pending={pending}
      >
        <div className="branches-panel">
          <div>
            {/* 쓰기가 도는 동안만 잠근다 (DiffPanel 관례). 예전엔 "in-flight revive가 clear를
                덮어쓰는 레이스 방지"도 겸했으나(E7d ⑤), 조회가 busy를 안 켜게 된 뒤로는
                `clearBranchCompare()`의 `invalidateReads()`가 그 경합을 막는다 (E14a 스펙 §2-4-2) */}
            <Button
              variant="ghost"
              size="sm"
              isDisabled={busy}
              onPress={onCloseCompare}
              testId="branch-compare-back"
            >
              ← 목록으로
            </Button>
          </div>
          <div className="branches-panel__scroll" data-testid="branch-compare-view">
            {section(
              `"${compare.name}"에만 있는 ${T.commit}`,
              result.onlyInSelected,
              result.selectedOverflow,
              `없어요 — 전부 지금 ${T.branch}에도 있어요.`,
            )}
            {section(
              `지금 ${T.branch}에만 있는 ${T.commit}`,
              result.onlyInCurrent,
              result.currentOverflow,
              `없어요 — 전부 그 ${T.branch}에도 있어요.`,
            )}
          </div>
        </div>
      </Panel>
    )
  }

  const locals = overview?.locals ?? []
  const remotes = overview?.remotes ?? []
  const toggleFolder = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  /** 상태 툴팁 — 칩 대신 아이콘·타이포이므로 설명은 여기서 (스펙 ③) */
  const localTitle = (branch: LocalBranchStatus): string => {
    if (branch.name === currentBranch) return `${branch.name} — ${T.head}(현재 작업 중)`
    if (branch.upstreamGone)
      return `${branch.name} — 업스트림이 원격에서 사라졌어요. ${T.push}하면 다시 만들어져요`
    if (branch.upstream === null) return `${branch.name} — 아직 ${T.noUpstream}`
    return branch.name
  }

  /** 인라인 컬러 ↑↓ — 0이거나 알 수 없으면(연결 없음) 숨김 (스펙 ③) */
  const aheadBehind = (branch: LocalBranchStatus) => (
    <>
      {branch.ahead !== null && branch.ahead > 0 && (
        <span className="branch-row__ahead">↑{branch.ahead}</span>
      )}
      {branch.behind !== null && branch.behind > 0 && (
        <span className="branch-row__behind">↓{branch.behind}</span>
      )}
    </>
  )

  const localRow = (branch: LocalBranchStatus, displayName: string, depth: number) => {
    const isCurrent = branch.name === currentBranch
    const dimmed = branch.upstream === null || branch.upstreamGone
    return (
      <Tooltip key={branch.name} content={localTitle(branch)} summary={localTitle(branch)}>
        <button
          type="button"
          className={[
            'branch-row',
            selectedName === branch.name ? 'branch-row--selected' : '',
            historyRef === branch.name ? 'branch-row--viewing' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          onClick={() => setSelectedName(branch.name)}
          onDoubleClick={() => onAction({ kind: 'view', name: branch.name })}
          onContextMenu={(event) => openMenu(event, { kind: 'local', branch })}
          data-testid={`branch-row-${branch.name}`}
        >
          <span className={`branch-row__glyph${isCurrent ? ' branch-row__glyph--here' : ''}`}>
            {isCurrent ? '➤' : '⎇'}
          </span>
          <span
            className={[
              'branch-row__name',
              isCurrent ? 'branch-row__name--here' : '',
              dimmed ? 'branch-row__name--dim' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {displayName}
          </span>
          {aheadBehind(branch)}
        </button>
      </Tooltip>
    )
  }

  const remoteRow = (name: string, displayName: string, depth: number) => (
    <Tooltip key={name} content={name} summary={name}>
      <button
        type="button"
        className={[
          'branch-row',
          'branch-row--remote',
          selectedName === name ? 'branch-row--selected' : '',
          historyRef === name ? 'branch-row--viewing' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => setSelectedName(name)}
        onDoubleClick={() => onAction({ kind: 'view', name })}
        onContextMenu={(event) => openMenu(event, { kind: 'remote', name })}
        data-testid={`branch-row-${name}`}
      >
        <span className="branch-row__glyph">☁</span>
        <span className="branch-row__name">{displayName}</span>
      </button>
    </Tooltip>
  )

  const folderRow = (path: string, name: string, count: number, depth: number) => (
    <button
      key={`folder:${path}`}
      type="button"
      className="branch-row branch-row--folder"
      style={{ paddingLeft: `${8 + depth * 16}px` }}
      onClick={() => toggleFolder(path)}
      data-testid={`branch-folder-${path}`}
    >
      <span className="branch-row__glyph">{collapsed.has(path) ? '▸' : '▾'}</span>
      <span className="branch-row__name branch-row__name--folder">{name}</span>
      <span className="branch-row__count">{count}</span>
    </button>
  )

  const searchLocals = flatSearch(locals, query)
  const searchRemotes = flatSearch(remotes, query)
  const localRows = flattenBranchTree(buildBranchTree(locals), collapsed)
  const remoteRows = flattenBranchTree(buildBranchTree(remotes), collapsed)
  const selectedTarget: MenuState['target'] | null =
    locals.find((branch) => branch.name === selectedName) != null
      ? { kind: 'local', branch: locals.find((branch) => branch.name === selectedName)! }
      : remotes.some((remote) => remote.name === selectedName) && selectedName !== null
        ? { kind: 'remote', name: selectedName }
        : null

  return (
    <Panel title={T.branch} titleHint="branch" testId="branches-panel" pending={pending}>
      <div className="branches-panel">
        <div className="branches-panel__fetch">
          <Button variant="ghost" size="sm" isDisabled={busy} onPress={onFetchRemotes} testId="fetch-remotes">
            <RefreshCw size={13} aria-hidden="true" /> {T.fetch}
          </Button>
          {lastFetchAt !== null && (
            <span className="branches-panel__fetch-at" data-testid="fetch-at">
              {formatRelativeTime(Math.floor(lastFetchAt / 1000), now)} {T.fetch}
            </span>
          )}
        </div>
        <input
          className="branches-panel__search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="이름으로 찾기"
          aria-label={`${T.branch} 검색`}
          data-testid="branches-search"
        />
        <div className="branches-panel__scroll" data-testid="branches-list">
          {locals.length === 0 && remotes.length === 0 ? (
            <p className="branches-panel__empty">보여줄 {T.branch}가 없어요.</p>
          ) : searchLocals !== null ? (
            <>
              {/* 검색 중엔 평면 매치 — 전체 경로 표시 (스펙 ①) */}
              {searchLocals.map((branch) => localRow(branch, branch.name, 0))}
              {(searchRemotes ?? []).map((remote) => remoteRow(remote.name, remote.name, 0))}
              {searchLocals.length === 0 && (searchRemotes ?? []).length === 0 && (
                <p className="branches-panel__empty">일치하는 이름이 없어요.</p>
              )}
            </>
          ) : (
            <>
              {locals.length > 0 && <p className="branches-panel__group">로컬 {T.branch}</p>}
              {localRows.map((row) =>
                row.node.kind === 'folder'
                  ? folderRow(row.node.path, row.node.name, row.node.count, row.depth)
                  : localRow(row.node.branch, row.node.name, row.depth),
              )}
              {remotes.length > 0 && <p className="branches-panel__group">원격</p>}
              {remoteRows.map((row) =>
                row.node.kind === 'folder'
                  ? folderRow(row.node.path, row.node.name, row.node.count, row.depth)
                  : remoteRow(row.node.branch.name, row.node.name, row.depth),
              )}
            </>
          )}
        </div>
        {selectedTarget !== null && (
          <div className="branches-panel__selection-actions" data-testid="branch-selection-actions">
            <span>더블클릭하면 이 브랜치 히스토리를 조회해요.</span>
            <button type="button" onClick={(event) => openMenu(event, selectedTarget)}>
              <MoreHorizontal size={15} aria-hidden="true" /> 작업
            </button>
          </div>
        )}
      </div>
      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={
            menu.target.kind === 'local'
              ? buildLocalMenu(menu.target.branch)
              : buildRemoteMenu(menu.target.name)
          }
          onClose={() => setMenu(null)}
        />
      )}
    </Panel>
  )
}
