import { useState, type MouseEvent } from 'react'
import type { WorktreeInfo } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu'
import { Panel } from '../ui/Panel'
import { Tooltip } from '../ui/Tooltip'
import { shortenAbove, shortenBranch, sourceChip, uniqueNames } from './worktree-label'
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
  busy: boolean
  onAction(action: WorktreeAction): void
}

/** 워크트리 탭 (E7c) — 목록·활성 지정(클릭)·우클릭 관리. 폴더 이름으로 표시, 경로는 흐리게 */
export function WorktreesPanel({
  worktrees,
  currentPath,
  activePath,
  home,
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
        label: isCurrent ? '앱에서 열기 — 지금 여기예요' : '앱에서 열기 (전체 전환)',
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
      ? '없어진 폴더'
      : worktree.branch !== null
        ? shortenBranch(worktree.branch, 28)
        : `분리됨 (${worktree.headHash?.slice(0, 7) ?? '?'})`

  return (
    <Panel title="워크트리" accessory={<Badge tone="git">worktree</Badge>} testId="worktrees-panel">
      <div className="worktrees-panel">
        <div className="worktrees-panel__scroll" data-testid="worktrees-list">
          {worktrees.map((worktree) => (
            <button
              key={worktree.path}
              type="button"
              className={`worktree-row${worktree.prunable ? ' worktree-row--gone' : ''}`}
              // E7j 편차: Task 6이 리치 카드로 대체할 때까지 네이티브 title을 그대로 둔다(플랜 명시 예외 —
              // smoke.spec.ts가 이 title 단언을 유지한다). Task 6에서 data-tooltip 전환과 같은 커밋으로 지울 것
              title={worktree.path === currentPath ? `${worktree.path} — 지금 여기` : worktree.path}
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
          ))}
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
