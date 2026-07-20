import { useState } from 'react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
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
        저장 메시지 <Badge tone="git">commit</Badge>
      </label>
      <textarea
        id="commit-message"
        data-testid="commit-message"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder={suggestion || '무엇을 바꿨는지 적어 주세요'}
        rows={3}
      />
      {message.trim().length === 0 && suggestion.length > 0 && (
        // 스펙 10장 "선택의 결과는 말로 설명한다" — placeholder가 힌트가 아니라 실제 저장 문구임을 알린다
        <p className="commit-form__hint" data-testid="commit-hint">
          비워 두고 저장하면 위 제안 문구로 저장돼요
        </p>
      )}
      <Button variant="primary" type="submit" isDisabled={disabled} testId="commit-button">
        저장하기 — {allowEmpty && stagedCount === 0 ? '합치기 마무리' : `${stagedCount}개 파일`}
      </Button>
    </form>
  )
}
