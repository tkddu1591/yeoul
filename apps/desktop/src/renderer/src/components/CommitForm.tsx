import { useState } from 'react'
import { Button } from '../ui/Button'
import { T } from '../terms'
import './commit-form.css'

interface CommitFormProps {
  stagedCount: number
  busy: boolean
  /** 빈 메시지로 저장하면 대신 들어갈 규칙 기반 제안 (스펙 8장). 없으면 빈 문자열 */
  suggestion: string
  /** 합치는 중에는 변경 0개여도 저장(병합 커밋)이 의미 있다 — 전량 ours 데드엔드 방지 (품질 리뷰) */
  allowEmpty: boolean
  onCommit(message: string): Promise<boolean>
}

export function CommitForm({ stagedCount, busy, suggestion, allowEmpty, onCommit }: CommitFormProps) {
  const [message, setMessage] = useState('')
  const effectiveMessage = message.trim().length > 0 ? message : suggestion
  const disabled = busy || (stagedCount === 0 && !allowEmpty) || effectiveMessage.trim().length === 0

  // E8 — 버튼을 못 누르는 이유, 또는(누를 수는 있지만) 빈 채로 저장하면 위 제안 문구가 대신 쓰인다는 안내.
  // 두 개념을 한 줄로 합쳐 "말로 상태를 알린다" — 카드 안에 늘 떠 있는 회색 줄 대신, 필요할 때만 뜬다.
  const reason = busy
    ? '작업 중이에요'
    : stagedCount === 0 && !allowEmpty
      ? `${T.staged}에 올린 파일이 없어요`
      : effectiveMessage.trim().length === 0
        ? `${T.commitMessage}를 적어 주세요`
        : message.trim().length === 0 && suggestion.length > 0
          ? `비워 두고 ${T.commit}하면 위 제안 문구로 ${T.commit}돼요`
          : ''

  return (
    <form
      className="commit-form"
      onSubmit={(event) => {
        event.preventDefault()
        // 커밋이 실패하면(훅 거부, 충돌 상태 등) 입력한 메시지를 보존한다
        void onCommit(effectiveMessage).then((committed) => {
          if (committed) setMessage('')
        })
      }}
    >
      <label className="commit-form__label" htmlFor="commit-message">
        {T.commitMessage}
      </label>
      <textarea
        id="commit-message"
        data-testid="commit-message"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder={suggestion ? `비워 두면: ${suggestion}` : '무엇을 바꿨는지 적어 주세요'}
        rows={3}
      />
      <div className="commit-form__foot">
        <span className="commit-form__reason" data-testid="commit-hint">
          {reason}
        </span>
        <Button variant="primary" type="submit" isDisabled={disabled} testId="commit-button">
          {allowEmpty && stagedCount === 0 ? `${T.merge} 마무리` : T.commit}
        </Button>
      </div>
    </form>
  )
}
