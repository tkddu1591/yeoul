import type { PullMergeBlockReason } from '@git-gui/domain'
function get(reason: PullMergeBlockReason): string {
  switch (reason) {
    case 'closed':
      return '이미 종료된 풀 리퀘스트예요.'
    case 'draft':
      return '초안을 검토 준비 상태로 바꿔 주세요.'
    case 'changes-requested':
      return '수정 요청이 남아 있어요.'
    case 'unknown':
      return '병합 가능 여부를 다시 확인해 주세요.'
    case 'blocked':
      return '충돌·검사·브랜치 보호 조건을 GitHub에서 확인해 주세요.'
    default:
      return 'GitHub에서 병합 가능한 상태로 확인했어요.'
  }
}
export const pullFeedback = { merge: { message: { get } } }
