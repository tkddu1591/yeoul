import { describe, expect, it } from 'vitest'
import type { LocalBranchStatus } from '@git-gui/domain'
import { trackBadgeLabel } from '../src/renderer/src/components/branch-badges'

const b = (over: Partial<LocalBranchStatus>): LocalBranchStatus => ({
  name: 'x',
  isCurrent: false,
  upstream: 'origin/x',
  upstreamGone: false,
  ahead: 0,
  behind: 0,
  committedAt: 0,
  hash: 'a'.repeat(40),
  ...over,
})

describe('trackBadgeLabel', () => {
  it('upstream이 없으면 "업스트림 없음"이다', () => {
    expect(trackBadgeLabel(b({ upstream: null, ahead: null, behind: null }))).toBe('업스트림 없음')
  })

  it('[gone]이면 "업스트림 삭제됨"이다', () => {
    expect(trackBadgeLabel(b({ upstreamGone: true, ahead: null, behind: null }))).toBe('업스트림 삭제됨')
  })

  it('앞서고 뒤처진 수를 ↑·↓로 보여주고, 0인 쪽은 생략한다', () => {
    expect(trackBadgeLabel(b({ ahead: 1, behind: 3 }))).toBe('↑1 ↓3')
    expect(trackBadgeLabel(b({ ahead: 2, behind: 0 }))).toBe('↑2')
    expect(trackBadgeLabel(b({ ahead: 0, behind: 5 }))).toBe('↓5')
  })

  it('차이가 없으면 "동기화됨"이다', () => {
    expect(trackBadgeLabel(b({}))).toBe('동기화됨')
  })
})
