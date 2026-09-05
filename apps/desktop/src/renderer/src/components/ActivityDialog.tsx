import type { GitActivity } from '@git-gui/ipc-contract'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { Button } from '../ui/Button'
interface ActivityDialogProps {
  entries: GitActivity[]
  open: boolean
  onClose(): void
  onCancel(path: string): void
}
export function ActivityDialog({ entries, open, onClose, onCancel }: ActivityDialogProps) {
  return (
    <ModalOverlay
      className="ui-modal-overlay"
      isOpen={open}
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
      isDismissable
    >
      <Modal className="ui-modal">
        <Dialog className="ui-dialog">
          <Heading slot="title" className="ui-dialog__title">
            Git 작업 기록
          </Heading>
          <p className="text-xs text-(--color-text-muted)">
            현재 앱 실행 중 최근 주요 작업 100개 · 명령 인자와 인증 정보는 기록하지 않아요.
          </p>
          <ol className="m-0 max-h-[55vh] list-none overflow-auto p-0">
            {[...entries].reverse().map((entry) => (
              <li key={entry.id} className="border-b border-(--color-border) py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <strong>git {entry.operation}</strong>
                  <span>
                    {entry.status === 'running'
                      ? '실행 중'
                      : entry.status === 'completed'
                        ? '완료'
                        : entry.status === 'canceled'
                          ? '중단됨'
                          : '실패'}
                  </span>
                </div>
                <p className="my-1 break-all text-xs text-(--color-text-muted)">{entry.cwd}</p>
                <span className="text-xs">
                  {new Date(entry.startedAt).toLocaleTimeString()} ·{' '}
                  {(entry.durationMs / 1000).toFixed(1)}초
                </span>
                {entry.status === 'running' && (
                  <Button variant="ghost" size="sm" onPress={() => onCancel(entry.cwd)}>
                    작업 중단
                  </Button>
                )}
              </li>
            ))}
            {!entries.length && <li className="py-4 text-sm">아직 실행한 Git 작업이 없어요.</li>}
          </ol>
          <div className="ui-dialog__actions">
            <Button variant="ghost" onPress={onClose}>
              닫기
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
