# E14a busy 구역화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** diff를 읽는 조회가 앱 전체를 잠그지 않게 해서, 파일을 클릭하거나 에디터에서 저장할 때 가운데 diff 말고는 아무것도 깜빡이지 않게 한다.

**Architecture:** 스토어의 `guard`를 `runWrite`(지금 그대로 전역 `busy`)와 `runRead`(전역을 안 건드리고 대상별 카운터만)로 가른다. 두 함수는 이미 `(set, get, run)`을 인자로 받아 스토어에 대해 순수하므로 새 모듈 `store/run-guard.ts`로 꺼내 단위 테스트한다. E10이 `armSuppression=false`로 이미 표시해 둔 조회 15개가 그대로 `runRead`로 간다 — 새 분류표를 만들지 않는다.

**Tech Stack:** TypeScript · React 19 · zustand · Vitest(단위) · Playwright Electron(E2E)

## Global Constraints

- **정본 스펙:** `docs/superpowers/specs/2026-07-30-e14a-busy-scope-design.md`. 스펙과 어긋나게 구현했다면 플랜에 편차로 기록한다.
- **언어:** 모든 주석·커밋 메시지·UI 문구는 한글. 주변 코드의 밀도를 따른다 — 이 저장소의 주석은 "왜"를 실측 숫자와 함께 적는다.
- **E2E는 반드시 단일 포그라운드 Bash 호출 + `timeout: 600000`.** 기본 120초 상한은 실행을 조용히 백그라운드로 보내고 멈춘다.
- **`npx playwright test`는 빌드하지 않는다.** `pnpm --filter @git-gui/desktop e2e`만 `electron-vite build &&`가 붙는다. 소스를 고친 뒤 `npx playwright test`를 돌리면 낡은 번들을 테스트하는 것이고 반증은 무의미해진다.
- **E2E 환경변수:** `GIT_GUI_E2E_REPO`(저장소 즉시 열기) · `GIT_GUI_USER_DATA`(설정 격리 — 하네스가 자동 주입하지만 직접 launch할 땐 반드시 지정) · `GIT_GUI_E2E_SHOW=1`(실제 창).
- **OS 전체 화면 캡처 금지.** 사용자의 다른 창에 사적 정보가 있다. Playwright의 창/페이지 캡처만 쓰고 `/private/tmp/claude-501/-Users-sangyeop-kim-git-gui/b4ef6d32-042d-440c-8252-b8944659aa01/scratchpad/`에 쓴다.
- **사용자의 실행 중인 dev 앱을 건드리거나 재시작하지 않는다.**
- **모션 안전망:** `apps/desktop/test/motion-tokens.test.ts`가 레이아웃 속성 전환을 금지한다. `opacity`·`transform`은 허용 대상이다.
- **기준 게이트(시작 시점):** typecheck 6/6 · 루트 `pnpm test` **562** · build 성공 · e2e **119**.

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| **생성** `apps/desktop/src/renderer/src/store/run-guard.ts` | `runWrite`/`runRead`/`ReadTarget`/억제 창. 스토어에 대해 순수 — 가짜 `set`/`get`으로 단위 테스트된다. |
| **생성** `apps/desktop/test/run-guard.test.ts` | 위 모듈의 단위 테스트. 스토어 로직 첫 단위 테스트다. |
| **수정** `apps/desktop/src/renderer/src/store/repository-store.ts` | `guard` 삭제 → 새 모듈 사용. 조회 15개를 `runRead`로 전환하고 결과 `set`을 `isCurrent()`로 감싼다. `reads` 상태 추가. |
| **수정** `apps/desktop/src/renderer/src/ui/tokens.css` | `--motion-pending-delay: 400ms` 토큰 추가. |
| **수정** `apps/desktop/src/renderer/src/ui/base.css` | `@keyframes ui-pending-in`·`ui-pending-spin`, `.ui-pending` 클래스. |
| **수정** `apps/desktop/src/renderer/src/ui/Panel.tsx` | `pending?: boolean` prop — 헤더 우측에 스피너. |
| **수정** `apps/desktop/src/renderer/src/ui/panel.css` | 스피너 자리(`margin-left: auto`). |
| **수정** `apps/desktop/src/renderer/src/App.tsx` | 각 패널에 `pending={store.reads.<target> > 0}` 전달. |
| **수정** `apps/desktop/e2e/smoke.spec.ts` | 회귀 E2E 4건. |

---

### Task 1: `run-guard.ts` 모듈 + 단위 테스트

**Files:**
- Create: `apps/desktop/src/renderer/src/store/run-guard.ts`
- Create: `apps/desktop/test/run-guard.test.ts`

**Interfaces:**
- Produces: `ReadTarget`, `createEmptyReads()`, `WATCH_SUPPRESS_MS`, `isWithinSuppressWindow()`, `resetSuppression()`, `runWrite(set, get, run)`, `runRead(set, get, target, run)`. Task 2가 전부 쓴다.
- Consumes: 없음 (독립 모듈).

- [x] **Step 1: 실패하는 테스트를 쓴다**

`apps/desktop/test/run-guard.test.ts`:

```ts
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
```

- [x] **Step 2: 실패를 확인한다**

Run: `cd "/Users/sangyeop_kim/git gui" && npx vitest run --root apps/desktop test/run-guard.test.ts`
Expected: FAIL — `Failed to resolve import "../src/renderer/src/store/run-guard"`

- [x] **Step 3: 모듈을 구현한다**

`apps/desktop/src/renderer/src/store/run-guard.ts`:

```ts
/**
 * 스토어 작업의 두 갈래 — "저장소를 바꾸는 작업"과 "화면만 읽는 조회" (E14a).
 *
 * 왜 별도 모듈인가: repository-store.ts는 1678줄이고 git() IPC 브리지에 묶여 있어 단위 테스트가
 * 하나도 없다. 반면 이 두 함수는 (set, get, run)을 인자로 받아 스토어에 대해 순수하므로, 꺼내면
 * 가짜 set/get으로 테스트된다 — 이 저장소의 다른 순수 모듈 31개와 같은 패턴이다.
 *
 * 왜 갈랐는가 (사용자 제보: "파일 누르면 헤더부터 사이드바 전체가 깜빡인다"): 예전엔 guard 하나가
 * 조회에도 전역 busy를 켰다. busy는 렌더러 118곳에 스레드돼 있어, diff 하나 읽는 29ms 동안 헤더
 * 컨트롤 10개와 좌측 22개가 비활성이 됐다가 돌아왔다(실측: 헤더 속성 변형 30건). 더 나쁜 건
 * externalRefresh도 같은 경로라 **에디터에서 파일을 저장하기만 해도** 같은 일이 벌어졌다는 것이다
 * (실측: 헤더 변형 20건). E11이 버튼 색에 100ms 트랜지션을 걸어둔 탓에 29ms짜리 상태 변화가
 * 100ms에 걸쳐 번지며 더 잘 보였다.
 */

/** 조회 결과가 떨어지는 자리 — 액션이 아니라 화면 위치 기준이다(로딩을 보여줄 곳이 곧 그 자리다) */
export type ReadTarget = 'snapshot' | 'center' | 'right' | 'left' | 'reviews'

/** 대상 목록이 필요하면 createEmptyReads()의 키를 쓴다 — 정본을 하나로 둔다(죽은 export 방지) */
export function createEmptyReads(): Record<ReadTarget, number> {
  return { snapshot: 0, center: 0, right: 0, left: 0, reviews: 0 }
}

/** run-guard가 요구하는 최소 상태 — RepositoryStore가 이를 구조적으로 만족하므로 캐스팅이 없다 */
interface GuardState {
  busy: boolean
  error: string | null
  notice: string | null
  reads: Record<ReadTarget, number>
}

type GuardSet = (partial: Partial<GuardState>) => void
type GuardGet = () => GuardState

/** 작업 종료 후 이 시간 안의 감시 이벤트는 자기 작업의 꼬리로 보고 무시한다 (디바운스 300ms + 여유) */
export const WATCH_SUPPRESS_MS = 800

/** 마지막 쓰기 작업이 끝난 시각 — 감시발 재조회의 억제 창 기준 (E7b 실측 1: 트레일링 이벤트 흡수) */
let lastWriteEndAt = 0

export function isWithinSuppressWindow(now = Date.now()): boolean {
  return now - lastWriteEndAt < WATCH_SUPPRESS_MS
}

/** 억제 창을 즉시 닫는다 — 저장소를 새로 열 때(init) 이전 저장소의 꼬리를 끌고 오지 않게 한다 */
export function resetSuppression(): void {
  lastWriteEndAt = 0
}

/**
 * 대상별 최신 조회 번호. 조회는 겹쳐 돌 수 있으므로(전역 직렬화를 뺐다) 늦게 도착한 응답이
 * 최신 결과를 덮지 않게 막아야 한다 — HistoryPanel의 findSeqRef가 같은 문제를 같은 방식으로 푼다(E7i).
 */
const readSeq: Record<ReadTarget, number> = createEmptyReads()

/**
 * 저장소를 바꾸는 작업. 전역 busy로 직렬화하고, 시작할 때 error·notice를 지우며
 * (사용자가 뭔가 새로 시작했다는 신호다), 끝나면 억제 창을 무장한다.
 * 예전 guard(armSuppression=true)와 동작이 같다.
 */
export async function runWrite(
  set: GuardSet,
  get: GuardGet,
  run: () => Promise<void>,
): Promise<boolean> {
  if (get().busy) return false
  set({ busy: true, error: null, notice: null })
  try {
    await run()
    return true
  } catch (cause) {
    set({ error: toMessage(cause) })
    return false
  } finally {
    lastWriteEndAt = Date.now()
    set({ busy: false })
  }
}

/**
 * 화면만 읽는 조회. 전역 busy를 건드리지 않고 대상별 카운터만 올렸다 내린다.
 * error·notice를 지우지 않고 억제 창도 무장하지 않는 것은 이제 구성상 저절로 지켜진다 —
 * E10이 armSuppression=false라는 인자로 표현하던 규칙이 함수가 나뉘면서 구조로 옮겨왔다.
 *
 * run에 isCurrent를 넘기는 이유: 결과를 스토어에 넣는 set()은 여기가 아니라 run 안에서 일어난다.
 * 그래서 runRead만으로는 늦게 온 응답을 막을 수 없다 — 느린 조회 A와 빠른 조회 B가 겹치면 B가
 * 먼저 떨어진 뒤 A가 다른 파일의 diff로 덮어쓴다. 지금까지는 busy 재진입 거부가 이 경합을 우연히
 * 막고 있었고, 그걸 빼는 순간 열린다. 호출부는 결과 set을 반드시 if (isCurrent())로 감싼다.
 */
export async function runRead(
  set: GuardSet,
  get: GuardGet,
  target: ReadTarget,
  run: (isCurrent: () => boolean) => Promise<void>,
): Promise<boolean> {
  const seq = (readSeq[target] += 1)
  const isCurrent = () => seq === readSeq[target]
  // set이 함수형 갱신자를 안 받으므로(StoreSet은 Partial만 받는다) get()으로 읽어 펼친다.
  // get()과 set() 사이에 await가 없어 단일 스레드에서 안전하다
  set({ reads: { ...get().reads, [target]: get().reads[target] + 1 } })
  try {
    await run(isCurrent)
    return true
  } catch (cause) {
    if (isCurrent()) set({ error: toMessage(cause) })
    return false
  } finally {
    set({ reads: { ...get().reads, [target]: get().reads[target] - 1 } })
  }
}

function toMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
```

- [x] **Step 4: 통과를 확인한다**

Run: `cd "/Users/sangyeop_kim/git gui" && npx vitest run --root apps/desktop test/run-guard.test.ts`
Expected: PASS — 16 passed

- [x] **Step 5: 반증한다 — 테스트가 실제로 무는지**

`runRead`의 `set({ reads: … })` 두 줄을 잠시 지우고 재실행 → 카운터 테스트 2건이 빨개져야 한다.
`isCurrent`를 `() => true`로 고정하고 재실행 → 늦은 응답 테스트 3건이 빨개져야 한다.
확인 후 **원복**하고 다시 통과를 확인한다. 빨강/초록 출력을 그대로 보고에 붙인다.

- [x] **Step 6: 커밋**

```bash
cd "/Users/sangyeop_kim/git gui"
git add apps/desktop/src/renderer/src/store/run-guard.ts apps/desktop/test/run-guard.test.ts
git commit -m "feat(desktop): E14a runWrite/runRead 분리 — 조회를 전역 잠금에서 뺀다

guard 하나가 조회에도 전역 busy를 켜던 것을 두 함수로 가른다. 스토어에 대해 순수한
함수라 별도 모듈로 꺼내 가짜 set/get으로 단위 테스트한다(스토어 로직 첫 단위 테스트).

runRead는 run에 isCurrent를 넘긴다 — 결과 set이 run 안에서 일어나므로 그것 없이는
늦게 온 조회가 최신 결과를 덮는다. 지금까지 busy 재진입 거부가 우연히 막고 있던 경합이다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 스토어를 새 모듈로 전환 — 조회 15개

**Files:**
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts` (`:85` `busy` 선언부 근처에 `reads` 추가 · `:373-409` `guard`·`lastGuardEndAt` 삭제 · `:427` 초기값 · `:454` `init` 리셋 · `:524` 억제 창 판정 · 조회 15개)

**Interfaces:**
- Consumes: Task 1의 `runWrite` · `runRead` · `ReadTarget` · `createEmptyReads` · `isWithinSuppressWindow` · `resetSuppression` · `WATCH_SUPPRESS_MS`.
- Produces: `RepositoryStore.reads: Record<ReadTarget, number>` — Task 4의 App 배선이 읽는다.

**전환 대상 15개 (스펙 §2-2 표 그대로).** 각각 결과 `set()`을 `if (!isCurrent()) return`으로 지킨다:

| target | 액션 (현재 줄) |
| --- | --- |
| `snapshot` | `refresh`(:488) · `externalRefresh`(:518) |
| `center` | `selectFile`(:683) · `selectCommitFile`(:740) · `compareFileWithWorktree`(:780) · `selectConflict`(:1302 부근) |
| `right` | `selectCommit`(:716) · `openPullDetail`(:1613) · `viewHistory`(:1265) · `clearHistoryView`(:1280) · `loadMoreHistory`(:1418) · `ensureHistoryLoaded`(:1465) · `revealHead`(:1486) |
| `left` | `compareBranch`(:1046) |
| `reviews` | `refreshPulls`(:1533) |

> 줄 번호는 이 플랜을 쓴 시점 기준이다. 앞선 편집으로 밀릴 수 있으니 **함수 이름으로 찾는다.**
> 전환 후 `grep -c "armSuppression" repository-store.ts`가 **0**이어야 하고,
> `grep -c "runRead(" repository-store.ts`가 **15**여야 한다.

- [x] **Step 1: 상태와 import를 바꾼다**

`repository-store.ts` 상단 import에 추가:

```ts
import {
  createEmptyReads,
  isWithinSuppressWindow,
  resetSuppression,
  runRead,
  runWrite,
  type ReadTarget,
} from './run-guard'
export { WATCH_SUPPRESS_MS } from './run-guard'
```

`WATCH_SUPPRESS_MS`를 re-export하는 이유: 기존에 이 파일에서 `export const`로 나가고 있어 다른 곳이 여기서 가져다 쓴다. 소비처를 옮기지 않고 그대로 통하게 둔다.

인터페이스에 필드를 추가한다(`:85` `busy: boolean` 바로 아래):

```ts
  /** 조회가 진행 중인 자리별 개수 — busy와 달리 전역을 잠그지 않고 그 패널만 로딩을 보인다 (E14a) */
  reads: Record<ReadTarget, number>
```

초기값(`:427` `busy: false,` 바로 아래):

```ts
  reads: createEmptyReads(),
```

- [x] **Step 2: `guard`와 `lastGuardEndAt`을 지운다**

`:373-409`의 `lastGuardEndAt` 선언, `WATCH_SUPPRESS_MS` 선언, `guard` 함수 전체를 삭제한다.
`:454`의 `lastGuardEndAt = 0`을 `resetSuppression()`으로,
`:524`의 `if (Date.now() - lastGuardEndAt < WATCH_SUPPRESS_MS) return`을
`if (isWithinSuppressWindow()) return`으로 바꾼다.

- [x] **Step 3: 쓰기 50개를 `runWrite`로 바꾼다 (기계적)**

`guard(set, get, async () => {` → `runWrite(set, get, async () => {`.
꼬리의 `})` 는 그대로. 이 50개는 `armSuppression` 인자가 없던 것들이다.

> **정정(Task 2 실측):** 플랜 초안이 "35개"라고 쓴 것은 틀렸다. `grep -c "guard(set, get"` 이
> 세던 50이 총계가 아니라 **쓰기 개수**였고, 조회 15개는 다중행 호출이라 그 grep에 안 잡혔다.
> 실제 분할은 쓰기 50 · 조회 15 · 총 65다.

- [x] **Step 4: 조회 15개를 `runRead`로 바꾼다**

`selectFile`을 본보기로 삼는다 — 나머지 14개도 같은 모양이다:

```ts
  async selectFile(selected) {
    const { repoPath } = get()
    if (!repoPath) return
    // 충돌 파일은 diff가 아니라 충돌 해결 화면으로 — 한쪽을 고르거나 직접 수정한다
    if (selected.change.staged === 'conflicted' || selected.change.unstaged === 'conflicted') {
      await get().selectConflict(selected.change.path)
      return
    }
    // 읽기 전용 조회 — 전역 busy를 켜지 않는다. 이 앱에서 가장 잦은 조작이라 켜면 헤더·사이드바가
    // 매번 깜빡인다(E14a 실측: 헤더 속성 변형 30건, 29ms). 억제 창도 무장하지 않는다(E10)
    await runRead(set, get, 'center', async (isCurrent) => {
      const untracked = selected.change.unstaged === 'untracked'
      const diff = await git().changes.diff(repoPath, selected.change.path, {
        staged: selected.staged,
        untracked,
        // staged rename은 원래 경로를 동봉해야 rename으로 표시된다 (unstage와 대칭)
        origPath: selected.staged ? selected.change.origPath : null,
      })
      // 그 사이 다른 파일을 눌렀다면 이 결과는 낡았다 — 덮지 않고 버린다 (E14a)
      if (!isCurrent()) return
      // 파일 diff·커밋 상세·충돌 뷰는 상호 배타 — 중앙 패널이 하나다
      set({ selected, diff, diffLabel: null, commitDetail: null, commitFile: null, conflictFile: null })
    })
  },
```

**`set()`이 여러 번 있는 액션 — 무엇을 감싸고 무엇을 두는가.** 플랜 작성 시점에 전수 확인했다.

`isCurrent()`는 **`await` 뒤에서 결과를 반영하는 `set()`에만** 건다. `await` **앞**의 `set()`은
아직 경합이 없으므로 감싸지 않고, 지우지도 않는다.

- **`viewHistory`(`:1262`) · `clearHistoryView`(`:1277`) 의 `set({ historyRef })` 는 그대로 둔다.**
  `await` 앞에 일부러 놓인 **즉시 피드백**이다 — E7g가 "조회 중: `<ref>` ✕" 알약을 클릭 즉시
  띄우려고 이렇게 짰다. 이걸 "시작 시 화면을 비우는 코드"로 오해해 지우면 알약이 조회가 끝난
  뒤에야 나타나는 회귀가 된다. 바로 뒤의 `set({ ...(await fetchSnapshot(...)) })`만 감싼다.
- **`loadMoreHistory`(`:1411`, `:1415`) 는 `try`와 `catch` 양쪽에 결과 `set()`이 있다.**
  둘 다 감싼다 — `catch` 쪽은 "조회 브랜치가 사라졌으면 조용히 전체 그래프로 복귀"하는 폴백이라
  결과를 쓰는 것은 마찬가지다.
- **`selectConflict`(`:1293`) · `compareBranch`(`:1055`) · `refreshPulls`(`:1526`) 는
  `await` 뒤 `set()` 하나씩**이다. 그것만 감싼다.

즉 **스펙 §2-3의 "조회 중에도 이전 내용을 그대로 둔다"를 어기는 액션은 현재 하나도 없다** —
비우는 코드를 새로 넣지 않기만 하면 된다. 전환 중 위 목록과 다른 모양을 발견하면 임의로
판단하지 말고 플랜 실행 기록에 적고 컨트롤러에게 보고한다.

- [x] **Step 5: 타입·단위 게이트**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm typecheck && pnpm test
```
Expected: typecheck 6/6 · Tests **578 passed** (562 + Task 1의 16건)

- [x] **Step 6: 잔재를 확인한다**

```bash
cd "/Users/sangyeop_kim/git gui/apps/desktop/src/renderer/src/store" && grep -c "armSuppression" repository-store.ts; grep -c "runRead(" repository-store.ts; grep -c "runWrite(" repository-store.ts
```
Expected: `0` · `15` · `50`  (조회 15 · 쓰기 50 · 총 65 — 위 Step 3 정정 참조)

- [x] **Step 7: 커밋**

```bash
cd "/Users/sangyeop_kim/git gui"
git add apps/desktop/src/renderer/src/store/repository-store.ts
git commit -m "refactor(desktop): E14a 조회 15개를 runRead로 — armSuppression 인자 폐기

E10이 armSuppression=false로 표시해 둔 조회 15개를 그대로 runRead로 옮긴다. 새 분류표를
만들지 않고 이미 있던 경계를 승계한다. 그 인자가 표현하던 규칙(error·notice를 지우지 않는다,
억제 창을 무장하지 않는다)은 이제 함수가 나뉘어 구조로 표현된다.

각 조회의 결과 set은 isCurrent()로 지킨다 — 전역 직렬화를 뺐으므로 조회가 겹칠 수 있고,
그대로 두면 늦게 온 응답이 다른 파일의 diff로 덮어쓴다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 깜빡임 회귀 E2E 2건

**Files:**
- Modify: `apps/desktop/e2e/smoke.spec.ts` (파일 끝에 추가)

**Interfaces:**
- Consumes: Task 2의 동작(조회가 `busy`를 안 켠다).
- Produces: 없음.

- [x] **Step 1: 테스트를 쓴다**

`smoke.spec.ts` 끝에 추가한다. 기존 헬퍼 `createRepoWithChange`가 파일 1개만 만든다면
아래처럼 자체 픽스처를 쓴다(파일 2개가 필요하다 — A→B로 재야 하기 때문이다).

```ts
/**
 * E14a — 파일을 옮겨 다닐 때 앱 전체가 깜빡이면 안 된다.
 *
 * 사용자 제보: "파일 누르면 왜 헤더부터 사이드바 전체가 다 텍스트가 리렌더링되는것처럼
 * 깜빡이는거야? diff부분만 바뀌면 될 것 같은데.."
 *
 * 원인은 selectFile이 diff만 읽는 조회인데도 전역 busy를 켰다 끈 것이다. busy는 렌더러
 * 118곳에 스레드돼 있다. 수정 전 실측(MutationObserver, 파일 A→B 클릭 1회):
 *   헤더  텍스트 0 · 속성 30 (disabled×10 · tabindex×10 · data-disabled×10)
 *   좌측  텍스트 2 · 속성 78 (그 텍스트가 CommitForm의 '작업 중이에요'다)
 *   헤더 컨트롤이 비활성으로 머문 시간 28.8ms
 *
 * **왜 A→B인가:** "선택 없음 → 첫 파일"은 좌측 행 액션이 정당하게 활성화된다(실측: disabled
 * 대상 20→3). 그 경우엔 좌측 변형 0을 요구할 수 없다. 이미 한 파일을 보고 있는 상태에서
 * 다른 파일로 옮기면 그 정당한 변화가 이미 끝나 있어, 남는 변형은 전부 busy 탓이다.
 */
test('E14a — 파일을 옮겨도 헤더가 잠기지 않는다 (전체 깜빡임 회귀)', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'git-gui-e14a-'))
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  try {
    await execGitOrThrow(['init', '-b', 'main'], { cwd: repo })
    await execGitOrThrow(['config', 'user.email', 'e2e@example.com'], { cwd: repo })
    await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: repo })
    for (const name of ['a.txt', 'b.txt']) {
      await writeFile(join(repo, name), 'base\n'.repeat(50))
    }
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow(['commit', '-m', 'init'], { cwd: repo })
    for (const name of ['a.txt', 'b.txt']) {
      await writeFile(join(repo, name), 'changed\n'.repeat(50))
    }

    const app = await electron.launch({
      args: [APP_ROOT],
      env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
    })
    try {
      const window = await app.firstWindow()
      // 먼저 a.txt를 골라 "이미 보고 있는" 상태를 만든다
      await window.getByTestId('file-unstaged-a.txt').click()
      await expect(window.getByTestId('diff-panel')).toBeVisible()

      const counts = await window.evaluate(async () => {
        const log = { header: 0, composerText: [] as string[] }
        const headerObserver = new MutationObserver((records) => {
          log.header += records.length
        })
        headerObserver.observe(document.querySelector('.app__header')!, {
          subtree: true,
          attributes: true,
          attributeFilter: ['disabled', 'data-disabled', 'tabindex'],
        })
        const leftObserver = new MutationObserver((records) => {
          for (const record of records) {
            if (record.type === 'characterData') log.composerText.push(String(record.target.data))
          }
        })
        leftObserver.observe(document.querySelector('.app__left')!, {
          subtree: true,
          characterData: true,
        })

        ;(document.querySelector('[data-testid="file-unstaged-b.txt"]') as HTMLElement).click()
        await new Promise((resolve) => setTimeout(resolve, 800))
        headerObserver.disconnect()
        leftObserver.disconnect()
        return log
      })

      expect(counts.header, '헤더 잠금 변형 — 수정 전 실측 30건').toBe(0)
      expect(
        counts.composerText.filter((text) => text.includes('작업 중이에요')),
        '커밋 컴포저가 "작업 중이에요"로 번쩍이면 안 된다',
      ).toEqual([])
      // 공허한 통과 방지 — 가운데는 실제로 b.txt로 바뀌었어야 한다
      await expect(window.getByTestId('diff-panel')).toContainText('b.txt')
    } finally {
      await app.close()
    }
  } finally {
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E14a — 앱을 만지지 않아도 깜빡이던 경로. externalRefresh(E10 워킹트리 감시)도 조회인데
 * 전역 busy를 켰다. 즉 **에디터에서 파일을 저장하기만 해도** 헤더가 잠겼다 풀렸다.
 * 에디터 자동저장을 켜두면 상시로 돈다. 수정 전 실측: 외부 저장 1회 → 헤더 변형 20건.
 *
 * 여기서는 사용자가 앱을 만지지 않았으므로 좌측 disabled 변형도 0을 요구할 수 있다.
 */
test('E14a — 에디터에서 저장해도 앱이 잠기지 않는다 (외부 변경 깜빡임 회귀)', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'git-gui-e14a-ext-'))
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  try {
    await execGitOrThrow(['init', '-b', 'main'], { cwd: repo })
    await execGitOrThrow(['config', 'user.email', 'e2e@example.com'], { cwd: repo })
    await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: repo })
    await writeFile(join(repo, 'a.txt'), 'base\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow(['commit', '-m', 'init'], { cwd: repo })

    const app = await electron.launch({
      args: [APP_ROOT],
      env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
    })
    try {
      const window = await app.firstWindow()
      await expect(window.locator('.app__header')).toBeVisible()
      // 부팅 직후의 초기 조회들이 끝나길 기다린다 — 그 뒤부터 센다
      await expect
        .poll(async () => window.evaluate(() => document.querySelectorAll('.ui-pending').length), {
          timeout: 5000,
        })
        .toBe(0)

      await window.evaluate(() => {
        const log = { header: 0, left: 0 }
        ;(window as unknown as { __e14a: typeof log }).__e14a = log
        new MutationObserver((records) => {
          log.header += records.length
        }).observe(document.querySelector('.app__header')!, {
          subtree: true,
          attributes: true,
          attributeFilter: ['disabled', 'data-disabled', 'tabindex'],
        })
        new MutationObserver((records) => {
          log.left += records.length
        }).observe(document.querySelector('.app__left')!, {
          subtree: true,
          attributes: true,
          attributeFilter: ['disabled', 'data-disabled'],
        })
      })

      // 에디터가 파일을 저장한 상황을 그대로 재현한다 (E10 워킹트리 감시 경로)
      await writeFile(join(repo, 'a.txt'), 'edited by editor\n')
      // 변경이 실제로 화면에 반영될 때까지 기다린다 — 반영도 안 됐는데 0건이면 공허하다
      await expect(window.getByTestId('file-unstaged-a.txt')).toBeVisible()

      const log = await window.evaluate(
        () => (window as unknown as { __e14a: { header: number; left: number } }).__e14a,
      )
      expect(log.header, '헤더 잠금 변형 — 수정 전 실측 20건').toBe(0)
      expect(log.left, '좌측 잠금 변형 — 사용자가 만지지 않았으므로 0이어야 한다').toBe(0)
    } finally {
      await app.close()
    }
  } finally {
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
```

- [x] **Step 2: 통과를 확인한다**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm --filter @git-gui/desktop e2e
```
(**단일 포그라운드 호출 · `timeout: 600000`**)
Expected: **121 passed** (119 + 2)

- [x] **Step 3: 반증한다**

`run-guard.ts`의 `runRead`가 `set({ busy: true })`를 켰다 끄도록 잠시 되돌린 뒤
**`pnpm --filter @git-gui/desktop e2e`로 재빌드해서** 실행 → 두 테스트가 빨개져야 한다.
`npx playwright test`는 빌드하지 않으므로 쓰지 않는다. 확인 후 원복하고 다시 통과를 확인한다.
빨강/초록 출력을 그대로 보고에 붙인다.

- [x] **Step 4: 커밋**

```bash
cd "/Users/sangyeop_kim/git gui"
git add apps/desktop/e2e/smoke.spec.ts
git commit -m "test(desktop): E14a 깜빡임 회귀 E2E 2건 — 파일 이동·외부 저장

사용자 제보를 그대로 테스트로 고정한다. 수정 전 실측(헤더 속성 변형 30건·20건)이 각
테스트 주석에 기준값으로 남는다.

A→B로 재는 이유를 주석에 적었다 — '선택 없음 → 첫 파일'은 좌측 행 액션이 정당하게
활성화되므로(실측 20→3) 그 경우엔 좌측 변형 0을 요구할 수 없다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 조회 로딩 표시 — `.ui-pending`

**Files:**
- Modify: `apps/desktop/src/renderer/src/ui/tokens.css` (`:38` `--motion-slow` 아래)
- Modify: `apps/desktop/src/renderer/src/ui/base.css` (`:75` `@keyframes ui-fade` 아래)
- Modify: `apps/desktop/src/renderer/src/ui/Panel.tsx`
- Modify: `apps/desktop/src/renderer/src/ui/panel.css` (`:20` `.ui-panel__head` 아래)
- Modify: `apps/desktop/src/renderer/src/App.tsx` (패널 호출부)

**Interfaces:**
- Consumes: Task 2의 `store.reads`.
- Produces: `Panel`의 `pending?: boolean` prop.

- [x] **Step 1: 토큰을 추가한다**

`ui/tokens.css`의 `--motion-slow: 240ms;` 줄 바로 아래:

```css
  --motion-pending-delay: 400ms; /* 조회 로딩이 배어나오기 시작하는 시점 — 실측 diff 조회가 29ms라
                                    평범한 조회는 전부 이 안에서 끝나 한 프레임도 보이지 않는다 (E14a) */
```

- [x] **Step 2: 키프레임과 클래스를 추가한다**

`ui/base.css`의 `@keyframes ui-fade { … }` 블록 바로 아래:

```css
/* E14a — 조회 로딩. JS 타이머로 "150ms 넘으면 띄운다"를 만들지 않고, 처음부터 DOM에 붙이되
   animation-delay로 늦춘다. 지연이 끝나기 전에 사라지는 빠른 조회는 한 프레임도 보이지 않는다.
   prefers-reduced-motion 블록(아래)이 animation-duration만 0.01ms로 줄이고 animation-delay는
   건드리지 않으므로, 모션 줄이기에서도 "지연 400ms는 그대로, 페이드만 없음"이 저절로 된다 —
   페이드까지 없애면 지연도 함께 사라져 빠른 조회가 오히려 번쩍인다 */
@keyframes ui-pending-in {
  from {
    opacity: 0;
  }
}
@keyframes ui-pending-spin {
  to {
    transform: rotate(1turn);
  }
}
.ui-pending {
  width: 12px;
  height: 12px;
  flex: none;
  border-radius: var(--radius-pill);
  border: 2px solid var(--color-border);
  border-top-color: var(--color-text-muted);
  /* 지연 중에도 DOM에 있으므로 클릭을 가로채지 않게 한다 */
  pointer-events: none;
  animation:
    ui-pending-in var(--motion-base) var(--ease-out) var(--motion-pending-delay) both,
    ui-pending-spin 700ms linear var(--motion-pending-delay) infinite;
}
```

`transform: rotate`와 `opacity`는 안전망(`motion-tokens.test.ts`)이 막는 레이아웃 속성이 아니다.

- [x] **Step 3: `Panel`에 `pending`을 단다**

`ui/Panel.tsx`:

```tsx
interface PanelProps {
  title: string
  /** 원어 병기(E8) — 있으면 툴팁 본문이 "title (titleHint)"가 된다. 보이는 <h2>는 title 그대로 */
  titleHint?: string
  /** 제목 옆 배지 등 */
  accessory?: ReactNode
  /** 이 패널로 떨어질 조회가 진행 중인가 — 느린 조회에만 스피너가 배어난다 (E14a) */
  pending?: boolean
  children: ReactNode
  testId?: string
}

export function Panel({ title, titleHint, accessory, pending, children, testId }: PanelProps) {
  const tooltipContent = titleHint !== undefined ? `${title} (${titleHint})` : title
  return (
    <section className="ui-panel" data-testid={testId}>
      <header className="ui-panel__head">
        <Tooltip content={tooltipContent} summary={title}>
          <h2>{title}</h2>
        </Tooltip>
        {accessory}
        {/* 조회 중에도 이전 내용은 그대로 둔다 — 비우면 그게 다시 깜빡임이다(E14a 스펙 §2-3).
            내용을 덮는 오버레이가 아니라 헤더 우측의 작은 표시 하나다 */}
        {pending === true ? (
          <span className="ui-pending" data-testid="panel-pending" aria-label="불러오는 중" />
        ) : null}
      </header>
      <div className="ui-panel__body">{children}</div>
    </section>
  )
}
```

`ui/panel.css`의 `.ui-panel__head h2 { min-width: 72px; }` 뒤에 추가:

```css
/* E14a — 스피너는 헤더 오른쪽 끝에 붙는다 */
.ui-panel__head .ui-pending {
  margin-left: auto;
}
```

- [x] **Step 4: App에서 배선한다**

`App.tsx`에서 각 패널에 넘긴다. target은 스펙 §2-2 표를 따른다:

- `DiffPanel` · `ConflictPanel` → `pending={store.reads.center > 0}`
- `HistoryPanel` · `CommitDetailPanel` · `ReviewDetailPanel` → `pending={store.reads.right > 0}`
- `BranchesPanel` → `pending={store.reads.left > 0}`

각 컴포넌트는 `pending?: boolean`을 props에 추가해 자기 `<Panel>`에 그대로 넘긴다.
`DiffPanel`을 본보기로 삼는다 — 나머지 5개도 같은 모양이다:

```tsx
// components/DiffPanel.tsx — props 인터페이스에 추가
interface DiffPanelProps {
  // …기존 props 그대로…
  /** 이 패널로 떨어질 조회가 진행 중인가 (E14a) */
  pending?: boolean
}

// 두 군데 <Panel> 모두에 넘긴다 (:36 빈 상태 · :42 본문)
export function DiffPanel({ /* …기존… */ pending }: DiffPanelProps) {
  if (diff === null) {
    return (
      <Panel title={T.diff} testId="diff-panel" pending={pending}>
        …
      </Panel>
    )
  }
  return (
    <Panel title={/* …기존… */} testId="diff-panel" pending={pending} accessory={/* 기존 */}>
      …
    </Panel>
  )
}
```

```tsx
// App.tsx 호출부
<DiffPanel /* …기존 props… */ pending={store.reads.center > 0} />
```

`WorktreesPanel`·`ChangesPanel`은 조회 대상이 아니므로 넘기지 않는다.

`ReviewPopover`는 `Panel`을 쓰지 않으므로 자기 헤더에 `<span className="ui-pending" />`을
`store.reads.reviews > 0`일 때 직접 넣는다.

- [x] **Step 5: 게이트**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm typecheck && pnpm test
```
Expected: typecheck 6/6 · Tests **578 passed** (변동 없음 — 이 태스크는 단위 테스트를 늘리지 않는다)

- [x] **Step 6: 커밋**

```bash
cd "/Users/sangyeop_kim/git gui"
git add apps/desktop/src/renderer/src/ui apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/components
git commit -m "feat(desktop): E14a 조회 로딩 표시 — animation-delay로 느린 조회에만 배어난다

JS 타이머 대신 animation-delay(400ms)를 쓴다. 실측 diff 조회가 29ms라 평범한 조회는 전부
지연 안에서 끝나 한 프레임도 보이지 않고, 느린 조회만 자연스럽게 드러난다.

조회 중에도 이전 내용은 그대로 둔다 — 비우면 그게 다시 깜빡임이다. 내용을 덮는 오버레이가
아니라 패널 헤더 우측의 작은 표시 하나다.

prefers-reduced-motion에서 별도 규칙이 필요 없다: 기존 블록이 animation-duration만 줄이고
animation-delay는 건드리지 않아 '지연은 그대로, 페이드만 없음'이 저절로 된다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 경합·로딩 표시 E2E 2건

**Files:**
- Modify: `apps/desktop/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: Task 2의 `isCurrent()` 배선 · Task 4의 `data-testid="panel-pending"`.

- [x] **Step 1: 테스트를 쓴다**

```ts
/**
 * E14a — 파일 사이를 빠르게 옮겨 다녀도 마지막에 고른 파일의 diff가 남는다.
 *
 * 전역 직렬화(busy 재진입 거부)를 빼면서 조회가 겹칠 수 있게 됐다. 그 대가로 새 위험이 열렸다:
 * 늦게 끝난 조회가 먼저 끝난 최신 조회를 덮으면 **누른 것과 다른 파일의 diff가 남는다.**
 * runRead의 isCurrent()가 그걸 막는다(run-guard.ts 주석 참조). 이 테스트는 사용자가 실제로 하는
 * 행동(목록을 훑으며 연달아 클릭)으로 그 경로를 태운다.
 *
 * 단위 테스트(test/run-guard.test.ts)가 지연을 수동으로 뒤집어 이 규칙을 정밀하게 고정하고,
 * 여기서는 실제 앱에서 배선이 이어져 있는지를 본다.
 */
test('E14a — 파일을 연달아 빠르게 눌러도 마지막 파일의 diff가 남는다', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'git-gui-e14a-race-'))
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const names = ['a.txt', 'b.txt', 'c.txt', 'd.txt']
  try {
    await execGitOrThrow(['init', '-b', 'main'], { cwd: repo })
    await execGitOrThrow(['config', 'user.email', 'e2e@example.com'], { cwd: repo })
    await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: repo })
    // 파일마다 크기를 다르게 둔다 — 조회 시간이 갈려야 순서가 뒤집힐 여지가 생긴다
    for (const [index, name] of names.entries()) {
      await writeFile(join(repo, name), `base ${name}\n`.repeat(200 * (index + 1)))
    }
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow(['commit', '-m', 'init'], { cwd: repo })
    for (const [index, name] of names.entries()) {
      await writeFile(join(repo, name), `changed ${name}\n`.repeat(200 * (index + 1)))
    }

    const app = await electron.launch({
      args: [APP_ROOT],
      env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
    })
    try {
      const window = await app.firstWindow()
      await expect(window.getByTestId('file-unstaged-a.txt')).toBeVisible()

      // 큰 파일 → 작은 파일 순으로 기다리지 않고 연달아 누른다. 앞의 것이 더 오래 걸리므로,
      // isCurrent()가 없으면 마지막(a.txt)을 앞선 조회가 덮을 수 있다
      await window.evaluate((fileNames) => {
        for (const name of [...fileNames].reverse()) {
          ;(document.querySelector(`[data-testid="file-unstaged-${name}"]`) as HTMLElement).click()
        }
      }, names)

      // 마지막으로 누른 것은 a.txt다 — 조회가 전부 끝난 뒤에도 그대로여야 한다
      await expect(window.getByTestId('diff-panel')).toContainText('a.txt')
      await expect
        .poll(async () => window.getByTestId('diff-panel').textContent(), { timeout: 3000 })
        .toContain('a.txt')
      for (const other of names.slice(1)) {
        await expect(window.getByTestId('diff-panel')).not.toContainText(other)
      }
    } finally {
      await app.close()
    }
  } finally {
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E14a — 로딩 표시는 느린 조회에만 배어난다.
 * 빠른 조회(실측 29ms)는 --motion-pending-delay(400ms) 안에 끝나 한 프레임도 보이지 않는다.
 *
 * 시간에 의존하므로 고정 sleep 대신 재측정으로 짠다. "느림"은 토큰을 잠시 0으로 만들어
 * 흉내내지 않는다 — 그러면 지연 자체를 검증하지 못한다. 대신 지연이 실제로 걸려 있는지를
 * computed style로 확인하고, 빠른 조회에서 스피너가 보이지 않음을 단언한다.
 */
test('E14a — 빠른 조회에서는 로딩 표시가 보이지 않는다', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'git-gui-e14a-pending-'))
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  try {
    await execGitOrThrow(['init', '-b', 'main'], { cwd: repo })
    await execGitOrThrow(['config', 'user.email', 'e2e@example.com'], { cwd: repo })
    await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: repo })
    for (const name of ['a.txt', 'b.txt']) await writeFile(join(repo, name), 'base\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow(['commit', '-m', 'init'], { cwd: repo })
    for (const name of ['a.txt', 'b.txt']) await writeFile(join(repo, name), 'changed\n')

    const app = await electron.launch({
      args: [APP_ROOT],
      env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
    })
    try {
      const window = await app.firstWindow()
      await window.getByTestId('file-unstaged-a.txt').click()
      await expect(window.getByTestId('diff-panel')).toContainText('a.txt')

      // 클릭 직후부터 rAF로 스피너의 실제 불투명도를 표본한다
      const samples = await window.evaluate(async () => {
        const opacities: number[] = []
        let running = true
        const tick = () => {
          const spinner = document.querySelector('[data-testid="panel-pending"]')
          opacities.push(spinner === null ? -1 : Number(getComputedStyle(spinner).opacity))
          if (running) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
        ;(document.querySelector('[data-testid="file-unstaged-b.txt"]') as HTMLElement).click()
        await new Promise((resolve) => setTimeout(resolve, 600))
        running = false
        return opacities
      })

      const visible = samples.filter((value) => value > 0.05)
      expect(
        visible.length,
        `빠른 조회에서 스피너가 보였다 — 불투명도 표본 ${samples.join(',')}`,
      ).toBe(0)

      // 지연이 실제로 토큰 값으로 걸려 있는지 — 위 단언이 "스피너가 아예 없어서" 통과하는 걸 막는다
      const delay = await window.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--motion-pending-delay').trim(),
      )
      expect(delay).toBe('400ms')
    } finally {
      await app.close()
    }
  } finally {
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
```

> **왜 "쓰기 중 조회"를 E2E로 안 재는가:** 그러려면 쓰기를 진행 중 상태로 붙잡아야 하는데,
> 플랜 작성 시점에 확인한 결과 렌더러는 스토어를 전역으로 노출하지 않는다
> (`window.gitApi`·`window.hostingApi`·`window.windowApi`만 있다). 그걸 재려고 **프로덕션 코드에
> 테스트 전용 전역을 새로 심지 않는다.** 스펙 §2-4의 동시성 결정은 Task 1의 단위 테스트
> ("runWrite 중에도 조회는 시작된다")가 이미 정확히 고정하고 있고, 그게 더 나은 자리다.
> 여기 E2E는 대신 **새로 열린 위험(늦게 온 응답이 최신을 덮는 것)**을 실제 앱에서 태운다.

- [x] **Step 2: 통과를 확인한다**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm --filter @git-gui/desktop e2e
```
Expected: **123 passed** (121 + 2)

- [x] **Step 3: 반증한다**

두 건 각각 무력화한다.

1. `--motion-pending-delay`를 `0ms`로 바꾸고 **재빌드해서** 실행 → "빠른 조회에서는 보이지 않는다"가
   빨개져야 한다.
2. `run-guard.ts`의 `isCurrent`를 `() => true`로 고정하고 **재빌드해서** 실행 → "연달아 빠르게
   눌러도 마지막 파일" 이 빨개져야 한다.

**2번이 빨개지지 않을 수 있다** — 실제 조회가 전부 빨라 순서가 실제로는 안 뒤집힐 수 있다.
그 경우 이 E2E는 "경합을 잡는 테스트"가 아니라 "배선이 이어져 있음을 보는 테스트"로 격하되므로,
**그 사실을 그대로 보고하고 플랜 실행 기록에 적는다.** 통과했다고 검출력이 있다고 말하지 않는다
(단위 테스트가 지연을 수동으로 뒤집어 재는 쪽이 실제 검출력을 갖는다).

원복 후 다시 통과를 확인한다. 빨강/초록 출력을 그대로 붙인다.

- [x] **Step 4: 커밋**

```bash
cd "/Users/sangyeop_kim/git gui"
git add apps/desktop/e2e/smoke.spec.ts
git commit -m "test(desktop): E14a 동시성·로딩 표시 E2E 2건

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: 최종 게이트 · 스크린샷 · 실행 기록

**Files:**
- Modify: `docs/superpowers/plans/2026-07-30-e14a-busy-scope.md` (이 파일 — 실행 기록 절 추가)
- Modify: `README.md` (해당하면)

- [x] **Step 1: 네 게이트를 전부 실행한다**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm typecheck
cd "/Users/sangyeop_kim/git gui" && pnpm test
cd "/Users/sangyeop_kim/git gui" && pnpm --filter @git-gui/desktop build
cd "/Users/sangyeop_kim/git gui" && pnpm --filter @git-gui/desktop e2e
```
Expected: 6/6 · **578** · 성공 · **123**

- [x] **Step 2: 수정 후 실측을 다시 잰다**

Task 3의 두 테스트가 이미 0을 단언하지만, 스펙 §1의 표와 나란히 놓을 "수정 후" 숫자를
같은 방식(구역별 MutationObserver)으로 한 번 더 재서 실행 기록에 표로 남긴다.

- [x] **Step 3: 스크린샷 2장**

Playwright 창 캡처로만 찍는다(OS 전체 화면 금지). 스크래치패드 경로에 쓴다:
- `e14a-1-pending-spinner.png` — 느린 조회에서 스피너가 배어난 순간(지연 토큰을 임시로 늘려 촬영하고, 촬영용 변경은 커밋하지 않는다)
- `e14a-2-writing-locked.png` — 진짜 쓰기 작업 중에는 지금처럼 전역이 잠긴다는 증거

- [x] **Step 4: 실행 기록을 쓴다**

이 플랜 말미에 「실행 기록」절을 추가한다. 반드시 담을 것:
- 플랜과 다르게 구현한 모든 편차와 그 이유
- Task 2 Step 4에서 "조회 시작 시 화면을 비우는 `set()`"을 발견해 삭제했다면 어느 액션인지
- Task 5의 `__store` 접근이 실패해 테스트를 바꿨다면 무엇으로 바꿨는지
- 각 반증의 빨강/초록 출력
- 최종 게이트 숫자
- 수정 전/후 실측 대조표

- [x] **Step 5: 커밋**

```bash
cd "/Users/sangyeop_kim/git gui"
git add docs/superpowers/plans/2026-07-30-e14a-busy-scope.md README.md
git commit -m "docs: E14a 플랜 실행 기록 — 편차·반증·최종 게이트

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 후속 노트 (이 에픽에서 하지 않음 — 스펙 §4)

- **구독 셀렉터화·`React.memo`** — App이 셀렉터 없이 스토어 전체를 구독(`App.tsx:95`)하고 셀렉터 사용처가 0건이라 모든 스토어 변경이 전체 트리를 리렌더한다. 깜빡임의 원인은 아니었지만(헤더 텍스트 변경 0 · 속성만 30) 리렌더 비용은 남아 있다.
- **E14b — eslint + Rules of React + React Compiler.** `HistoryPanel.tsx:204`의 렌더 중 ref 쓰기는 E7i 리뷰가 실측 재현으로 잡은 버그의 가드라 조심해서 다뤄야 한다. eslint 설정이 저장소에 아예 없어 `eslint-disable react-hooks/exhaustive-deps` 16곳이 한 번도 검사된 적 없다.
- **좌측 `name`×36 · `type`×18 속성 처닝** — 파일 클릭 시 잡히는 별개 냄새(입력 요소 속성 재설정 — key 불안정이나 react-aria id 재생성 의심). 원인이 달라 별도 조사가 필요하다.

---

## 실행 기록 (2026-07-31)

> 이 절이 E14a의 정본이다. 플랜 본문은 "하려던 것", 이 절은 **실제로 한 것과 왜 달라졌는지**다.
> 뒤에 오는 작업은 본문이 아니라 여기를 먼저 읽는다.

### 최종 게이트 (Task 6에서 전부 재실행)

| 게이트 | 명령 | 시작 시점 | 결과 |
| --- | --- | --- | --- |
| 타입 | `pnpm typecheck` | 6/6 | **6/6** |
| 단위 | `pnpm test` | 562 | **580 passed (48 files)** |
| 빌드 | `pnpm --filter @git-gui/desktop build` | 성공 | **성공** |
| E2E | `pnpm --filter @git-gui/desktop e2e` | 119 | **123 passed (2.9m)** |

단위 +18의 내역: Task 1의 `run-guard` 16건 + `toErrorMessage` 회귀 2건.
**플랜 Task 6 Step 1이 적은 기대치 578은 틀렸다** — 그 2건을 세지 않은 숫자다(아래 Task 1 편차 참조).

### 수정 전/후 실측 대조표

`MutationObserver`를 구역별(`.app__header` · `.app__left` · `.app__right` · `.app__center`)로 붙이고
속성·텍스트·노드를 전부 세는, 스펙 §1과 같은 계측기다.

**편차 — 스펙 §1의 숫자를 그대로 "수정 전" 열에 쓰지 않았다.** §1은 사용자의 실제 저장소에서 잰
값이고 Task 6은 E2E 픽스처(파일 2개·40~50줄)에서 잰다. 픽스처가 다르면 절대값이 달라져
나란히 놓으면 거짓말이 된다. 그래서 **같은 픽스처에서 `runRead`에 `set({busy:true/false})`를
임시로 되돌려 수정 전 동작을 재현**해 한 번 더 쟀다(Task 3 반증과 같은 변이). 재현값이 §1과
얼마나 맞는지도 함께 적는다.

**파일 A → 파일 B 클릭 1회**

| 구역 | 수정 전(같은 픽스처 재현) | 수정 후 | 스펙 §1(사용자 저장소) |
| --- | --- | --- | --- |
| 헤더 | 속성 **30** (`disabled`×10 · `tabindex`×10 · `data-disabled`×10) | **0** | 속성 30 — 내역까지 동일 |
| 좌측 | 텍스트 **2**("작업 중이에요"→"스테이지에 올린 파일이 없어요") · 속성 39(`disabled`×10 · `name`×18 · `type`×9 · `class`×2) | 텍스트 **0** · 속성 **29**(`name`×18 · `type`×9 · `class`×2) | 텍스트 2 · 속성 78 |
| 우측 | 속성 **2** (`disabled`×2) | **0** | 속성 2 |
| 가운데 | 텍스트 1 · 노드 59 · 속성 62(`style`×55 · `data-tooltip`×1 · `disabled`/`tabindex`/`data-disabled` 각 2) | 텍스트 1 · 노드 59 · 속성 **56**(`style`×55 · `data-tooltip`×1) | 텍스트 1 · 노드 5 · 속성 10 |

**외부 저장(에디터가 파일을 쓰기만 함) 1회**

| 구역 | 수정 전(재현) | 수정 후 | 스펙 §1-2 |
| --- | --- | --- | --- |
| 헤더 | 속성 **30** (세 속성 기준) | **0** | 30(세 속성) / 20(두 속성) |
| 좌측 | 텍스트 3("작업 중이에요" 포함) · 노드 5 · 속성 19(`disabled`×3 포함) | 텍스트 **1**("1") · 노드 5 · 속성 **16**(`disabled` **0**) | 좌측 변형 6 |
| 우측 | 속성 2 | **0** | — |
| 가운데 | 0 | **0** | — |

읽어야 할 것:

- **헤더·우측은 두 시나리오 모두 정확히 0이 됐다.** 사용자가 제보한 "헤더부터 사이드바 전체가
  깜빡인다"의 직접 원인(`busy`발 `disabled`/`tabindex`/`data-disabled` 토글)이 사라졌다.
- **좌측에서 사라진 건 `disabled` 계열과 "작업 중이에요" 텍스트뿐**이다. 남은
  `name`×18 · `type`×9 · `class`×2는 **수정 전에도 같은 수**였다 — 즉 E14a가 줄인 것이 아니라
  애초에 다른 원인의 처닝이다. 후속 노트의 "좌측 `name`·`type` 속성 처닝" 항목이 이 실측으로
  독립 사안임이 확정됐다(플랜 작성 시점엔 추정이었다).
- **가운데의 감소분 6 = `disabled`/`tabindex`/`data-disabled` 각 2**다. 가운데 패널의 자기 툴바
  버튼도 남의 조회 때문에 잠겼다 풀리고 있었다. 나머지(노드 59 · `style`×55)는 diff를 실제로
  b.txt로 갈아 끼우는 정당한 일이고 **픽스처 크기에 비례**한다 — §1의 5/10과 절대값이 다른 건
  그 때문이지 회귀가 아니다. 가운데 열은 시나리오 간 비교용이 아니라 "여기만 바뀌어야 한다"의
  확인용으로만 읽어야 한다.

### 편차 — 플랜과 다르게 간 것 전부

#### Task 1 — `run-guard` 모듈

- **플랜 Step 5의 반증 예상이 틀렸다.** "카운터 2건 빨강"은 실제 **1건**, "늦은 응답 3건"은 실제
  **2건**이었다. 원인을 규명한 뒤(한 단언이 다른 단언에 이미 포함돼 있었다) 변이 **A2(감소만 삭제)**
  와 **C(`readSeq`를 대상별이 아니라 전역 하나로)** 를 추가 설계해 **16건 전부의 검출력**을 확인했다.
  "예상보다 적게 빨개졌으니 통과"로 넘기지 않았다.
- **플랜이 지어낸 `toMessage`가 결함이었다.** 그 함수는 Electron IPC 래핑 접두사를 벗기지 않아,
  그대로 뒀으면 스토어 액션 전체의 오류 문구가 나빠질 뻔했다("저장할 게 없어요" →
  `Error invoking remote method 'git:commit': Error: 저장할 게 없어요`). 기존 `toErrorMessage`를
  `run-guard`로 옮겨 해결하고(`d3c65ce`) 회귀 테스트 2건을 더했다 — 이것이 578이 아니라 580인 이유다.

#### Task 2 — 스토어 전환

- **`guard` 호출은 50개가 아니라 65개**(쓰기 50 · 조회 15). 플랜 초안의 grep이 단일행 호출만 세고
  다중행 조회 호출을 놓쳤다. 스펙·플랜 정정 `ab667ce`.
- **`WATCH_SUPPRESS_MS` 재export를 삭제했다.** 플랜은 "다른 곳이 여기서 가져다 쓴다"고 적었지만
  실제 importer는 **0곳**인 죽은 export였다 — 근거 없는 추측이었다.
- **`refreshPulls`의 결과 `set()`은 하나가 아니라 둘이다.** `catch`의 `set({pulls: null})`도 결과를
  쓰므로 둘 다 `isCurrent()`로 지켰다.
- **`revealHead`의 결과 `set()`은 for 루프 안**이라 플랜이 열거한 세 유형 어디에도 없었다.
- **`openPullDetail`의 최대 5초 `busy` 대기 루프를 삭제했다**(`b3693cf`). 그 루프는 "조회가 전역
  busy를 잡아 첫 클릭이 삼켜진다"는 병리의 우회책이었고, E14a가 그 병리 자체를 없앴다. 남겨두면
  스펙 §2-4("쓰기 중에도 조회는 허용")를 정면으로 어긴다.
- **`refresh`/`externalRefresh`는 `set()` 객체 리터럴 안에 `await`가 섞여 있었다.** 원래 평가 순서를
  보존하며 폈다. `hostingStatus`가 여전히 매번 무조건 조회된다는 점도 확인했다(의도 유지).
- **`StoreSet`/`StoreGet` 타입 별칭이 죽어 삭제**했고, 사라진 `guard`를 가리키던 **주석 13곳을 정정**
  했다(그중 2곳은 내용까지 거짓이 돼 있었다).

#### Task 2 보완 — e2e 2건 실패, 그리고 그것이 드러낸 것

- **`busy`는 표시가 아니라 재진입 차단기이기도 했다.** `HistoryPanel:271`의 "바닥에 닿으면 더
  불러오기" 이펙트는 `onLoadMore`가 매 렌더 새 참조라 **원래부터 렌더마다 재발화**하고 있었고,
  `!busy`만이 그 사슬을 끊고 있었다. 조회가 `busy`를 안 켜자 무한 렌더 루프 → React error #185로
  우측 열이 통째로 언마운트됐다. `!pending`으로 차단기를 복원하고 **스펙 §2-4-1을 신설**했다
  (`ab3a9b7`, 수정 `2248be0`). 이 패턴이 저장소에 이 한 곳뿐임을 전수 확인했다.
- **E10 포커스 테스트 실패는 회귀가 아니라 계측 도구의 소실이었다.** 그 테스트는 새로고침 버튼의
  `disabled` 토글로 재조회 횟수를 셌는데, 그 토글이 바로 이 에픽이 없애는 대상이다. 대체 계측으로
  제안된 `window.gitApi` 래핑은 **불가능**했다 — contextBridge가 deep-freeze하며
  (`writable:false` · `configurable:false`), 게다가 경로가 `gitApi.status`가 아니라 `gitApi.repo.status`다.
  대신 **main 프로세스에서 `repo:status` IPC 핸들러를 감싸** 셌다. `ipcMain._invokeHandlers`는
  Electron 내부 필드라 업그레이드 시 깨질 수 있으나, `patched` 단언을 둬서 **조용히 통과하는 대신
  명시적으로 실패**한다.

#### Task 3 — 깜빡임 회귀 E2E

- **`data-testid="diff-panel"`은 빈 상태 패널에도 붙어 있다**(`DiffPanel.tsx:36`). 플랜의 사전조건
  `toBeVisible()`은 부팅 즉시 참이라, 측정이 "선택 없음 → 첫 파일"에서 시작될 수 있었다 — 그건
  이 테스트가 **명시적으로 피하려던 케이스**다(좌측 행 액션이 정당하게 활성화된다). `toContainText('a.txt')`로 교체.
- **플랜의 정착 대기가 공허했다.** `.ui-pending` 개수를 폴링했는데 **그 클래스는 Task 4에서야 생긴다** —
  항상 0이라 아무것도 기다리지 않았다. "직전 간격 동안 변형 0"이 될 때까지 폴링하는 방식으로 교체.
- **외부 저장 기준값은 20이 아니라 30**이다(스펙의 20은 속성 2개, 테스트는 3개 기준). 정정 `599fa1c`.

#### Task 4 — 로딩 표시

- **플랜의 `margin-left: auto`가 결함이었다.** `.ui-panel__head > .ui-button:first-of-type`에 이미 같은
  규칙이 있어 자동 여백이 둘이 되면 남은 공간을 반씩 나눈다 — 실측으로 `diff-close` 버튼의 x좌표가
  **703 → 637로 66px 밀렸다 돌아왔다**. 로딩 표시가 이 에픽이 없애려는 깜빡임을 새로 만들 뻔했다.
  절대 배치로 흐름에서 빼 해결.
- **`data-testid="panel-pending"`을 패널 7개가 공유한다** → 이후 테스트는 반드시 패널로 스코프해야 한다.
- 개별 패널 컴포넌트는 `pending: boolean`(필수), `Panel`은 `pending?: boolean`(선택)으로 갈랐다 — 의도적 편차.

#### Task 5 — 경합·로딩 표시 E2E

- **플랜의 불투명도 단언은 구조적으로 실패할 수 없었다.** 빠른 조회에서 스피너는 정확히 한 프레임만
  DOM에 살고, `rAF` 콜백은 페인트 전이라 **지연이 0ms여도 computed opacity가 0**이다. 검출력 0.
  "스피너가 한 프레임이라도 붙었는가" + "스피너 **자신의** `animation-delay`가 `0.4s`인가"
  두 단언으로 교체하고 각각 반증했다.
- 플랜의 `panel-pending` 셀렉터가 미스코프였다.
- 테스트 1에 동기화가 없어 "아직 안 덮었을 뿐"인 상태를 통과로 오독할 수 있었다.
- **테스트 1의 픽스처 크기(선형 200·400·600·800)로는 검출력이 1/3**이었다 → 세제곱(200·1600·5400·12800)
  으로 벌려 5/5. 크기 차가 줄면 검출력이 즉시 떨어지므로, **경합의 정밀한 고정은 단위 테스트의 몫**이고
  이 E2E는 배선 확인용이라는 것을 테스트 주석에 남겼다.

#### Task 6 — 최종 게이트

- 플랜 Step 1의 단위 기대치 **578은 580으로 정정**(Task 1 참조).
- 수정 후 실측을 스펙 §1과 그대로 대조하지 않고 **같은 픽스처에서 수정 전을 재현해 나란히** 쟀다
  (위 대조표의 편차 문단).
- 스크린샷 2장은 **임시 소스 변이**로 찍었고 **커밋하지 않았다**(아래).
- 계측·촬영용 스펙 2개(`e2e/e14a-measure.spec.ts` · `e2e/e14a-shot.spec.ts`)는 찍은 뒤 삭제했다.
  저장소에 남는 검증은 회귀 E2E 4건과 단위 16건이다.
- **README를 갱신했다** — 이 저장소의 README는 에픽마다 사용자가 체감하는 변화를 한 문장씩
  덧붙이는 형식이고, E14a는 눈에 보이는 동작 변화라 해당한다.

### 반증 요약

| 대상 | 변이 | 결과 |
| --- | --- | --- |
| `run-guard` 단위 16건 | 카운터 증감 삭제 / 감소만 삭제(A2) / `isCurrent`를 `()=>true` / `readSeq` 전역 하나(C) | 네 변이의 합으로 **16건 전부** 검출력 확인 (플랜 예상 2·3건은 실제 1·2건 — 규명 후 변이 추가) |
| 깜빡임 회귀 E2E 2건 | `runRead`에 `busy` 토글 복원 + 재빌드 | 둘 다 빨강. **Task 6에서 같은 변이를 다시 태워 헤더 30건을 재현**했고, 그 내역이 스펙 §1의 `disabled`×10·`tabindex`×10·`data-disabled`×10과 정확히 일치했다 |
| 경합 E2E | `isCurrent`를 `()=>true` + 재빌드 | 5/5 빨강 (단, 픽스처 크기를 세제곱으로 벌린 뒤. 선형에선 1/3) |
| 로딩 표시 E2E | `--motion-pending-delay`를 `0ms` + 재빌드 | 교체 전 단언은 **초록(검출력 0)** → 단언 자체를 교체. 교체 후 각각 빨강 |

### 증거 스크린샷

`/private/tmp/claude-501/-Users-sangyeop-kim-git-gui/b4ef6d32-042d-440c-8252-b8944659aa01/scratchpad/`
(Playwright 창 캡처만 — OS 전체 화면 금지)

- **`e14a-1-pending-spinner.png`** — 느린 조회에서 스피너가 배어나는 순간. `runRead`에 임시로
  2500ms 지연을 넣고 클릭 후 455ms에 캡처했다(캡처 직전 computed opacity **0.835**, 직후 1 —
  400ms 지연이 끝나고 150ms 페이드가 도는 한가운데다). 이 장면이 동시에 증명하는 것:
  헤더·좌측·우측 컨트롤이 **전부 살아 있고**, 커밋 컴포저는 "작업 중이에요"가 아니라
  "스테이지에 올린 파일이 없어요"이며, 가운데는 **아직 a.txt의 diff를 그대로 들고 있다**
  (스펙 §2-3 "조회 중에도 이전 내용을 그대로 둔다").
- **`e14a-2-writing-locked.png`** — 진짜 쓰기(스테이지에 올리기) 진행 중. `runWrite`에 임시로
  1500ms 지연을 넣고 250ms에 캡처했다. **헤더 컨트롤 5개가 비활성**이고 커밋 상태 슬롯이
  **"작업 중이에요"**다 — E14a가 전역 잠금을 **없앤 것이 아니라 쓰기로 좁힌 것**임의 증거다.

두 임시 변이는 촬영 직후 `git checkout`으로 되돌리고 재빌드해 작업 트리를 깨끗이 했다.

### 후속 (E14a 범위 밖)

- **구독 셀렉터화 · `React.memo`** — App이 `App.tsx:95`에서 셀렉터 없이 스토어 전체를 구독한다.
  깜빡임의 원인은 아니었지만(헤더 텍스트 변경 0 · 속성만 30) 리렌더 비용은 그대로 남아 있다.
- **E14b — eslint 도입 + Rules of React 위반 수정 + React Compiler.** 저장소에 eslint 설정이 아예
  없어 `eslint-disable react-hooks/exhaustive-deps` **16곳이 한 번도 검사된 적이 없다**.
  `HistoryPanel.tsx`의 렌더 중 ref 쓰기는 E7i 리뷰가 실측으로 잡은 버그의 가드라 조심히 다뤄야 한다.
  **E14a가 근거 하나를 더했다: `onLoadMore`가 매 렌더 새 참조인 것이 무한 루프의 연료였다** —
  React Compiler가 있었으면 안정 참조가 됐을 자리다.
- **`apps/desktop/tsconfig.json`의 `include`가 `["src"]`뿐**이라 `apps/desktop/test/**`가 타입 검사를
  전혀 안 받는다. `packages/*/test/**`는 `tsconfig.base.json`에 포함돼 있어 대칭이 깨져 있다.
- **좌측 `name`×18 · `type`×9 속성 처닝** — 위 대조표에서 **수정 전후가 동일**함이 확인된 별개 냄새다
  (입력 요소 속성 재설정 — key 불안정이나 react-aria id 재생성 의심). 원인이 달라 별도 조사가 필요하다.
