import { describe, expect, it } from 'vitest'
import { countSessionsFor, MAX_SESSIONS_PER_WINDOW } from '../src/main/terminal-handlers'

// WebContents 대신 아무 참조나 쓴다 — countSessionsFor는 신원 비교만 한다
const windowA = { id: 1 }
const windowB = { id: 2 }

describe('창별 터미널 상한 (E15b)', () => {
  it('창마다 8개다 — 앱 전체가 아니다', () => {
    expect(MAX_SESSIONS_PER_WINDOW).toBe(8)
  })

  it('빈 상태는 0', () => {
    expect(countSessionsFor(new Map(), windowA)).toBe(0)
  })

  it('그 창의 세션만 센다 — 다른 창 것은 안 센다', () => {
    const targets = new Map([
      ['s1', windowA],
      ['s2', windowB],
      ['s3', windowA],
      ['s4', windowB],
    ])
    expect(countSessionsFor(targets, windowA)).toBe(2)
    expect(countSessionsFor(targets, windowB)).toBe(2)
  })

  it('한 창이 상한을 채워도 다른 창은 0이다 — 이게 이 변경의 전부다', () => {
    const targets = new Map(
      Array.from({ length: MAX_SESSIONS_PER_WINDOW }, (_, i) => [`s${i}`, windowA] as const),
    )
    expect(countSessionsFor(targets, windowA)).toBe(MAX_SESSIONS_PER_WINDOW)
    expect(countSessionsFor(targets, windowB)).toBe(0)
  })
})
