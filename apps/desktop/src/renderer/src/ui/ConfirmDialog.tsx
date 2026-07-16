import type { ReactNode } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { Button } from './Button'
import './confirm-dialog.css'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  onConfirm(): void
  onCancel(): void
}

/** 되돌릴 수 없는 동작 전용 확인창 — ESC·바깥 클릭은 취소와 같다 */
export function ConfirmDialog({
  isOpen,
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <ModalOverlay
      className="ui-modal-overlay"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      isDismissable
    >
      <Modal className="ui-modal">
        <Dialog role="alertdialog" className="ui-dialog">
          <Heading slot="title" className="ui-dialog__title">
            {title}
          </Heading>
          <div className="ui-dialog__body">{children}</div>
          <div className="ui-dialog__actions">
            <Button variant="ghost" size="sm" onPress={onCancel} testId="confirm-cancel">
              그만두기
            </Button>
            <Button variant="danger" size="sm" onPress={onConfirm} testId="confirm-accept">
              {confirmLabel}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
