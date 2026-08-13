import { describe, expect, it } from 'vitest'
import { createWindowRegistry } from '../src/main/window-registry'

/**
 * E15c에서 레지스트리가 한 겹 깊어졌다 — 창이 저장소 하나가 아니라 탭들을 갖는다.
 * 기존 E15b 테스트 11건의 의도(방어적 복사·N-7 빈 항목·없는 id 무해·순서 보존)를
 * 새 시그니처로 보존하며 재작성했다. 창 id와 탭 id는 다른 이름 공간이다 —
 * 창 id는 index.ts가 발급하는 임의 숫자, 탭 id는 뷰의 webContents.id
 */
describe('창 레지스트리 (E15b→E15c)', () => {
  it('창을 등록하고 id로 찾는다', () => {
    const registry = createWindowRegistry()
    registry.addWindow(1, { leftCollapsed: true })
    registry.addTab(1, 10, '/a')
    expect(registry.getWindow(1)).toEqual({
      tabs: [10],
      activeTab: 10,
      layout: { leftCollapsed: true },
    })
  })

  it('없는 id는 undefined — 창·탭 조회 전부', () => {
    const registry = createWindowRegistry()
    expect(registry.getWindow(99)).toBeUndefined()
    expect(registry.windowOfTab(99)).toBeUndefined()
    expect(registry.getTabRepoPath(99)).toBeUndefined()
    expect(registry.layoutOfTab(99)).toBeUndefined()
  })

  it('첫 탭이 활성이 된다 — 이후 탭 추가는 활성을 훔치지 않는다', () => {
    const registry = createWindowRegistry()
    registry.addWindow(1, {})
    registry.addTab(1, 10, '/a')
    expect(registry.getWindow(1)?.activeTab).toBe(10)
    registry.addTab(1, 11, '/b')
    expect(registry.getWindow(1)?.activeTab).toBe(10)
  })

  /**
   * E15b 리뷰 N-7 계승 — 예전 이 테스트는 본문에서 findByRepoPath를 한 번도 부르지 않고
   * snapshot 길이만 봐서 구현이 통째로 사라져도 통과했다. 이름이 약속한 것을 실제로 물린다:
   * 빈 탭은 어떤 인자로도 안 걸리고, 빈 탭이 앞에 있어도 뒤의 진짜 저장소는 찾힌다
   * (순회가 빈 탭에서 멈추거나 잘못 걸리지 않는다)
   */
  it('저장소 없는 탭(⌘T 빈 탭)은 findTabByRepoPath에 안 걸린다', () => {
    const registry = createWindowRegistry()
    registry.addWindow(1, {})
    registry.addTab(1, 10, null)
    registry.addTab(1, 11, null)
    registry.addTab(1, 12, '/a')
    // 빈 탭 둘을 지나 진짜 저장소를 찾는다
    expect(registry.findTabByRepoPath('/a')).toEqual({ windowId: 1, tabId: 12 })
    // 빈 탭을 가리킬 법한 값 어느 것으로도 안 걸린다. 특히 null은 시그니처 밖이라 타입이
    // 막지만, 느슨한 비교(== 나 falsy 판정)로 구현하면 여기서 첫 빈 탭이 나온다
    expect(registry.findTabByRepoPath('')).toBeUndefined()
    expect(registry.findTabByRepoPath('null')).toBeUndefined()
    expect(registry.findTabByRepoPath(null as unknown as string)).toBeUndefined()
    expect(registry.findTabByRepoPath(undefined as unknown as string)).toBeUndefined()
  })

  it('레이아웃은 병합한다 — 렌더러가 바뀐 필드만 보낸다', () => {
    const registry = createWindowRegistry()
    registry.addWindow(1, { leftCollapsed: true, rightWidth: 300 })
    registry.setLayout(1, { rightWidth: 420 })
    expect(registry.getWindow(1)?.layout).toEqual({ leftCollapsed: true, rightWidth: 420 })
  })

  it('탭에서 창의 레이아웃을 읽는다 — settings:get-sync가 sender.id(탭)로 묻는다', () => {
    const registry = createWindowRegistry()
    registry.addWindow(1, { rightWidth: 300 })
    registry.addTab(1, 10, '/a')
    registry.addTab(1, 11, '/b')
    // 같은 창의 어느 탭으로 물어도 같은 창 레이아웃이다 (스펙 §4 — 레이아웃은 창 단위)
    expect(registry.layoutOfTab(10)).toEqual({ rightWidth: 300 })
    expect(registry.layoutOfTab(11)).toEqual({ rightWidth: 300 })
  })

  it('없는 id에 써도 죽지 않는다 — 창이 닫히는 중에 늦은 IPC가 올 수 있다', () => {
    const registry = createWindowRegistry()
    expect(() => registry.setLayout(99, { rightWidth: 1 })).not.toThrow()
    expect(() => registry.setTabRepoPath(99, '/a')).not.toThrow()
    expect(() => registry.setActiveTab(99, 10)).not.toThrow()
    expect(() => registry.removeTab(99)).not.toThrow()
    expect(() => registry.removeWindow(99)).not.toThrow()
  })

  it('setActiveTab에 그 창의 탭이 아닌 id를 줘도 무해하다 — tabId는 렌더러 입력이다', () => {
    const registry = createWindowRegistry()
    registry.addWindow(1, {})
    registry.addWindow(2, {})
    registry.addTab(1, 10, '/a')
    registry.addTab(2, 20, '/b')
    registry.setActiveTab(1, 20)
    expect(registry.getWindow(1)?.activeTab).toBe(10)
  })

  it('없는 창에 탭을 넣으면 throw — 프로그래밍 오류다', () => {
    const registry = createWindowRegistry()
    expect(() => registry.addTab(99, 10, '/a')).toThrow()
  })

  it('창을 지우면 스냅샷에서 빠지고 그 창의 탭 색인도 청소된다', () => {
    const registry = createWindowRegistry()
    registry.addWindow(1, {})
    registry.addTab(1, 10, '/a')
    registry.addWindow(2, {})
    registry.addTab(2, 20, '/b')
    registry.removeWindow(1)
    expect(registry.snapshot()).toEqual([
      { tabs: [{ repoPath: '/b' }], activeTab: 0, layout: {} },
    ])
    // 두 맵의 정합 — 창만 지우고 탭 색인을 남기면 죽은 탭이 검색·조회에 계속 걸린다
    expect(registry.windowOfTab(10)).toBeUndefined()
    expect(registry.getTabRepoPath(10)).toBeUndefined()
    expect(registry.findTabByRepoPath('/a')).toBeUndefined()
  })

  it('스냅샷은 등록 순서다 — 복원이 그 순서로 창을 만든다', () => {
    const registry = createWindowRegistry()
    registry.addWindow(7, {})
    registry.addTab(7, 70, '/first')
    registry.addWindow(3, {})
    registry.addTab(3, 30, '/second')
    expect(registry.snapshot().map((w) => w.tabs[0]?.repoPath)).toEqual(['/first', '/second'])
  })

  /**
   * addWindow의 방어적 복사 (E15b Task 1 반증 실측 계승) — 복원이 설정 모듈 캐시에 살아 있는
   * 객체(readWindows()가 돌려주는 layout)를 그대로 넘긴다. 붙들면 창 하나의 레이아웃 변경이
   * 디스크 캐시를 건드리는 통로가 생긴다. 값을 넣은 뒤 원본을 고쳐서 그 붙듦을 문다
   */
  it('넘겨받은 layout을 붙들지 않는다 — 복원이 디스크 캐시의 객체를 넘긴다', () => {
    const registry = createWindowRegistry()
    const fromDisk = { rightWidth: 300 }
    registry.addWindow(1, fromDisk)
    fromDisk.rightWidth = 999
    expect(registry.getWindow(1)?.layout).toEqual({ rightWidth: 300 })
  })
})

describe('탭 (E15c)', () => {
  it('창 하나에 탭 셋 — 순서가 보존된다', () => {
    const r = createWindowRegistry()
    r.addWindow(1, {})
    r.addTab(1, 10, '/a')
    r.addTab(1, 11, '/b')
    r.addTab(1, 12, null)
    expect(r.getWindow(1)?.tabs).toEqual([10, 11, 12])
  })

  it('index를 주면 그 자리에 끼운다', () => {
    const r = createWindowRegistry()
    r.addWindow(1, {})
    r.addTab(1, 10, '/a')
    r.addTab(1, 11, '/b')
    r.addTab(1, 12, '/c', 1)
    expect(r.getWindow(1)?.tabs).toEqual([10, 12, 11])
  })

  it('같은 탭을 두 창에 넣으면 throw — 뷰는 한 창에만 산다', () => {
    const r = createWindowRegistry()
    r.addWindow(1, {})
    r.addWindow(2, {})
    r.addTab(1, 10, '/a')
    expect(() => r.addTab(2, 10, '/a')).toThrow()
  })

  it('마지막 탭을 떼면 창 항목도 사라진다', () => {
    const r = createWindowRegistry()
    r.addWindow(1, {})
    r.addTab(1, 10, '/a')
    r.removeTab(10)
    expect(r.getWindow(1)).toBeUndefined()
  })

  it('활성 탭을 떼면 이웃이 활성이 된다 — 오른쪽 우선, 없으면 왼쪽', () => {
    const r = createWindowRegistry()
    r.addWindow(1, {})
    r.addTab(1, 10, '/a')
    r.addTab(1, 11, '/b')
    r.addTab(1, 12, '/c')
    r.setActiveTab(1, 11)
    r.removeTab(11)
    expect(r.getWindow(1)?.activeTab).toBe(12)
    r.removeTab(12)
    expect(r.getWindow(1)?.activeTab).toBe(10)
  })

  it('findTabByRepoPath는 모든 창을 훑는다', () => {
    const r = createWindowRegistry()
    r.addWindow(1, {})
    r.addWindow(2, {})
    r.addTab(1, 10, '/a')
    r.addTab(2, 20, '/b')
    expect(r.findTabByRepoPath('/b')).toEqual({ windowId: 2, tabId: 20 })
    expect(r.findTabByRepoPath('/zzz')).toBeUndefined()
  })

  it('빈 탭(repoPath null)은 어떤 인자로도 findTabByRepoPath에 안 걸린다 — E15b N-7 계승', () => {
    const r = createWindowRegistry()
    r.addWindow(1, {})
    r.addTab(1, 10, null)
    expect(r.findTabByRepoPath(null as unknown as string)).toBeUndefined()
  })

  it('setTabRepoPath로 갈아탄 탭이 검색에 잡힌다', () => {
    const r = createWindowRegistry()
    r.addWindow(1, {})
    r.addTab(1, 10, '/a')
    r.setTabRepoPath(10, '/b')
    expect(r.findTabByRepoPath('/a')).toBeUndefined()
    expect(r.findTabByRepoPath('/b')).toEqual({ windowId: 1, tabId: 10 })
  })

  it('snapshot은 탭 순서·활성·창 layout을 담고 깊은 복사다', () => {
    const r = createWindowRegistry()
    r.addWindow(1, { rightWidth: 300 })
    r.addTab(1, 10, '/a')
    r.addTab(1, 11, null)
    r.setActiveTab(1, 11)
    const snap = r.snapshot()
    expect(snap).toEqual([
      { tabs: [{ repoPath: '/a' }, { repoPath: null }], activeTab: 1, layout: { rightWidth: 300 } },
    ])
    snap[0]!.layout.rightWidth = 999
    expect(r.getWindow(1)?.layout.rightWidth).toBe(300)
  })
})

/**
 * 영속 신호 (E15b 리뷰 I-1 계승). 레지스트리가 바뀔 때마다 알린다 — 종류를 가르는 이유는
 * 영속 정책이 다르기 때문이다: 창·탭 목록은 즉시, 레이아웃은 디바운스.
 * 그래서 "알렸다"만으로는 부족하고 **어느 종류로 알렸는지**까지 문다.
 * E15c에서 탭 추가/제거/활성 전환/repoPath 변경은 전부 'windows'다 — snapshot(영속 형상)이 바뀐다
 */
describe('레지스트리 변경 알림 (E15b 리뷰 I-1)', () => {
  const record = () => {
    const kinds: string[] = []
    return { kinds, registry: createWindowRegistry((kind) => kinds.push(kind)) }
  }

  it('창·탭이 늘고 줄고 갈아타면 windows로 알린다 — 사람의 조작이라 즉시 쓴다', () => {
    const { kinds, registry } = record()
    registry.addWindow(1, {})
    registry.addTab(1, 10, '/a')
    registry.addTab(1, 11, '/b')
    registry.setTabRepoPath(10, '/c')
    registry.setActiveTab(1, 11)
    registry.removeTab(11)
    registry.removeWindow(1)
    expect(kinds).toEqual([
      'windows',
      'windows',
      'windows',
      'windows',
      'windows',
      'windows',
      'windows',
    ])
  })

  it('레이아웃 변경은 layout으로 알린다 — 드래그가 초당 여러 번이라 묶어 쓴다', () => {
    const { kinds, registry } = record()
    registry.addWindow(1, {})
    registry.setLayout(1, { terminalHeight: 240 })
    registry.setLayout(1, { terminalHeight: 260 })
    expect(kinds).toEqual(['windows', 'layout', 'layout'])
  })

  it('아무것도 안 바뀌면 알리지 않는다 — 없는 id·이미 활성인 탭으로 디스크를 쓰지 않는다', () => {
    const { kinds, registry } = record()
    registry.removeWindow(99)
    registry.removeTab(99)
    registry.setLayout(99, { rightWidth: 1 })
    registry.setTabRepoPath(99, '/a')
    registry.setActiveTab(99, 10)
    expect(kinds).toEqual([])
    // 이미 활성인 탭을 다시 활성화하는 것도 변화가 아니다 — 탭 클릭마다 즉시 쓰기가 나가면 안 된다
    registry.addWindow(1, {})
    registry.addTab(1, 10, '/a')
    kinds.length = 0
    registry.setActiveTab(1, 10)
    expect(kinds).toEqual([])
  })

  it('콜백을 안 줘도 동작한다 — 단위 테스트와 옛 호출부가 그대로 산다', () => {
    const registry = createWindowRegistry()
    expect(() => {
      registry.addWindow(1, {})
      registry.addTab(1, 10, '/a')
    }).not.toThrow()
    expect(registry.snapshot()).toHaveLength(1)
  })
})
