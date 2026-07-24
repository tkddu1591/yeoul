import { useVirtualizer } from '@tanstack/react-virtual'
import { CircleMinus, CirclePlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FileChange } from '@git-gui/domain'
import type { SelectedFile } from '../store/repository-store'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { ContextMenu } from '../ui/ContextMenu'
import { Panel } from '../ui/Panel'
import { KIND_GLYPHS, KIND_LABELS } from './change-kind'
import { FindBar } from './FindBar'
import './changes-panel.css'
import './virtual.css'

interface ChangesPanelProps {
  changes: FileChange[]
  selected: SelectedFile | null
  /** 작업 중에는 모든 버튼을 비활성화한다 — 연타로 git 작업이 겹치면 index.lock 충돌이 난다 */
  busy: boolean
  /** ⌘F로 이 패널이 검색 대상으로 잡혔는가 (E7h ⑥) — 두 목록('지금 바뀐 것'·'저장 예정') 공용 */
  findOpen: boolean
  onFindClose(): void
  onStage(paths: string[]): void
  onUnstage(paths: string[]): void
  /** 선택 파일 변경 취소 — tracked 경로와 untracked 경로를 분리해 넘긴다. 되돌릴 수 없다 */
  onDiscard(trackedPaths: string[], untrackedPaths: string[]): void
  /** 우클릭 → "파일 삭제 (delete)" — 확인창을 거친 뒤 호출된다. 되돌릴 수 없다 (E5a 피드백 2) */
  onRemoveFile(path: string): void
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
  /** 우클릭 메뉴 — 좌표만 올린다. 메뉴 구성은 목록이 담당 (E5a) */
  onMenu(x: number, y: number): void
}

function FileRow({
  change,
  staged,
  isSelected,
  isChecked,
  busy,
  onToggle,
  onSelect,
  onMenu,
}: FileRowProps) {
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
        onContextMenu={(event) => {
          event.preventDefault()
          onMenu(event.clientX, event.clientY)
        }}
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
  /** E7h ⑥ — ⌘F 필터로 좁힌 렌더 대상. 가상화·행 렌더만 이걸 쓴다 — 체크·일괄 버튼(모두 선택 등)은
   * 필터와 무관하게 changes(전체)를 그대로 대상으로 삼는다(핸들러 무변, 필터는 보이는 행만 좁힌다) */
  visibleChanges: FileChange[]
  staged: boolean
  selected: SelectedFile | null
  busy: boolean
  bulkLabel: string
  /** unstaged 목록에만 있다 — 확인창을 거쳐 선택 파일의 변경을 취소한다 */
  onDiscard?: (trackedPaths: string[], untrackedPaths: string[]) => void
  /** unstaged 목록에만 있다 — 우클릭 "파일 삭제". 확인창은 이 목록이 관리한다 (E5a) */
  onRemoveFile?: (path: string) => void
  onAction(paths: string[]): void
  onSelect(selected: SelectedFile): void
}

function FileList({
  title,
  termBadge,
  countTestId,
  emptyText,
  changes,
  visibleChanges,
  staged,
  selected,
  busy,
  bulkLabel,
  onDiscard,
  onRemoveFile,
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
  // E7h ⑥ — count·행 인덱싱은 visibleChanges(필터로 좁힌 목록) 기준. 필터가 없으면 changes와 같다
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: visibleChanges.length,
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
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const discardTracked = validChecked.filter((c) => c.unstaged !== 'untracked').map((c) => c.path)
  const discardUntracked = validChecked.filter((c) => c.unstaged === 'untracked').map((c) => c.path)
  const runDiscard = () => {
    setConfirmingDiscard(false)
    onDiscard?.(discardTracked, discardUntracked)
    setChecked(new Set())
  }

  // 우클릭 메뉴와 단일 파일 확인창(되돌리기·삭제) — 이 목록이 관리한다 (E5a 피드백 2)
  const [menu, setMenu] = useState<{ x: number; y: number; change: FileChange } | null>(null)
  const [menuDiscard, setMenuDiscard] = useState<FileChange | null>(null)
  const [menuRemove, setMenuRemove] = useState<FileChange | null>(null)
  const runMenuDiscard = () => {
    const change = menuDiscard
    setMenuDiscard(null)
    if (change === null) return
    if (change.unstaged === 'untracked') onDiscard?.([], [change.path])
    else onDiscard?.([change.path], [])
  }
  const runMenuRemove = () => {
    const change = menuRemove
    setMenuRemove(null)
    if (change !== null) onRemoveFile?.(change.path)
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
            {onDiscard && (
              <Button
                variant="danger"
                size="sm"
                isDisabled={busy || validChecked.length === 0}
                onPress={() => setConfirmingDiscard(true)}
                testId="discard-selected"
              >
                변경 취소 ({validChecked.length})
              </Button>
            )}
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
                const change = visibleChanges[item.index]!
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
                      onMenu={(x, y) => setMenu({ x, y, change })}
                    />
                  </li>
                )
              })}
            </ul>
          </div>
          {onDiscard && (
            <ConfirmDialog
              isOpen={confirmingDiscard}
              title="변경 내용을 취소할까요?"
              confirmLabel="변경 취소"
              onConfirm={runDiscard}
              onCancel={() => setConfirmingDiscard(false)}
            >
              선택한 파일 {validChecked.length}개의 아직 올리지 않은 변경 내용을 되돌려요. 올려둔
              (staged) 내용은 남아요.
              {discardUntracked.length > 0 && ` 새 파일 ${discardUntracked.length}개는 삭제돼요.`} 이
              동작은 되돌릴 수 없어요.
            </ConfirmDialog>
          )}
          {menu !== null && (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              items={
                menu.change.staged === 'conflicted' || menu.change.unstaged === 'conflicted'
                  ? [
                      // 사유를 담은 disabled 항목 1개 — 이유 없는 회색 나열보다 다음 행동이 명확하다.
                      // 실제 차단은 엔진 가드(restore/remove/discard의 unmerged 거부)가 심층 방어한다
                      {
                        key: 'conflicted-info',
                        label: '충돌 중인 파일이에요 — 충돌 화면에서 정리해요',
                        disabled: true,
                        onSelect: () => {},
                      },
                    ]
                  : staged
                    ? [
                        {
                          key: 'unstage-file',
                          label: '내리기 (unstage)',
                          onSelect: () => onAction(actionPaths(menu.change, true)),
                        },
                      ]
                    : [
                        {
                          key: 'stage-file',
                          label: '올리기 (stage)',
                          onSelect: () => onAction(actionPaths(menu.change, false)),
                        },
                        {
                          key: 'discard-file',
                          label: '이 파일만 되돌리기 (discard)',
                          onSelect: () => setMenuDiscard(menu.change),
                        },
                        {
                          key: 'remove-file',
                          label: '파일 삭제 (delete)',
                          onSelect: () => setMenuRemove(menu.change),
                        },
                      ]
              }
              onClose={() => setMenu(null)}
            />
          )}
          <ConfirmDialog
            isOpen={menuDiscard !== null}
            title="이 파일의 변경을 취소할까요?"
            confirmLabel="변경 취소"
            onConfirm={runMenuDiscard}
            onCancel={() => setMenuDiscard(null)}
          >
            "{menuDiscard?.path}"의 아직 올리지 않은 변경 내용을 되돌려요. 올려둔(staged) 내용은
            남아요.
            {menuDiscard?.unstaged === 'untracked' && ' 새 파일이라 파일 자체가 삭제돼요.'} 이 동작은
            되돌릴 수 없어요.
          </ConfirmDialog>
          <ConfirmDialog
            isOpen={menuRemove !== null}
            title="파일을 삭제할까요?"
            confirmLabel="파일 삭제"
            onConfirm={runMenuRemove}
            onCancel={() => setMenuRemove(null)}
          >
            "{menuRemove?.path}" 파일을 디스크에서 삭제해요. 이 동작은 되돌릴 수 없어요.
          </ConfirmDialog>
        </>
      )}
    </Panel>
  )
}

export function ChangesPanel({
  changes,
  selected,
  busy,
  findOpen,
  onFindClose,
  onStage,
  onUnstage,
  onDiscard,
  onRemoveFile,
  onSelect,
}: ChangesPanelProps) {
  const stagedChanges = changes.filter((c) => c.staged !== null)
  const unstagedChanges = changes.filter((c) => c.unstaged !== null)
  // E7h ⑥ — ⌘F 필터(두 목록 공용). findOpen이 닫히면 검색어와 무관하게 필터를 끈다
  const [findQuery, setFindQuery] = useState('')
  const query = findOpen && findQuery !== '' ? findQuery.toLowerCase() : ''
  const visibleUnstaged =
    query === ''
      ? unstagedChanges
      : unstagedChanges.filter((c) => c.path.toLowerCase().includes(query))
  const visibleStaged =
    query === '' ? stagedChanges : stagedChanges.filter((c) => c.path.toLowerCase().includes(query))
  const visibleTotal = visibleUnstaged.length + visibleStaged.length

  return (
    <div className="changes-panel" data-find-scope="changes">
      {findOpen && (
        <FindBar
          query={findQuery}
          position={visibleTotal === 0 ? -1 : 0}
          count={visibleTotal}
          mode="filter"
          placeholder="파일 찾기"
          onQuery={setFindQuery}
          onNext={() => {}}
          onPrev={() => {}}
          onClose={() => {
            setFindQuery('')
            onFindClose()
          }}
        />
      )}
      <FileList
        title="지금 바뀐 것"
        termBadge="unstaged"
        countTestId="unstaged-count"
        emptyText="바뀐 파일이 없어요"
        changes={unstagedChanges}
        visibleChanges={visibleUnstaged}
        staged={false}
        selected={selected}
        busy={busy}
        bulkLabel="올리기"
        onAction={onStage}
        onDiscard={onDiscard}
        onRemoveFile={onRemoveFile}
        onSelect={onSelect}
      />
      <FileList
        title="저장 예정"
        termBadge="staged"
        countTestId="staged-count"
        emptyText="파일을 올리면 여기에 모여요"
        changes={stagedChanges}
        visibleChanges={visibleStaged}
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
