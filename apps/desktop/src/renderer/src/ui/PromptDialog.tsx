import { useEffect, useState } from 'react'
import { Dialog, Heading, Input, Label, Modal, ModalOverlay, TextField } from 'react-aria-components'
import { Button } from './Button'
import { isSubmitEnter } from './keyboard'
import './confirm-dialog.css'
import './prompt-dialog.css'

interface PromptDialogProps {
  isOpen: boolean
  title: string
  description: string
  label: string
  placeholder: string
  submitLabel: string
  /** 열릴 때 채워 둘 값 — 이름 바꾸기 등. 기본은 빈 값 */
  initialValue?: string
  /** 입력을 가린다(type=password) — 토큰 등 비밀값 전용 (E3a 후속 노트: PAT 마스킹) */
  masked?: boolean
  /** 인라인 에러 — 실패 시 다이얼로그 안에서 바로 보인다 (상단 배너와 병행) */
  errorText?: string | null
  /** 제출 — 실패 시 호출 측이 다이얼로그를 열어 두면 입력이 보존된다 */
  onSubmit(value: string): void
  onCancel(): void
}

/** 한 줄 입력 다이얼로그 — Enter로 제출(IME 조합 중 제외), ESC·바깥 클릭은 취소. 닫힐 때 입력을 비운다 */
export function PromptDialog({
  isOpen,
  title,
  description,
  label,
  placeholder,
  submitLabel,
  initialValue,
  masked,
  errorText,
  onSubmit,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState('')
  // 열릴 때 초기값으로 채우고, 닫힐 때 비운다 — 실패로 열려 있는 동안에는 입력이 보존된다
  useEffect(() => {
    setValue(isOpen ? (initialValue ?? '') : '')
  }, [isOpen, initialValue])
  const submit = () => {
    const trimmed = value.trim()
    if (trimmed === '') return
    onSubmit(trimmed)
  }
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
          <TextField
            className="ui-prompt__field"
            value={value}
            onChange={setValue}
            autoFocus
            onKeyDown={(event) => {
              if (isSubmitEnter(event.key, event.nativeEvent.isComposing)) {
                submit()
                return
              }
              // react-aria는 onKeyDown이 있으면 기본으로 전파를 끊는다(createEventHandler — 실측 2).
              // ESC가 ModalOverlay의 닫기 핸들러에 닿도록 제출이 아닌 키는 전파를 잇는다
              event.continuePropagation()
            }}
          >
            <Label className="ui-prompt__label">{label}</Label>
            <Input
              className="ui-prompt__input"
              type={masked ? 'password' : 'text'}
              placeholder={placeholder}
              data-testid="prompt-input"
            />
          </TextField>
          {errorText && (
            <p className="ui-prompt__error" role="alert" data-testid="prompt-error">
              {errorText}
            </p>
          )}
          <div className="ui-dialog__actions">
            <Button variant="ghost" size="sm" onPress={onCancel} testId="prompt-cancel">
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
