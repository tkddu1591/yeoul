import { useState, type MouseEvent } from 'react'
import type { BranchCompare, BranchOverview, CommitSummary, LocalBranchStatus } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu'
import { Panel } from '../ui/Panel'
import { trackBadgeLabel } from './branch-badges'
import { branchDisplayName, groupBranches } from './branch-groups'
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

interface BranchesPanelProps {
  overview: BranchOverview | null
  /** "지금과 비교" 결과 — non-null이면 목록 대신 비교 뷰를 보여준다 */
  compare: { name: string; result: BranchCompare } | null
  currentBranch: string | null
  busy: boolean
  /** 진행 중 작업(merging 등) — 파괴적 항목을 사유와 함께 비활성한다 */
  actionsDisabled: boolean
  onAction(action: BranchPanelAction): void
  onCloseCompare(): void
}

interface MenuState {
  x: number
  y: number
  target: { kind: 'local'; branch: LocalBranchStatus } | { kind: 'remote'; name: string }
}

/** IntelliJ식 실험 공간 패널 (E7a) — 검색·폴더 그룹·상태 배지·우클릭 관리. 빠른 전환은 헤더 스위처가 담당 */
export function BranchesPanel({
  overview,
  compare,
  currentBranch,
  busy,
  actionsDisabled,
  onAction,
  onCloseCompare,
}: BranchesPanelProps) {
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<MenuState | null>(null)

  // 불가 항목은 숨기지 않고 사유와 함께 비활성한다 (HistoryPanel undo/reword 관례)
  const buildLocalMenu = (branch: LocalBranchStatus): ContextMenuEntry[] => {
    const isCurrent = branch.name === currentBranch
    const noUpstream = branch.upstream === null
    return [
      {
        key: 'switch',
        label: isCurrent
          ? '이 공간으로 이동 (checkout) — 지금 여기예요'
          : '이 공간으로 이동 (checkout)',
        disabled: busy || actionsDisabled || isCurrent,
        onSelect: () => onAction({ kind: 'switch', name: branch.name }),
      },
      {
        key: 'branch-from',
        label: '여기서 새 실험 공간…',
        disabled: busy,
        onSelect: () => onAction({ kind: 'branch-from', name: branch.name, hash: branch.hash }),
      },
      { key: 'sep-1', separator: true },
      {
        key: 'merge',
        label: isCurrent ? '지금 것과 합치기 (merge) — 자기 자신이에요' : '지금 것과 합치기 (merge)',
        disabled: busy || actionsDisabled || isCurrent,
        onSelect: () => onAction({ kind: 'merge', name: branch.name }),
      },
      {
        key: 'rebase',
        label: isCurrent
          ? '지금 것을 이 위로 재배치 (rebase) — 자기 자신이에요'
          : '지금 것을 이 위로 재배치 (rebase)',
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
          ? '원격 최신으로 업데이트 (pull)'
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
        label: '백업 (push)',
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
        label: isCurrent ? '지우기 — 지금 있는 공간이에요' : '지우기…',
        disabled: busy || actionsDisabled || isCurrent,
        onSelect: () => onAction({ kind: 'remove', name: branch.name }),
      },
    ]
  }

  const buildRemoteMenu = (name: string): ContextMenuEntry[] => [
    {
      key: 'checkout-remote',
      label: '내 공간으로 가져오기 (checkout)',
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
          {title} <span className="branch-row__badge">{commits.length}</span>
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
        accessory={<Badge tone="git">compare</Badge>}
        testId="branches-panel"
      >
        <div className="branches-panel">
          <div>
            <Button variant="ghost" size="sm" onPress={onCloseCompare} testId="branch-compare-back">
              ← 목록으로
            </Button>
          </div>
          <div className="branches-panel__scroll" data-testid="branch-compare-view">
            {section(
              `"${compare.name}"에만 있는 저장`,
              result.onlyInSelected,
              result.selectedOverflow,
              '없어요 — 전부 지금 공간에도 있어요.',
            )}
            {section(
              '지금 공간에만 있는 저장',
              result.onlyInCurrent,
              result.currentOverflow,
              '없어요 — 전부 그 공간에도 있어요.',
            )}
          </div>
        </div>
      </Panel>
    )
  }

  const locals = (overview?.locals ?? []).filter((branch) => branch.name.includes(query))
  const remotes = (overview?.remotes ?? []).filter((remote) => remote.name.includes(query))
  const grouped = groupBranches(locals)
  const remoteGroups = new Map<string, typeof remotes>()
  for (const remote of remotes) {
    const list = remoteGroups.get(remote.remote) ?? []
    list.push(remote)
    remoteGroups.set(remote.remote, list)
  }

  const localRow = (branch: LocalBranchStatus, displayName: string) => (
    <button
      key={branch.name}
      type="button"
      className="branch-row"
      title={branch.name}
      onClick={(event) => openMenu(event, { kind: 'local', branch })}
      onContextMenu={(event) => openMenu(event, { kind: 'local', branch })}
      data-testid={`branch-row-${branch.name}`}
    >
      <span className="branch-row__name">⎇ {displayName}</span>
      {branch.name === currentBranch && <Badge tone="git">지금 여기</Badge>}
      <span className="branch-row__badge">{trackBadgeLabel(branch)}</span>
    </button>
  )

  return (
    <Panel title="실험 공간" accessory={<Badge tone="git">branch</Badge>} testId="branches-panel">
      <div className="branches-panel">
        <input
          className="branches-panel__search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="이름으로 찾기"
          aria-label="실험 공간 검색"
          data-testid="branches-search"
        />
        <div className="branches-panel__scroll" data-testid="branches-list">
          {locals.length === 0 && remotes.length === 0 ? (
            <p className="branches-panel__empty">보여줄 실험 공간이 없어요.</p>
          ) : (
            <>
              {locals.length > 0 && <p className="branches-panel__group">내 공간 (로컬)</p>}
              {grouped.loose.map((branch) => localRow(branch, branch.name))}
              {grouped.folders.map((folder) => (
                <div key={folder.name}>
                  <p className="branches-panel__folder">📁 {folder.name}/</p>
                  {folder.branches.map((branch) =>
                    localRow(branch, branchDisplayName(branch.name)),
                  )}
                </div>
              ))}
              {[...remoteGroups.entries()].map(([remoteName, refs]) => (
                <div key={remoteName}>
                  <p className="branches-panel__group">{remoteName} (원격)</p>
                  {refs.map((ref) => (
                    <button
                      key={ref.name}
                      type="button"
                      className="branch-row branch-row--remote"
                      title={ref.name}
                      onClick={(event) => openMenu(event, { kind: 'remote', name: ref.name })}
                      onContextMenu={(event) => openMenu(event, { kind: 'remote', name: ref.name })}
                      data-testid={`branch-row-${ref.name}`}
                    >
                      <span className="branch-row__name">☁ {ref.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
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
