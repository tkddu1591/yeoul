import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { Button } from '../Button'
import '../confirm-dialog.css'
import './settings-dialog.css'
import type { WorktreeSelectAction } from './worktree-select-action'

interface SettingsDialogProps {
  isOpen: boolean
  worktreeSelectAction: WorktreeSelectAction
  onChangeWorktreeSelectAction(action: WorktreeSelectAction): void
  onClose(): void
}

/**
 * 설정 모달 (E7c) — 이 앱 최초의 범용 설정 표면. 카테고리 사이드바 + 즉시 저장(확인 버튼 없음 —
 * rightWidth·테마 관례). v1 카테고리는 "일반" 하나 — 후속 카테고리는 미리 그리지 않는다(죽은 UI 금지, 스펙)
 */
export function SettingsDialog({
  isOpen,
  worktreeSelectAction,
  onChangeWorktreeSelectAction,
  onClose,
}: SettingsDialogProps) {
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
                className="settings-dialog__cat settings-dialog__cat--on"
                data-testid="settings-cat-general"
              >
                일반
              </button>
            </nav>
            <div className="settings-dialog__content">
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
