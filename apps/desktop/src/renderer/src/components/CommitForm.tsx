import { Button } from '../ui/Button'
import { isSubmitEnter } from '../ui/keyboard'
import type { CommitFormModel } from '../adapter/commit-form.adapter'
import { useCommitDraft } from '../hook/use-commit-draft'
import { commitFormPolicy } from '../service/commit-form.service'
import './commit-form.css'

interface CommitFormProps {
  model: CommitFormModel
  busy: boolean
  onCommit(message: string): Promise<boolean>
}
export function CommitForm({ model, busy, onCommit }: CommitFormProps) {
  const draft = useCommitDraft(model.target)
  const effective = draft.data.message.trim() ? draft.data.message : model.suggestion
  const availability = commitFormPolicy.availability.get(model, busy, effective)
  const submit = () => {
    if (availability.disabled) return
    void onCommit(effective).then((completed) => {
      if (completed) draft.entry.clear()
    })
  }
  const label = model.merging && model.stagedCount === 0 ? '병합 마무리' : '커밋'
  return (
    <form
      className="commit-form"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <label className="commit-form__label" htmlFor="commit-message">
          커밋 메시지
        </label>
        <span
          className="min-w-0 truncate text-(--color-accent)"
          title={model.target.path}
          data-testid="commit-target"
        >
          {model.target.name} / {model.target.branch}
        </span>
      </div>
      <div className="commit-form__box">
        <textarea
          id="commit-message"
          data-testid="commit-message"
          value={draft.data.message}
          onChange={(event) => draft.entry.set(event.target.value)}
          rows={3}
          placeholder={
            model.suggestion ? `비워 두면: ${model.suggestion}` : '무엇을 바꿨는지 적어 주세요'
          }
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              isSubmitEnter(event.key, event.nativeEvent.isComposing)
            ) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className="commit-form__foot items-start!">
          <span
            className="commit-form__status whitespace-normal! overflow-visible! py-1"
            data-testid="commit-hint"
          >
            {availability.label}
          </span>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            isDisabled={availability.disabled}
            testId="commit-button"
            aria-label={label}
            aria-keyshortcuts="Meta+Enter"
          >
            {label}
            <kbd className="commit-form__kbd" aria-hidden="true">
              ⌘↵
            </kbd>
          </Button>
        </div>
      </div>
    </form>
  )
}
