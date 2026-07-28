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

  // E9 — 왼쪽 슬롯은 항상 무언가를 말한다. 못 누르면 이유를, 누를 수 있으면 무엇을 커밋하는지.
  // (E8에서는 누를 수 있을 때 빈 문자열이라 span 높이가 0이 됐다)
  const status = busy
    ? '작업 중이에요'
    : stagedCount === 0 && !allowEmpty
      ? `${T.staged}에 올린 파일이 없어요`
      : effectiveMessage.trim().length === 0
        ? `${T.commitMessage}를 적어 주세요`
        : allowEmpty && stagedCount === 0
          ? `${T.merge} 마무리`
          : `${stagedCount}개 파일`

  const submit = () => {
    if (disabled) return
    // 커밋이 실패하면(훅 거부, 충돌 상태 등) 입력한 메시지를 보존한다
    void onCommit(effectiveMessage).then((committed) => {
      if (committed) setMessage('')
    })
  }

  return (
    <form
      className="commit-form"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <label className="commit-form__label" htmlFor="commit-message">
        {T.commitMessage}
      </label>
      <div className="commit-form__box">
        <textarea
          id="commit-message"
          data-testid="commit-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            // ⌘↵ / Ctrl+↵ 제출. 한글 조합 중 Enter는 확정용이라 제출하면 안 된다 (E1a PromptDialog 선례)
            if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
            if (event.nativeEvent.isComposing) return
            event.preventDefault()
            submit()
          }}
          placeholder={suggestion ? `비워 두면: ${suggestion}` : '무엇을 바꿨는지 적어 주세요'}
          rows={3}
        />
        <div className="commit-form__foot">
          <span className="commit-form__status" data-testid="commit-hint">
            {status}
          </span>
          <Button
            variant="soft"
            size="sm"
            type="submit"
            isDisabled={disabled}
            testId="commit-button"
            // E9 보완 — kbd가 라벨 안에 있으면 접근명이 "커밋⌘↵"가 된다. kbd는 aria-hidden으로 빼고
            // 접근명은 명시적으로 준다 (ShelfPopover 선례)
            aria-label={allowEmpty && stagedCount === 0 ? `${T.merge} 마무리` : T.commit}
          >
            {allowEmpty && stagedCount === 0 ? `${T.merge} 마무리` : T.commit}
            <kbd className="commit-form__kbd" aria-hidden="true">
              ⌘↵
            </kbd>
          </Button>
        </div>
      </div>
    </form>
  )
}
