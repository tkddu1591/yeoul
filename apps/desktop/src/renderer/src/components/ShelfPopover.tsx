import { Archive } from 'lucide-react'
import { useState } from 'react'
import { useEscapeFallback } from '../ui/use-escape-fallback'
import { Dialog, DialogTrigger, Popover } from 'react-aria-components'
import type { ShelfEntry } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Tooltip } from '../ui/Tooltip'
import { formatRelativeTime } from './relative-time'
import { parseShelfMessage } from './shelf-message'
import './shelf-popover.css'

interface ShelfPopoverProps {
  shelf: ShelfEntry[]
  busy: boolean
  onSave(): void
  /** 항목 미리보기 — 커밋 상세(우측)로 보여준다. 팝오버는 닫는다 (피드백 2) */
  onPreview(hash: string): void
  onRestore(ref: string): void
  onDrop(ref: string): void
}

/** 보관함 (스펙 E1) — 잠시 치워 둔 변경을 보고 꺼내거나 버린다. 전환 자동 보관도 여기로 온다 */
export function ShelfPopover({ shelf, busy, onSave, onPreview, onRestore, onDrop }: ShelfPopoverProps) {
  const [dropTarget, setDropTarget] = useState<ShelfEntry | null>(null)
  // 미리보기 클릭 시 닫아야 해서 제어형으로 둔다 — 그 외 동작은 기존과 같다
  const [open, setOpen] = useState(false)
  // 버리기 확인창이 위에 떠 있는 동안에는 ESC를 확인창에 양보한다 (E6b 실측 2 — body 포커스 fallback)
  useEscapeFallback(open && dropTarget === null, () => setOpen(false))
  return (
    <>
      <DialogTrigger isOpen={open} onOpenChange={setOpen}>
        <Tooltip content="보관함" summary="보관함" describedBy={false}>
          <Button variant="ghost" size="sm" testId="shelf-open" aria-label="보관함">
            <Archive size={13} aria-hidden="true" /> <span className="app__btn-label">보관함</span>{' '}
            <Badge tone="count">
              <span data-testid="shelf-count">{shelf.length}</span>
            </Badge>
          </Button>
        </Tooltip>
        <Popover className="shelf-popover">
          <Dialog className="shelf-popover__dialog" aria-label="보관함">
            <div className="shelf-popover__head">
              <span>
                잠시 치워 둔 변경 <Badge tone="git">stash</Badge>
              </span>
              <Button variant="neutral" size="sm" isDisabled={busy} onPress={onSave} testId="shelf-save">
                지금 변경 보관하기
              </Button>
            </div>
            {shelf.length === 0 ? (
              <p className="shelf-popover__empty">
                비어 있어요. 실험 공간을 옮길 때 겹치는 변경이 있으면 자동으로 담기기도 해요.
              </p>
            ) : (
              <ul className="shelf-popover__list">
                {shelf.map((entry) => (
                  <li key={entry.ref} className="shelf-popover__row">
                    <Tooltip content="무엇이 담겼는지 미리보기" summary="무엇이 담겼는지 미리보기">
                      <button
                        type="button"
                        className="shelf-popover__meta"
                        onClick={() => {
                          setOpen(false)
                          onPreview(entry.hash)
                        }}
                        data-testid={`shelf-preview-${entry.ref}`}
                      >
                        <Tooltip content={entry.message} summary={entry.message}>
                          <span className="shelf-popover__message">
                            {parseShelfMessage(entry.message).text}
                          </span>
                        </Tooltip>
                        <span className="shelf-popover__time">
                          {parseShelfMessage(entry.message).branch !== null && (
                            <span className="shelf-popover__branch">
                              {parseShelfMessage(entry.message).branch}
                            </span>
                          )}
                          {formatRelativeTime(entry.savedAt, Date.now())}
                        </span>
                      </button>
                    </Tooltip>
                    <Button
                      variant="ghost"
                      size="sm"
                      isDisabled={busy}
                      onPress={() => onRestore(entry.ref)}
                      testId={`shelf-restore-${entry.ref}`}
                    >
                      꺼내기
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      isDisabled={busy}
                      onPress={() => setDropTarget(entry)}
                      testId={`shelf-drop-${entry.ref}`}
                    >
                      버리기
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Dialog>
        </Popover>
      </DialogTrigger>
      <ConfirmDialog
        isOpen={dropTarget !== null}
        title="보관함 항목을 버릴까요?"
        confirmLabel="버리기"
        onConfirm={() => {
          if (dropTarget !== null) onDrop(dropTarget.ref)
          setDropTarget(null)
        }}
        onCancel={() => setDropTarget(null)}
      >
        "{dropTarget?.message}"를 버려요. 이 동작은 되돌릴 수 없어요.
      </ConfirmDialog>
    </>
  )
}
