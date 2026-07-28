import { useState, type MouseEvent } from 'react'
import type { WorktreeHeadInfo, WorktreeInfo } from '@git-gui/domain'
import { formatRelativeTime } from './relative-time'
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu'
import { Panel } from '../ui/Panel'
import { Tooltip } from '../ui/Tooltip'
import { shortenAbove, shortenBranch, sourceChip, uniqueNames } from './worktree-label'
import { T } from '../terms'
import './worktrees-panel.css'

export type WorktreeAction =
  // 행 클릭 = 활성 지정 + 설정된 동작 (App이 worktreeSelectAction으로 분기)
  | { kind: 'select'; path: string; label: string }
  // 우클릭 "여기서 터미널 열기" = 설정 무관 항상 터미널
  | { kind: 'terminal'; path: string; label: string }
  | { kind: 'open'; path: string }
  | { kind: 'reveal'; path: string }
  | { kind: 'remove'; path: string }
  | { kind: 'add' }

interface WorktreesPanelProps {
  worktrees: WorktreeInfo[]
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
  onAction(action: WorktreeAction): void
}

/** 워크트리 탭 (E7c) — 목록·활성 지정(클릭)·우클릭 관리. 폴더 이름으로 표시, 경로는 흐리게 */
export function WorktreesPanel({
  worktrees,
  currentPath,
  activePath,
  home,
  headInfos,
  onHoverWorktree,
  busy,
  onAction,
}: WorktreesPanelProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; worktree: WorktreeInfo } | null>(null)

  const folderName = (path: string) => path.split('/').filter(Boolean).pop() ?? path

  // E7j — 리프 이름이 겹치면(codex·claude 구조에서 흔하다) 구분되는 조상까지 붙여 유일화한다
  const names = uniqueNames(worktrees.map((worktree) => worktree.path))

  const buildMenu = (worktree: WorktreeInfo): ContextMenuEntry[] => {
    const isCurrent = worktree.path === currentPath
    const name = folderName(worktree.path)
    return [
      {
        key: 'terminal',
        label: '여기서 터미널 열기',
        disabled: busy || worktree.prunable,
        onSelect: () => onAction({ kind: 'terminal', path: worktree.path, label: name }),
      },
      {
        key: 'open',
        label: isCurrent ? `앱에서 열기 — ${T.head}예요` : '앱에서 열기 (전체 전환)',
        disabled: busy || isCurrent || worktree.prunable,
        onSelect: () => onAction({ kind: 'open', path: worktree.path }),
      },
      { key: 'sep-1', separator: true },
      {
        key: 'reveal',
        label: 'Finder에서 보기',
        disabled: busy || worktree.prunable,
        onSelect: () => onAction({ kind: 'reveal', path: worktree.path }),
      },
      {
        key: 'remove',
        label: worktree.isMain
          ? '지우기 — 본체는 지울 수 없어요'
          : isCurrent
            ? '지우기 — 지금 열고 있는 워크트리예요'
            : '지우기… (worktree remove)',
        disabled: busy || worktree.isMain || isCurrent,
        onSelect: () => onAction({ kind: 'remove', path: worktree.path }),
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
              <Tooltip
                key={worktree.path}
                summary={worktree.path}
                content={
                  <>
                    <div className="ui-tooltip__title">
                      {worktree.branch ?? `${T.detached} (${worktree.headHash?.slice(0, 7) ?? '?'})`}
                    </div>
                    <div className="ui-tooltip__path">{worktree.path}</div>
                    <div className="ui-tooltip__meta">
                      출처 {sourceChip(worktree.path, home)}
                      {worktree.headHash !== null && ` · HEAD ${worktree.headHash.slice(0, 7)}`}
                      {head !== null && ` · ${head.subject}`}
                      {head !== null && ` · ${formatRelativeTime(head.committedAt, Date.now())}`}
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
                      <span className="worktree-row__source">{sourceChip(worktree.path, home)}</span>
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
                  </span>
                </button>
              </Tooltip>
            )
          })}
          <button
            type="button"
            className="worktree-row worktree-row--add"
            onClick={() => onAction({ kind: 'add' })}
            data-testid="worktree-add"
          >
            ＋ 새 워크트리…
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
