import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOW_TICK_MS, subscribeNow } from '../src/renderer/src/ui/use-now'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('공용 시각 틱', () => {
  it('NOW_TICK_MS는 60초 — 상대 시각은 분 단위라 그보다 잦을 이유가 없다', () => {
    expect(NOW_TICK_MS).toBe(60_000)
  })

  it('틱마다 구독자를 부른다', () => {
    const seen: number[] = []
    const stop = subscribeNow(() => seen.push(1))
    vi.advanceTimersByTime(NOW_TICK_MS * 3)
    stop()
    expect(seen.length).toBe(3)
  })

  it('구독자가 여럿이어도 타이머는 하나다 — 같은 틱에 함께 깨어난다', () => {
    const order: string[] = []
    const stopA = subscribeNow(() => order.push('a'))
    const stopB = subscribeNow(() => order.push('b'))
    vi.advanceTimersByTime(NOW_TICK_MS)
    stopA()
    stopB()
    // 한 번의 틱에서 둘 다 정확히 1회 — 타이머가 둘이면 순서가 a,b가 아니거나 수가 어긋난다
    expect(order).toEqual(['a', 'b'])
  })

  it('구독자가 0이 되면 타이머를 멈춘다 — 창을 닫아도 도는 것을 막는다', () => {
    const stop = subscribeNow(() => {})
    expect(vi.getTimerCount()).toBe(1)
    stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('한 구독자가 떠나도 남은 구독자는 계속 받는다', () => {
    let kept = 0
    const stopA = subscribeNow(() => {})
    const stopB = subscribeNow(() => {
      kept += 1
    })
    stopA()
    vi.advanceTimersByTime(NOW_TICK_MS * 2)
    stopB()
    expect(kept).toBe(2)
  })

  it('같은 구독 해제를 두 번 불러도 남의 타이머를 끄지 않는다', () => {
    const stopA = subscribeNow(() => {})
    const stopB = subscribeNow(() => {})
    stopA()
    stopA()
    expect(vi.getTimerCount()).toBe(1)
    stopB()
    expect(vi.getTimerCount()).toBe(0)
  })
})
