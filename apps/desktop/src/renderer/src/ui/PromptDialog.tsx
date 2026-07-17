import { useState } from 'react'
import { Dialog, Heading, Input, Label, Modal, ModalOverlay, TextField } from 'react-aria-components'
import { Button } from './Button'
import './confirm-dialog.css'
import './prompt-dialog.css'

interface PromptDialogProps {
  isOpen: boolean
  title: string
  description: string
  label: string
  placeholder: string
  submitLabel: string
  onSubmit(value: string): void
  onCancel(): void
}

/** 한 줄 입력 다이얼로그 — Enter로 제출, ESC·바깥 클릭은 취소. 닫힐 때 입력을 비운다 */
export function PromptDialog({
  isOpen,
  title,
  description,
  label,
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState('')
  const submit = () => {
    const trimmed = value.trim()
    if (trimmed === '') return
    setValue('')
    onSubmit(trimmed)
  }
  const cancel = () => {
    setValue('')
    onCancel()
  }
  return (
    <ModalOverlay
      className="ui-modal-overlay"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) cancel()
      }}
      isDismissable
    >
      <Modal className="ui-modal">
        <Dialog className="ui-dialog">
          <Heading slot="title" className="ui-dialog__title">
            {title}
          </Heading>
          <p className="ui-dialog__body">{description}</p>
          <TextField
            className="ui-prompt__field"
            value={value}
            onChange={setValue}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
          >
            <Label className="ui-prompt__label">{label}</Label>
            <Input className="ui-prompt__input" placeholder={placeholder} data-testid="prompt-input" />
          </TextField>
          <div className="ui-dialog__actions">
            <Button variant="ghost" size="sm" onPress={cancel} testId="prompt-cancel">
              그만두기
            </Button>
            <Button
              variant="primary"
              size="sm"
              isDisabled={value.trim() === ''}
              onPress={submit}
              testId="prompt-submit"
            >
              {submitLabel}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
