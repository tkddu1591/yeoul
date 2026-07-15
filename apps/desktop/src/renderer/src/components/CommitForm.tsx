import { useState } from 'react'

interface CommitFormProps {
  stagedCount: number
  busy: boolean
  onCommit(message: string): void
}

export function CommitForm({ stagedCount, busy, onCommit }: CommitFormProps) {
  const [message, setMessage] = useState('')
  const disabled = busy || stagedCount === 0 || message.trim().length === 0

  return (
    <form
      className="commit-form"
      onSubmit={(event) => {
        event.preventDefault()
        onCommit(message)
        setMessage('')
      }}
    >
      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="저장 메시지를 입력하세요"
        rows={3}
      />
      <button type="submit" disabled={disabled}>
        저장하기 (commit) — {stagedCount}개 파일
      </button>
    </form>
  )
}
