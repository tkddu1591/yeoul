import { beforeEach, describe, expect, it } from 'vitest'
import {
  createEmptyReads,
  isWithinSuppressWindow,
  resetSuppression,
  runRead,
  runWrite,
  WATCH_SUPPRESS_MS,
  type ReadTarget,
} from '../src/renderer/src/store/run-guard'

/** 가짜 스토어 — run-guard가 요구하는 필드만 가진다 (GuardState를 구조적으로 만족) */
function createFakeStore() {
  let state = {
    busy: false,
    error: null as string | null,
    notice: null as string | null,
    reads: createEmptyReads(),
  }
  return {
    set: (partial: Partial<typeof state>) => {
      state = { ...state, ...partial }
    },
    get: () => state,
    peek: () => state,
  }
}

/** 수동으로 풀 수 있는 지연 — 두 조회의 완료 순서를 뒤집기 위해 쓴다 */
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  resetSuppression()
})

describe('runRead — 조회는 전역을 잠그지 않는다', () => {
  it('busy를 켜지 않는다', async () => {
    const store = createFakeStore()
    let sawBusy: boolean | null = null
    await runRead(store.set, store.get, 'center', async () => {
      sawBusy = store.peek().busy
    })
    expect(sawBusy).toBe(false)
    expect(store.peek().busy).toBe(false)
  })

  it('대상별 카운터를 올렸다 내린다', async () => {
    const store = createFakeStore()
    let during = -1
    await runRead(store.set, store.get, 'center', async () => {
      during = store.peek().reads.center
    })
    expect(during).toBe(1)
    expect(store.peek().reads.center).toBe(0)
  })

  it('실패해도 카운터를 되돌린다', async () => {
    const store = createFakeStore()
    const ok = await runRead(store.set, store.get, 'right', async () => {
      throw new Error('조회 실패')
    })
    expect(ok).toBe(false)
    expect(store.peek().reads.right).toBe(0)
    expect(store.peek().error).toBe('조회 실패')
  })

  it('error·notice를 지우지 않는다 — 조회는 "새로 시작"이 아니다 (E10 Important 3)', async () => {
    const store = createFakeStore()
    store.set({ error: '이전 오류', notice: '이전 안내' })
    await runRead(store.set, store.get, 'center', async () => {})
    expect(store.peek().error).toBe('이전 오류')
    expect(store.peek().notice).toBe('이전 안내')
  })

  it('억제 창을 무장하지 않는다 — 조회가 진짜 외부 변경을 삼키면 안 된다 (E10)', async () => {
    const store = createFakeStore()
    await runRead(store.set, store.get, 'snapshot', async () => {})
    expect(isWithinSuppressWindow()).toBe(false)
  })
})

describe('runRead — 늦게 온 응답을 버린다 (busy 재진입 거부가 하던 일의 대체)', () => {
  it('느린 조회가 나중에 끝나도 자기가 최신이 아님을 안다', async () => {
    const store = createFakeStore()
    const slow = deferred()
    const seen: string[] = []

    // A(느림) 시작 — 아직 끝나지 않는다
    const a = runRead(store.set, store.get, 'center', async (isCurrent) => {
      await slow.promise
      seen.push(`A:${isCurrent()}`)
    })
    // B(빠름)가 통째로 끝난다
    await runRead(store.set, store.get, 'center', async (isCurrent) => {
      seen.push(`B:${isCurrent()}`)
    })
    // 이제 A를 풀어준다
    slow.resolve()
    await a

    expect(seen).toEqual(['B:true', 'A:false'])
  })

  it('늦게 온 실패가 최신 error를 덮지 않는다', async () => {
    const store = createFakeStore()
    const slow = deferred()
    const a = runRead(store.set, store.get, 'center', async () => {
      await slow.promise
      throw new Error('낡은 실패')
    })
    await runRead(store.set, store.get, 'center', async () => {})
    slow.resolve()
    await a
    expect(store.peek().error).toBeNull()
  })

  it('다른 target의 조회는 서로의 최신 판정을 무너뜨리지 않는다', async () => {
    const store = createFakeStore()
    const slow = deferred()
    let centerWasCurrent: boolean | null = null
    const a = runRead(store.set, store.get, 'center', async (isCurrent) => {
      await slow.promise
      centerWasCurrent = isCurrent()
    })
    await runRead(store.set, store.get, 'right', async () => {})
    slow.resolve()
    await a
    expect(centerWasCurrent).toBe(true)
  })
})

describe('runWrite — 기존 guard와 동일하다', () => {
  it('재진입을 거부한다', async () => {
    const store = createFakeStore()
    const slow = deferred()
    let secondRan = false
    const first = runWrite(store.set, store.get, async () => {
      await slow.promise
    })
    const second = await runWrite(store.set, store.get, async () => {
      secondRan = true
    })
    expect(second).toBe(false)
    expect(secondRan).toBe(false)
    slow.resolve()
    await first
  })

  it('시작할 때 error·notice를 지운다 — 사용자가 뭔가 새로 시작했다는 신호다', async () => {
    const store = createFakeStore()
    store.set({ error: '이전 오류', notice: '이전 안내' })
    await runWrite(store.set, store.get, async () => {})
    expect(store.peek().error).toBeNull()
    expect(store.peek().notice).toBeNull()
  })

  it('끝나면 억제 창을 무장한다', async () => {
    const store = createFakeStore()
    expect(isWithinSuppressWindow()).toBe(false)
    await runWrite(store.set, store.get, async () => {})
    expect(isWithinSuppressWindow()).toBe(true)
  })

  it('실패하면 error를 담고 false를 준다', async () => {
    const store = createFakeStore()
    const ok = await runWrite(store.set, store.get, async () => {
      throw new Error('작업 실패')
    })
    expect(ok).toBe(false)
    expect(store.peek().error).toBe('작업 실패')
    expect(store.peek().busy).toBe(false)
  })
})

describe('runWrite 중에도 조회는 시작된다 (E14a 동시성 결정)', () => {
  it('busy가 켜져 있어도 runRead가 실행된다', async () => {
    const store = createFakeStore()
    const slow = deferred()
    let readRan = false
    const write = runWrite(store.set, store.get, async () => {
      await slow.promise
    })
    await runRead(store.set, store.get, 'center', async () => {
      readRan = true
    })
    expect(readRan).toBe(true)
    expect(store.peek().busy).toBe(true) // write는 아직 진행 중
    slow.resolve()
    await write
  })
})

describe('억제 창', () => {
  it('WATCH_SUPPRESS_MS는 800 — 디바운스 300ms + 여유 (E7b 실측 1)', () => {
    expect(WATCH_SUPPRESS_MS).toBe(800)
  })

  it('resetSuppression이 창을 즉시 닫는다 (init이 쓰는 경로)', async () => {
    const store = createFakeStore()
    await runWrite(store.set, store.get, async () => {})
    expect(isWithinSuppressWindow()).toBe(true)
    resetSuppression()
    expect(isWithinSuppressWindow()).toBe(false)
  })

  it('createEmptyReads는 5개 대상을 전부 0으로 준다', () => {
    const reads = createEmptyReads()
    const targets: ReadTarget[] = ['snapshot', 'center', 'right', 'left', 'reviews']
    expect(Object.keys(reads).sort()).toEqual([...targets].sort())
    expect(Object.values(reads).every((n) => n === 0)).toBe(true)
  })
})
