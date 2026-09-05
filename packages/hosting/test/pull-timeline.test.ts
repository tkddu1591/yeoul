import { describe, expect, it } from 'vitest'
import { pullTimelineAdapter } from '../src/pull-timeline'

describe('buildPullTimeline', () => {
  it('이슈 코멘트와 리뷰를 시간순(오래된 것 먼저)으로 병합한다', () => {
    const timeline = pullTimelineAdapter.item.toList(
      [
        {
          id: 1,
          user: { login: 'octo' },
          body: '질문이 있어요',
          created_at: '2026-07-20T10:00:00Z',
        },
        { id: 3, user: { login: 'octo' }, body: '확인했어요', created_at: '2026-07-20T12:00:00Z' },
      ],
      [
        {
          id: 2,
          user: { login: 'reviewer' },
          body: '전반적으로 좋아요',
          state: 'COMMENTED',
          submitted_at: '2026-07-20T11:00:00Z',
        },
      ],
    )
    expect(timeline.map((item) => item.id)).toEqual([1, 2, 3])
    expect(timeline[1]).toEqual({
      id: 2,
      author: 'reviewer',
      body: '전반적으로 좋아요',
      createdAt: 1784545200,
      kind: 'review',
      commitId: null,
      state: null,
    })
  })

  it('본문 없는 코멘트 리뷰(COMMENTED·PENDING)는 타임라인에서 뺀다', () => {
    const timeline = pullTimelineAdapter.item.toList(
      [],
      [
        {
          id: 1,
          user: { login: 'r' },
          body: '',
          state: 'COMMENTED',
          submitted_at: '2026-07-20T10:00:00Z',
        },
        { id: 2, user: { login: 'r' }, body: null, state: 'PENDING' },
      ],
    )
    expect(timeline).toEqual([])
  })

  it('승인(APPROVED)은 본문이 없어도 남는다 — 승인됨 배지·판정의 근거', () => {
    const timeline = pullTimelineAdapter.item.toList(
      [],
      [
        {
          id: 9,
          user: { login: 'reviewer' },
          body: '',
          state: 'APPROVED',
          submitted_at: '2026-07-20T10:00:00Z',
        },
      ],
    )
    expect(timeline).toEqual([
      {
        id: 9,
        author: 'reviewer',
        body: '',
        createdAt: 1784541600,
        kind: 'review',
        commitId: null,
        state: 'approved',
      },
    ])
  })

  it('작성자가 없으면(탈퇴 계정) "(알 수 없음)"으로 표시한다', () => {
    const timeline = pullTimelineAdapter.item.toList(
      [{ id: 1, user: null, body: '남은 코멘트', created_at: '2026-07-20T10:00:00Z' }],
      [],
    )
    expect(timeline[0]!.author).toBe('(알 수 없음)')
  })

  it('시각을 해석할 수 없으면 0으로 두어 빠뜨리지 않고 맨 앞에 싣는다', () => {
    const timeline = pullTimelineAdapter.item.toList(
      [
        { id: 1, user: { login: 'a' }, body: '정상 시각', created_at: '2026-07-20T10:00:00Z' },
        { id: 2, user: { login: 'b' }, body: '깨진 시각', created_at: 'not-a-date' },
      ],
      [],
    )
    expect(timeline.map((item) => item.id)).toEqual([2, 1])
  })
})

it('본문 없는 수정 요청·취소 리뷰도 상태 판정을 위해 보존한다', () => {
  const result = pullTimelineAdapter.item.toList(
    [],
    [
      {
        id: 10,
        user: { login: 'r' },
        body: '',
        state: 'CHANGES_REQUESTED',
        commit_id: 'head',
        submitted_at: '2026-09-05T00:00:00Z',
      },
      {
        id: 11,
        user: { login: 'r' },
        body: '',
        state: 'DISMISSED',
        submitted_at: '2026-09-05T01:00:00Z',
      },
    ],
  )
  expect(result.map((review) => review.state)).toEqual(['changes-requested', 'dismissed'])
  expect(result[0]?.commitId).toBe('head')
})
