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

  it('스냅샷은 복사본이다 — 받은 쪽이 고쳐도 레지스트리가 안 바뀐다', () => {
    const registry = createWindowRegistry()
    registry.add(1, { repoPath: '/a', layout: { rightWidth: 300 } })
    const snapshot = registry.snapshot()
    snapshot[0]!.layout.rightWidth = 999
    expect(registry.get(1)?.layout.rightWidth).toBe(300)
  })
})
