import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from '../src/renderer/src/components/relative-time'

const NOW_MS = 1_752_600_000_000 // 고정 기준 시각

function at(secondsAgo: number): number {
  return Math.floor(NOW_MS / 1000) - secondsAgo
}

describe('formatRelativeTime', () => {
  it('1분 미만은 방금 전', () => {
    expect(formatRelativeTime(at(5), NOW_MS)).toBe('방금 전')
    expect(formatRelativeTime(at(59), NOW_MS)).toBe('방금 전')
  })

  it('분 단위', () => {
    expect(formatRelativeTime(at(60), NOW_MS)).toBe('1분 전')
    expect(formatRelativeTime(at(59 * 60), NOW_MS)).toBe('59분 전')
  })

  it('시간 단위', () => {
    expect(formatRelativeTime(at(60 * 60), NOW_MS)).toBe('1시간 전')
    expect(formatRelativeTime(at(23 * 60 * 60), NOW_MS)).toBe('23시간 전')
  })

  it('하루면 어제, 일주일 미만은 N일 전', () => {
    expect(formatRelativeTime(at(24 * 60 * 60), NOW_MS)).toBe('어제')
    expect(formatRelativeTime(at(3 * 24 * 60 * 60), NOW_MS)).toBe('3일 전')
  })

  it('일주일 이상은 날짜로', () => {
    const epoch = at(30 * 24 * 60 * 60)
    const date = new Date(epoch * 1000)
    expect(formatRelativeTime(epoch, NOW_MS)).toBe(
      `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`,
    )
  })
})
