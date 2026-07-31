import { beforeEach, describe, expect, it } from 'vitest'
import {
  createEmptyReads,
  invalidateReads,
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

/**
 * Blocking 1 — seq는 target 안에서만 돈다. refresh는 target이 'snapshot'이면서
 * center·right·left 상태까지 쓰므로(reviveSelections), writes로 그 자리들의 seq도 잡아야 한다.
 * 실측 재현: 창 포커스 → refresh 시작 → 사용자가 b.txt 클릭 → 늦게 끝난 refresh가 a.txt를 되살림.
 */
describe('runRead writes — 교차 target 무효화 (스펙 §2-4-2 B1)', () => {
  it('writes에 적은 target을 남이 건드리면 낡은 것이 된다', async () => {
    const store = createFakeStore()
    const slow = deferred()
    let snapshotWasCurrent: boolean | null = null
    // refresh 역할 — 표시는 snapshot이지만 실제로는 center·right까지 쓴다
    const snapshotRead = runRead(
      store.set,
      store.get,
      'snapshot',
      async (isCurrent) => {
        await slow.promise
        snapshotWasCurrent = isCurrent()
      },
      ['snapshot', 'center', 'right'],
    )
    // 그사이 사용자가 다른 파일을 눌렀다 (center)
    await runRead(store.set, store.get, 'center', async () => {})
    slow.resolve()
    await snapshotRead

    expect(snapshotWasCurrent).toBe(false)
  })

  it('writes에 없는 target은 무효화하지 않는다 — 넓히는 게 아니라 정확히 적는 것이다', async () => {
    const store = createFakeStore()
    const slow = deferred()
    let snapshotWasCurrent: boolean | null = null
    const snapshotRead = runRead(
      store.set,
      store.get,
      'snapshot',
      async (isCurrent) => {
        await slow.promise
        snapshotWasCurrent = isCurrent()
      },
      ['snapshot', 'center'],
    )
    // reviews는 이 조회가 쓰지 않는 자리다 — 리뷰 목록 갱신이 스냅샷을 낡게 만들면 안 된다
    await runRead(store.set, store.get, 'reviews', async () => {})
    slow.resolve()
    await snapshotRead

    expect(snapshotWasCurrent).toBe(true)
  })

  it('반대 방향도 막는다 — 늦게 시작한 스냅샷 조회가 진행 중인 center 조회를 낡게 만든다', async () => {
    const store = createFakeStore()
    const slow = deferred()
    let centerWasCurrent: boolean | null = null
    const centerRead = runRead(store.set, store.get, 'center', async (isCurrent) => {
      await slow.promise
      centerWasCurrent = isCurrent()
    })
    await runRead(store.set, store.get, 'snapshot', async () => {}, ['snapshot', 'center', 'right'])
    slow.resolve()
    await centerRead

    expect(centerWasCurrent).toBe(false)
  })

  it('writes를 안 주면 target 하나만 잡는다 (기본값 — 기존 호출부 15곳의 동작)', async () => {
    const store = createFakeStore()
    const slow = deferred()
    let leftWasCurrent: boolean | null = null
    const leftRead = runRead(store.set, store.get, 'left', async (isCurrent) => {
      await slow.promise
      leftWasCurrent = isCurrent()
    })
    await runRead(store.set, store.get, 'center', async () => {})
    slow.resolve()
    await leftRead

    expect(leftWasCurrent).toBe(true)
  })

  it('카운터(=스피너)는 표시용 target에만 붙는다 — writes를 넓혀도 스피너가 번지지 않는다', async () => {
    const store = createFakeStore()
    let during: Record<ReadTarget, number> | null = null
    await runRead(
      store.set,
      store.get,
      'snapshot',
      async () => {
        during = { ...store.peek().reads }
      },
      ['snapshot', 'center', 'right'],
    )
    expect(during).toEqual({ snapshot: 1, center: 0, right: 0, left: 0, reviews: 0 })
  })
})

/**
 * Blocking 2 — 쓰기는 상태를 갈아엎으므로 그 전에 시작된 조회 결과는 전부 낡았다.
 * 실측 재현: openRepository가 도는 동안 옛 저장소의 조회가 끝나 새 저장소 화면에
 * 옛 저장소의 선택(a.txt)이 되살아났다.
 */
describe('invalidateReads — 진행 중인 조회를 전부 낡게 만든다 (스펙 §2-4-2 B2)', () => {
  it('runWrite가 진입할 때 진행 중인 조회를 무효화한다', async () => {
    const store = createFakeStore()
    const slowRead = deferred()
    let readWasCurrent: boolean | null = null
    // 옛 저장소의 조회가 아직 in-flight
    const read = runRead(store.set, store.get, 'center', async (isCurrent) => {
      await slowRead.promise
      readWasCurrent = isCurrent()
    })
    // 그사이 저장소를 새로 연다 (쓰기)
    await runWrite(store.set, store.get, async () => {})
    // 이제 옛 조회가 도착한다
    slowRead.resolve()
    await read

    expect(readWasCurrent).toBe(false)
  })

  it('재진입이 거부된 runWrite는 무효화하지 않는다 — 아무 일도 일어나지 않았기 때문이다', async () => {
    const store = createFakeStore()
    const slowWrite = deferred()
    const slowRead = deferred()
    // 조회를 먼저 띄운다
    let readWasCurrent: boolean | null = null
    const read = runRead(store.set, store.get, 'center', async (isCurrent) => {
      await slowRead.promise
      readWasCurrent = isCurrent()
    })
    // 쓰기 A가 진입 — 여기서 한 번 무효화된다
    const writeA = runWrite(store.set, store.get, async () => {
      await slowWrite.promise
    })
    // 조회를 새로 띄운다 (무효화 이후라 최신이다)
    let laterReadWasCurrent: boolean | null = null
    const laterSlow = deferred()
    const laterRead = runRead(store.set, store.get, 'center', async (isCurrent) => {
      await laterSlow.promise
      laterReadWasCurrent = isCurrent()
    })
    // 쓰기 B는 busy라 거부된다 — 이게 무효화하면 laterRead가 억울하게 낡는다
    expect(await runWrite(store.set, store.get, async () => {})).toBe(false)

    slowWrite.resolve()
    await writeA
    slowRead.resolve()
    await read
    laterSlow.resolve()
    await laterRead

    expect(readWasCurrent).toBe(false)
    expect(laterReadWasCurrent).toBe(true)
  })

  it('직접 부르면 모든 target의 진행 중 조회가 낡는다 (clearSelection·비교 뷰 닫기가 쓰는 경로)', async () => {
    const store = createFakeStore()
    const targets: ReadTarget[] = ['snapshot', 'center', 'right', 'left', 'reviews']
    const gates = targets.map(() => deferred())
    const seen: Record<string, boolean> = {}
    const reads = targets.map((target, index) =>
      runRead(store.set, store.get, target, async (isCurrent) => {
        await gates[index]!.promise
        seen[target] = isCurrent()
      }),
    )
    // 사용자가 닫기를 눌렀다
    invalidateReads()
    for (const gate of gates) gate.resolve()
    await Promise.all(reads)

    expect(seen).toEqual({
      snapshot: false,
      center: false,
      right: false,
      left: false,
      reviews: false,
    })
  })

  it('무효화 뒤에 시작한 조회는 최신이다 — 영구히 막아버리지 않는다', async () => {
    const store = createFakeStore()
    invalidateReads()
    let wasCurrent: boolean | null = null
    await runRead(store.set, store.get, 'center', async (isCurrent) => {
      wasCurrent = isCurrent()
    })
    expect(wasCurrent).toBe(true)
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

describe('오류 문구 — IPC 래핑 접두사를 벗긴다', () => {
  /** main에서 던진 오류가 렌더러에 도착할 때 Electron이 실제로 붙이는 형태 그대로다 */
  const wrapped = new Error("Error invoking remote method 'git:commit': Error: 저장할 게 없어요")

  it('runWrite의 오류가 사용자 문구만 남긴다', async () => {
    const store = createFakeStore()
    await runWrite(store.set, store.get, async () => {
      throw wrapped
    })
    expect(store.peek().error).toBe('저장할 게 없어요')
  })

  it('runRead의 오류가 사용자 문구만 남긴다', async () => {
    const store = createFakeStore()
    await runRead(store.set, store.get, 'center', async () => {
      throw wrapped
    })
    expect(store.peek().error).toBe('저장할 게 없어요')
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
