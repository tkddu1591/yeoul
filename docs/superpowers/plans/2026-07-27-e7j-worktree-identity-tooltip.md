# E7j 워크트리 정체성 + 공용 툴팁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 워크트리 행이 어느 것인지·어디 있는지·무엇에서 갈라졌는지 한눈에 보이게 하고, 앱의 네이티브 `title` 툴팁을 공용 Tooltip 컴포넌트로 통일한다.

**Architecture:** 표시 규칙은 전부 순수 함수(`worktree-label.ts`·`tooltip-position.ts`)로 분리하고 컴포넌트는 렌더만 한다. Tooltip은 cloneElement로 트리거에 이벤트·`aria-describedby`·`data-tooltip`을 붙이고 카드는 body 포털로 띄운다. 분기점은 엔진 `worktrees.forkPoint`를 호버 시점에만 부르고 `경로+HEAD` 키로 store에 캐시한다.

**Tech Stack:** 기존과 동일(Electron·React·zustand·vitest·Playwright). **신규 의존성 없음**.

**Branch:** `feature/e7j-worktree-identity` (main 1c15318 이후에서 생성)

**게이트 기준선:** 루트 테스트 **486**, desktop e2e **87**(smoke 81 + hosting 6). 태스크마다 "+N(실측 정정)"으로 누적하고, 실측이 다르면 구현자가 편차 보고·컨트롤러가 표를 정정한다(E7g~E7i 관례).

## 사전 실측 (플랜 작성 시 확인 — 재확인 불요)

1. **네이티브 DOM `title`은 19곳**(스펙의 "41곳"은 컴포넌트 prop(Panel·ConfirmDialog·PromptDialog·ListDialog의 `title=`)까지 센 오산 — **스펙 정정 대상**). 전수 목록은 Task 3에 박아 두었다.
2. **desktop 테스트는 전부 순수 함수 테스트** — `apps/desktop/test/`에 jsdom·@testing-library가 없다(설정도 없음). 따라서 **스펙의 "컴포넌트 단위(jsdom)" 항목은 채택하지 않는다**: Tooltip의 위치 계산·표시 판정을 순수 함수로 분리해 단위 테스트하고, 실제 hover·ESC·aria는 E2E로 검증한다(코드베이스 관례 유지, 신규 의존성 0). **스펙 편차로 기록.**
3. **기준 브랜치 결정**: `git symbolic-ref refs/remotes/origin/HEAD` → 있으면 `refs/remotes/origin/main` 형태 반환(실측), 없으면 `fatal: ref ... is not a symbolic ref`로 실패 → `main` → `master` 순으로 `rev-parse --verify -q`.
4. **앞섬/뒤처짐**: `git rev-list --left-right --count <base>...HEAD` → `0\t0` 형식(탭 구분, 왼쪽=base만 가진 수=behind, 오른쪽=내 쪽=ahead).
5. **WorktreesPanel은 가상화를 쓰지 않는다**(`worktrees.map` 직접 렌더) — 두 줄 전환이 `estimateSize`에 영향 없음.
6. **E2E가 `title` 속성을 단언하는 곳 4개**: smoke.spec.ts `1316`·`1353`·`1500`(브랜치 행 `/지금 여기/`)·`1658`(워크트리 행 `/지금 여기/`).

**플랜 명시 미확정(실독·같은 취지·편차 보고):** worktree-open-guard·assertWorktreePath의 정확한 함수명·위치(Task 5 핸들러 검증에 재사용), `WorktreeInfo` 필드(headHash 유무), store의 `worktrees` 상태 갱신 지점, smoke.spec.ts 헬퍼 관례(무인자 `createRepoWithChange()`·`GIT_GUI_E2E_REPO` env·`GIT_GUI_USER_DATA` 격리).

---

### Task 1: `worktree-label.ts` 순수 함수

**Files:**
- Create: `apps/desktop/src/renderer/src/components/worktree-label.ts`
- Test: `apps/desktop/test/worktree-label.test.ts`

- [x] **Step 1: Red — 단위 테스트.** `apps/desktop/test/worktree-label.test.ts` 신규:

```ts
import { describe, expect, it } from 'vitest'
import {
  shortenBranch,
  shortenParent,
  sourceChip,
  uniqueNames,
} from '../src/renderer/src/components/worktree-label'

const HOME = '/Users/me'

describe('shortenParent', () => {
  it('홈 바로 아래면 ~ 하나로 줄인다', () => {
    expect(shortenParent(`${HOME}/dataworks-frontend`, HOME)).toBe('~/')
  })

  it('깊은 경로는 앞을 버리고 뒤 조각을 살린다(구분되는 세션 폴더 보존)', () => {
    expect(shortenParent(`${HOME}/.claude/worktree/goofy-lalande/dataworks-frontend`, HOME)).toBe(
      '…/worktree/goofy-lalande/',
    )
  })

  it('홈 밖 경로는 ~ 축약 없이 뒤 조각을 살린다', () => {
    expect(shortenParent('/Volumes/ext/projects/repo-a/wt', HOME)).toBe('…/projects/repo-a/')
  })

  it('한 조각짜리 경로는 그대로 둔다', () => {
    expect(shortenParent('/repo', HOME)).toBe('/')
  })
})

describe('sourceChip', () => {
  it('홈 아래 dot 폴더는 그 이름이 출처다', () => {
    expect(sourceChip(`${HOME}/.claude/worktree/x/repo`, HOME)).toBe('.claude')
    expect(sourceChip(`${HOME}/.codex/worktree/x/repo`, HOME)).toBe('.codex')
  })

  it('홈 바로 아래는 "내 폴더"다', () => {
    expect(sourceChip(`${HOME}/dataworks-frontend`, HOME)).toBe('내 폴더')
  })

  it('홈 밖은 최상위 폴더 이름이다', () => {
    expect(sourceChip('/Volumes/ext/projects/repo', HOME)).toBe('Volumes')
  })
})

describe('uniqueNames', () => {
  it('겹치지 않으면 짧은 이름을 유지한다', () => {
    const names = uniqueNames([`${HOME}/alpha`, `${HOME}/beta`])
    expect(names.get(`${HOME}/alpha`)).toBe('alpha')
    expect(names.get(`${HOME}/beta`)).toBe('beta')
  })

  it('겹치면 구분되는 조상 폴더를 앞에 붙인다', () => {
    const a = `${HOME}/.claude/worktree/goofy/repo`
    const b = `${HOME}/.codex/worktree/pivot/repo`
    const names = uniqueNames([a, b])
    expect(names.get(a)).toBe('goofy/repo')
    expect(names.get(b)).toBe('pivot/repo')
  })

  it('조상 한 단계로도 안 갈리면 더 붙인다', () => {
    const a = `${HOME}/.claude/worktree/s/repo`
    const b = `${HOME}/.codex/worktree/s/repo`
    const names = uniqueNames([a, b])
    expect(names.get(a)).toBe('.claude/worktree/s/repo')
    expect(names.get(b)).toBe('.codex/worktree/s/repo')
  })
})

describe('shortenBranch', () => {
  it('짧으면 그대로 둔다', () => {
    expect(shortenBranch('main', 20)).toBe('main')
  })

  it('길면 앞을 생략해 뒤(구분 정보)를 살린다', () => {
    expect(shortenBranch('claude/dw-1051-work-review-final', 20)).toBe('…dw-1051-work-review')
  })
})
```

- [x] **Step 2: Red 확인** — `npx vitest run apps/desktop/test/worktree-label.test.ts` 실행, 모듈 없음으로 전건 실패 확인.

- [x] **Step 3: 구현.** `apps/desktop/src/renderer/src/components/worktree-label.ts` 신규:

```ts
/**
 * 워크트리 행 표시 규칙 (E7j) — 같은 이름 워크트리가 여럿일 때 어느 것인지, 어디에 있는지
 * 한눈에 보이게 하는 순수 함수들. codex·claude 계열 도구가 만드는
 * `~/.codex/worktree/<세션>/<저장소>` 구조에서 구분 정보가 경로 **가운데**에 있는 것이 설계 전제다.
 */

/** 경로를 세그먼트로 쪼갠다 — 빈 조각 제거 */
function segments(path: string): string[] {
  return path.split('/').filter((part) => part !== '')
}

/**
 * 행 2줄에 쓰는 부모 폴더 표기 — 홈은 `~`, 너무 길면 **앞을 버리고 뒤 조각을 살린다**
 * (가운데 생략은 구분 정보인 세션 폴더를 지운다). 항상 `/`로 끝난다.
 */
export function shortenParent(path: string, home: string, keep = 2): string {
  const parts = segments(path)
  const parentParts = parts.slice(0, -1)
  if (parentParts.length === 0) return '/'
  const homeParts = segments(home)
  const underHome =
    homeParts.length > 0 && homeParts.every((part, index) => parentParts[index] === part)
  const rest = underHome ? parentParts.slice(homeParts.length) : parentParts
  if (underHome && rest.length === 0) return '~/'
  if (rest.length <= keep) return `${underHome ? '~/' : '/'}${rest.join('/')}/`
  return `…/${rest.slice(-keep).join('/')}/`
}

/** 어느 도구·폴더가 만든 워크트리인지 — 홈 아래 dot 폴더면 그 이름, 홈 직속이면 "내 폴더" */
export function sourceChip(path: string, home: string): string {
  const parts = segments(path)
  const homeParts = segments(home)
  const underHome = homeParts.length > 0 && homeParts.every((part, index) => parts[index] === part)
  if (!underHome) return parts[0] ?? '/'
  const rest = parts.slice(homeParts.length)
  if (rest.length <= 1) return '내 폴더'
  return rest[0]!.startsWith('.') ? rest[0]! : '내 폴더'
}

/**
 * 행 이름 — 리프가 겹치면 구분되는 조상 폴더를 하나씩 붙여 유일해질 때까지 확장한다.
 * 겹치지 않는 워크트리는 짧은 이름을 유지한다(정보 소음 최소화)
 */
export function uniqueNames(paths: string[]): Map<string, string> {
  const names = new Map<string, string>()
  const partsOf = new Map(paths.map((path) => [path, segments(path)]))
  for (const path of paths) {
    const parts = partsOf.get(path)!
    let depth = 1
    let label = parts.slice(-depth).join('/')
    while (
      depth < parts.length &&
      paths.some((other) => other !== path && partsOf.get(other)!.slice(-depth).join('/') === label)
    ) {
      depth += 1
      label = parts.slice(-depth).join('/')
    }
    names.set(path, label)
  }
  return names
}

/**
 * 브랜치 이름 — 길면 **선행 네임스페이스**(`claude/`·`codex/`·`feature/`)를 생략한다.
 * 목록의 모든 워크트리가 접두를 공유하므로 그건 노이즈고, 구분 정보는 그 뒤에 있다.
 * (플랜 초판의 "문자열 뒤쪽 보존" 구현은 자기 테스트와 모순이었다 — 리뷰 판정으로 정정)
 */
export function shortenBranch(branch: string, max: number): string {
  if (branch.length <= max) return branch
  const slash = branch.indexOf('/')
  // 네임스페이스가 없으면 잘리는 쪽(꼬리)에 표시를 남긴다 — 앞에 …를 붙이면 거짓말이 된다
  if (slash === -1) return `${branch.slice(0, max - 1)}…`
  const rest = branch.slice(slash + 1)
  return `…${rest.length <= max - 1 ? rest : rest.slice(0, max - 1)}`
}
```

- [x] **Step 4: Green 확인** — `npx vitest run apps/desktop/test/worktree-label.test.ts` 전건 통과.

- [x] **Step 5: 게이트** — 루트 `pnpm test` → **486+12 = 498(실측 확정)**, `pnpm typecheck` 전부 Done.

- [x] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/components/worktree-label.ts apps/desktop/test/worktree-label.test.ts
git commit -m "feat(desktop): E7j 워크트리 표시 순수 함수 — 경로 뒤 조각 보존·출처 칩·이름 유일화

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 공용 Tooltip 컴포넌트

**Files:**
- Create: `apps/desktop/src/renderer/src/ui/tooltip-position.ts`
- Create: `apps/desktop/src/renderer/src/ui/Tooltip.tsx`
- Create: `apps/desktop/src/renderer/src/ui/tooltip.css`
- Test: `apps/desktop/test/tooltip-position.test.ts`

- [x] **Step 1: Red — 위치 계산 단위 테스트.** `apps/desktop/test/tooltip-position.test.ts` 신규:

```ts
import { describe, expect, it } from 'vitest'
import { placeTooltip } from '../src/renderer/src/ui/tooltip-position'

const VIEWPORT = { width: 1000, height: 800 }

describe('placeTooltip', () => {
  it('기본은 트리거 아래에 붙인다', () => {
    const place = placeTooltip(
      { top: 100, left: 200, width: 120, height: 24 },
      { width: 200, height: 80 },
      VIEWPORT,
    )
    expect(place.placement).toBe('bottom')
    expect(place.top).toBe(132) // 100 + 24 + gap 8
    expect(place.left).toBe(200)
  })

  it('아래 공간이 부족하면 위로 뒤집는다', () => {
    const place = placeTooltip(
      { top: 740, left: 200, width: 120, height: 24 },
      { width: 200, height: 80 },
      VIEWPORT,
    )
    expect(place.placement).toBe('top')
    expect(place.top).toBe(652) // 740 - 80 - gap 8
  })

  it('오른쪽으로 넘치면 뷰포트 안으로 민다', () => {
    const place = placeTooltip(
      { top: 100, left: 900, width: 60, height: 24 },
      { width: 300, height: 80 },
      VIEWPORT,
    )
    expect(place.left).toBe(692) // 1000 - 300 - margin 8
  })

  it('왼쪽으로 넘쳐도 최소 여백을 지킨다', () => {
    const place = placeTooltip(
      { top: 100, left: 2, width: 40, height: 24 },
      { width: 300, height: 80 },
      VIEWPORT,
    )
    expect(place.left).toBe(8)
  })

  it('위아래 모두 부족하면 공간이 더 큰 쪽을 고른다', () => {
    const place = placeTooltip(
      { top: 300, left: 100, width: 40, height: 24 },
      { width: 100, height: 700 },
      VIEWPORT,
    )
    // 아래 남은 공간 476 > 위 300 → bottom 유지
    expect(place.placement).toBe('bottom')
  })
})
```

- [x] **Step 2: Red 확인 후 구현.** `npx vitest run apps/desktop/test/tooltip-position.test.ts` 실패 확인 → `apps/desktop/src/renderer/src/ui/tooltip-position.ts` 신규:

```ts
/** 툴팁 배치 계산 (E7j) — 렌더와 분리된 순수 함수라 단위 테스트가 된다 */
export interface TooltipRect {
  top: number
  left: number
  width: number
  height: number
}

export interface TooltipPlacement {
  top: number
  left: number
  placement: 'top' | 'bottom'
}

const GAP = 8
const MARGIN = 8

export function placeTooltip(
  trigger: TooltipRect,
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = GAP,
): TooltipPlacement {
  const below = viewport.height - (trigger.top + trigger.height)
  const above = trigger.top
  // 아래가 기본 — 안 들어가면 위로 뒤집고, 둘 다 부족하면 더 넓은 쪽
  const fitsBelow = below >= tip.height + gap
  const placement: 'top' | 'bottom' = fitsBelow || below >= above ? 'bottom' : 'top'
  const top =
    placement === 'bottom' ? trigger.top + trigger.height + gap : trigger.top - tip.height - gap
  const maxLeft = viewport.width - tip.width - MARGIN
  const left = Math.max(MARGIN, Math.min(trigger.left, maxLeft))
  return { top, left, placement }
}
```

- [x] **Step 3: Tooltip 컴포넌트.** `apps/desktop/src/renderer/src/ui/Tooltip.tsx` 신규:

```tsx
import { cloneElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { placeTooltip, type TooltipPlacement } from './tooltip-position'
import './tooltip.css'

interface TooltipProps {
  /** 카드 본문 — 여러 줄·요소 가능 */
  content: ReactNode
  /**
   * 평문 한 줄 요약 — 트리거의 data-tooltip으로 남아 E2E가 hover 없이도 단언할 수 있다.
   * 접근성 이름이 따로 없는 트리거에서는 이 문구가 aria-describedby 대상이 된다
   */
  summary: string
  /** 트리거 — 단일 요소여야 한다(cloneElement로 이벤트·속성을 얹는다: 레이아웃 무영향) */
  children: ReactElement
  /** 마우스 지연(ms) — 포커스는 즉시 */
  delay?: number
}

/**
 * 공용 호버 툴팁 (E7j) — 네이티브 title을 대체한다.
 * title은 OS가 1초쯤 뒤에 스타일 없이 그려서 앱 톤과 어긋나고 여러 줄·강조를 못 쓴다.
 */
export function Tooltip({ content, summary, children, delay = 400 }: TooltipProps) {
  const id = useId()
  const [place, setPlace] = useState<TooltipPlacement | null>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const close = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = null
    setPlace(null)
  }

  const open = () => {
    const element = triggerRef.current
    if (element === null) return
    const rect = element.getBoundingClientRect()
    // 첫 배치는 대략치로 띄우고, 실제 크기를 잰 뒤 아래 이펙트가 보정한다
    setPlace(
      placeTooltip(
        { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        { width: 280, height: 80 },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    )
  }

  // 실제 카드 크기로 재배치 — 긴 경로 한 줄이 화면 밖으로 나가는 것 방지
  useEffect(() => {
    if (place === null) return
    const element = triggerRef.current
    const tip = tipRef.current
    if (element === null || tip === null) return
    const rect = element.getBoundingClientRect()
    const next = placeTooltip(
      { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      { width: tip.offsetWidth, height: tip.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    )
    if (next.top !== place.top || next.left !== place.left) setPlace(next)
    // place가 바뀔 때만 — 무한 보정을 막으려 좌표 동일하면 setState 안 한다
  }, [place])

  // 열려 있는 동안 스크롤·리사이즈·ESC는 즉시 닫는다 (트리거가 사라지는 상황 포함)
  useEffect(() => {
    if (place === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [place])

  useEffect(() => close, [])

  const trigger = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node
      const original = (children as { ref?: unknown }).ref
      if (typeof original === 'function') (original as (n: HTMLElement | null) => void)(node)
      else if (original !== null && typeof original === 'object')
        (original as { current: HTMLElement | null }).current = node
    },
    'data-tooltip': summary,
    'aria-describedby': place !== null ? id : undefined,
    onMouseEnter: (event: MouseEvent) => {
      timerRef.current = setTimeout(open, delay)
      ;(children.props as { onMouseEnter?: (e: MouseEvent) => void }).onMouseEnter?.(event)
    },
    onMouseLeave: (event: MouseEvent) => {
      close()
      ;(children.props as { onMouseLeave?: (e: MouseEvent) => void }).onMouseLeave?.(event)
    },
    onFocus: (event: FocusEvent) => {
      open()
      ;(children.props as { onFocus?: (e: FocusEvent) => void }).onFocus?.(event)
    },
    onBlur: (event: FocusEvent) => {
      close()
      ;(children.props as { onBlur?: (e: FocusEvent) => void }).onBlur?.(event)
    },
    onClick: (event: MouseEvent) => {
      close()
      ;(children.props as { onClick?: (e: MouseEvent) => void }).onClick?.(event)
    },
  } as Record<string, unknown>)

  return (
    <>
      {trigger}
      {place !== null &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className="ui-tooltip"
            style={{ top: place.top, left: place.left }}
            data-testid="tooltip"
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  )
}
```

- [x] **Step 4: CSS.** `apps/desktop/src/renderer/src/ui/tooltip.css` 신규(토큰 실명은 tokens.css 실독 — 없으면 유사 토큰 치환·편차 보고):

```css
/* E7j — 공용 호버 툴팁 카드. 네이티브 title 대체(앱 톤·여러 줄·즉시성) */
.ui-tooltip {
  position: fixed;
  z-index: 200;
  max-width: 420px;
  padding: var(--space-2) var(--space-3);
  background: var(--color-surface);
  color: inherit;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-2);
  font-size: var(--text-sm);
  line-height: 1.5;
  pointer-events: none;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.ui-tooltip__title {
  font-weight: 600;
}
.ui-tooltip__path {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.ui-tooltip__meta {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
```

- [x] **Step 5: 게이트** — `npx vitest run apps/desktop/test/tooltip-position.test.ts` 5건 통과, 루트 `pnpm test` → **+5(실측 정정)**, typecheck Done, `cd apps/desktop && npx electron-vite build` 성공.

- [x] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/ui/Tooltip.tsx apps/desktop/src/renderer/src/ui/tooltip-position.ts apps/desktop/src/renderer/src/ui/tooltip.css apps/desktop/test/tooltip-position.test.ts
git commit -m "feat(desktop): E7j 공용 Tooltip — 포털 카드·뒤집기/클램프 배치·aria-describedby·data-tooltip

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 2-보완: shortenBranch 꼬리 표시 + Tooltip 잔가지 (품질 리뷰 Important 1 + Minor 2)

품질 리뷰 판정: `shortenBranch`의 의미론은 **구현자가 맞다**(스펙 ①의 예시 `…/dw-1051-work-review` 자체가 네임스페이스 제거 결과 — 뒤 보존 알고리즘으로는 어떤 입력으로도 못 만든다). 플랜 구현 블록은 위에서 정정했다. 다만 그 알고리즘의 빈틈 1건과 Tooltip 잔가지 2건을 닫는다.

- **Important**: `/`가 없는 긴 브랜치는 `indexOf('/') === -1` → 원문 앞쪽을 남기면서 **앞에 `…`를 붙인다** — 자르지 않은 쪽에 생략 표시가 붙고 실제 잘린 꼬리는 무표기. 사용자가 제기한 불만("어디가 잘렸는지 몰라 구분이 안 된다")과 동종 결함.
- **Minor**: `Tooltip.tsx`의 `(children as { ref?: unknown }).ref`가 React 19의 deprecated 게터를 때린다(자식에 ref가 있으면 console.error) → `children.props`에서 읽는다. `onMouseEnter`가 기존 타이머를 clear하지 않아 hover→focus 조합에서 중복 open이 1회 돈다.

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/worktree-label.ts`
- Modify: `apps/desktop/test/worktree-label.test.ts`
- Modify: `apps/desktop/src/renderer/src/ui/Tooltip.tsx`

- [x] **Step 1: Red — 꼬리 표시 테스트 1건.** `shortenBranch` describe에 추가:

```ts
  it('네임스페이스가 없으면 잘린 꼬리 쪽에 표시를 남긴다', () => {
    const long = 'a-very-long-branch-name-without-any-namespace'
    const short = shortenBranch(long, 28)
    expect(short.endsWith('…')).toBe(true)
    expect(short.startsWith('…')).toBe(false)
    expect(short).toBe('a-very-long-branch-name-wit…')
  })
```

- [x] **Step 2: Red 확인 후 구현.** `worktree-label.ts`의 `shortenBranch`를 위(Task 1 Step 3) 정정본과 동일하게 만든다 — `slash === -1`이면 `` `${branch.slice(0, max - 1)}…` ``.

- [x] **Step 3: Tooltip 잔가지 2건.** `Tooltip.tsx`에서:
  - `const original = (children as { ref?: unknown }).ref` → `const original = (children.props as { ref?: unknown }).ref`
  - `onMouseEnter` 핸들러 첫 줄에 `if (timerRef.current !== null) clearTimeout(timerRef.current)` 추가.

- [x] **Step 4: 게이트** — `npx vitest run apps/desktop/test/worktree-label.test.ts` 13건 통과, 루트 `pnpm test` → **504**(503+1), typecheck Done, `cd apps/desktop && npx electron-vite build` 성공.

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/worktree-label.ts apps/desktop/test/worktree-label.test.ts apps/desktop/src/renderer/src/ui/Tooltip.tsx
git commit -m "fix(desktop): E7j 보완 — 네임스페이스 없는 긴 브랜치의 꼬리 생략 표시·Tooltip ref/타이머 잔가지

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Task 1·2 리뷰 후속 노트(기록만):** ① 네임스페이스 제거 후에도 잘리는 경우 꼬리가 무표기(JS가 이미 max로 맞춰 CSS ellipsis가 안 뜬다) — 양끝 표시(`…head…`)는 기대값 변경이 필요해 후속. ② 접두·앞부분이 같고 꼬리만 다른 형제 브랜치는 같은 축약이 될 수 있다(이 저장소 네이밍에서는 티켓·세션이 앞에 와 지배적으로 유리). ③ Task 3 리스크 예고: `aria-describedby` 무조건 덮어쓰기(현재 사용처 0), react-aria 모달(`ManageBranchesDialog`) 안에서는 body 포털 툴팁이 `ariaHideOutside`로 스크린리더에 숨는다(시각·E2E는 정상), 툴팁 ESC가 전파를 막지 않아 다이얼로그와 동시에 닫힌다.

**Task 1·2 실행 편차 (소급 기록 — 리뷰 검증 완료):** ① 단위 테스트는 13이 아니라 **12건**(보완으로 13) — 게이트 표 전 열 정정. ② **플랜의 `shortenBranch` 구현이 자기 테스트와 모순**이었다(뒤 보존 알고리즘은 기대값 `…dw-1051-work-review`를 만들 수 없음). 구현자가 TDD Green을 위해 "네임스페이스 제거 + 앞쪽 유지"로 교정 → 리뷰가 **구현자 손을 들어줌**(스펙 ①의 예시값 자체가 그 알고리즘의 산출물이고, 실제 브랜치 목록에서 `claude/`·`codex/` 접두는 100% 중복 정보). 플랜 구현 블록을 정정본으로 교체. ③ tooltip.css 토큰 11개 전부 실존(치환 0). ④ Tooltip의 cloneElement ref 병합은 React 19.2.7에서 실동 확인(타입만 통과가 아님).

---

### Task 3: 네이티브 `title` 19곳 → Tooltip 교체

**Files:**
- Modify: 아래 19곳(파일·행)
- Modify: `apps/desktop/e2e/smoke.spec.ts` (title 단언 4곳 전환)

**교체 규칙**: `title={X}` 속성을 제거하고 그 요소를 `<Tooltip content={X} summary={X}>…</Tooltip>`로 감싼다. `X`가 여러 줄(`\n` 포함)이면 content는 그대로 두고 summary는 첫 줄만 쓴다. 요소에 이미 `aria-label`이 있으면 그대로 둔다(중복 낭독 방지 — Tooltip은 `aria-describedby`만 얹는다).

- [ ] **Step 1: 워크드 예시 3종.** 아래 세 모양을 먼저 적용해 패턴을 확정한다.

(a) 문자열 title + 버튼 — `components/ShelfPopover.tsx:60`:

```tsx
                    <button
                      type="button"
                      title="무엇이 담겼는지 미리보기"
```

→

```tsx
                    <Tooltip content="무엇이 담겼는지 미리보기" summary="무엇이 담겼는지 미리보기">
                    <button
                      type="button"
```

(닫는 `</button>` 뒤에 `</Tooltip>` — 들여쓰기는 prettier가 정리한다. import 추가: `import { Tooltip } from '../ui/Tooltip'`)

(b) 식 title + span — `App.tsx:336`:

```tsx
          <span className="app__repo-path" title={store.repoPath} data-testid="repo-path">
```

→

```tsx
          <Tooltip content={store.repoPath} summary={store.repoPath}>
            <span className="app__repo-path" data-testid="repo-path">
```

(c) 여러 줄 title — `components/HistoryPanel.tsx:437`:

```tsx
                    title={`${commit.subject}\n${formatAbsoluteTime(commit.committedAt)} · ${commit.authorName}`}
```

→ 요소를 Tooltip으로 감싸고:

```tsx
                  content={
                    <>
                      <div className="ui-tooltip__title">{commit.subject}</div>
                      <div className="ui-tooltip__meta">
                        {formatAbsoluteTime(commit.committedAt)} · {commit.authorName}
                      </div>
                    </>
                  }
                  summary={commit.subject}
```

- [ ] **Step 2: 나머지 16곳 일괄 적용.** 전수 목록(사전 실측):

| 파일:행 | 요소 | 현재 title |
| --- | --- | --- |
| `App.tsx:336` | span | `{store.repoPath}` (Step 1-b에서 완료) |
| `components/BranchSwitcher.tsx:41` | span | `{branch.name}` |
| `components/BranchesPanel.tsx:288` | button | `{localTitle(branch)}` |
| `components/BranchesPanel.tsx:326` | button | `{name}` |
| `components/ChangesPanel.tsx:99` | button | `{tooltip}` |
| `components/CommitDetailPanel.tsx:73` | button | `{tooltip}` |
| `components/HistoryPanel.tsx:437` | button | 여러 줄 (Step 1-c에서 완료) |
| `components/HistoryPanel.tsx:453` | span | `{ref}` |
| `components/HistoryPanel.tsx:471` | span | `{arranged.hidden…}` |
| `components/HistoryPanel.tsx:485` | span | `{commit.subject}` |
| `components/ManageBranchesDialog.tsx:61` | span | `{branch.name}` |
| `components/ReviewDetailPanel.tsx:102` | span | `` {`${headBranch} → ${baseBranch}`} `` |
| `components/ReviewPopover.tsx:153` | button | `"코멘트·승인·병합 보기"` |
| `components/ReviewPopover.tsx:166` | button | `"브라우저에서 열기"` |
| `components/ShelfPopover.tsx:60` | button | `"무엇이 담겼는지 미리보기"` (Step 1-a) |
| `components/ShelfPopover.tsx:67` | span | `{entry.message}` |
| `components/WorktreesPanel.tsx:99` | button | 현재/일반 분기 경로 — **Task 6에서 리치 카드로 대체하므로 이번엔 건드리지 않는다** |
| `components/WorktreesPanel.tsx:124` | span | `"터미널 대상 — 새 터미널이 이 폴더에서 열려요"` |
| `ui/Panel.tsx:16` | h2 | `{title}` — 패널 제목은 잘리지 않으므로 **툴팁을 없앤다**(`title` 속성만 제거) |

행 번호는 편집하며 밀린다 — 각 항목은 **파일 + 현재 title 표현**으로 찾아 적용하고, 못 찾으면 편차 보고.

- [ ] **Step 3: E2E title 단언 4곳 전환.** smoke.spec.ts에서 `toHaveAttribute('title', /지금 여기/)` 4곳(1316·1353·1500·1658행 부근)을 `toHaveAttribute('data-tooltip', /지금 여기/)`로 교체한다. 단언 강도 동일(같은 요소·같은 정규식).

- [ ] **Step 4: 잔재 확인** — `grep -rn "title=" apps/desktop/src/renderer/src --include="*.tsx"` 결과에 DOM 요소 title이 남아 있지 않은지 확인(컴포넌트 prop만 남아야 한다). Task 6이 담당하는 WorktreesPanel:99는 예외로 남는다.

- [ ] **Step 5: 게이트** — typecheck Done, 루트 `pnpm test` 유지, build 성공, `npx playwright test e2e/smoke.spec.ts` → **81 유지**(포그라운드 동기, timeout 600000). 깨지는 테스트가 있으면 원인 수정(비활성 금지)·편차 보고.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src apps/desktop/e2e/smoke.spec.ts
git commit -m "refactor(desktop): E7j 네이티브 title → 공용 Tooltip 일괄 교체(E2E 단언 data-tooltip 전환)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: WorktreesPanel 두 줄 재설계

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/WorktreesPanel.tsx` (행 렌더 — 95-135행 부근)
- Modify: `apps/desktop/src/renderer/src/components/worktrees-panel.css`
- Modify: `apps/desktop/src/renderer/src/App.tsx` (home 경로 전달)

- [ ] **Step 1: home 경로 확보.** WorktreesPanel은 홈 경로를 알아야 한다. `WorktreesPanelProps`에 `home: string`을 추가하고, App은 이미 가진 값(실독 — 없으면 `store.repoPath`에서 유도 불가하므로 preload/IPC로 `app.getPath('home')`를 노출하는 최소 배선을 추가하고 **편차 보고**)을 넘긴다. 홈을 못 구하면 빈 문자열을 넘겨 `~` 축약 없이 동작하게 한다(순수 함수가 이미 그 경우를 처리한다).

- [ ] **Step 2: 행 렌더 교체.** 기존 행 버튼 블록(`<button key={worktree.path} …>` ~ `</button>`)을 다음으로 교체:

```tsx
            <button
              key={worktree.path}
              type="button"
              className={`worktree-row${worktree.prunable ? ' worktree-row--gone' : ''}`}
              onClick={(event) =>
                worktree.prunable
                  ? openMenu(event, worktree)
                  : onAction({
                      kind: 'select',
                      path: worktree.path,
                      label: names.get(worktree.path) ?? folderName(worktree.path),
                    })
              }
              onContextMenu={(event) => openMenu(event, worktree)}
              data-testid={`worktree-row-${folderName(worktree.path)}`}
            >
              <span className="worktree-row__lines">
                <span className="worktree-row__line">
                  <span
                    className={`worktree-row__glyph${worktree.path === currentPath ? ' worktree-row__glyph--here' : ''}`}
                  >
                    {worktree.path === currentPath ? '➤' : '⌂'}
                  </span>
                  <span
                    className={`worktree-row__branch${worktree.path === currentPath ? ' worktree-row__branch--here' : ''}`}
                  >
                    {branchLabel(worktree)}
                  </span>
                  <span className="worktree-row__source">{sourceChip(worktree.path, home)}</span>
                  {worktree.path === activePath && (
                    <span className="worktree-row__terminal">❯_</span>
                  )}
                </span>
                <span className="worktree-row__line worktree-row__line--sub">
                  <span className="worktree-row__name">
                    {names.get(worktree.path) ?? folderName(worktree.path)}
                  </span>
                  <span className="worktree-row__path">{shortenParent(worktree.path, home)}</span>
                </span>
              </span>
            </button>
```

컴포넌트 상단(기존 `folderName` 선언 근처)에 추가:

```tsx
  // E7j — 리프 이름이 겹치면(codex·claude 구조에서 흔하다) 구분되는 조상까지 붙여 유일화한다
  const names = uniqueNames(worktrees.map((worktree) => worktree.path))
```

`branchLabel`은 브랜치가 주 식별자가 되도록 교체:

```tsx
  const branchLabel = (worktree: WorktreeInfo) =>
    worktree.prunable
      ? '없어진 폴더'
      : worktree.branch !== null
        ? shortenBranch(worktree.branch, 28)
        : `분리됨 (${worktree.headHash?.slice(0, 7) ?? '?'})`
```

(`WorktreeInfo.headHash` 유무는 실독 — 없으면 `분리됨`만 표시하고 편차 보고.) import 추가: `import { shortenBranch, shortenParent, sourceChip, uniqueNames } from './worktree-label'`.

**testid는 기존 `worktree-row-${folderName(path)}` 유지** — 기존 E2E 무회귀를 위해 이름 유일화와 분리한다(중복 가능성은 E7j 범위 밖 알려진 성질로 남긴다).

- [ ] **Step 3: CSS 교체.** worktrees-panel.css의 `.worktree-row` 관련 블록(실독)을 두 줄 배치로:

```css
/* E7j — 두 줄 행: 1줄 브랜치(주 식별자)+출처, 2줄 이름+경로. 잘리는 쪽을 뒤가 아니라 앞으로 */
.worktree-row {
  display: flex;
  align-items: flex-start;
  width: 100%;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.worktree-row:hover {
  background: var(--color-hover-bg, rgba(127, 127, 127, 0.08));
}
.worktree-row--gone {
  opacity: var(--opacity-disabled);
}
.worktree-row__lines {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  width: 100%;
}
.worktree-row__line {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.worktree-row__line--sub {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
.worktree-row__glyph {
  width: 15px;
  text-align: center;
  opacity: 0.7;
}
.worktree-row__glyph--here {
  opacity: 1;
  color: var(--concept-branch);
}
.worktree-row__branch {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.worktree-row__branch--here {
  font-weight: 600;
}
.worktree-row__source {
  flex: none;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
.worktree-row__terminal {
  flex: none;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}
.worktree-row__name {
  flex: none;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.worktree-row__path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.85;
}
```

(`.add-worktree__*`·`.worktrees-panel__empty`·스크롤 블록은 유지 — 실독.)

- [ ] **Step 4: 게이트** — typecheck, build, `npx playwright test e2e/smoke.spec.ts -g "워크트리"` 전건 통과 + 전 스위트 **81 유지**(포그라운드 동기, timeout 600000), 루트 `pnpm test` 유지. 워크트리 E2E가 `지금 여기` 텍스트나 한 줄 구조를 단언하면 같은 취지로 갱신·편차 보고.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/WorktreesPanel.tsx apps/desktop/src/renderer/src/components/worktrees-panel.css apps/desktop/src/renderer/src/App.tsx
git commit -m "feat(desktop): E7j 워크트리 두 줄 행 — 브랜치 주 식별자·출처 칩·이름 유일화·경로 뒤 조각

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 분기점 엔진 + IPC + store 캐시

**Files:**
- Modify: `packages/domain/src/repository.ts` (ForkPoint)
- Modify: `packages/git-adapter/src/client.ts` (worktrees.forkPoint)
- Modify: `packages/ipc-contract/src/index.ts` · `apps/desktop/src/preload/index.ts` · `apps/desktop/src/main/git-handlers.ts`
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`
- Test: `packages/git-adapter/test/client.test.ts`

- [ ] **Step 1: 도메인 타입.** `packages/domain/src/repository.ts`의 `WorktreeInfo` 선언 뒤(실독)에 추가:

```ts
/** 워크트리가 어느 브랜치에서 갈라졌는지 (E7j) — git이 기록하지 않아 merge-base로 계산한다 */
export interface ForkPoint {
  /** 기준 브랜치 이름(origin/HEAD → main → master 순으로 결정) */
  base: string
  /** 기준 대비 내가 앞선 저장 수 */
  ahead: number
  /** 기준 대비 내가 뒤처진 저장 수 */
  behind: number
}
```

- [ ] **Step 2: Red — 엔진 테스트 4건.** `packages/git-adapter/test/client.test.ts`의 worktrees 관련 테스트 뒤(실독)에 추가:

```ts
  describe('worktrees.forkPoint (E7j)', () => {
    it('기본 브랜치에서 갈라진 지점과 앞섬/뒤처짐을 센다', async () => {
      const repo = await createFixtureRepo()
      await commitFile(repo, 'a.txt', 'a', 'base')
      await execGitOrThrow(['branch', 'side'], { cwd: repo })
      const wtPath = `${repo}-fork`
      await execGitOrThrow(['worktree', 'add', '--end-of-options', wtPath, 'side'], { cwd: repo })
      await commitFile(wtPath, 'b.txt', 'b', 'side 저장')
      await commitFile(repo, 'c.txt', 'c', 'main 저장')
      const fork = await createGitClient(repo).worktrees.forkPoint(wtPath)
      expect(fork).not.toBeNull()
      expect(fork!.base).toBe('main')
      expect(fork!.ahead).toBe(1)
      expect(fork!.behind).toBe(1)
      await execGitOrThrow(['worktree', 'remove', '--force', '--end-of-options', wtPath], { cwd: repo })
    })

    it('기준 브랜치 자신인 워크트리는 null이다', async () => {
      const repo = await createFixtureRepo()
      await commitFile(repo, 'a.txt', 'a', 'base')
      expect(await createGitClient(repo).worktrees.forkPoint(repo)).toBeNull()
    })

    it('분리된(detached) 워크트리도 HEAD 기준으로 센다', async () => {
      const repo = await createFixtureRepo()
      await commitFile(repo, 'a.txt', 'a', 'base')
      const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
      const wtPath = `${repo}-detached`
      await execGitOrThrow(['worktree', 'add', '--detach', '--end-of-options', wtPath, head], { cwd: repo })
      const fork = await createGitClient(repo).worktrees.forkPoint(wtPath)
      expect(fork).not.toBeNull()
      expect(fork!.ahead).toBe(0)
      expect(fork!.behind).toBe(0)
      await execGitOrThrow(['worktree', 'remove', '--force', '--end-of-options', wtPath], { cwd: repo })
    })

    it('기준 브랜치를 못 찾으면 null이다', async () => {
      const repo = await createFixtureRepo()
      await commitFile(repo, 'a.txt', 'a', 'base')
      await execGitOrThrow(['branch', '-m', 'main', 'trunk'], { cwd: repo })
      expect(await createGitClient(repo).worktrees.forkPoint(repo)).toBeNull()
    })
  })
```

(헬퍼 실명은 실독 — `commitFile`이 없으면 파일의 기존 커밋 헬퍼를 쓰고 편차 보고. 기본 브랜치가 `main`이 아니면 기대값 조정.)

- [ ] **Step 3: Red 확인 후 구현.** client.ts의 worktrees 네임스페이스 인터페이스에 추가:

```ts
    /** 이 워크트리가 기준 브랜치에서 갈라진 지점 — 계산 비용이 있어 호출부가 필요할 때만 부른다 (E7j) */
    forkPoint(path: string): Promise<ForkPoint | null>
```

구현(worktrees.remove 뒤):

```ts
      async forkPoint(path) {
        // 기준 브랜치: origin/HEAD symref → main → master (실측 3)
        const symref = await execGit(['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd: path })
        let base: string | null = null
        if (symref.exitCode === 0) {
          base = symref.stdout.trim().replace(/^refs\/remotes\//, '')
        } else {
          for (const candidate of ['main', 'master']) {
            const exists = await execGit(['rev-parse', '--verify', '-q', candidate], { cwd: path })
            if (exists.exitCode === 0) {
              base = candidate
              break
            }
          }
        }
        if (base === null) return null
        const current = await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: path })
        // 기준 그 자신이면 분기점이라는 개념이 없다
        if (current.exitCode === 0 && current.stdout.trim() === base) return null
        const counts = await execGit(
          ['rev-list', '--left-right', '--count', `${base}...HEAD`],
          { cwd: path },
        )
        if (counts.exitCode !== 0) return null
        // 출력은 "<behind>\t<ahead>" — 왼쪽이 기준만 가진 수 (실측 4)
        const [left, right] = counts.stdout.trim().split(/\s+/)
        const behind = Number(left)
        const ahead = Number(right)
        if (!Number.isFinite(behind) || !Number.isFinite(ahead)) return null
        return { base, ahead, behind }
      },
```

`ForkPoint`를 `@git-gui/domain` import에 추가.

- [ ] **Step 4: IPC 3면.** contract에 `worktrees.forkPoint(repoPath: string, path: string): Promise<ForkPoint | null>` + 채널 `worktreeForkPoint: 'worktree:fork-point'`, `ForkPoint` re-export. preload에 `forkPoint: (repoPath, path) => ipcRenderer.invoke(CHANNELS.worktreeForkPoint, repoPath, path)`. main 핸들러는 **기존 워크트리 경로 검증(assertWorktreePath 계열 — 실독)을 반드시 재사용**한다:

```ts
  ipcMain.handle(CHANNELS.worktreeForkPoint, async (_event, repoPath: unknown, path: unknown) => {
    const root = assertAllowedRepo(repoPath)
    const target = await assertWorktreePath(root, assertString(path))
    return createGitClient(root).worktrees.forkPoint(target)
  })
```

(`assertWorktreePath`의 실제 이름·시그니처는 실독 — 기존 openPath·terminal cwd·reveal 핸들러가 쓰는 것과 동일하게. 다르면 같은 취지로 맞추고 편차 보고.)

- [ ] **Step 5: store 캐시.** repository-store.ts 인터페이스에 추가:

```ts
  /** 워크트리 분기점 — 호버 시점에만 계산하고 경로+HEAD로 캐시한다 (E7j) */
  forkPoints: Record<string, ForkPoint | null>
  loadForkPoint(path: string, headHash: string | null): Promise<void>
```

초기값 `forkPoints: {}`, 구현(`searchHistory` 근처):

```ts
  async loadForkPoint(path, headHash) {
    const { repoPath, forkPoints } = get()
    const key = `${path} ${headHash ?? ''}`
    if (!repoPath || key in forkPoints) return
    // 조회성 — guard(busy 잠금·에러 배너)를 쓰지 않고 실패는 조용히 null로 캐시한다
    try {
      const fork = await git().worktrees.forkPoint(repoPath, path)
      set({ forkPoints: { ...get().forkPoints, [key]: fork } })
    } catch {
      set({ forkPoints: { ...get().forkPoints, [key]: null } })
    }
  },
```

- [ ] **Step 6: 게이트** — `npx vitest run packages/git-adapter/test/client.test.ts` 전건, 루트 `pnpm test` → **+4(실측 정정)**, typecheck Done, build 성공.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src packages/git-adapter/src packages/git-adapter/test packages/ipc-contract/src apps/desktop/src/preload apps/desktop/src/main apps/desktop/src/renderer/src/store
git commit -m "feat: E7j 워크트리 분기점 — merge-base 기반 forkPoint 엔진·IPC·store 캐시

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: 워크트리 리치 호버 카드

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/WorktreesPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx` (forkPoints·onHover 배선)

- [ ] **Step 1: props 추가.** `WorktreesPanelProps`에:

```ts
  /** 분기점 캐시 — 키는 `경로 HEAD해시` (E7j) */
  forkPoints: Record<string, ForkPoint | null>
  /** 행에 마우스가 머물면 그 워크트리 하나만 분기점을 계산한다 */
  onHoverWorktree(path: string, headHash: string | null): void
```

- [ ] **Step 2: 카드 내용 + Tooltip 적용.** Task 4에서 만든 행 버튼을 Tooltip으로 감싼다(Task 3이 남겨 둔 WorktreesPanel:99의 네이티브 title은 이때 제거):

```tsx
            <Tooltip
              key={worktree.path}
              summary={worktree.path}
              content={
                <>
                  <div className="ui-tooltip__title">{branchLabel(worktree)}</div>
                  <div className="ui-tooltip__path">{worktree.path}</div>
                  <div className="ui-tooltip__meta">
                    출처 {sourceChip(worktree.path, home)}
                    {worktree.headHash !== null && ` · HEAD ${worktree.headHash.slice(0, 7)}`}
                    {worktree.path === currentPath && ' · 지금 여기'}
                    {worktree.locked && ' · 잠김'}
                  </div>
                  {worktree.prunable && (
                    <div className="ui-tooltip__meta">폴더가 없어졌어요 — 목록에서 정리할 수 있어요</div>
                  )}
                  {forkPoints[`${worktree.path} ${worktree.headHash ?? ''}`] != null && (
                    <div className="ui-tooltip__meta">
                      {forkPoints[`${worktree.path} ${worktree.headHash ?? ''}`]!.base}에서 갈라짐 ·{' '}
                      {forkPoints[`${worktree.path} ${worktree.headHash ?? ''}`]!.ahead}개 앞섬 ·{' '}
                      {forkPoints[`${worktree.path} ${worktree.headHash ?? ''}`]!.behind}개 뒤처짐
                    </div>
                  )}
                </>
              }
            >
              <button
                type="button"
                className={…}
                onMouseEnter={() => onHoverWorktree(worktree.path, worktree.headHash)}
                …
              >
```

(`key`는 Tooltip으로 옮기고 버튼에서 제거. `onMouseEnter`는 Tooltip이 cloneElement로 합성해 주므로 그대로 둘 수 있다 — Task 2 구현이 원래 핸들러를 이어 부른다.)

- [ ] **Step 3: App 배선.** WorktreesPanel 렌더에 추가:

```tsx
                forkPoints={store.forkPoints}
                onHoverWorktree={(path, headHash) => void store.loadForkPoint(path, headHash)}
```

- [ ] **Step 4: 게이트** — typecheck, build, 루트 `pnpm test` 유지, `npx playwright test e2e/smoke.spec.ts` → **81 유지**(포그라운드 동기, timeout 600000).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/WorktreesPanel.tsx apps/desktop/src/renderer/src/App.tsx
git commit -m "feat(desktop): E7j 워크트리 호버 카드 — 전체 경로·출처·HEAD·분기점 한 화면

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: E2E 2건 + 최종 게이트 + 스크린샷 + README

**Files:**
- Modify: `apps/desktop/e2e/smoke.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: E2E 신규 2건.** smoke.spec.ts 끝에 추가:

```ts
test('E7j — 같은 이름 워크트리가 출처·이름으로 구분된다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'wt-one'], { cwd: repo })
  await execGitOrThrow(['branch', 'wt-two'], { cwd: repo })
  // 같은 리프 이름을 서로 다른 부모 아래에 만든다(codex·claude 구조 재현)
  const base = dirname(repo)
  const leaf = basename(repo)
  const oneParent = join(base, 'holder-one')
  const twoParent = join(base, 'holder-two')
  await execGitOrThrow(['worktree', 'add', '--end-of-options', join(oneParent, leaf), 'wt-one'], { cwd: repo })
  await execGitOrThrow(['worktree', 'add', '--end-of-options', join(twoParent, leaf), 'wt-two'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-worktrees').click()
    // 브랜치가 1줄 주 식별자로 보이고, 2줄 이름이 부모까지 붙어 구분된다
    await expect(window.getByText('wt-one')).toBeVisible()
    await expect(window.getByText('wt-two')).toBeVisible()
    await expect(window.getByText(`holder-one/${leaf}`)).toBeVisible()
    await expect(window.getByText(`holder-two/${leaf}`)).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(oneParent, { recursive: true, force: true })
    await rm(twoParent, { recursive: true, force: true })
  }
})

test('E7j — 워크트리에 호버하면 전체 경로가 잘림 없이 보인다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-worktrees').click()
    const row = window.getByTestId(`worktree-row-${basename(repo)}`)
    await expect(row).toHaveAttribute('data-tooltip', repo)
    await row.hover()
    const tip = window.getByTestId('tooltip')
    await expect(tip).toBeVisible()
    await expect(tip).toContainText(repo)
    await window.keyboard.press('Escape')
    await expect(tip).toHaveCount(0)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

(`dirname`·`basename` import가 없으면 `node:path`에서 추가. testid·헬퍼는 실독 — Task 4가 testid를 유지했으므로 `worktree-row-<leaf>`가 유효하다.)

- [ ] **Step 2: 게이트** — build + `npx playwright test e2e/smoke.spec.ts` → **83 passed**(81+2), 신규 2건 각각 단독 `-g` 1회 non-flaky, 루트 `pnpm test` 유지, typecheck Done. 포그라운드 동기(timeout 600000).

- [ ] **Step 3: 전체 게이트** — 루트 `pnpm test` **508(486+12+5+1+4 — 실측 확정)** · typecheck 전부 Done · desktop build · `pnpm --filter @git-gui/desktop e2e` → **89**(smoke 83 + hosting 6) · last-screen 아티팩트 0건.

- [ ] **Step 4: 공식 스크린샷 2장** — 임시 spec `apps/desktop/e2e/tmp-shots-e7j.spec.ts`(관례: harness electron·1440×900·try/finally 정리·촬영 후 spec 삭제·전체 e2e 재실행 금지): **(1) e7j-worktree-rows.png** — 같은 리프 이름 워크트리 2~3개가 출처 칩·유일화 이름·경로 뒤 조각으로 구분되는 목록. **(2) e7j-worktree-hover.png** — 행 호버 카드(전체 경로·출처·HEAD, 가능하면 분기점 줄까지). 스크래치패드에 사본을 남긴다(`/private/tmp/claude-501/-Users-sangyeop-kim-git-gui/b4ef6d32-042d-440c-8252-b8944659aa01/scratchpad/`).

- [ ] **Step 5: README.** 기존 E7i 문단 끝(실독) 뒤에 추가:

```markdown
E7j: 워크트리 목록이 두 줄로 바뀌어 브랜치가 앞에 오고, 같은 이름이 여럿이면 구분되는 폴더까지 붙여 보여주며, 어느 도구·폴더가 만든 워크트리인지(.claude·.codex·내 폴더) 칩으로 표시합니다. 행에 마우스를 올리면 전체 경로·HEAD·"어느 브랜치에서 갈라졌는지"가 카드로 뜨고, 앱 전체의 툴팁이 OS 기본 대신 같은 디자인의 호버 카드로 통일됐습니다.
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts README.md
git commit -m "test(desktop): E7j E2E 2건 — 같은 이름 구분·호버 카드 + README

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 게이트 표 (누적 — 실측 정정 대상)

| 시점 | 루트 테스트 | smoke |
| --- | --- | --- |
| 시작 | 486 | 81 |
| Task 1 후 | +12 → 498 | 81 |
| Task 2 후 | +5 → 503 | 81 |
| Task 2-보완 후 | +1 → 504 | 81 |
| Task 3 후 | 504 | 81 유지 |
| Task 4 후 | 504 | 81 유지 |
| Task 5 후 | +4 → 508 | 81 유지 |
| Task 6 후 | 508 | 81 유지 |
| Task 7 후 | 508 · e2e **90**(84+6) | +2 → 83 |

## Self-Review (플랜 자체 점검)

1. **스펙 커버리지**: ①두 줄 행=T1+T4 · ②공용 Tooltip·title 교체·E2E 전환=T2+T3 · ③리치 카드=T6 · ④분기점 지연 계산=T5 · 테스트=T1·T2·T5 단위 + T7 E2E 2건 + 스크린샷. 에러표 각 행: 홈 밖(T1 sourceChip/shortenParent) · 조상까지 동일(T1 uniqueNames 전체 확장) · 한 조각 경로(T1) · 분리됨(T4 branchLabel·T5 detached 테스트) · 없어진 폴더(T6 카드 줄) · 화면 밖 뒤집기/클램프(T2) · 갱신 시 닫힘(T2 scroll/resize 리스너) · 드래그 영역(무변) 전부 매핑.
2. **스펙 편차 2건(명시)**: (a) 네이티브 title은 41이 아니라 **19곳**(스펙 정정 필요) (b) 컴포넌트 단위 테스트(jsdom)는 **채택하지 않고** 순수 함수 단위 + E2E로 대체(인프라 부재·신규 의존성 회피).
3. **플레이스홀더**: 없음. "실독·같은 취지·편차 보고"는 프로젝트 관례로 항목화.
4. **타입 일관성**: `ForkPoint{base,ahead,behind}`가 domain(T5)→contract(T5)→store(T5)→panel props(T6)에서 동명. `shortenParent`·`sourceChip`·`uniqueNames`·`shortenBranch`(T1)↔T4·T6 사용 일치. `placeTooltip`(T2)↔Tooltip 내부. `forkPoints` 키 규칙(`경로 HEAD`)이 store(T5)와 카드(T6)에서 동일 — **T6 구현자는 키 계산을 지역 변수로 한 번만 만들어 쓸 것**(플랜 코드는 가독성을 위해 인라인 반복).
5. **알려진 위험 2건**: (a) Tooltip의 cloneElement ref 병합은 React 19 ref-as-prop 규약을 따른다 — 트리거가 함수형 컴포넌트면 동작하지 않는다(19곳 전부 DOM 요소임을 실측 확인). (b) 워크트리 testid를 리프 이름 기준으로 유지하므로 같은 리프 이름이 둘이면 testid가 중복된다 — 기존 E2E 무회귀를 위한 의도된 선택이며, T7의 신규 E2E는 화면 텍스트로 구분을 검증한다.
