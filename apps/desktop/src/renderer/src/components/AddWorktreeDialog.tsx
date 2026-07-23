import { useEffect, useState } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import type { LocalBranchStatus } from '@git-gui/domain'
import { Button } from '../ui/Button'
import '../ui/confirm-dialog.css'
import './worktrees-panel.css'
import { suggestWorktreePath } from './worktree-path'

interface AddWorktreeDialogProps {
  isOpen: boolean
  mainPath: string
  /** 로컬 브랜치 — 이미 워크트리가 쓰는 브랜치는 checkedOut으로 걸러진다 */
  branches: LocalBranchStatus[]
  /** 이미 어떤 워크트리가 체크아웃한 브랜치 이름들 (git 제약: 같은 브랜치 중복 불가) */
  checkedOut: Set<string>
  errorText: string | null
  onSubmit(path: string, branch: string): void
  onCancel(): void
}

/** 새 워크트리 만들기 (E7c) — 체크아웃 안 된 브랜치 선택 + 경로(자동 제안·수정 가능) */
export function AddWorktreeDialog({
  isOpen,
  mainPath,
  branches,
  checkedOut,
  errorText,
  onSubmit,
  onCancel,
}: AddWorktreeDialogProps) {
  const available = branches.filter((branch) => !checkedOut.has(branch.name))
  const [branch, setBranch] = useState('')
  const [path, setPath] = useState('')
  const [pathEdited, setPathEdited] = useState(false)
  useEffect(() => {
    if (!isOpen) return
    const first = available[0]?.name ?? ''
    setBranch(first)
    setPath(first === '' ? '' : suggestWorktreePath(mainPath, first))
    setPathEdited(false)
    // 열림 전이에만 초기화 — available은 렌더마다 새 배열
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const chooseBranch = (name: string) => {
    setBranch(name)
    if (!pathEdited) setPath(suggestWorktreePath(mainPath, name))
  }

  return (
    <ModalOverlay
      className="ui-modal-overlay"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      isDismissable
    >
      <Modal className="ui-modal">
        <Dialog className="ui-dialog">
          <Heading slot="title" className="ui-dialog__title">
            새 워크트리 만들기
          </Heading>
          <p className="ui-dialog__body">
            체크아웃되지 않은 실험 공간을 새 폴더에 함께 펼쳐요. 같은 실험 공간은 한 폴더에서만 열 수
            있어요.
          </p>
          {available.length === 0 ? (
            <p className="worktrees-panel__empty">
              펼칠 수 있는 실험 공간이 없어요. 실험 공간 탭에서 먼저 만들어 주세요.
            </p>
          ) : (
            <>
              <label className="add-worktree__label">
                실험 공간
                <select
                  className="add-worktree__select"
                  value={branch}
                  onChange={(event) => chooseBranch(event.target.value)}
                  data-testid="add-worktree-branch"
                >
                  {available.map((option) => (
                    <option key={option.name} value={option.name}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="add-worktree__label">
                폴더 경로
                <input
                  className="add-worktree__input"
                  value={path}
                  onChange={(event) => {
                    setPath(event.target.value)
                    setPathEdited(true)
                  }}
                  data-testid="add-worktree-path"
                />
              </label>
              {errorText !== null && (
                <p className="add-worktree__error" role="alert" data-testid="add-worktree-error">
                  {errorText}
                </p>
              )}
            </>
          )}
          <div className="ui-dialog__actions">
            <Button variant="ghost" size="sm" onPress={onCancel} testId="add-worktree-cancel">
              그만두기
            </Button>
            <Button
              variant="primary"
              size="sm"
              isDisabled={branch === '' || path === ''}
              onPress={() => onSubmit(path, branch)}
              testId="add-worktree-submit"
            >
              만들기
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
