import { describe, expect, it } from 'vitest'
import { createWindowRegistry } from '../src/main/window-registry'

describe('창 레지스트리 (E15b)', () => {
  it('창을 등록하고 id로 찾는다', () => {
    const registry = createWindowRegistry()
    registry.add(1, { repoPath: '/a', layout: { leftCollapsed: true } })
    expect(registry.get(1)).toEqual({ repoPath: '/a', layout: { leftCollapsed: true } })
  })

  it('없는 id는 undefined', () => {
    expect(createWindowRegistry().get(99)).toBeUndefined()
  })

  it('같은 저장소를 연 창을 찾는다 — 중복 열기 차단의 근거', () => {
    const registry = createWindowRegistry()
    registry.add(1, { repoPath: '/a', layout: {} })
    registry.add(2, { repoPath: '/b', layout: {} })
    expect(registry.findByRepoPath('/b')).toBe(2)
    expect(registry.findByRepoPath('/zzz')).toBeUndefined()
  })

  it('저장소 없는 창(⌘N 빈 창)은 findByRepoPath에 안 걸린다', () => {
    const registry = createWindowRegistry()
    registry.add(1, { repoPath: null, layout: {} })
    // null을 찾아 달라고 할 수 없다 — 시그니처가 string만 받는다. 빈 창 둘이 서로를 덮지 않는지만 본다
    registry.add(2, { repoPath: null, layout: {} })
    expect(registry.snapshot()).toHaveLength(2)
  })

  it('창 안에서 저장소를 바꾸면 갱신된다 — E15a 전환기로 바꿔도 main이 안다', () => {
    const registry = createWindowRegistry()
    registry.add(1, { repoPath: '/a', layout: {} })
    registry.setRepoPath(1, '/b')
    expect(registry.findByRepoPath('/a')).toBeUndefined()
    expect(registry.findByRepoPath('/b')).toBe(1)
  })

  it('레이아웃은 병합한다 — 렌더러가 바뀐 필드만 보낸다', () => {
    const registry = createWindowRegistry()
    registry.add(1, { repoPath: null, layout: { leftCollapsed: true, rightWidth: 300 } })
    registry.setLayout(1, { rightWidth: 420 })
    expect(registry.get(1)?.layout).toEqual({ leftCollapsed: true, rightWidth: 420 })
  })

  it('없는 창에 써도 죽지 않는다 — 창이 닫히는 중에 설정이 날아올 수 있다', () => {
    const registry = createWindowRegistry()
    expect(() => registry.setLayout(99, { rightWidth: 1 })).not.toThrow()
    expect(() => registry.setRepoPath(99, '/a')).not.toThrow()
  })

  it('창을 지우면 스냅샷에서 빠진다', () => {
    const registry = createWindowRegistry()
    registry.add(1, { repoPath: '/a', layout: {} })
    registry.add(2, { repoPath: '/b', layout: {} })
    registry.remove(1)
    expect(registry.snapshot()).toEqual([{ repoPath: '/b', layout: {} }])
  })

  it('스냅샷은 등록 순서다 — 복원이 그 순서로 창을 만든다', () => {
    const registry = createWindowRegistry()
    registry.add(7, { repoPath: '/first', layout: {} })
    registry.add(3, { repoPath: '/second', layout: {} })
    expect(registry.snapshot().map((w) => w.repoPath)).toEqual(['/first', '/second'])
  })

  /**
   * add의 방어적 복사에 그물이 없었다 (Task 1 반증 실측: `{ ...state.layout }` → `state.layout`
   * 변이가 10건 중 0건을 물었다). 그때는 유일한 호출자가 갓 만든 객체를 넘겨 버려서 무해했지만,
   * E15b 복원부터는 **설정 모듈 캐시에 살아 있는 객체**(`readWindows()`가 돌려주는
   * `settings.windows[i].layout`)가 그대로 들어온다 — 붙들면 창 하나의 레이아웃 변경이
   * 디스크 캐시를 건드리는 통로가 생긴다. 값을 넣은 뒤 원본을 고쳐서 그 붙듦을 문다
   */
  it('넘겨받은 layout을 붙들지 않는다 — 복원이 디스크 캐시의 객체를 넘긴다', () => {
    const registry = createWindowRegistry()
    const fromDisk = { rightWidth: 300 }
    registry.add(1, { repoPath: '/a', layout: fromDisk })
    fromDisk.rightWidth = 999
    expect(registry.get(1)?.layout).toEqual({ rightWidth: 300 })
  })

  it('스냅샷은 복사본이다 — 받은 쪽이 고쳐도 레지스트리가 안 바뀐다', () => {
    const registry = createWindowRegistry()
    registry.add(1, { repoPath: '/a', layout: { rightWidth: 300 } })
    const snapshot = registry.snapshot()
    snapshot[0]!.layout.rightWidth = 999
    expect(registry.get(1)?.layout.rightWidth).toBe(300)
  })
})

/**
 * 영속 신호 (E15b 리뷰 I-1). 예전엔 영속 지점이 `before-quit` 하나뿐이라 창을 닫고 종료하면
 * 그 창의 레이아웃이 통째로 증발했다 — 이제 레지스트리가 바뀔 때마다 알린다.
 *
 * 종류를 가르는 이유는 영속 정책이 다르기 때문이다: 창 목록은 즉시, 레이아웃은 디바운스.
 * 그래서 "알렸다"만으로는 부족하고 **어느 종류로 알렸는지**까지 문다
 */
describe('레지스트리 변경 알림 (E15b 리뷰 I-1)', () => {
  const record = () => {
    const kinds: string[] = []
    return { kinds, registry: createWindowRegistry((kind) => kinds.push(kind)) }
  }

  it('창이 늘고 줄고 갈아타면 windows로 알린다 — 사람의 조작이라 즉시 쓴다', () => {
    const { kinds, registry } = record()
    registry.add(1, { repoPath: '/a', layout: {} })
    registry.setRepoPath(1, '/b')
    registry.remove(1)
    expect(kinds).toEqual(['windows', 'windows', 'windows'])
  })

  it('레이아웃 변경은 layout으로 알린다 — 드래그가 초당 여러 번이라 묶어 쓴다', () => {
    const { kinds, registry } = record()
    registry.add(1, { repoPath: '/a', layout: {} })
    registry.setLayout(1, { terminalHeight: 240 })
    registry.setLayout(1, { terminalHeight: 260 })
    expect(kinds).toEqual(['windows', 'layout', 'layout'])
  })

  it('아무것도 안 바뀌면 알리지 않는다 — 없는 창에 온 늦은 IPC로 디스크를 쓰지 않는다', () => {
    const { kinds, registry } = record()
    registry.remove(99)
    registry.setLayout(99, { rightWidth: 1 })
    registry.setRepoPath(99, '/a')
    expect(kinds).toEqual([])
  })

  it('콜백을 안 줘도 동작한다 — 단위 테스트와 옛 호출부가 그대로 산다', () => {
    const registry = createWindowRegistry()
    expect(() => registry.add(1, { repoPath: '/a', layout: {} })).not.toThrow()
    expect(registry.snapshot()).toHaveLength(1)
  })
})
