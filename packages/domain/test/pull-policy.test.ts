import { describe, expect, it } from 'vitest'
import { pullPolicy, type PullMergeFacts, type PullReviewFacts } from '../src/pull-policy'
const detail: PullMergeFacts = {
  state: 'open',
  merged: false,
  isDraft: false,
  headSha: 'current',
  mergeable: true,
  mergeState: 'clean',
}
const approval: PullReviewFacts = {
  id: 1,
  author: 'reviewer',
  kind: 'review',
  state: 'approved',
  createdAt: 1,
  commitId: 'current',
}
describe('pullPolicy', () => {
  it('과거 승인 이후 수정 요청을 우선한다', () => {
    const reviews: PullReviewFacts[] = [
      approval,
      { ...approval, id: 2, createdAt: 2, state: 'changes-requested' },
    ]
    expect(pullPolicy.review.get(detail, reviews)).toBe('changes-requested')
    expect(pullPolicy.merge.check(detail, reviews)).toEqual({
      allowed: false,
      reason: 'changes-requested',
    })
  })
  it('다른 head에 대한 승인을 현재 승인으로 표시하지 않는다', () => {
    expect(pullPolicy.review.get(detail, [{ ...approval, commitId: 'old' }])).toBe(
      'previous-approval',
    )
    expect(pullPolicy.review.get(detail, [approval])).toBe('approved')
  })
  it('취소된 승인을 제거하고 다른 리뷰어의 요청을 보존한다', () => {
    expect(
      pullPolicy.review.get(detail, [
        approval,
        { ...approval, id: 2, createdAt: 2, state: 'dismissed' },
      ]),
    ).toBe('pending')
    expect(
      pullPolicy.review.get(detail, [
        approval,
        { ...approval, author: 'other', state: 'changes-requested' },
      ]),
    ).toBe('changes-requested')
  })
  it('초안·불명 상태·보호 조건으로 막힌 병합을 비활성한다', () => {
    for (const variant of [
      { isDraft: true },
      { mergeable: null },
      { mergeState: 'blocked' },
      { headSha: null },
    ])
      expect(pullPolicy.merge.check({ ...detail, ...variant }, []).allowed).toBe(false)
    expect(pullPolicy.merge.check(detail, []).allowed).toBe(true)
  })
})
