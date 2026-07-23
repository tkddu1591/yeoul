import { useState } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { Button } from '../Button'
import '../confirm-dialog.css'
import './settings-dialog.css'
import type { Theme } from '../theme'
import type { WorktreeSelectAction } from './worktree-select-action'

interface SettingsDialogProps {
  isOpen: boolean
  theme: Theme
  onChangeTheme(theme: Theme): void
  worktreeSelectAction: WorktreeSelectAction
  onChangeWorktreeSelectAction(action: WorktreeSelectAction): void
  onClose(): void
}

type SettingsCategory = 'general' | 'theme'

/**
 * 설정 모달 (E7c) — 카테고리 사이드바 + 즉시 저장(확인 버튼 없음 — rightWidth·테마 관례).
 * E7d ⑦: [테마] 카테고리 신설(헤더 토글 이관) — 카테고리 전환이 처음 실사용된다
 */
export function SettingsDialog({
  isOpen,
  theme,
  onChangeTheme,
  worktreeSelectAction,
  onChangeWorktreeSelectAction,
  onClose,
}: SettingsDialogProps) {
  const [category, setCategory] = useState<SettingsCategory>('general')
  return (
    <ModalOverlay
      className="ui-modal-overlay"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      isDismissable
    >
      <Modal className="ui-modal settings-dialog__modal">
        <Dialog className="ui-dialog">
          <Heading slot="title" className="ui-dialog__title">
            설정
          </Heading>
          <div className="settings-dialog__body" data-testid="settings-dialog">
            <nav className="settings-dialog__cats" aria-label="설정 분류">
              <button
                type="button"
                className={`settings-dialog__cat${category === 'general' ? ' settings-dialog__cat--on' : ''}`}
                onClick={() => setCategory('general')}
                data-testid="settings-cat-general"
              >
                일반
              </button>
              <button
                type="button"
                className={`settings-dialog__cat${category === 'theme' ? ' settings-dialog__cat--on' : ''}`}
                onClick={() => setCategory('theme')}
                data-testid="settings-cat-theme"
              >
                테마
              </button>
            </nav>
            <div className="settings-dialog__content">
              {category === 'general' ? (
                <fieldset className="settings-dialog__field">
                  <legend className="settings-dialog__label">워크트리 선택 시 동작</legend>
                  <label className="settings-dialog__radio">
                    <input
                      type="radio"
                      name="worktree-select-action"
                      checked={worktreeSelectAction === 'terminal'}
                      onChange={() => onChangeWorktreeSelectAction('terminal')}
                      data-testid="settings-worktree-terminal"
                    />
                    터미널만 따라가기 — 새 터미널이 그 폴더에서 열려요
                  </label>
                  <label className="settings-dialog__radio">
                    <input
                      type="radio"
                      name="worktree-select-action"
                      checked={worktreeSelectAction === 'switch-app'}
                      onChange={() => onChangeWorktreeSelectAction('switch-app')}
                      data-testid="settings-worktree-switch"
                    />
                    앱 전체 전환 — 변경·역사·실험 공간도 그 워크트리 기준으로 바뀌어요
                  </label>
                  <p className="settings-dialog__desc">
                    우클릭 메뉴에서는 설정과 무관하게 두 동작을 언제든 고를 수 있어요.
                  </p>
                </fieldset>
              ) : (
                <fieldset className="settings-dialog__field">
                  <legend className="settings-dialog__label">테마</legend>
                  <label className="settings-dialog__radio">
                    <input
                      type="radio"
                      name="app-theme"
                      checked={theme === 'light'}
                      onChange={() => onChangeTheme('light')}
                      data-testid="settings-theme-light"
                    />
                    밝게
                  </label>
                  <label className="settings-dialog__radio">
                    <input
                      type="radio"
                      name="app-theme"
                      checked={theme === 'dark'}
                      onChange={() => onChangeTheme('dark')}
                      data-testid="settings-theme-dark"
                    />
                    어둡게
                  </label>
                  <p className="settings-dialog__desc">터미널 색도 함께 바뀌어요.</p>
                </fieldset>
              )}
            </div>
          </div>
          <div className="ui-dialog__actions">
            <Button variant="ghost" size="sm" onPress={onClose} testId="settings-close">
              닫기
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
