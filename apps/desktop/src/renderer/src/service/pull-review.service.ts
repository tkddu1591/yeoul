import { pullFeedback } from '../../../shared/pull-feedback'
import { pullPolicy } from '@git-gui/domain'
import type { PullDetailView } from '@git-gui/ipc-contract'
function get(view: PullDetailView) {
  const review = pullPolicy.review.get(view.detail, view.comments)
  const status = view.detail.merged
    ? '병합됨'
    : view.detail.state === 'closed'
      ? '닫힘'
      : view.detail.isDraft
        ? '초안'
        : review === 'changes-requested'
          ? '수정 요청'
          : review === 'approved'
            ? '현재 커밋 승인됨'
            : review === 'previous-approval'
              ? '이전 승인 · 현재 커밋 확인 필요'
              : '검토 대기'
  const permission = pullPolicy.merge.check(view.detail, view.comments)
  return {
    status,
    merge: { ...permission, reason: pullFeedback.merge.message.get(permission.reason) },
    settled: view.detail.merged || view.detail.state === 'closed',
  }
}
export const pullReviewService = { summary: { get } }
