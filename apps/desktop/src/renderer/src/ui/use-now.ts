import { useEffect, useState } from 'react'

/**
 * 상대 시각("3분 전")이 갱신되는 주기 (E14b).
 * 상대 시각의 최소 단위가 '분'이라 이보다 잦게 깨울 이유가 없다.
 */
export const NOW_TICK_MS = 60_000

/**
 * 공용 타이머 — 구독자가 있을 때만 돈다.
 * 컴포넌트마다 setInterval을 걸면 7개가 따로 돌고 서로 다른 프레임에 깨어나 같은 화면 안에서
 * 조금씩 어긋난 시각을 보인다. 하나만 돌리고 나눠 준다.
 */
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

export function subscribeNow(listener: () => void): () => void {
  listeners.add(listener)
  if (timer === null) {
    timer = setInterval(() => {
      for (const notify of listeners) notify()
    }, NOW_TICK_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

/**
 * 지금 시각(ms). 60초마다 갱신된다.
 *
 * 왜 필요한가 (E14b — react-hooks/purity): 렌더 중에 Date.now()를 부르면 같은 props로 다른
 * 결과가 나와 렌더가 순수하지 않다. 그리고 실제 버그이기도 하다 — 지금까지 상대 시각은 다른
 * 이유로 리렌더될 때까지 "3분 전"에 멈춰 있었다(시간이 흘러도 화면이 안 바뀐다).
 */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => subscribeNow(() => setNow(Date.now())), [])
  return now
}
