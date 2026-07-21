/** 리뷰 요청 타임라인 항목 — 이슈 코멘트와 리뷰 요약을 하나의 시간순 목록으로 합친 것 */
export interface PullComment {
  id: number
  author: string
  body: string
  /** epoch 초 — UI 상대 시간 표기용 */
  createdAt: number
  /** comment: 이슈 코멘트 / review: 리뷰 요약(승인·코멘트 리뷰) */
  kind: 'comment' | 'review'
  /** kind='review'이고 승인(APPROVED)이면 'approved' — 그 외 null */
  state: 'approved' | null
}

/** GitHub 이슈 코멘트 응답 — 우리가 쓰는 필드만. user는 탈퇴 계정이면 null이다 */
interface RawIssueComment {
  id: number
  user: { login: string } | null
  body: string
  created_at: string
}

/** GitHub 리뷰 응답 — 우리가 쓰는 필드만. PENDING 리뷰는 submitted_at이 없다 */
interface RawReview {
  id: number
  user: { login: string } | null
  body: string | null
  state: string
  submitted_at?: string
}

function toEpochSeconds(iso: string | undefined): number {
  const ms = iso === undefined ? NaN : Date.parse(iso)
  // 해석 불가 시각은 0 — 항목을 빠뜨리는 것보다 순서가 어긋나는 쪽이 덜 위험하다
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000)
}

/**
 * 이슈 코멘트 + 리뷰 요약을 병합해 시간순(오래된 것 먼저)으로 정렬한다 — 순수 함수(레이어 분리).
 * 리뷰는 본문 있는 항목만 싣되, 승인(APPROVED)은 본문이 없어도 싣는다 —
 * 상세의 "승인됨" 배지와 타임라인의 "승인했어요" 표시가 이 목록에서 나온다.
 * 라인 단위 리뷰 코멘트(/pulls/{n}/comments)는 이번 범위 제외(후속 노트).
 */
export function buildPullTimeline(rawComments: unknown[], rawReviews: unknown[]): PullComment[] {
  const comments: PullComment[] = rawComments.map((raw) => {
    const comment = raw as RawIssueComment
    return {
      id: comment.id,
      author: comment.user?.login ?? '(알 수 없음)',
      body: comment.body,
      createdAt: toEpochSeconds(comment.created_at),
      kind: 'comment',
      state: null,
    }
  })
  const reviews: PullComment[] = (rawReviews as RawReview[])
    .filter((review) => review.state === 'APPROVED' || (review.body ?? '') !== '')
    .map((review) => ({
      id: review.id,
      author: review.user?.login ?? '(알 수 없음)',
      body: review.body ?? '',
      createdAt: toEpochSeconds(review.submitted_at),
      kind: 'review',
      state: review.state === 'APPROVED' ? 'approved' : null,
    }))
  // 시간순 — 같은 시각이면 안정 정렬로 원래 순서(코멘트 먼저)를 유지한다
  return [...comments, ...reviews].sort((a, b) => a.createdAt - b.createdAt)
}
