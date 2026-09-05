import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { Button } from '../ui/Button'
interface WorkflowHelpDialogProps {
  open: boolean
  onClose(): void
  onLayout(mode: 'default' | 'review' | 'terminal'): void
}
export function WorkflowHelpDialog({ open, onClose, onLayout }: WorkflowHelpDialogProps) {
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
            보기와 단축키
          </Heading>
          <p className="text-sm">
            현재 작업 폴더는 헤더와 커밋 영역에서 확인할 수 있어요. 전체 목록의 파일을 선택하면 해당
            작업 폴더로 이동해요.
          </p>
          <div className="flex gap-2">
            <Button onPress={() => onLayout('default')}>기본 배치</Button>
            <Button onPress={() => onLayout('review')}>코드 검토</Button>
            <Button onPress={() => onLayout('terminal')}>터미널 작업</Button>
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-8 gap-y-2 text-sm">
            <dt>폴더·작업 공간 열기</dt>
            <dd>⌘O</dd>
            <dt>새 탭 / 탭 닫기</dt>
            <dd>⌘T / ⌘W</dd>
            <dt>현재 영역 검색</dt>
            <dd>⌘F</dd>
            <dt>커밋 메시지 제출</dt>
            <dd>⌘↵</dd>
            <dt>터미널 접기·펼치기</dt>
            <dd>⌘`</dd>
            <dt>왼쪽 / 오른쪽 패널</dt>
            <dd>⌘⌥1 / ⌘⌥2</dd>
            <dt>목록 이동</dt>
            <dd>↑ ↓ Home End</dd>
            <dt>범위 선택</dt>
            <dd>Shift + ↑ ↓ Home End</dd>
            <dt>선택한 파일 체크</dt>
            <dd>Space</dd>
            <dt>대화상자 닫기</dt>
            <dd>Esc</dd>
            <dt>이 도움말</dt>
            <dd>⌘/</dd>
          </dl>
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
