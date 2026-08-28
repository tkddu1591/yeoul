import { describe, expect, it } from 'vitest'
import { sanitizePersistedSettings, sanitizeSettings, splitSettings } from '../src/index'

describe('sanitizeSettings', () => {
  it('알려진 필드만, 올바른 타입만 통과시킨다', () => {
    expect(
      sanitizeSettings({
        colorMode: 'dark',
        colorTheme: 'retro',
        rightWidth: 420,
        evil: 'x',
        __proto__: { a: 1 },
      }),
    ).toEqual({ colorMode: 'dark', colorTheme: 'retro', rightWidth: 420 })
  })

  it('잘못된 값은 조용히 버린다 — 설정은 전부 선택적이다', () => {
    expect(sanitizeSettings({ colorMode: 'sepia', colorTheme: 'neon', rightWidth: 'wide' })).toEqual({})
    expect(sanitizeSettings({ rightWidth: NaN })).toEqual({})
  })

  it('객체가 아니면 빈 설정', () => {
    expect(sanitizeSettings(null)).toEqual({})
    expect(sanitizeSettings('{}')).toEqual({})
    expect(sanitizeSettings([1, 2])).toEqual({})
  })

  it('터미널 도크 필드(terminalOpen·terminalHeight)를 통과시키고 잘못된 타입은 버린다 (E7b)', () => {
    expect(sanitizeSettings({ terminalOpen: true, terminalHeight: 240 })).toEqual({
      terminalOpen: true,
      terminalHeight: 240,
    })
    expect(sanitizeSettings({ terminalOpen: 'yes', terminalHeight: NaN })).toEqual({})
  })

  it('워크트리 선택 동작(worktreeSelectAction)은 두 값만 통과시킨다 (E7c)', () => {
    expect(sanitizeSettings({ worktreeSelectAction: 'terminal' })).toEqual({
      worktreeSelectAction: 'terminal',
    })
    expect(sanitizeSettings({ worktreeSelectAction: 'switch-app' })).toEqual({
      worktreeSelectAction: 'switch-app',
    })
    expect(sanitizeSettings({ worktreeSelectAction: 'always-ask' })).toEqual({})
  })

  it('받아오기 방식(pullMode)·자동 새로고침(autoFetch)을 검증해 통과시킨다 (E7e)', () => {
    expect(sanitizeSettings({ pullMode: 'rebase', autoFetch: false })).toEqual({
      pullMode: 'rebase',
      autoFetch: false,
    })
    expect(sanitizeSettings({ pullMode: 'squash', autoFetch: 'no' })).toEqual({})
  })
})

/**
 * 최근 저장소 목록 (E15a) — 이 필드는 다른 설정과 위험도가 다르다. 여기 담긴 문자열이
 * 그대로 repo.open의 인자가 되고, 그 값은 디스크의 settings.json에서 온다(사람이 편집할 수 있다).
 * main이 rev-parse로 다시 검증하긴 하지만 이 sanitize가 1차 방어다.
 */
describe('sanitizeSettings — recentRepos (E15a)', () => {
  it('문자열 배열을 순서 그대로 통과시킨다 — 최신이 앞이라 순서가 의미를 갖는다', () => {
    expect(sanitizeSettings({ recentRepos: ['/a', '/b', '/c'] })).toEqual({
      recentRepos: ['/a', '/b', '/c'],
    })
  })

  it('배열이 아니면 필드째 버린다', () => {
    expect(sanitizeSettings({ recentRepos: '/a' })).toEqual({})
    expect(sanitizeSettings({ recentRepos: { 0: '/a' } })).toEqual({})
    expect(sanitizeSettings({ recentRepos: null })).toEqual({})
    expect(sanitizeSettings({ recentRepos: 42 })).toEqual({})
  })

  it('문자열 아닌 원소만 버리고 나머지는 살린다 — 한 톨 때문에 목록을 통째로 잃지 않는다', () => {
    expect(
      sanitizeSettings({ recentRepos: ['/a', 42, null, { path: '/evil' }, ['/nested'], '/b'] }),
    ).toEqual({ recentRepos: ['/a', '/b'] })
  })

  it('sparse array의 hole도 걷어낸다 — filter가 건너뛰는 hole을 spread로 실체화한다', () => {
    // 아래 hole은 오타가 아니라 픽스처다 — JSON.parse는 hole을 못 만들지만 이 함수는
    // 렌더러가 IPC로 보낸 객체에도 쓰이고 거기엔 sparse array가 올 수 있다
    expect(sanitizeSettings({ recentRepos: ['/a', , '/b'] })).toEqual({ recentRepos: ['/a', '/b'] })
  })

  it('빈 배열은 필드를 남긴다 — 설정 저장이 얕은 병합이라 이것이 목록을 비우는 유일한 방법이다', () => {
    // settings.ts:52가 `save({ ...current(), ...sanitizeSettings(partial) })`라 필드를 빼면
    // 디스크의 옛 목록이 그대로 남는다. 즉 "다 지웠다"를 영속할 방법이 없어진다 — 의도된 동작이다
    expect(sanitizeSettings({ recentRepos: [] })).toEqual({ recentRepos: [] })
  })

  it('원소가 전부 불량이면 빈 배열이 된다 — 필드가 사라지지는 않는다', () => {
    expect(sanitizeSettings({ recentRepos: [1, 2, null] })).toEqual({ recentRepos: [] })
  })

  it('입력 배열을 그대로 물지 않는다 — 호출부가 디스크 객체를 재사용한다', () => {
    const input = ['/a', '/b']
    const result = sanitizeSettings({ recentRepos: input })
    // 값 단언을 먼저 둔다 — 이게 없으면 필드가 통째로 빠져도 `undefined !== input`이라 통과한다
    expect(result.recentRepos).toEqual(['/a', '/b'])
    expect(result.recentRepos).not.toBe(input)
  })
})

describe('sanitizePersistedSettings', () => {
  it('renderer 필드에 더해 hosting.github(token·login)을 통과시킨다', () => {
    expect(
      sanitizePersistedSettings({
        colorMode: 'dark',
        colorTheme: 'forest',
        hosting: { github: { token: 'enc-base64', login: 'octocat', evil: 'x' } },
      }),
    ).toEqual({
      colorMode: 'dark',
      colorTheme: 'forest',
      hosting: { github: { token: 'enc-base64', login: 'octocat' } },
    })
  })

  it('옛 theme 필드는 colorMode로 마이그레이션한다', () => {
    expect(sanitizePersistedSettings({ theme: 'dark' })).toEqual({ colorMode: 'dark' })
  })

  it('hosting이 잘못된 형태면 조용히 버린다', () => {
    expect(sanitizePersistedSettings({ hosting: 'yes' })).toEqual({})
    expect(sanitizePersistedSettings({ hosting: { github: { token: 42 } } })).toEqual({})
    expect(sanitizePersistedSettings({ hosting: { github: [] } })).toEqual({})
  })

  it('sanitizeSettings(renderer 표면)는 hosting을 걷어낸다 — 토큰은 renderer로 가지 않는다', () => {
    expect(sanitizeSettings({ colorMode: 'light', hosting: { github: { token: 'enc' } } })).toEqual({
      colorMode: 'light',
    })
  })
})

describe('sanitizePersistedSettings의 windows 방어 (E15c 형식)', () => {
  it('정상 목록은 그대로 통과한다 — 탭 순서·활성 인덱스·창 layout', () => {
    const value = {
      windows: [
        {
          tabs: [{ repoPath: '/a' }, { repoPath: null }, { repoPath: '/b' }],
          activeTab: 1,
          layout: { rightWidth: 300 },
        },
      ],
    }
    expect(sanitizePersistedSettings(value).windows).toEqual([
      {
        tabs: [{ repoPath: '/a' }, { repoPath: null }, { repoPath: '/b' }],
        activeTab: 1,
        layout: { rightWidth: 300 },
      },
    ])
  })

  it('탭의 워크스페이스 경로를 보존하고 잘못된 타입은 걷어낸다', () => {
    const value = {
      windows: [
        {
          tabs: [
            { repoPath: '/workspace/front', workspacePath: '/workspace' },
            { repoPath: '/single', workspacePath: 42 },
          ],
          activeTab: 0,
          layout: {},
        },
      ],
    }
    expect(sanitizePersistedSettings(value).windows).toEqual([
      {
        tabs: [
          { repoPath: '/workspace/front', workspacePath: '/workspace' },
          { repoPath: '/single' },
        ],
        activeTab: 0,
        layout: {},
      },
    ])
  })

  it('배열이 아니면 필드째 버린다', () => {
    expect(sanitizePersistedSettings({ windows: '창' })).not.toHaveProperty('windows')
  })

  it('원소가 객체가 아니면 버린다', () => {
    expect(sanitizePersistedSettings({ windows: ['/a', null, 3, []] }).windows).toEqual([])
  })

  it('tabs가 배열이 아니면 그 창째 버린다', () => {
    expect(
      sanitizePersistedSettings({ windows: [{ tabs: '탭들', activeTab: 0, layout: {} }] }).windows,
    ).toEqual([])
    expect(
      sanitizePersistedSettings({ windows: [{ tabs: { 0: { repoPath: '/a' } }, activeTab: 0 }] })
        .windows,
    ).toEqual([])
  })

  it('탭 원소가 객체가 아니거나 배열이면 그 탭을 버린다 — 배열은 typeof object를 통과한다', () => {
    const value = {
      windows: [{ tabs: ['/a', null, 3, ['/b'], { repoPath: '/c' }], activeTab: 0, layout: {} }],
    }
    expect(sanitizePersistedSettings(value).windows).toEqual([
      { tabs: [{ repoPath: '/c' }], activeTab: 0, layout: {} },
    ])
  })

  /**
   * E15b 리뷰 N-1 계승 — `null`로 낮추면 손상된 한 줄이 유령 빈 탭을 띄우고 종료 때
   * `{"repoPath":null}`로 다시 저장돼 매 실행 고착된다. 낮추기 대신 그 탭을 버린다
   */
  it('탭 repoPath의 타입이 틀리면 그 탭째 버린다 — 낮추면 유령 빈 탭이 고착된다', () => {
    const value = {
      windows: [
        { tabs: [{ repoPath: 42 }, { repoPath: '/a' }, { repoPath: ['/b'] }], activeTab: 0, layout: {} },
      ],
    }
    expect(sanitizePersistedSettings(value).windows).toEqual([
      { tabs: [{ repoPath: '/a' }], activeTab: 0, layout: {} },
    ])
  })

  it('repoPath 키가 없는 탭도 버린다 — 우리가 쓴 파일은 빈 탭도 null을 명시한다', () => {
    expect(
      sanitizePersistedSettings({ windows: [{ tabs: [{ path: '/a' }], activeTab: 0, layout: {} }] })
        .windows,
    ).toEqual([])
  })

  it('명시적 null 탭은 남긴다 — 빈 탭(RepoPicker)의 정당한 값이다', () => {
    expect(
      sanitizePersistedSettings({ windows: [{ tabs: [{ repoPath: null }], activeTab: 0, layout: {} }] })
        .windows,
    ).toEqual([{ tabs: [{ repoPath: null }], activeTab: 0, layout: {} }])
  })

  it('탭이 전부 버려지면 그 창째 버린다 — 탭 없는 창은 없다', () => {
    const value = {
      windows: [
        { tabs: [{ repoPath: 42 }], activeTab: 0, layout: {} },
        { tabs: [], activeTab: 0, layout: {} },
        { tabs: [{ repoPath: '/a' }], activeTab: 0, layout: {} },
      ],
    }
    expect(sanitizePersistedSettings(value).windows).toEqual([
      { tabs: [{ repoPath: '/a' }], activeTab: 0, layout: {} },
    ])
  })

  it('activeTab이 정수가 아니거나 범위 밖이면 0으로 접는다 — 음수·초과·비정수·비숫자·없음 전부', () => {
    const tabs = [{ repoPath: '/a' }, { repoPath: '/b' }]
    for (const activeTab of [-1, 2, 99, 1.5, '1', null, undefined]) {
      expect(
        sanitizePersistedSettings({ windows: [{ tabs, activeTab, layout: {} }] }).windows,
      ).toEqual([{ tabs, activeTab: 0, layout: {} }])
    }
    // 범위 안 정수는 그대로 — 접기가 유효값까지 뭉개지 않는다
    expect(
      sanitizePersistedSettings({ windows: [{ tabs, activeTab: 1, layout: {} }] }).windows,
    ).toEqual([{ tabs, activeTab: 1, layout: {} }])
  })

  it('layout의 알 수 없는 키·틀린 타입은 걷어낸다', () => {
    const value = {
      windows: [
        {
          tabs: [{ repoPath: '/a' }],
          activeTab: 0,
          layout: { rightWidth: '넓게', 몰래: 1, terminalOpen: true },
        },
      ],
    }
    expect(sanitizePersistedSettings(value).windows).toEqual([
      { tabs: [{ repoPath: '/a' }], activeTab: 0, layout: { terminalOpen: true } },
    ])
  })

  it('windows는 renderer 표면이 아니다 — sanitizeSettings가 걷어낸다', () => {
    expect(
      sanitizeSettings({
        colorMode: 'dark',
        windows: [{ tabs: [{ repoPath: '/a' }], activeTab: 0, layout: {} }],
      }),
    ).toEqual({ colorMode: 'dark' })
  })
})

/**
 * E15b 옛 형식(`{ repoPath, layout }`) 마이그레이션 (E15c Task 8, 스펙 §6) — 옛 형식을 버리면
 * E15b 사용자의 settings.json이 E15c 첫 실행에서 **조용히** 복원을 잃는다. 탭 하나짜리 창으로
 * 받아들이고, 종료 때 새 형식으로 다시 저장되므로 마이그레이션은 한 번만 일어난다.
 */
describe('sanitizePersistedSettings — E15b 옛 형식 마이그레이션 (E15c)', () => {
  it('옛 형식은 탭 하나짜리 창이 된다 — 저장소·레이아웃 무손실', () => {
    const value = {
      windows: [
        { repoPath: '/a', layout: { rightWidth: 300 } },
        { repoPath: '/b', layout: {} },
      ],
    }
    expect(sanitizePersistedSettings(value).windows).toEqual([
      { tabs: [{ repoPath: '/a' }], activeTab: 0, layout: { rightWidth: 300 } },
      { tabs: [{ repoPath: '/b' }], activeTab: 0, layout: {} },
    ])
  })

  it('옛 형식의 빈 창(repoPath null)은 빈 탭 하나가 된다', () => {
    expect(sanitizePersistedSettings({ windows: [{ repoPath: null, layout: {} }] }).windows).toEqual(
      [{ tabs: [{ repoPath: null }], activeTab: 0, layout: {} }],
    )
  })

  it('옛 형식의 repoPath 타입이 틀리면 그 항목째 버린다 (E15b 리뷰 N-1 그대로)', () => {
    const value = {
      windows: [{ repoPath: 42 }, { repoPath: '/a', layout: {} }, { repoPath: ['/b'] }],
    }
    expect(sanitizePersistedSettings(value).windows).toEqual([
      { tabs: [{ repoPath: '/a' }], activeTab: 0, layout: {} },
    ])
  })

  it('repoPath도 tabs도 없는 원소는 버린다 — 어느 형식도 아니다', () => {
    expect(sanitizePersistedSettings({ windows: [{ layout: { rightWidth: 300 } }] }).windows).toEqual(
      [],
    )
  })

  it('옛 형식과 새 형식이 섞여 있어도 각각 제 모양으로 온다 — 순서 보존', () => {
    const value = {
      windows: [
        { repoPath: '/old', layout: {} },
        { tabs: [{ repoPath: '/new-a' }, { repoPath: '/new-b' }], activeTab: 1, layout: {} },
      ],
    }
    expect(sanitizePersistedSettings(value).windows).toEqual([
      { tabs: [{ repoPath: '/old' }], activeTab: 0, layout: {} },
      { tabs: [{ repoPath: '/new-a' }, { repoPath: '/new-b' }], activeTab: 1, layout: {} },
    ])
  })

  it('옛 형식의 layout도 sanitize를 거친다', () => {
    const value = { windows: [{ repoPath: '/a', layout: { rightWidth: '넓게', terminalOpen: true } }] }
    expect(sanitizePersistedSettings(value).windows).toEqual([
      { tabs: [{ repoPath: '/a' }], activeTab: 0, layout: { terminalOpen: true } },
    ])
  })
})

describe('splitSettings — 창별/앱공용 분리 (E15b)', () => {
  it('창별 다섯 필드는 layout으로 간다', () => {
    const { app, layout } = splitSettings({
      leftCollapsed: true,
      rightCollapsed: false,
      rightWidth: 420,
      terminalOpen: true,
      terminalHeight: 240,
    })
    expect(layout).toEqual({
      leftCollapsed: true,
      rightCollapsed: false,
      rightWidth: 420,
      terminalOpen: true,
      terminalHeight: 240,
    })
    expect(app).toEqual({})
  })

  it('앱 공용 필드는 app으로 간다', () => {
    const { app, layout } = splitSettings({
      colorMode: 'dark',
      colorTheme: 'violet',
      pullMode: 'rebase',
    })
    expect(app).toEqual({ colorMode: 'dark', colorTheme: 'violet', pullMode: 'rebase' })
    expect(layout).toEqual({})
  })

  it('한 partial에 섞여 와도 각각 제 자리로 간다 — 렌더러가 갈라 보낼 의무가 없다', () => {
    const { app, layout } = splitSettings({ colorMode: 'light', rightWidth: 300 })
    expect(app).toEqual({ colorMode: 'light' })
    expect(layout).toEqual({ rightWidth: 300 })
  })

  it('sanitize를 거친다 — 타입이 틀린 값은 양쪽 다 안 받는다', () => {
    const { app, layout } = splitSettings({
      theme: 'neon',
      rightWidth: '넓게',
      pullMode: 'rebase',
    })
    expect(app).toEqual({ pullMode: 'rebase' })
    expect(layout).toEqual({})
  })

  it('hosting 토큰은 어느 쪽에도 안 간다 — renderer 표면이 아니다', () => {
    const { app, layout } = splitSettings({ hosting: { github: { token: 'x', login: 'y' } } })
    expect(app).not.toHaveProperty('hosting')
    expect(layout).not.toHaveProperty('hosting')
  })

  it('빈 입력은 빈 둘', () => {
    expect(splitSettings({})).toEqual({ app: {}, layout: {} })
    expect(splitSettings(null)).toEqual({ app: {}, layout: {} })
  })
})
