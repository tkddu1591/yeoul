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

- [x] **Step 1: 워크드 예시 3종.** 아래 세 모양을 먼저 적용해 패턴을 확정한다.

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

- [x] **Step 2: 나머지 16곳 일괄 적용.** 전수 목록(사전 실측):

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

- [x] **Step 3: E2E title 단언 4곳 전환.** smoke.spec.ts에서 `toHaveAttribute('title', /지금 여기/)` 4곳(1316·1353·1500·1658행 부근)을 `toHaveAttribute('data-tooltip', /지금 여기/)`로 교체한다. 단언 강도 동일(같은 요소·같은 정규식).

- [x] **Step 4: 잔재 확인** — `grep -rn "title=" apps/desktop/src/renderer/src --include="*.tsx"` 결과에 DOM 요소 title이 남아 있지 않은지 확인(컴포넌트 prop만 남아야 한다). Task 6이 담당하는 WorktreesPanel:99는 예외로 남는다.

- [x] **Step 5: 게이트** — typecheck Done, 루트 `pnpm test` 유지, build 성공, `npx playwright test e2e/smoke.spec.ts` → **81 유지**(포그라운드 동기, timeout 600000). 깨지는 테스트가 있으면 원인 수정(비활성 금지)·편차 보고.

- [x] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src apps/desktop/e2e/smoke.spec.ts
git commit -m "refactor(desktop): E7j 네이티브 title → 공용 Tooltip 일괄 교체(E2E 단언 data-tooltip 전환)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Task 3 실행 편차 (소급 기록 — 리뷰 검증 완료):** ① 플랜 사전실측 오류 — E2E `title` 단언은 4개가 아니라 **5개**(멀티라인 호출 1건이 한 줄 grep에 안 잡힘). 전환 대상은 BranchesPanel 계열 4곳(1316·1321·1353·1500). ② **플랜 내부 모순**: Step 3이 1658행(=WorktreesPanel:99, 예외로 남긴 그 버튼) 전환을 지시했으나 그 요소는 네이티브 title을 유지하므로 전환하면 스모크가 깨진다 → **유지**가 옳음(리뷰 확인). **Task 6 필수 후속 조건**: 워크트리 행을 리치 카드로 바꿀 때 `smoke.spec.ts`의 그 단언(`worktree-row-*`의 `title`)을 **같은 커밋에서** `data-tooltip`으로 전환할 것 — 안 하면 Task 6이 스모크를 깨뜨린다. ③ 중첩 title(HistoryPanel 행+span들, ShelfPopover 행+span)을 각각 독립 Tooltip으로 감쌈 → 리뷰가 실측으로 **카드 2장 겹침 회귀**를 확인, Task 3-보완에서 해소.

**플랜 자체 정정(컨트롤러):** 이 문서에 raw NUL 바이트 7개가 박혀 있었다(`forkPoints` 키 구분자) — E7i에서 같은 사고가 있었으므로 전부 `::`로 교체했다. Task 5·6의 캐시 키 규칙은 `` `${경로}::${HEAD해시}` ``다.

### Task 3-보완: 중첩 툴팁 겹침 + 패널 제목 잘림 (품질 리뷰 Important 2건 — 실측 재현)

리뷰가 프로브 E2E로 두 결함을 실제로 재현했다.

- **I-1 중첩 툴팁이 2장 겹쳐 뜬다(이번 커밋이 만든 회귀)**: 행 버튼과 그 안의 span에 각각 Tooltip이 붙어, 행에 올렸다가 subject로 옮기면 카드가 2개(같은 제목 중복) 겹친다(실측: 박스 x 838-861·y 175-186 겹침). 네이티브 `title`은 최내곽 하나만 떴다. `stopPropagation`으로는 부족하다 — 바깥이 `mouseleave`를 못 받는 경로가 있다.
- **I-2 패널 제목 잘림 정보 손실**: 플랜의 "패널 제목은 잘리지 않으므로"는 사실이 아니었다. `ui/panel.css`가 h2에 `text-overflow: ellipsis`를 건다 — 실측 `DiffPanel` 긴 경로 제목이 scrollWidth 439 / clientWidth 151로 **66% 잘리는데 title을 없애 전체를 볼 방법이 사라졌다**(DiffPanel·ConflictPanel·ReviewDetailPanel 직격).

**Files:**
- Modify: `apps/desktop/src/renderer/src/ui/Tooltip.tsx`
- Modify: `apps/desktop/src/renderer/src/components/HistoryPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/ui/Panel.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ChangesPanel.tsx`·`CommitDetailPanel.tsx`

- [x] **Step 1: 중첩 해소 — 조상 close 컨텍스트.** `Tooltip.tsx`에 추가(리뷰가 프로토타입으로 검증한 방식):

```tsx
/** 중첩 트리거에서 바깥 카드가 남아 2장이 겹치는 것을 막는다 — 안쪽이 열리면 조상을 닫는다 (E7j 보완 I-1) */
const NestContext = createContext<(() => void) | null>(null)
```

컴포넌트 안에서 `const closeAncestor = useContext(NestContext)`를 잡고, `open()` 첫 줄에서 `closeAncestor?.()`를 부른다. 반환은 Provider로 감싼다:

```tsx
  return (
    <NestContext.Provider value={close}>
      {trigger}
      {place !== null && createPortal(…)}
    </NestContext.Provider>
  )
```

(`createContext`·`useContext` import 추가.)

- [x] **Step 2: 중복 카드 제거.** HistoryPanel의 `history-item__subject` span Tooltip은 행 카드의 첫 줄과 **내용이 같다** — 그 Tooltip을 제거하고 span은 그대로 둔다(행 카드가 이미 제목을 보여준다).

- [x] **Step 3: 패널 제목 툴팁 복원.** `ui/Panel.tsx`의 `<h2>{title}</h2>`를 다음으로:

```tsx
        <Tooltip content={title} summary={title}>
          <h2>{title}</h2>
        </Tooltip>
```

(import 추가. Panel이 Tooltip을 쓰면 순환 import가 생기는지 확인 — Tooltip은 Panel을 쓰지 않으므로 없다.)

- [x] **Step 4: aria 이중 낭독 2곳.** `ChangesPanel.tsx`·`CommitDetailPanel.tsx`의 파일 행은 `aria-label={tooltip}`을 유지한 채 같은 문자열이 `aria-describedby`로도 붙어 스크린리더가 두 번 읽는다 — 그 두 곳의 Tooltip에서 `summary`는 유지하되 **`aria-describedby` 연결을 끄는** 옵션을 Tooltip에 추가한다:

```tsx
  /** 트리거에 이미 같은 문구의 aria-label이 있으면 켠다 — 중복 낭독 방지 (E7j 보완) */
  describedBy?: boolean
```

기본 true, `aria-describedby={describedBy !== false && place !== null ? id : undefined}`. 두 호출부에 `describedBy={false}`.

- [x] **Step 5: 게이트** — typecheck, 루트 `pnpm test` **504 유지**, build, `npx playwright test e2e/smoke.spec.ts` → **81 유지**(포그라운드 동기, Bash timeout 600000 필수).

- [x] **Step 6: 육안 검증(필수)** — 임시 프로브 spec으로 히스토리 행 → subject 이동 시 **카드가 1개만** 뜨는지, 긴 제목 패널(diff)에서 h2 호버 시 전체 제목이 보이는지 확인하고 결과 수치를 보고한다. 프로브 spec은 확인 후 삭제하고 워킹트리를 클린으로 남긴다.

- [x] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/ui/Tooltip.tsx apps/desktop/src/renderer/src/ui/Panel.tsx apps/desktop/src/renderer/src/components/HistoryPanel.tsx apps/desktop/src/renderer/src/components/ChangesPanel.tsx apps/desktop/src/renderer/src/components/CommitDetailPanel.tsx
git commit -m "fix(desktop): E7j 보완 — 중첩 툴팁 겹침 해소·패널 제목 툴팁 복원·aria 이중 낭독 차단

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Task 3 리뷰 Minor 후속 노트(기록만):** ① WorktreesPanel `❯_` span에 조상 버튼의 네이티브 title이 겹쳐 보일 수 있음 — Task 6에서 자연 해소. ② react-aria Modal(`ManageBranchesDialog`) 안에서는 body 포털 툴팁이 `ariaHideOutside` 대상이 될 수 있어 스크린리더에서 설명이 누락될 소지(시각·E2E 정상).

**Task 3-보완 실행 편차 (소급 기록 — 리뷰 재검 통과):** 편차 없음(플랜 Step 1~7 문면 그대로). **프로브 실측(구현자·리뷰어 교차 확인):** 중첩 시 카드 **1개 유지**(행→ref 배지 이동 시 텍스트가 안쪽 내용으로 교체, 직행도 1개) · 긴 경로 h2 `scrollWidth 968/clientWidth 156` 잘림 재현 후 hover 카드에 전체 경로 노출 · `describedBy` 기본 true라 나머지 15곳은 `aria-describedby` 정상 부착, false 준 2곳만 미부착(aria-label 원문 유지). NestContext는 close 참조 안정(ref+setState만 캡처)·Provider가 trigger와 포털만 감싸 패널 본문 오인 없음.

---

### Task 4: WorktreesPanel 두 줄 재설계

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/WorktreesPanel.tsx` (행 렌더 — 95-135행 부근)
- Modify: `apps/desktop/src/renderer/src/components/worktrees-panel.css`
- Modify: `apps/desktop/src/renderer/src/App.tsx` (home 경로 전달)

- [x] **Step 1: home 경로 확보.** WorktreesPanel은 홈 경로를 알아야 한다. `WorktreesPanelProps`에 `home: string`을 추가하고, App은 이미 가진 값(실독 — 없으면 `store.repoPath`에서 유도 불가하므로 preload/IPC로 `app.getPath('home')`를 노출하는 최소 배선을 추가하고 **편차 보고**)을 넘긴다. 홈을 못 구하면 빈 문자열을 넘겨 `~` 축약 없이 동작하게 한다(순수 함수가 이미 그 경우를 처리한다).

- [x] **Step 2: 행 렌더 교체.** 기존 행 버튼 블록(`<button key={worktree.path} …>` ~ `</button>`)을 다음으로 교체:

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

- [x] **Step 3: CSS 교체.** worktrees-panel.css의 `.worktree-row` 관련 블록(실독)을 두 줄 배치로:

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

- [x] **Step 4: 게이트** — typecheck, build, `npx playwright test e2e/smoke.spec.ts -g "워크트리"` 전건 통과 + 전 스위트 **81 유지**(포그라운드 동기, timeout 600000), 루트 `pnpm test` 유지. 워크트리 E2E가 `지금 여기` 텍스트나 한 줄 구조를 단언하면 같은 취지로 갱신·편차 보고.

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/WorktreesPanel.tsx apps/desktop/src/renderer/src/components/worktrees-panel.css apps/desktop/src/renderer/src/App.tsx
git commit -m "feat(desktop): E7j 워크트리 두 줄 행 — 브랜치 주 식별자·출처 칩·이름 유일화·경로 뒤 조각

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Task 4 실행 편차 (소급 기록 — 리뷰 검증 완료):** ① **home 경로 IPC 신설**(플랜 Step 1 허용) — contract `repo.home()` + `repo:home` 채널 + preload + main `app.getPath('home')`, App이 마운트 시 1회 조회해 state 보관(실패 시 빈 문자열 → 순수 함수가 축약 없이 처리). 리뷰 판정: 인자 0개·홈 경로만 반환이라 새 공격면 없음. ② `WorktreeInfo.headHash`·`locked` 이미 존재. ③ 플랜 Step 2 코드 블록에 네이티브 `title`이 빠져 있었으나 Critical notes·smoke 단언이 유지를 요구 → **보존**(Task 6에서 카드로 대체). ④ 플랜 스니펫이 `❯_`를 순수 span으로 되돌리게 돼 있었으나 Task 3에서 이미 Tooltip으로 전환된 요소 → **Tooltip 유지**. **리뷰 실측(프로브)**: 같은 리프 이름 2개가 `pivot-…/dataworks-frontend` vs `goofy-…/dataworks-frontend`로 실제 구분 렌더, 출처 칩 `.probe-e7j-claude`/`.probe-e7j-codex`/`내 폴더`/`private`(홈 밖 최상위) 전부 스펙대로, 행 높이 48px 균일·오버플로 없음.

---

### Task 5: 분기점 엔진 + IPC + store 캐시

**Files:**
- Modify: `packages/domain/src/repository.ts` (ForkPoint)
- Modify: `packages/git-adapter/src/client.ts` (worktrees.forkPoint)
- Modify: `packages/ipc-contract/src/index.ts` · `apps/desktop/src/preload/index.ts` · `apps/desktop/src/main/git-handlers.ts`
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`
- Test: `packages/git-adapter/test/client.test.ts`

- [x] **Step 1: 도메인 타입.** `packages/domain/src/repository.ts`의 `WorktreeInfo` 선언 뒤(실독)에 추가:

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

- [x] **Step 2: Red — 엔진 테스트 4건.** `packages/git-adapter/test/client.test.ts`의 worktrees 관련 테스트 뒤(실독)에 추가:

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

- [x] **Step 3: Red 확인 후 구현.** client.ts의 worktrees 네임스페이스 인터페이스에 추가:

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

- [x] **Step 4: IPC 3면.** contract에 `worktrees.forkPoint(repoPath: string, path: string): Promise<ForkPoint | null>` + 채널 `worktreeForkPoint: 'worktree:fork-point'`, `ForkPoint` re-export. preload에 `forkPoint: (repoPath, path) => ipcRenderer.invoke(CHANNELS.worktreeForkPoint, repoPath, path)`. main 핸들러는 **기존 워크트리 경로 검증(assertWorktreePath 계열 — 실독)을 반드시 재사용**한다:

```ts
  ipcMain.handle(CHANNELS.worktreeForkPoint, async (_event, repoPath: unknown, path: unknown) => {
    const root = assertAllowedRepo(repoPath)
    const target = await assertWorktreePath(root, assertString(path))
    return createGitClient(root).worktrees.forkPoint(target)
  })
```

(`assertWorktreePath`의 실제 이름·시그니처는 실독 — 기존 openPath·terminal cwd·reveal 핸들러가 쓰는 것과 동일하게. 다르면 같은 취지로 맞추고 편차 보고.)

- [x] **Step 5: store 캐시.** repository-store.ts 인터페이스에 추가:

```ts
  /** 워크트리 분기점 — 호버 시점에만 계산하고 경로+HEAD로 캐시한다 (E7j) */
  forkPoints: Record<string, ForkPoint | null>
  loadForkPoint(path: string, headHash: string | null): Promise<void>
```

초기값 `forkPoints: {}`, 구현(`searchHistory` 근처):

```ts
  async loadForkPoint(path, headHash) {
    const { repoPath, forkPoints } = get()
    const key = `${path}::${headHash ?? ''}`
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

- [x] **Step 6: 게이트** — `npx vitest run packages/git-adapter/test/client.test.ts` 전건, 루트 `pnpm test` → **+4(실측 정정)**, typecheck Done, build 성공.

- [x] **Step 7: Commit**

```bash
git add packages/domain/src packages/git-adapter/src packages/git-adapter/test packages/ipc-contract/src apps/desktop/src/preload apps/desktop/src/main apps/desktop/src/renderer/src/store
git commit -m "feat: E7j 워크트리 분기점 — merge-base 기반 forkPoint 엔진·IPC·store 캐시

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Task 5 실행 편차 (소급 기록 — 리뷰 검증 완료):** `client.test.ts`에 `commitFile` 헬퍼가 없어 기존 관례(`writeFixtureFile`+`add -A`+`FIXTURE_IDENT commit`)를 감싼 로컬 헬퍼로 정의(동작 동일). IPC 핸들러는 기존 `assertAllowedRepo`+`assertWorktreePath`(목록 멤버십 대조)를 그대로 재사용 — 목록 밖 임의 경로 통과 불가 확인. 캐시 키 `` `${경로}::${HEAD}` ``가 Task 6 조회 키와 문자 단위 일치, HEAD 변경 시 자동 무효, 실패 시 null 캐시는 스펙("조용히 무시")에 부합.

### Task 5-보완: 분기점 정확성 + 브랜치 꼬리 표시 + 행 타이포 (품질 리뷰 Important 3 + Minor)

리뷰가 프로브·임시 저장소로 전부 실측 재현했다.

- **I-1 네임스페이스 있는 브랜치의 꼬리가 무표시로 잘린다**: `claude/DW-1051-work-review-and-more-tail` → `…DW-1051-work-review-and-mor` — "mor"에서 끝나는 것처럼 읽힌다. Task 2-보완이 네임스페이스 **없는** 경로에만 꼬리 `…`를 넣고 이 경로를 빠뜨렸다.
- **I-2 관계없는 계보에서 null을 안 준다**: 커밋 메시지는 "merge-base 기반"이지만 실제로 `merge-base`를 부르지 않는다. 고아 계보에서도 `{base:'main',ahead:1,behind:3}`가 나와 Task 6 카드가 **"main에서 갈라짐"이라고 거짓 진술**하게 된다.
- **I-3 "기준=자기 자신" 가드가 실사용에서 죽어 있다**: origin/HEAD가 있으면 `base='origin/main'`인데 비교는 로컬 `main`과 한다 → 기본 브랜치 워크트리에도 `{ahead:0,behind:0}` 카드가 뜬다(이 저장소가 정확히 그 상태).
- **Minor**: 테스트가 1/1 대칭이라 ahead/behind 뒤바뀜을 못 잡음(M-1) · `.worktree-row`의 `font-size: var(--text-sm)` 소실로 워크트리 탭만 14px(M-2) · 현재 행만 48.5px(M-3) · 이름과 경로가 세션 폴더를 중복 표기하고 CSS가 뒤를 또 잘라 이중 생략(M-4) · 2줄이 글리프 아래에서 시작해 브랜치와 정렬이 안 맞고 `·` 구분자 없음(M-5) · 브랜치 굵기가 현재 행만 600(M-6).

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/worktree-label.ts` · `apps/desktop/test/worktree-label.test.ts`
- Modify: `packages/git-adapter/src/client.ts` · `packages/git-adapter/test/client.test.ts`
- Modify: `apps/desktop/src/renderer/src/components/WorktreesPanel.tsx` · `worktrees-panel.css`

- [x] **Step 1: I-1 — 양끝 생략.** `shortenBranch`의 네임스페이스 경로에서 잘릴 때 꼬리에도 표시를 남긴다:

```ts
  return `…${rest.length <= max - 1 ? rest : `${rest.slice(0, max - 2)}…`}`
```

테스트 1건 추가(기존 `'…dw-1051-work-review'` 케이스는 그대로 통과해야 한다 — `rest='dw-1051-work-review-final'`(25) > max-1(19)이므로 이제 `…dw-1051-work-revie…`가 된다. **기존 기대값도 함께 갱신**하고, 갱신 사실을 편차로 보고):

```ts
  it('네임스페이스를 지운 뒤에도 길면 꼬리에도 표시를 남긴다', () => {
    expect(shortenBranch('claude/dw-1051-work-review-final', 20)).toBe('…dw-1051-work-revie…')
  })
```

- [x] **Step 2: I-2·I-3 — 분기점 정확성.** `client.ts`의 `forkPoint`에서 base 결정 직후, 카운트 이전에:

```ts
        // 기준과 HEAD가 같은 커밋이면 분기라는 개념이 없다(origin/main과 로컬 main이 같은 경우 포함 — I-3)
        const [baseSha, headSha] = await Promise.all([
          execGit(['rev-parse', base], { cwd: path }),
          execGit(['rev-parse', 'HEAD'], { cwd: path }),
        ])
        if (baseSha.exitCode === 0 && headSha.exitCode === 0 && baseSha.stdout.trim() === headSha.stdout.trim()) {
          return null
        }
        // 공통 조상이 없으면(고아 계보) 갈라진 지점 자체가 없다 — 카운트는 나오지만 거짓말이 된다 (I-2)
        const mergeBase = await execGit(['merge-base', base, 'HEAD'], { cwd: path })
        if (mergeBase.exitCode !== 0) return null
```

기존 `current`(abbrev-ref) 비교 블록은 **남겨 둔다**(로컬 base 이름과 같은 경우를 여전히 잡는다).

- [x] **Step 3: M-1 — 방향 고정 테스트.** 기존 forkPoint 첫 테스트의 픽스처를 비대칭으로 바꾼다: main 쪽 저장을 2회로 늘리고 기대값을 `ahead: 1, behind: 2`로. 그리고 고아 계보 테스트 1건 추가:

```ts
    it('공통 조상이 없는 계보는 null이다', async () => {
      const repo = await createFixtureRepo()
      await commitFile(repo, 'a.txt', 'a', 'base')
      await execGitOrThrow(['checkout', '-q', '--orphan', 'lonely'], { cwd: repo })
      await commitFile(repo, 'b.txt', 'b', '고아 저장')
      expect(await createGitClient(repo).worktrees.forkPoint(repo)).toBeNull()
    })
```

- [x] **Step 4: M-4 — 이름·경로 중복 제거.** 이름이 이미 세션 폴더를 담으면 경로에서 그만큼을 뺀다. `worktree-label.ts`에 추가:

```ts
/**
 * 2줄 경로 — 이름(uniqueNames)이 이미 보여주는 조각 위쪽만 표기한다 (E7j 보완 M-4).
 * 이름이 `goofy/repo`면 경로는 `~/.claude/worktree/`까지만 — 같은 조각을 두 번 보여주지 않는다.
 */
export function shortenAbove(path: string, home: string, nameDepth: number, keep = 2): string {
  const parts = segments(path)
  const above = parts.slice(0, Math.max(0, parts.length - nameDepth))
  if (above.length === 0) return '/'
  const homeParts = segments(home)
  const underHome = homeParts.length > 0 && homeParts.every((part, index) => above[index] === part)
  const rest = underHome ? above.slice(homeParts.length) : above
  if (underHome && rest.length === 0) return '~/'
  if (rest.length <= keep) return `${underHome ? '~/' : '/'}${rest.join('/')}/`
  return `…/${rest.slice(-keep).join('/')}/`
}
```

테스트 2건 추가:

```ts
describe('shortenAbove', () => {
  it('이름이 담은 조각 위쪽만 보여준다', () => {
    expect(shortenAbove(`${HOME}/.claude/worktree/goofy/repo`, HOME, 2)).toBe('…/.claude/worktree/')
  })

  it('이름이 리프 하나면 부모까지 보여준다', () => {
    expect(shortenAbove(`${HOME}/projects/repo`, HOME, 1)).toBe('~/projects/')
  })
})
```

WorktreesPanel은 `shortenParent(...)` 대신 `shortenAbove(worktree.path, home, (names.get(worktree.path) ?? '').split('/').length)`를 쓴다. (`shortenParent`는 테스트와 함께 남겨 둔다 — 다른 쓰임이 생길 수 있고 제거는 범위 밖.)

- [x] **Step 5: M-2·M-3·M-5·M-6 — 행 타이포·정렬.** `worktrees-panel.css`에서:
  - `.worktree-row`에 `font-size: var(--text-sm);` 복구(좌측 패널 간 타이포 통일).
  - `.worktree-row__line { min-height: 20px; }` 추가(현재 행 굵기로 인한 0.5px 튐 제거).
  - 2줄을 브랜치와 같은 x에서 시작하도록 `.worktree-row__line--sub { padding-left: 23px; }`(글리프 15px + gap 8px).
  - `.worktree-row__branch`에 `font-weight: 600;`(모든 행 — 주 식별자), `--here`는 색으로 구분(`color: var(--concept-branch)`).
  - 이름과 경로 사이 `·` 구분자: JSX에서 `<span className="worktree-row__dot">·</span>`를 이름과 경로 사이에 넣고 `.worktree-row__dot { flex: none; opacity: 0.5; }`.

- [x] **Step 6: 게이트** — `npx vitest run apps/desktop/test/worktree-label.test.ts`(16건: 13+2+1) · `npx vitest run packages/git-adapter/test/client.test.ts` · 루트 `pnpm test` **511**(508+2+1) · typecheck · build · `npx playwright test e2e/smoke.spec.ts` **81 유지**(포그라운드 동기, Bash timeout 600000 필수).

- [x] **Step 7: 육안 검증(필수)** — 프로브 spec으로 (a) 긴 네임스페이스 브랜치가 `…앞…뒤…` 형태로 양끝 생략되는지 (b) 이름·경로가 세션 폴더를 중복하지 않는지 (c) 2줄이 브랜치와 같은 x에서 시작하는지 (d) 이 저장소(origin/HEAD 있음)의 본체 워크트리에서 분기점이 **뜨지 않는지**(I-3) 실측하고 수치를 보고한다. 프로브는 삭제하고 워킹트리 클린으로 남긴다.

- [x] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/src/components/worktree-label.ts apps/desktop/test/worktree-label.test.ts packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts apps/desktop/src/renderer/src/components/WorktreesPanel.tsx apps/desktop/src/renderer/src/components/worktrees-panel.css
git commit -m "fix: E7j 보완 — 분기점 merge-base/동일-HEAD 가드·브랜치 양끝 생략·행 타이포 정렬

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Task 4·5 리뷰 Nit(기록만):** `forkPoints`가 저장소 전환 시 초기화되지 않음(키에 절대경로가 들어가 충돌 없음·양 미미) · prunable 워크트리에서 `spawn git ENOENT`가 IPC를 넘어 reject되고 store try/catch가 유일한 방어선.

**Task 5-보완 실행 편차 (소급 기록 — 리뷰 재검 통과):** ① 기존 `shortenBranch` 기대값 갱신(플랜 요구) — 결과적으로 동일 단언 2개 중복(플랜 유발 Nit). ② **기존 "분리된 워크트리" 테스트가 부수적으로 깨짐**(같은 SHA detach = I-3 케이스라 이제 null) → 워크트리에 커밋 1개를 더해 진짜 발산(`ahead:1/behind:0`). 리뷰 판정: 기존 0/0 픽스처는 카운트를 아무것도 증명하지 못했으므로 **강화된 조정**. ③ **플랜 Step 4의 `shortenAbove` 기대값이 자기모순**이었다(`…/.claude/worktree/` vs 같은 블록 doc 주석의 `~/.claude/worktree/` — `rest.length(2) <= keep(2)`라 tilde 분기 확정) → 구현자가 doc 일치값 채택, 리뷰가 옳다고 판정. ④ 게이트 산술 511 → **512**(고아 계보 테스트 1건 누락).

**리뷰 실측(독립 재현):** 엔진 6케이스 — 고아 계보 null · 앞서기만 `{ahead:3,behind:0}` · 뒤처지기만 `{ahead:0,behind:2}` · origin/HEAD+동일 SHA null · origin/HEAD+1 앞섬 정상 통과(과잉 차단 없음) · 실제 저장소 본체 `{origin/main, ahead:458}`(플랜 Step 7(d) 문구가 좁았던 것 — HEAD==origin/HEAD일 때만 null). 시각 5항목 — 양끝 생략 · 이름/경로 중복 제거(부수 효과로 경로 이중 생략도 해소, clip false) · `branchX=52 nameX=52` · 1줄 12.5px 복구·weight 600 통일·현재 행은 색 구분 · 행 높이 58px 균일.

---

### Task 6: 워크트리 리치 호버 카드

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/WorktreesPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx` (forkPoints·onHover 배선)

- [x] **Step 1: props 추가.** `WorktreesPanelProps`에:

```ts
  /** 분기점 캐시 — 키는 `경로::HEAD해시` (E7j) */
  forkPoints: Record<string, ForkPoint | null>
  /** 행에 마우스가 머물면 그 워크트리 하나만 분기점을 계산한다 */
  onHoverWorktree(path: string, headHash: string | null): void
```

- [x] **Step 2: 카드 내용 + Tooltip 적용.** Task 4에서 만든 행 버튼을 Tooltip으로 감싼다(Task 3이 남겨 둔 WorktreesPanel:99의 네이티브 title은 이때 제거):

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
                  {forkPoints[`${worktree.path}::${worktree.headHash ?? ''}`] != null && (
                    <div className="ui-tooltip__meta">
                      {forkPoints[`${worktree.path}::${worktree.headHash ?? ''}`]!.base}에서 갈라짐 ·{' '}
                      {forkPoints[`${worktree.path}::${worktree.headHash ?? ''}`]!.ahead}개 앞섬 ·{' '}
                      {forkPoints[`${worktree.path}::${worktree.headHash ?? ''}`]!.behind}개 뒤처짐
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

- [x] **Step 3: App 배선.** WorktreesPanel 렌더에 추가:

```tsx
                forkPoints={store.forkPoints}
                onHoverWorktree={(path, headHash) => void store.loadForkPoint(path, headHash)}
```

- [x] **Step 4: 게이트** — typecheck, build, 루트 `pnpm test` 유지, `npx playwright test e2e/smoke.spec.ts` → **81 유지**(포그라운드 동기, timeout 600000).

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/WorktreesPanel.tsx apps/desktop/src/renderer/src/App.tsx
git commit -m "feat(desktop): E7j 워크트리 호버 카드 — 전체 경로·출처·HEAD·분기점 한 화면

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Task 6 실행 편차 (소급 기록):** 캐시 키를 `forkKey` 지역 변수로 1회 계산(플랜 self-review 4항 지시 반영). 네이티브 title 제거와 E2E 단언 전환을 같은 커밋에서 처리.

---

### Task 7: E2E 2건 + 최종 게이트 + 스크린샷 + README

**Files:**
- Modify: `apps/desktop/e2e/smoke.spec.ts`
- Modify: `README.md`

- [x] **Step 1: E2E 신규 2건.** smoke.spec.ts 끝에 추가:

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

- [x] **Step 2: 게이트** — build + `npx playwright test e2e/smoke.spec.ts` → **83 passed**(81+2), 신규 2건 각각 단독 `-g` 1회 non-flaky, 루트 `pnpm test` 유지, typecheck Done. 포그라운드 동기(timeout 600000).

- [x] **Step 3: 전체 게이트** — 루트 `pnpm test` **512(486+12+5+1+4+4 — 실측 확정)** · typecheck 전부 Done · desktop build · `pnpm --filter @git-gui/desktop e2e` → **89**(smoke 83 + hosting 6) · last-screen 아티팩트 0건.

- [x] **Step 4: 공식 스크린샷 2장** — 임시 spec `apps/desktop/e2e/tmp-shots-e7j.spec.ts`(관례: harness electron·1440×900·try/finally 정리·촬영 후 spec 삭제·전체 e2e 재실행 금지): **(1) e7j-worktree-rows.png** — 같은 리프 이름 워크트리 2~3개가 출처 칩·유일화 이름·경로 뒤 조각으로 구분되는 목록. **(2) e7j-worktree-hover.png** — 행 호버 카드(전체 경로·출처·HEAD, 가능하면 분기점 줄까지). 스크래치패드에 사본을 남긴다(`<temporary-scratchpad>/`).

- [x] **Step 5: README.** 기존 E7i 문단 끝(실독) 뒤에 추가:

```markdown
E7j: 워크트리 목록이 두 줄로 바뀌어 브랜치가 앞에 오고, 같은 이름이 여럿이면 구분되는 폴더까지 붙여 보여주며, 어느 도구·폴더가 만든 워크트리인지(.claude·.codex·내 폴더) 칩으로 표시합니다. 행에 마우스를 올리면 전체 경로·HEAD·"어느 브랜치에서 갈라졌는지"가 카드로 뜨고, 앱 전체의 툴팁이 OS 기본 대신 같은 디자인의 호버 카드로 통일됐습니다.
```

- [x] **Step 6: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts README.md
git commit -m "test(desktop): E7j E2E 2건 — 같은 이름 구분·호버 카드 + README

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Task 7 실행 편차 (소급 기록 — 리뷰 검증 완료):** ① `worktree-row-*` 단언은 리치 카드 summary가 경로 전문이라 `/지금 여기/`를 옮길 수 없어 **꼬리 매치**로 전환하고, "지금 여기" 상태는 같은 테스트의 `toContainText('➤')`가 계속 검증(리뷰: 강도 유지 판정). ② macOS `/var`→`/private/var` 심링크 때문에 `realpathSync`로 비교 기준 해석(기존 스모크 관례와 동일 사유 — 플랜 결함). ③ 플랜 게이트 표 1381행 `e2e 90(84+6)`은 산술 오류 — 실측 **89**(83+6)가 맞다.

---

### Task 7-보완: 없어진 폴더 카드 브랜치 + 터미널 글리프 색 (통합 리뷰 Fix first)

- **I-1 (Important)**: `branchLabel()`은 행 1줄용이라 prunable이면 브랜치를 버리고 `'없어진 폴더'`를 돌려주는데, Task 6이 그 함수를 **카드 제목에 그대로 재사용**해 없어진 폴더 워크트리는 행·카드 어디에도 브랜치가 없다. 파서는 prunable과 branch를 독립으로 담으므로 **데이터는 있는데 UI가 버리는 것**이고, 정리 여부를 판단할 때 필요한 정보가 정확히 그 브랜치다. 스펙 ③은 상태를 "문구로 명시"하라 했지 브랜치를 대체하라 하지 않았다.
- **M-1 (Minor·시각)**: `.worktree-row__terminal`의 `color: var(--concept-branch)`가 T4 CSS 교체 때 함께 쓸려나가 `❯_`(터미널 대상) 강조가 본문색으로 내려앉았다 — 스펙 ① "E7g·E7h 규칙 그대로" 위반.

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/WorktreesPanel.tsx` (카드 제목)
- Modify: `apps/desktop/src/renderer/src/components/worktrees-panel.css` (`__terminal` 색)

- [x] **Step 1: 카드 제목이 브랜치를 보존하도록.** 카드 `content`의 제목 줄(`ui-tooltip__title`)에서 `branchLabel(worktree)` 대신 브랜치 자체를 쓴다(행 1줄의 `'없어진 폴더'` 축약은 유지):

```tsx
                  <div className="ui-tooltip__title">
                    {worktree.branch ?? `분리됨 (${worktree.headHash?.slice(0, 7) ?? '?'})`}
                  </div>
```

(상태 문구는 이미 있는 "폴더가 없어졌어요…" 줄이 담당한다.)

- [x] **Step 2: 터미널 글리프 색 복구.** `worktrees-panel.css`의 `.worktree-row__terminal` 블록에 `color: var(--concept-branch);` 한 줄 추가.

- [x] **Step 3: 게이트** — typecheck, 루트 `pnpm test` **512 유지**, build, `npx playwright test e2e/smoke.spec.ts` **83 유지**(포그라운드 동기, Bash timeout 600000 필수).

- [x] **Step 4: 육안 검증** — prunable 워크트리(폴더를 지운 뒤 목록 갱신) 호버 카드에 **브랜치 이름이 보이는지**, `❯_`가 강조색인지 프로브로 확인하고 수치·문구를 보고한다. 프로브는 삭제하고 워킹트리 클린으로.

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/WorktreesPanel.tsx apps/desktop/src/renderer/src/components/worktrees-panel.css
git commit -m "fix(desktop): E7j 보완 — 없어진 폴더 카드에도 브랜치 표시·터미널 글리프 강조색 복구

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**통합 리뷰 Minor 후속 노트(기록만):** ① 분기점이 "400ms 유지 후"가 아니라 `onMouseEnter` 즉시 계산된다 — 목록 렌더 시 호출 0은 지켜지고(실측) 조회성·캐시라 실해는 작으나 스펙 ④ 문구와는 다름. ② `shortenParent`가 `shortenAbove`로 대체돼 프로덕션에서 죽었다(export·단위 테스트만 잔존). ③ `ReviewPopover` 외부 링크 버튼은 aria-label과 툴팁 문구가 **포함 관계**라 이중 낭독 소지(3-보완 규칙은 완전 일치일 때만 끔). ④ `worktree-row-<leaf>` testid 중복(플랜 Self-Review 5b의 알려진 위험). ⑤ `NestContext`는 직계 조상 1단만 닫는다(현재 중첩 최대 2단이라 안전).

**Task 7-보완 실행 편차:** 없음(플랜 Step 1~5 문면 그대로). **육안 검증 실측:** 폴더만 지운 prunable 워크트리 카드 제목이 `'없어진 폴더'`가 아니라 실제 브랜치 `"gone-branch"`로 표시되고 상태 문구는 유지 · `.worktree-row__terminal` computed color `rgb(167,139,250)` = `--concept-branch`(#a78bfa) 정확 일치.

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
| Task 5-보완 후 | +4 → 512 | 81 유지 |
| Task 6 후 | 512 | 81 유지 |
| Task 7 후 | 512 · e2e **89**(83+6) | +2 → 83 |

## Self-Review (플랜 자체 점검)

1. **스펙 커버리지**: ①두 줄 행=T1+T4 · ②공용 Tooltip·title 교체·E2E 전환=T2+T3 · ③리치 카드=T6 · ④분기점 지연 계산=T5 · 테스트=T1·T2·T5 단위 + T7 E2E 2건 + 스크린샷. 에러표 각 행: 홈 밖(T1 sourceChip/shortenParent) · 조상까지 동일(T1 uniqueNames 전체 확장) · 한 조각 경로(T1) · 분리됨(T4 branchLabel·T5 detached 테스트) · 없어진 폴더(T6 카드 줄) · 화면 밖 뒤집기/클램프(T2) · 갱신 시 닫힘(T2 scroll/resize 리스너) · 드래그 영역(무변) 전부 매핑.
2. **스펙 편차 2건(명시)**: (a) 네이티브 title은 41이 아니라 **19곳**(스펙 정정 필요) (b) 컴포넌트 단위 테스트(jsdom)는 **채택하지 않고** 순수 함수 단위 + E2E로 대체(인프라 부재·신규 의존성 회피).
3. **플레이스홀더**: 없음. "실독·같은 취지·편차 보고"는 프로젝트 관례로 항목화.
4. **타입 일관성**: `ForkPoint{base,ahead,behind}`가 domain(T5)→contract(T5)→store(T5)→panel props(T6)에서 동명. `shortenParent`·`sourceChip`·`uniqueNames`·`shortenBranch`(T1)↔T4·T6 사용 일치. `placeTooltip`(T2)↔Tooltip 내부. `forkPoints` 키 규칙(`경로::HEAD`)이 store(T5)와 카드(T6)에서 동일 — **T6 구현자는 키 계산을 지역 변수로 한 번만 만들어 쓸 것**(플랜 코드는 가독성을 위해 인라인 반복).
5. **알려진 위험 2건**: (a) Tooltip의 cloneElement ref 병합은 React 19 ref-as-prop 규약을 따른다 — 트리거가 함수형 컴포넌트면 동작하지 않는다(19곳 전부 DOM 요소임을 실측 확인). (b) 워크트리 testid를 리프 이름 기준으로 유지하므로 같은 리프 이름이 둘이면 testid가 중복된다 — 기존 E2E 무회귀를 위한 의도된 선택이며, T7의 신규 E2E는 화면 텍스트로 구분을 검증한다.

## 실행 기록 (부록)

- 실행 방식: 서브에이전트(구현 sonnet, 리뷰 opus) + 태스크별 통합(스펙+품질) 리뷰. 리뷰어가 **프로브 E2E·임시 저장소로 결함을 실측 재현**하는 방식이 이 에픽에서 특히 값을 했다.
- 태스크 → 커밋: T1 `b5250a1`(worktree-label 12건) · T2 `6b81f8c`(Tooltip·placeTooltip 5건) + 보완 `5016688`(꼬리 표시·ref/타이머) · T3 `debdef3`(title 19곳 교체) + 보완 `58ed9cd`(중첩 겹침·패널 제목·aria) · T4 `6ead4d2`(두 줄 행) · T5 `59aabd1`(분기점) + 보완 `a460bf6`(merge-base·동일SHA·양끝 생략·타이포) · T6 `53e5d2e`(리치 카드) · T7 `cb9736a`(E2E 2건+README) + 보완 `6c028b8`(prunable 브랜치·글리프 색).
- **리뷰가 잡은 Important 8건**(전부 보완으로 폐쇄): `/` 없는 브랜치의 거짓 `…` · 중첩 툴팁 2장 겹침(이번 에픽이 만든 회귀, 프로브로 박스 좌표까지 측정) · 패널 제목 잘림 정보 손실(플랜 전제가 틀렸음 — CSS가 실제로 말줄임) · 네임스페이스 브랜치 꼬리 무표시 · **merge-base를 실제로 부르지 않아 고아 계보에 거짓 분기점** · **origin/HEAD 환경에서 "기준=자기 자신" 가드 사망**(이 저장소가 그 상태) · prunable 카드에서 브랜치 소실 · `❯_` 강조색 소실.
- **플랜 자체 결함 4건**(리뷰가 판정·정정): `shortenBranch` 구현이 자기 테스트와 모순(구현자 교정이 옳다고 판정) · `shortenAbove` 기대값이 같은 블록 doc과 모순 · E2E title 단언 수 4→5 · 게이트 산술 3회(499→498, 507→508, 90→89). 플랜에 raw NUL 7개가 박혀 있던 것도 `::`로 정정(E7i에서 같은 사고 전례).
- 최종 게이트 실측: 루트 **512** · typecheck 전부 Done · desktop e2e **89**(smoke 83 + hosting 6) · last-screen 0건.
- 공식 스크린샷 2장(e7j-worktree-rows·e7j-worktree-hover) 컨트롤러 육안 검수 통과·사용자 전송.
- 통합 리뷰 Verdict: Fix first(2건) → 보완 후 게이트 재확인 완료.
