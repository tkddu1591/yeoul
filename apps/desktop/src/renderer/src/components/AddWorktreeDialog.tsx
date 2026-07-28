import { useEffect, useState } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import type { LocalBranchStatus } from '@git-gui/domain'
import { Button } from '../ui/Button'
import '../ui/confirm-dialog.css'
import '../ui/settings/settings-dialog.css'
import './worktrees-panel.css'
import { suggestWorktreePath } from './worktree-path'
import { T } from '../terms'

interface AddWorktreeDialogProps {
  isOpen: boolean
  mainPath: string
  /** 로컬 브랜치 — 이미 워크트리가 쓰는 브랜치는 checkedOut으로 걸러진다 */
  branches: LocalBranchStatus[]
  /** 이미 어떤 워크트리가 체크아웃한 브랜치 이름들 (git 제약: 같은 브랜치 중복 불가) */
  checkedOut: Set<string>
  errorText: string | null
  /** createBranch면 branch는 새로 만들 이름(-b) — 지금 위치(HEAD) 기준 (E7d ④) */
  onSubmit(path: string, branch: string, createBranch: boolean): void
  onCancel(): void
}

type AddMode = 'existing' | 'new'

/**
 * 새 워크트리 만들기 (E7c) — 체크아웃 안 된 브랜치 선택 + 경로(자동 제안·수정 가능).
 * E7d ④: "새로 만들면서 펼치기" 모드 — 이름 입력 → 브랜치+워크트리 동시 생성(-b)
 */
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
  const [mode, setMode] = useState<AddMode>('existing')
  const [branch, setBranch] = useState('')
  const [newName, setNewName] = useState('')
  const [path, setPath] = useState('')
  const [pathEdited, setPathEdited] = useState(false)
  useEffect(() => {
    if (!isOpen) return
    const first = available[0]?.name ?? ''
    setMode('existing')
    setBranch(first)
    setNewName('')
    setPath(first === '' ? '' : suggestWorktreePath(mainPath, first))
    setPathEdited(false)
    // 열림 전이에만 초기화 — available은 렌더마다 새 배열
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const suggestFor = (name: string) => {
    if (!pathEdited) setPath(name === '' ? '' : suggestWorktreePath(mainPath, name))
  }
  const chooseBranch = (name: string) => {
    setBranch(name)
    suggestFor(name)
  }
  const chooseMode = (next: AddMode) => {
    setMode(next)
    // onChange 경로와 같은 trim — 후행 공백이 모드 전환 때만 하이픈 경로가 되는 비일관 방지 (품질 리뷰)
    suggestFor(next === 'existing' ? branch : newName.trim())
  }
  const effectiveBranch = mode === 'existing' ? branch : newName.trim()

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
            {T.branch}을 새 폴더에 함께 펼쳐요. 같은 {T.branch}은 한 폴더에서만 열 수 있어요.
          </p>
          <fieldset className="settings-dialog__field add-worktree__mode">
            <label className="settings-dialog__radio">
              <input
                type="radio"
                name="add-worktree-mode"
                checked={mode === 'existing'}
                onChange={() => chooseMode('existing')}
                data-testid="add-worktree-mode-existing"
              />
              기존 {T.branch} 펼치기
            </label>
            <label className="settings-dialog__radio">
              <input
                type="radio"
                name="add-worktree-mode"
                checked={mode === 'new'}
                onChange={() => chooseMode('new')}
                data-testid="add-worktree-mode-new"
              />
              새로 만들면서 펼치기 — 지금 위치에서 갈라져요
            </label>
          </fieldset>
          {mode === 'existing' ? (
            available.length === 0 ? (
              <p className="worktrees-panel__empty">
                펼칠 수 있는 {T.branch}이 없어요. "새로 만들면서 펼치기"를 써 보세요.
              </p>
            ) : (
              <label className="add-worktree__label">
                {T.branch}
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
            )
          ) : (
            <label className="add-worktree__label">
              새 {T.branch} 이름
              <input
                className="add-worktree__input"
                value={newName}
                onChange={(event) => {
                  setNewName(event.target.value)
                  suggestFor(event.target.value.trim())
                }}
                placeholder="예: feature/login"
                data-testid="add-worktree-new-name"
              />
            </label>
          )}
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
          <div className="ui-dialog__actions">
            <Button variant="ghost" size="sm" onPress={onCancel} testId="add-worktree-cancel">
              그만두기
            </Button>
            <Button
              variant="primary"
              size="sm"
              isDisabled={effectiveBranch === '' || path === ''}
              onPress={() => onSubmit(path, effectiveBranch, mode === 'new')}
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
