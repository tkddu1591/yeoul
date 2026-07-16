import { useVirtualizer } from '@tanstack/react-virtual'
import { CircleMinus, CirclePlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FileChange } from '@git-gui/domain'
import type { SelectedFile } from '../store/repository-store'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { KIND_GLYPHS, KIND_LABELS } from './change-kind'
import './changes-panel.css'
import './virtual.css'

interface ChangesPanelProps {
  changes: FileChange[]
  selected: SelectedFile | null
  /** 작업 중에는 모든 버튼을 비활성화한다 — 연타로 git 작업이 겹치면 index.lock 충돌이 난다 */
  busy: boolean
  onStage(paths: string[]): void
  onUnstage(paths: string[]): void
  onSelect(selected: SelectedFile): void
}

/** 이름 변경은 새 경로와 원래 경로가 index에 쌍으로 있다 — 함께 넘겨야 반쪽 unstage가 안 된다 */
function actionPaths(change: FileChange, staged: boolean): string[] {
  if (staged && change.staged === 'renamed' && change.origPath !== null) {
    return [change.path, change.origPath]
  }
  return [change.path]
}

interface FileRowProps {
  change: FileChange
  staged: boolean
  isSelected: boolean
  isChecked: boolean
  busy: boolean
  onToggle(): void
  onSelect(): void
}

function FileRow({ change, staged, isSelected, isChecked, busy, onToggle, onSelect }: FileRowProps) {
  const kind = staged ? change.staged : change.unstaged
  const kindLabel = kind ? KIND_LABELS[kind] : ''
  // 이름 변경은 "무엇이었는지"가 핵심 정보 — 원래 경로를 툴팁에 병기한다
  const tooltip =
    kind === 'renamed' && change.origPath !== null
      ? `${change.origPath} → ${change.path} — ${kindLabel}`
      : `${change.path} — ${kindLabel}`
  // IntelliJ처럼 파일명을 먼저, 경로를 뒤에 흐리게 — 좁은 열에서는 경로부터 축소한다
  const slashIndex = change.path.lastIndexOf('/')
  const directory = slashIndex >= 0 ? change.path.slice(0, slashIndex) : ''
  const basename = slashIndex >= 0 ? change.path.slice(slashIndex + 1) : change.path
  return (
    <div className={`file-row${isSelected ? ' file-row--selected' : ''}`}>
      {/* 칩(sticky) — 가로 스크롤 중에도 체크박스가 왼쪽에 남는다 */}
      <span className="file-row__checkcell">
        <input
          type="checkbox"
          className="file-row__check"
          checked={isChecked}
          onChange={onToggle}
          disabled={busy}
          aria-label={`${change.path} 선택`}
          data-testid={`check-${staged ? 'staged' : 'unstaged'}-${change.path}`}
        />
      </span>
      <button
        type="button"
        className={`file-row__main file-row__main--${kind ?? 'none'}`}
        disabled={busy}
        onClick={onSelect}
        title={tooltip}
        aria-label={tooltip}
        data-testid={`file-${staged ? 'staged' : 'unstaged'}-${change.path}`}
      >
        <span className="file-row__kind" aria-hidden="true">
          {kind ? KIND_GLYPHS[kind] : ''}
        </span>
        <span className="file-row__name">
          <span className="file-row__base">{basename}</span>
          {directory && <span className="file-row__dir">{directory}</span>}
        </span>
      </button>
    </div>
  )
}

interface FileListProps {
  title: string
  termBadge: string
  countTestId: string
  emptyText: string
  changes: FileChange[]
  staged: boolean
  selected: SelectedFile | null
  busy: boolean
  bulkLabel: string
  onAction(paths: string[]): void
  onSelect(selected: SelectedFile): void
}

function FileList({
  title,
  termBadge,
  countTestId,
  emptyText,
  changes,
  staged,
  selected,
  busy,
  bulkLabel,
  onAction,
  onSelect,
}: FileListProps) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  // 목록에서 사라진 경로는 체크에서 자동 제외한다 — stage/unstage 후 잔존 방지
  const validChecked = changes.filter((c) => checked.has(c.path))
  const allChecked = changes.length > 0 && validChecked.length === changes.length
  const side = staged ? 'staged' : 'unstaged'

  // 사라졌던 경로가 목록에 돌아와도 저절로 다시 체크되지 않게, 목록 변경 시 stale 경로를 정리한다
  useEffect(() => {
    setChecked((prev) => {
      const valid = new Set(changes.filter((c) => prev.has(c.path)).map((c) => c.path))
      return valid.size === prev.size ? prev : valid
    })
  }, [changes])

  // 수천 개 행에서도 DOM은 가시 범위만 유지한다 (#4). 행 높이는 실측(measureElement)한다
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: changes.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 31,
    overscan: 10,
  })

  const toggle = (path: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
  const toggleAll = () => {
    setChecked(allChecked ? new Set() : new Set(changes.map((c) => c.path)))
  }
  const runBulk = () => {
    onAction(validChecked.flatMap((change) => actionPaths(change, staged)))
    setChecked(new Set())
  }

  return (
    <Panel
      title={title}
      accessory={
        <>
          <Badge tone="git">{termBadge}</Badge>
          <Badge tone="count">
            <span data-testid={countTestId}>{changes.length}</span>
          </Badge>
        </>
      }
    >
      {changes.length === 0 ? (
        <p className="changes-panel__empty">{emptyText}</p>
      ) : (
        <>
          <div className="file-list__bulk">
            <label className="file-list__check-all">
              <input
                type="checkbox"
                checked={allChecked}
                ref={(element) => {
                  // 일부만 체크된 중간 상태 표시
                  if (element) element.indeterminate = validChecked.length > 0 && !allChecked
                }}
                onChange={toggleAll}
                disabled={busy}
                data-testid={`check-all-${side}`}
              />
              모두 선택
            </label>
            <Button
              variant="ghost"
              size="sm"
              isDisabled={busy || validChecked.length === 0}
              onPress={runBulk}
              testId={`${staged ? 'unstage' : 'stage'}-selected`}
            >
              {staged ? (
                <CircleMinus size={13} aria-hidden="true" />
              ) : (
                <CirclePlus size={13} aria-hidden="true" />
              )}
              선택 {bulkLabel} ({validChecked.length})
            </Button>
          </div>
          <div ref={scrollRef} className="virtual-scroll" data-testid={`file-scroll-${side}`}>
            <ul
              className="changes-panel__list"
              style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const change = changes[item.index]!
                return (
                  <li
                    key={`${side}-${change.path}`}
                    ref={virtualizer.measureElement}
                    data-index={item.index}
                    className="virtual-row virtual-row--wide"
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    <FileRow
                      change={change}
                      staged={staged}
                      isSelected={
                        selected !== null &&
                        selected.staged === staged &&
                        selected.change.path === change.path
                      }
                      isChecked={checked.has(change.path)}
                      busy={busy}
                      onToggle={() => toggle(change.path)}
                      onSelect={() => onSelect({ change, staged })}
                    />
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}
    </Panel>
  )
}

export function ChangesPanel({
  changes,
  selected,
  busy,
  onStage,
  onUnstage,
  onSelect,
}: ChangesPanelProps) {
  const stagedChanges = changes.filter((c) => c.staged !== null)
  const unstagedChanges = changes.filter((c) => c.unstaged !== null)

  return (
    <div className="changes-panel">
      <FileList
        title="지금 바뀐 것"
        termBadge="unstaged"
        countTestId="unstaged-count"
        emptyText="바뀐 파일이 없어요"
        changes={unstagedChanges}
        staged={false}
        selected={selected}
        busy={busy}
        bulkLabel="올리기"
        onAction={onStage}
        onSelect={onSelect}
      />
      <FileList
        title="저장 예정"
        termBadge="staged"
        countTestId="staged-count"
        emptyText="파일을 올리면 여기에 모여요"
        changes={stagedChanges}
        staged
        selected={selected}
        busy={busy}
        bulkLabel="내리기"
        onAction={onUnstage}
        onSelect={onSelect}
      />
    </div>
  )
}
