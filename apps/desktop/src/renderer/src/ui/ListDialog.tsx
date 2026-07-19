import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { Button } from './Button'
import './confirm-dialog.css'
import './list-dialog.css'

export interface ListDialogOption {
  key: string
  label: string
  meta?: string
}

interface ListDialogProps {
  isOpen: boolean
  title: string
  description: string
  options: ListDialogOption[]
  emptyText: string
  onSelect(key: string): void
  onCancel(): void
}

/** 목록에서 하나 고르는 다이얼로그 — 합치기 대상 선택 등 */
export function ListDialog({
  isOpen,
  title,
  description,
  options,
  emptyText,
  onSelect,
  onCancel,
}: ListDialogProps) {
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
        <Dialog className="ui-dialog">
          <Heading slot="title" className="ui-dialog__title">
            {title}
          </Heading>
          <p className="ui-dialog__body">{description}</p>
          {options.length === 0 ? (
            <p className="ui-list-dialog__empty">{emptyText}</p>
          ) : (
            <ul className="ui-list-dialog__list">
              {options.map((option) => (
                <li key={option.key}>
                  <button
                    type="button"
                    className="ui-list-dialog__option"
                    onClick={() => onSelect(option.key)}
                    data-testid={`list-option-${option.key}`}
                  >
                    <span className="ui-list-dialog__label">{option.label}</span>
                    {option.meta && <span className="ui-list-dialog__meta">{option.meta}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="ui-dialog__actions">
            <Button variant="ghost" size="sm" onPress={onCancel} testId="list-cancel">
              그만두기
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
