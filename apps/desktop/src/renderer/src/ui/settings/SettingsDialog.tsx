import { useState } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { GitFork, Palette, Settings2 } from 'lucide-react'
import { Button } from '../Button'
import '../confirm-dialog.css'
import './settings-dialog.css'
import { AppearanceSettingsPanel } from './AppearanceSettingsPanel'
import {
  GeneralSettingsPanel,
  type GeneralSettingsPreferences,
} from './GeneralSettingsPanel'
import {
  RemoteSettingsPanel,
  type RemoteDraft,
  type RemoteSettingsState,
} from './RemoteSettingsPanel'
import type { WorktreeSelectAction } from './worktree-select-action'
import type { PullMode } from './sync-settings'
import type { Appearance } from '@git-gui/ipc-contract'

interface SettingsDialogProps {
  isOpen: boolean
  appearance: Appearance
  onChangeAppearance(appearance: Appearance): void
  preferences: GeneralSettingsPreferences
  onChangeWorktreeSelectAction(action: WorktreeSelectAction): void
  onChangePullMode(mode: PullMode): void
  onChangeAutoFetch(enabled: boolean): void
  remote: RemoteSettingsState
  onAddRemote(name: string, url: string): Promise<boolean>
  onRemoveRemote(name: string): void
  onRevealDiagnostics(): void
  onClose(): void
}

type SettingsCategory = 'general' | 'remotes' | 'theme'

/**
 * 설정 모달 (E7c) — 카테고리 사이드바 + 즉시 저장(확인 버튼 없음 — rightWidth·테마 관례).
 * E7d ⑦: [테마] 카테고리 신설(헤더 토글 이관) — 카테고리 전환이 처음 실사용된다
 */
export function SettingsDialog({
  isOpen,
  appearance,
  onChangeAppearance,
  preferences,
  onChangeWorktreeSelectAction,
  onChangePullMode,
  onChangeAutoFetch,
  remote,
  onAddRemote,
  onRemoveRemote,
  onRevealDiagnostics,
  onClose,
}: SettingsDialogProps) {
  const [category, setCategory] = useState<SettingsCategory>('general')
  const [remoteDraft, setRemoteDraft] = useState<RemoteDraft>({ name: 'origin', url: '' })
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
                <Settings2 size={15} aria-hidden="true" />
                <span>일반</span>
              </button>
              <button
                type="button"
                className={`settings-dialog__cat${category === 'remotes' ? ' settings-dialog__cat--on' : ''}`}
                onClick={() => setCategory('remotes')}
                data-testid="settings-cat-remotes"
              >
                <GitFork size={15} aria-hidden="true" />
                <span>원격</span>
              </button>
              <button
                type="button"
                className={`settings-dialog__cat${category === 'theme' ? ' settings-dialog__cat--on' : ''}`}
                onClick={() => setCategory('theme')}
                data-testid="settings-cat-theme"
              >
                <Palette size={15} aria-hidden="true" />
                <span>테마</span>
              </button>
            </nav>
            <div className="settings-dialog__content">
              {category === 'general' ? (
                <GeneralSettingsPanel
                  preferences={preferences}
                  onChangeWorktreeSelectAction={onChangeWorktreeSelectAction}
                  onChangePullMode={onChangePullMode}
                  onChangeAutoFetch={onChangeAutoFetch}
                  onRevealDiagnostics={onRevealDiagnostics}
                />
              ) : category === 'remotes' ? (
                <RemoteSettingsPanel
                  remote={remote}
                  draft={remoteDraft}
                  onChangeDraft={setRemoteDraft}
                  onAdd={onAddRemote}
                  onRemove={onRemoveRemote}
                />
              ) : (
                <AppearanceSettingsPanel
                  appearance={appearance}
                  onChange={onChangeAppearance}
                />
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
