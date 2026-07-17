import { Archive } from 'lucide-react'
import { useState } from 'react'
import { Dialog, DialogTrigger, Popover } from 'react-aria-components'
import type { ShelfEntry } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { formatRelativeTime } from './relative-time'
import './shelf-popover.css'

interface ShelfPopoverProps {
  shelf: ShelfEntry[]
  busy: boolean
  onSave(): void
  onRestore(ref: string): void
  onDrop(ref: string): void
}

/** 보관함 (스펙 E1) — 잠시 치워 둔 변경을 보고 꺼내거나 버린다. 전환 자동 보관도 여기로 온다 */
export function ShelfPopover({ shelf, busy, onSave, onRestore, onDrop }: ShelfPopoverProps) {
  const [dropTarget, setDropTarget] = useState<ShelfEntry | null>(null)
  return (
    <>
      <DialogTrigger>
        <Button variant="ghost" size="sm" testId="shelf-open">
          <Archive size={13} aria-hidden="true" /> 보관함{' '}
          <Badge tone="count">
            <span data-testid="shelf-count">{shelf.length}</span>
          </Badge>
        </Button>
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
                    <div className="shelf-popover__meta">
                      <span className="shelf-popover__message" title={entry.message}>
                        {entry.message}
                      </span>
                      <span className="shelf-popover__time">
                        {formatRelativeTime(entry.savedAt, Date.now())}
                      </span>
                    </div>
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
