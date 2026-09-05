export interface PullMergeFacts {
  merged: boolean
  state: 'open' | 'closed'
  isDraft?: boolean
  headSha?: string | null
  mergeable?: boolean | null
  mergeState?: string
}
export interface PullReviewFacts {
  kind: 'comment' | 'review'
  author: string
  state: 'approved' | 'changes-requested' | 'dismissed' | null
  id: number
  createdAt: number
  commitId?: string | null
}

function getReview(detail: PullMergeFacts, comments: PullReviewFacts[]) {
  const latest = new Map<string, PullReviewFacts>()
  for (const review of comments
    .filter((item) => item.kind === 'review' && item.state !== null)
    .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id))
    latest.set(review.author, review)
  const reviews = [...latest.values()]
  if (reviews.some((review) => review.state === 'changes-requested')) return 'changes-requested'
  const approvals = reviews.filter((review) => review.state === 'approved')
  if (approvals.some((review) => detail.headSha && review.commitId === detail.headSha))
    return 'approved'
  if (approvals.length) return 'previous-approval'
  return 'pending'
}
export type PullMergeBlockReason =
  | 'closed'
  | 'draft'
  | 'changes-requested'
  | 'unknown'
  | 'blocked'
  | null
function checkMerge(
  detail: PullMergeFacts,
  comments: PullReviewFacts[],
): { allowed: boolean; reason: PullMergeBlockReason } {
  if (detail.merged || detail.state === 'closed') return { allowed: false, reason: 'closed' }
  if (detail.isDraft) return { allowed: false, reason: 'draft' }
  if (getReview(detail, comments) === 'changes-requested')
    return { allowed: false, reason: 'changes-requested' }
  if (!detail.headSha || detail.mergeable == null || detail.mergeState === 'unknown')
    return { allowed: false, reason: 'unknown' }
  if (!detail.mergeable || detail.mergeState !== 'clean')
    return { allowed: false, reason: 'blocked' }
  return { allowed: true, reason: null }
}
export const pullPolicy = { review: { get: getReview }, merge: { check: checkMerge } }
