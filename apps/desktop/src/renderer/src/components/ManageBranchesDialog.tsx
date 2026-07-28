import { Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import type { BranchSummary } from '@git-gui/domain'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { PromptDialog } from '../ui/PromptDialog'
import { Tooltip } from '../ui/Tooltip'
import { T } from '../terms'
import './manage-branches.css'
import '../ui/confirm-dialog.css'

interface ManageBranchesDialogProps {
  isOpen: boolean
  branches: BranchSummary[]
  busy: boolean
  errorText: string | null
  /** 성공 여부 반환 — 실패 시 이름 다이얼로그를 유지한다 */
  onRename(oldName: string, newName: string): Promise<boolean>
  /** 반환 true면 합쳐지지 않은 저장이 있어 강제 확인이 필요하다 */
  onRemove(name: string, force: boolean): Promise<boolean>
  /** 이름 바꾸기 프롬프트를 열 때 이전 에러를 지운다 — 스테일 인라인 에러 방지 (품질 리뷰) */
  onClearError(): void
  onCancel(): void
}

/** 실험 공간 관리 — 이름 바꾸기·지우기. 현재 공간은 지울 수 없다(이동 후 삭제 안내) */
export function ManageBranchesDialog({
  isOpen,
  branches,
  busy,
  errorText,
  onRename,
  onRemove,
  onClearError,
  onCancel,
}: ManageBranchesDialogProps) {
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<string | null>(null)
  const [forceTarget, setForceTarget] = useState<string | null>(null)

  return (
    <>
      <ModalOverlay
        className="ui-modal-overlay"
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) onCancel()
        }}
        isDismissable
      >
        <Modal className="ui-modal">
          <Dialog className="ui-dialog manage-branches">
            <Heading slot="title" className="ui-dialog__title">
              {T.branch} 관리
            </Heading>
            <p className="ui-dialog__body">
              이름을 바꾸거나 다 쓴 {T.branch}를 지워요. 지금 있는 공간은 지울 수 없어요.
            </p>
            <ul className="manage-branches__list">
              {branches.map((branch) => (
                <li key={branch.name} className="manage-branches__row">
                  <Tooltip content={branch.name} summary={branch.name}>
                    <span className="manage-branches__name">
                      {branch.name}
                      {branch.isCurrent && <span className="manage-branches__here">{T.head}</span>}
                    </span>
                  </Tooltip>
                  <Button
                    variant="ghost"
                    size="sm"
                    isDisabled={busy}
                    onPress={() => {
                      onClearError()
                      setRenameTarget(branch.name)
                    }}
                    testId={`manage-rename-${branch.name}`}
                  >
                    <Pencil size={13} aria-hidden="true" /> 이름 바꾸기
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    isDisabled={busy || branch.isCurrent}
                    onPress={() => setRemoveTarget(branch.name)}
                    testId={`manage-remove-${branch.name}`}
                  >
                    <Trash2 size={13} aria-hidden="true" /> 지우기
                  </Button>
                </li>
              ))}
            </ul>
            <div className="ui-dialog__actions">
              <Button variant="ghost" size="sm" onPress={onCancel} testId="manage-close">
                닫기
              </Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
      <PromptDialog
        isOpen={renameTarget !== null}
        title="이름 바꾸기"
        description={`이 ${T.branch}의 새 이름을 지어 주세요.`}
        label="새 이름"
        placeholder="예: better-name"
        submitLabel="바꾸기"
        initialValue={renameTarget ?? ''}
        errorText={errorText}
        onSubmit={(name) => {
          void (async () => {
            if (renameTarget !== null && (await onRename(renameTarget, name))) {
              setRenameTarget(null)
            }
          })()
        }}
        onCancel={() => setRenameTarget(null)}
      />
      <ConfirmDialog
        isOpen={removeTarget !== null}
        title={`${T.branch}를 지울까요?`}
        confirmLabel="지우기"
        onConfirm={() => {
          void (async () => {
            const name = removeTarget
            setRemoveTarget(null)
            if (name !== null && (await onRemove(name, false))) {
              // 합쳐지지 않은 저장이 있다 — 강제 삭제는 별도 확인을 거친다
              setForceTarget(name)
            }
          })()
        }}
        onCancel={() => setRemoveTarget(null)}
      >
        "{removeTarget}" {T.branch}를 지워요. 다른 공간에 {T.merge}된 내용은 그대로 남아요.
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={forceTarget !== null}
        title={`아직 ${T.merge}되지 않은 ${T.commit}이 있어요`}
        confirmLabel="그래도 지우기"
        onConfirm={() => {
          const name = forceTarget
          setForceTarget(null)
          if (name !== null) void onRemove(name, true)
        }}
        onCancel={() => setForceTarget(null)}
      >
        "{forceTarget}"에는 다른 곳에 {T.merge}되지 않은 {T.commit}이 있어요. 지우면 그 {T.commit}들은
        사라지고 되돌릴 수 없어요.
      </ConfirmDialog>
    </>
  )
}
