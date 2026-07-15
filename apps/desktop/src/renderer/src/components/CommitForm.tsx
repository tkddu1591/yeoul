import { useState } from 'react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import './commit-form.css'

interface CommitFormProps {
  stagedCount: number
  busy: boolean
  onCommit(message: string): Promise<boolean>
}

export function CommitForm({ stagedCount, busy, onCommit }: CommitFormProps) {
  const [message, setMessage] = useState('')
  const disabled = busy || stagedCount === 0 || message.trim().length === 0

  return (
    <form
      className="commit-form"
      onSubmit={(event) => {
        event.preventDefault()
        // 커밋이 실패하면(훅 거부, 충돌 상태 등) 입력한 메시지를 보존한다
        void onCommit(message).then((committed) => {
          if (committed) setMessage('')
        })
      }}
    >
      <label className="commit-form__label" htmlFor="commit-message">
        저장 메시지 <Badge tone="git">commit</Badge>
      </label>
      <textarea
        id="commit-message"
        data-testid="commit-message"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="무엇을 바꿨는지 적어 주세요"
        rows={3}
      />
      <Button variant="primary" type="submit" isDisabled={disabled} testId="commit-button">
        저장하기 — {stagedCount}개 파일
      </Button>
    </form>
  )
}
