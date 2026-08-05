# E14b eslint 게이트 + Rules of React 위반 해소 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** React 규칙을 검사하는 게이트를 이 저장소에 처음 세우고, 그 게이트가 잡아낸 위반 중 이득이 명확한 것을 고친다.

**Architecture:** `eslint@10` + `eslint-plugin-react-hooks@7`을 렌더러에만, `react-hooks` recommended 규칙만 켠다. 게이트를 먼저 세우되 기존 위반은 **부채 목록(ratchet)** 으로 `warn` 강등해 브랜치가 내내 초록이도록 하고, 태스크마다 그 목록에서 한 줄씩 걷어낸다. 마지막 태스크가 목록이 비었음을 확인한다.

**Tech Stack:** eslint 10 · eslint-plugin-react-hooks 7.1.1 · typescript-eslint(파서 전용) · React 19.2.7 · Vitest(단위) · Playwright Electron(E2E)

## Global Constraints

- **정본 스펙:** `docs/superpowers/specs/2026-07-31-e14b-lint-rules-of-react-design.md`. 어긋나게 구현했다면 플랜에 편차로 기록한다.
- **언어:** 모든 주석·커밋 메시지·UI 문구는 한글. 주변 코드의 밀도를 따른다 — 이 저장소의 주석은 "왜"를 실측 숫자와 함께 적는다.
- **E2E는 반드시 단일 포그라운드 Bash 호출 + `timeout: 600000`.** 기본 120초 상한은 실행을 조용히 백그라운드로 보내고 멈춘다.
- **`npx playwright test`는 빌드하지 않는다.** `pnpm --filter @git-gui/desktop e2e`만 `electron-vite build &&`가 붙는다. 소스를 고친 뒤 `npx playwright test`를 돌리면 낡은 번들을 테스트하는 것이고 반증은 무의미해진다.
- **E2E 환경변수:** `GIT_GUI_E2E_REPO`(저장소 즉시 열기) · `GIT_GUI_USER_DATA`(설정 격리 — 직접 launch할 땐 반드시 지정) · `GIT_GUI_E2E_SHOW=1`(실제 창).
- **OS 전체 화면 캡처 금지.** 사용자의 다른 창에 사적 정보가 있다. Playwright 창 캡처만 쓰고 `/private/tmp/claude-501/-Users-sangyeop-kim-git-gui/b4ef6d32-042d-440c-8252-b8944659aa01/scratchpad/`에 쓴다.
- **사용자의 실행 중인 dev 앱을 건드리거나 재시작하지 않는다.**
- **`exhaustive-deps` 14건은 이 에픽에서 고치지 않는다** (E14c). 억제를 유지하되 Task 7이 각각에 이유를 단다.
- **기준 게이트(시작 시점):** typecheck 6/6 · 루트 `pnpm test` **600** · build 성공 · e2e **124** · lint 없음.

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| **생성** `eslint.config.mjs` (저장소 루트) | 렌더러 대상 · `react-hooks` recommended · 영구 완화(`incompatible-library`) · 임시 부채 목록 |
| **수정** `package.json` (루트) | `lint` 스크립트 |
| **수정** `package.json` (루트) | eslint 관련 devDependency — **`apps/desktop`이 아니다**(Task 1 정정) |
| **생성** `apps/desktop/src/renderer/src/ui/use-now.ts` | 공용 60초 틱 — 렌더 중 `Date.now()` 제거 |
| **생성** `apps/desktop/test/use-now.test.ts` | 위 훅의 단위 테스트 |
| **수정** 7개 컴포넌트 | `formatRelativeTime(x, Date.now())` → `useNow()` |
| **수정** `ui/PromptDialog.tsx` · `components/AddWorktreeDialog.tsx` · `App.tsx` | `set-state-in-effect` 4건 |
| **수정** `ui/Tooltip.tsx` | `immutability` 해소(모듈 헬퍼) + `refs` 근거 있는 억제 |
| **수정** `apps/desktop/e2e/smoke.spec.ts` | 회귀 E2E 2건 |

---

### Task 1: eslint 게이트 + 부채 목록

**Files:**
- Create: `eslint.config.mjs`
- Modify: `package.json` (루트, `scripts`)
> **정정(Task 1 실측):** 초안은 `apps/desktop`에 깔라고 했으나 **틀렸다.** `eslint.config.mjs`와
> `lint` 스크립트가 둘 다 루트에 있어 desktop에만 깔면 `eslint: command not found`가 나고,
> 설정의 `import`도 루트에서 해석된다. **워크스페이스 루트에 넣는다** — `apps/desktop/package.json`은
> 건드리지 않는다.

**Interfaces:**
- Produces: `pnpm lint` 스크립트. 이후 모든 태스크가 이걸로 자기 작업을 검증한다.
- Consumes: 없음.

> **왜 부채 목록인가.** 게이트를 세우는 순간 에러 11건이 뜬다. 그대로 두면 브랜치가 내내 빨갛고,
> 태스크 사이에 "원래 빨간 건지 내가 깬 건지"를 구별할 수 없다. 그래서 **지금 위반하는 파일·규칙만
> 골라 `warn`으로 강등한 목록**을 두고, 태스크마다 한 줄씩 지운다. 목록이 비면 게이트가 완전해진다.

- [ ] **Step 1: 의존성을 설치한다**

```bash
cd "/Users/sangyeop_kim/git gui"
pnpm add -w -D eslint@^10 eslint-plugin-react-hooks@^7 typescript-eslint@^8
```

- [ ] **Step 2: `eslint.config.mjs`를 만든다**

```js
// E14b — 이 저장소의 첫 lint 게이트. React 규칙만, 렌더러만 본다.
// packages/*·src/main은 React 코드가 아니라 이 규칙이 할 일이 없고, typescript-eslint 권장
// 규칙셋을 모노레포 전체에 켜면 수백 건이 쏟아지는데 이 에픽의 목적이 아니다 (YAGNI, 스펙 §3)
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default [
  { ignores: ['**/node_modules/**', '**/out/**', '**/dist/**', '**/test-results/**'] },
  {
    files: ['apps/desktop/src/renderer/src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    // 영구 완화 — @tanstack/react-virtual v3는 컴파일러와 호환되지 않고 업스트림 수정이 없다
    // (v3.14.9가 마지막, v4 없음). 우리 코드로 못 고치므로 경고로 둔다 (스펙 §4-5).
    // 주의: 이 다섯 파일은 규칙이 통째로 건너뛰어져 **다른 위반도 보고되지 않는다** —
    // 게이트가 초록이어도 이 안은 검사되지 않았다는 뜻이다
    files: [
      'apps/desktop/src/renderer/src/components/ChangesPanel.tsx',
      'apps/desktop/src/renderer/src/components/CommitDetailPanel.tsx',
      'apps/desktop/src/renderer/src/components/ConflictPanel.tsx',
      'apps/desktop/src/renderer/src/components/DiffView.tsx',
      'apps/desktop/src/renderer/src/components/HistoryPanel.tsx',
    ],
    rules: { 'react-hooks/incompatible-library': 'warn' },
  },
  {
    // ── E14b 부채 목록 (임시) ──────────────────────────────────────────────
    // 게이트를 먼저 세우고 위반을 태스크별로 걷어내기 위한 ratchet이다.
    // 태스크가 한 파일을 고칠 때마다 여기서 그 항목을 지운다. Task 8이 이 블록 전체가
    // 사라졌음을 확인한다 — 남아 있으면 그 태스크가 안 끝난 것이다.
    files: [
      'apps/desktop/src/renderer/src/App.tsx',
      'apps/desktop/src/renderer/src/components/AddWorktreeDialog.tsx',
      'apps/desktop/src/renderer/src/components/BranchSwitcher.tsx',
      'apps/desktop/src/renderer/src/components/BranchesPanel.tsx',
      'apps/desktop/src/renderer/src/components/ReviewDetailPanel.tsx',
      'apps/desktop/src/renderer/src/components/ShelfPopover.tsx',
      'apps/desktop/src/renderer/src/components/WorktreesPanel.tsx',
      'apps/desktop/src/renderer/src/ui/PromptDialog.tsx',
      'apps/desktop/src/renderer/src/ui/Tooltip.tsx',
    ],
    rules: {
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
]
```

> **정정(Task 1 실측) — 블록이 하나 더 필요하다.** 기반 블록의 `reportUnusedDisableDirectives: 'error'`와
> 죽은 억제 3건(Task 7 몫)이 충돌해, 위 설정 그대로는 「에러 0」이 성립하지 않는다(3 errors).
> 죽은 억제를 **별도 부채 블록**으로 뺀다 — `reportUnusedDisableDirectives`는 `rules`가 아니라
> `linterOptions`라 위 블록의 `rules`로는 못 낮추고, 무엇보다 **걷어내는 태스크가 다르다**
> (`App.tsx`의 규칙 부채는 Task 5, 억제 3건은 Task 7). 한 블록에 묶으면 Task 5가 `App.tsx`를
> 빼는 순간 브랜치가 빨개진다 — ratchet이 정확히 막으려던 상황이다.
>
> ```js
> {
>   files: ['apps/desktop/src/renderer/src/App.tsx'],
>   linterOptions: { reportUnusedDisableDirectives: 'warn' },
> }
> ```
>
> **실제로 커밋된 설정(`6341e24`의 `eslint.config.mjs`)이 정본이다** — 이후 태스크는 그 파일을 보고 걷어낸다.

루트 `package.json`의 `scripts`에 더한다:

```json
"lint": "eslint ."
```

- [ ] **Step 3: 게이트가 에러 0으로 통과하는지 확인한다**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm lint
```
Expected: **에러 0.** 경고는 나온다(`incompatible-library` 5 + 부채 목록 11 + 죽은 억제 3 = 19).
에러가 하나라도 있으면 부채 목록에 빠진 파일이 있는 것이니 그 파일을 목록에 더한다.

- [ ] **Step 4: 부채 목록이 실제로 무언가를 강등하고 있는지 확인한다 (공허한 게이트 방지)**

```bash
cd "/Users/sangyeop_kim/git gui" && npx eslint . -f json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).reduce((n,f)=>n+f.messages.length,0)))'
```
Expected: **19**. (초안의 `grep -c "warning"`은 **21**을 준다 — 요약 두 줄도 그 단어를 포함한다. Task 1 실측 정정.) 0이면 규칙이 아예 안 돌고 있는 것이다 — 설정이 렌더러를 못 잡고 있으니 고친다.

- [ ] **Step 5: 커밋**

```bash
cd "/Users/sangyeop_kim/git gui"
git add eslint.config.mjs package.json pnpm-lock.yaml
git commit -m "chore: E14b eslint 게이트 도입 — 이 저장소의 첫 lint

react-hooks recommended를 렌더러에만 켠다. 지금까지 이 저장소에는 lint가 하나도 없어
eslint-disable react-hooks/exhaustive-deps 16곳이 한 번도 검사된 적이 없었다.

기존 위반 11건은 부채 목록으로 warn 강등해 브랜치가 내내 초록이도록 했다 — 태스크마다
한 줄씩 걷어내고 마지막 태스크가 목록이 비었음을 확인한다. incompatible-library 5건은
서드파티(@tanstack/react-virtual v3, 업스트림 수정 없음)라 영구 경고다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `useNow()` 훅 + 단위 테스트

**Files:**
- Create: `apps/desktop/src/renderer/src/ui/use-now.ts`
- Create: `apps/desktop/test/use-now.test.ts`

**Interfaces:**
- Produces: `useNow(): number` — 현재 시각(ms). 60초마다 갱신. Task 3이 7곳에서 쓴다.
  같은 모듈이 `subscribeNow(listener: () => void): () => void`와 `NOW_TICK_MS`를 내보낸다(테스트용이 아니라 훅 자신이 쓴다).
- Consumes: 없음.

> **왜 타이머를 모듈이 소유하나.** 컴포넌트마다 `setInterval`을 걸면 7개가 따로 돌고 서로 다른
> 프레임에 깨어나, 같은 화면 안에서 조금씩 어긋난 시각을 보인다. 공용 타이머 하나를 구독만 하고,
> 구독자가 0이 되면 멈춘다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/desktop/test/use-now.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOW_TICK_MS, subscribeNow } from '../src/renderer/src/ui/use-now'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('공용 시각 틱', () => {
  it('NOW_TICK_MS는 60초 — 상대 시각은 분 단위라 그보다 잦을 이유가 없다', () => {
    expect(NOW_TICK_MS).toBe(60_000)
  })

  it('틱마다 구독자를 부른다', () => {
    const seen: number[] = []
    const stop = subscribeNow(() => seen.push(1))
    vi.advanceTimersByTime(NOW_TICK_MS * 3)
    stop()
    expect(seen.length).toBe(3)
  })

  it('구독자가 여럿이어도 타이머는 하나다 — 같은 틱에 함께 깨어난다', () => {
    const order: string[] = []
    const stopA = subscribeNow(() => order.push('a'))
    const stopB = subscribeNow(() => order.push('b'))
    vi.advanceTimersByTime(NOW_TICK_MS)
    stopA()
    stopB()
    // 한 번의 틱에서 둘 다 정확히 1회 — 타이머가 둘이면 순서가 a,b가 아니거나 수가 어긋난다
    expect(order).toEqual(['a', 'b'])
  })

  it('구독자가 0이 되면 타이머를 멈춘다 — 창을 닫아도 도는 것을 막는다', () => {
    const stop = subscribeNow(() => {})
    expect(vi.getTimerCount()).toBe(1)
    stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('한 구독자가 떠나도 남은 구독자는 계속 받는다', () => {
    let kept = 0
    const stopA = subscribeNow(() => {})
    const stopB = subscribeNow(() => {
      kept += 1
    })
    stopA()
    vi.advanceTimersByTime(NOW_TICK_MS * 2)
    stopB()
    expect(kept).toBe(2)
  })

  it('같은 구독 해제를 두 번 불러도 남의 타이머를 끄지 않는다', () => {
    const stopA = subscribeNow(() => {})
    const stopB = subscribeNow(() => {})
    stopA()
    stopA()
    expect(vi.getTimerCount()).toBe(1)
    stopB()
    expect(vi.getTimerCount()).toBe(0)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd "/Users/sangyeop_kim/git gui" && npx vitest run --root apps/desktop test/use-now.test.ts`
Expected: FAIL — `Failed to resolve import "../src/renderer/src/ui/use-now"`

- [ ] **Step 3: 구현한다**

`apps/desktop/src/renderer/src/ui/use-now.ts`:

```ts
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
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd "/Users/sangyeop_kim/git gui" && npx vitest run --root apps/desktop test/use-now.test.ts`
Expected: PASS — 6 passed

- [ ] **Step 5: 반증한다**

세 변이를 각각 넣고 빨개지는지 확인한 뒤 원복한다. 빨강/초록 출력을 그대로 보고에 붙인다.

1. `listeners.size === 0` 검사를 지운다
2. `timer === null` 검사를 지워 구독마다 새 타이머를 만든다
3. `listeners.delete(listener)`를 지운다

> **정정(Task 2 실측) — 초안이 예상한 대응은 셋 다 틀렸다.** 실제는 이렇다:
>
> | 변이 | 초안 예상 | 실측 | 이유 |
> | --- | --- | --- | --- |
> | 1 | 「한 구독자가 떠나도」 1건 | **2건** | 「같은 해제 두 번」도 같은 결함을 문다 — `stopA()`가 남은 B를 무시하고 타이머를 죽여 `getTimerCount()`가 0이 된다 |
> | 2 | 「타이머는 하나다」·「0이 되면 멈춘다」 2건 | **3건, 「0이 되면 멈춘다」는 초록** | 그 테스트는 구독자가 **하나뿐**이라 중복 타이머 결함이 드러나지 않는다. 구독자 2명인 테스트들이 대신 문다 |
> | 3 | 「0이 되면 멈춘다」 1건 | **파일 전체 4건 · 단독 1건** | 모듈 전역 상태 오염 전파 (아래) |
>
> **모듈 전역 상태가 테스트 간에 공유된다.** `afterEach`의 `vi.useRealTimers()`는 가짜 타이머를
> 지우지만 모듈 변수 `timer`는 못 지운다. 변이 3에서 리스너가 남으면 이후 모든 테스트에서
> `subscribeNow`가 "이미 타이머가 있다"고 판단해 아무것도 안 만든다.
> **진짜 탐지와 오염을 실패 메시지 방향으로 가른다** — 단독은 `expected 1 to be +0`(멈추지 않음 =
> 진짜 결함), 전체는 `expected +0 to be 1`(애초에 타이머가 안 생김 = 전파).
> 그래서 **어긋난 변이는 반드시 `-t`로 단독 실행해 다시 확인한다.**
>
> **사정거리가 없는 테스트 2건도 기록한다:** 「NOW_TICK_MS는 60초」는 세 변이 어디에도 안 물리는
> 계약 문서형이고, 「틱마다 구독자를 부른다」는 세 변이가 전부 해제 경로만 건드려 안 물렸다
> (`notify()` 호출을 지우는 4번째 변이를 넣으면 이것만 빨개진다 — 그게 이 테스트의 자리다).
>
> **주의 — 이 파일은 순서 의존적이다.** 앞으로 테스트를 추가할 때 자기 구독을 정리하지 않으면
> 그 뒤 테스트가 엉뚱한 이유로 빨개진다.

- [ ] **Step 6: 커밋**

```bash
cd "/Users/sangyeop_kim/git gui"
git add apps/desktop/src/renderer/src/ui/use-now.ts apps/desktop/test/use-now.test.ts
git commit -m "feat(desktop): E14b useNow() — 공용 60초 틱

렌더 중 Date.now()를 없애기 위한 훅. 타이머는 모듈이 하나만 소유하고 구독자에게 나눠 준다 —
컴포넌트마다 걸면 7개가 따로 돌며 같은 화면에서 어긋난 시각을 보인다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 렌더 중 `Date.now()` 7곳 제거

**Files:**
- Modify: `components/BranchSwitcher.tsx:47` · `components/BranchesPanel.tsx:376` · `components/ReviewDetailPanel.tsx:42` · `components/ShelfPopover.tsx:81` · `components/WorktreesPanel.tsx:132` · `components/HistoryPanel.tsx:520` · `components/CommitDetailPanel.tsx:260`
- Modify: `eslint.config.mjs` (부채 목록에서 `purity` 관련 파일 제거)

**Interfaces:**
- Consumes: Task 2의 `useNow(): number`.

> **일곱 곳이다, 다섯이 아니다.** 린트는 다섯만 잡는다 — `HistoryPanel`과 `CommitDetailPanel`은
> `incompatible-library`로 **통째 건너뛰어져 규칙이 아예 돌지 않기 때문**이다(스펙 §4-1·§4-5).
> 다섯만 고치면 같은 버그가 둘 남고, 그 둘은 어떤 게이트도 안 잡는다.

- [ ] **Step 1: 전수를 다시 확인한다**

```bash
cd "/Users/sangyeop_kim/git gui/apps/desktop/src/renderer/src" && grep -rn "formatRelativeTime(" . | grep "Date.now()"
```
Expected: 7줄. 다르면 플랜 작성 이후 코드가 바뀐 것이니 실제 목록을 따르고 보고한다.

- [ ] **Step 2: 각 컴포넌트에서 `useNow()`를 쓴다**

`BranchSwitcher.tsx`를 본보기로 삼는다 — 나머지 6곳도 같은 모양이다:

```tsx
import { useNow } from '../ui/use-now'   // 경로는 파일 위치에 맞춘다

export function BranchSwitcher(/* … */) {
  const now = useNow()
  // …
  return (
    // …
    <span className="branch-switcher__time">{formatRelativeTime(branch.committedAt, now)}</span>
  )
}
```

**목록 안에서 반복 렌더되는 곳**(`HistoryPanel:520`의 커밋 행, `ShelfPopover:81`, `WorktreesPanel:132`)은 `useNow()`를 **행마다가 아니라 그 컴포넌트에서 한 번** 부르고 값을 내려 준다. 행 컴포넌트마다 부르면 구독자가 수천 개가 된다.

> **정정(Task 3 실측) — 목록인 곳이 넷이다.** 초안은 셋만 꼽았지만 `ReviewDetailPanel:42`의 시각은
> 컴포넌트 본문이 아니라 **코멘트마다 렌더되는 별도 컴포넌트 `CommentRow`(`:37`) 안**에 있다.
> 거기서 `useNow()`를 부르면 코멘트 수만큼(`per_page=100` 상한) 구독자가 생긴다. 클로저로 닫을 수
> 없는 구조라 **이 한 곳만 props로 `now: number`를 내려 준다** — "컴포넌트에서 한 번" 원칙은 같다.

- [ ] **Step 3: 부채 목록에서 걷어낸다**

`eslint.config.mjs`의 부채 목록 `files`에서 아래를 지운다 — 이 파일들은 이제 `purity` 위반이 없다:
`BranchSwitcher.tsx` · `BranchesPanel.tsx` · `ReviewDetailPanel.tsx` · `ShelfPopover.tsx` · `WorktreesPanel.tsx`

`App.tsx`·`AddWorktreeDialog.tsx`·`PromptDialog.tsx`·`Tooltip.tsx`는 남긴다(Task 4~6 몫).

- [ ] **Step 4: 게이트**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm lint && pnpm typecheck && pnpm test
```
Expected: lint 에러 0 · typecheck 6/6 · Tests **606** (600 + Task 2의 6건)

- [ ] **Step 5: 반증한다**

한 곳(`BranchSwitcher.tsx`)만 `Date.now()`로 되돌리고 `pnpm lint` → **에러**가 나야 한다(부채 목록에서 뺐으므로 경고가 아니라 에러다). 원복 후 다시 초록. 출력을 붙인다.

- [ ] **Step 6: 상대 시각이 실제로 갱신되는지 눈으로 확인한다**

E2E나 스크린샷이 아니라 **단위 수준**으로 족하다 — `useNow`가 틱마다 새 값을 준다는 것은 Task 2가 이미 고정했고, 그 값이 `formatRelativeTime`으로 들어간다는 것은 타입이 보장한다. 다만 **7곳 전부 `now`를 실제로 쓰는지** grep으로 확인한다:

```bash
cd "/Users/sangyeop_kim/git gui/apps/desktop/src/renderer/src" && grep -rn "formatRelativeTime(" . | grep -c "Date.now()"
```
Expected: **0**

- [ ] **Step 7: 커밋**

```bash
cd "/Users/sangyeop_kim/git gui"
git add apps/desktop/src/renderer/src/components eslint.config.mjs
git commit -m "fix(desktop): E14b 렌더 중 Date.now() 7곳 제거 — react-hooks/purity

렌더가 벽시계에 의존해 같은 props로 다른 결과를 냈다. 실제 버그이기도 하다 — 상대 시각이
다른 이유로 리렌더될 때까지 '3분 전'에 멈춰 있었다.

린트는 다섯만 잡는다. HistoryPanel:520·CommitDetailPanel:260은 그 컴포넌트가
incompatible-library로 통째 건너뛰어져 규칙이 안 돈다 — grep 전수로 찾아 함께 고쳤다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `PromptDialog` · `AddWorktreeDialog` — 회귀 테스트 먼저, 그다음 `key`

**Files:**
- Modify: `apps/desktop/e2e/smoke.spec.ts` (회귀 2건 추가)
- Modify: `apps/desktop/src/renderer/src/ui/PromptDialog.tsx:41-43`
- Modify: `apps/desktop/src/renderer/src/components/AddWorktreeDialog.tsx:44-50`
- Modify: `eslint.config.mjs` (부채 목록에서 두 파일 제거)

> **순서를 반드시 지킨다.** 확인 결과 `PromptDialog`의 E1a 요구사항 *"실패로 열려 있는 동안에는
> 입력이 보존된다"* 를 고정하는 테스트가 **저장소에 하나도 없다.** 즉 `key` 도입이 그걸 깨도 지금은
> 아무도 못 잡는다. **테스트를 먼저 쓰고 현재 코드에서 초록임을 확인한 뒤** 구현을 바꿔야
> "원래 되던 것"임을 증명할 수 있다.

> **정정(Task 4 실측) — "테스트가 하나도 없다"는 틀렸다.** `apps/desktop/e2e/hosting.spec.ts:364`가
> 같은 요구사항을 이미 단언하고 있었다(토큰 프롬프트가 401에서 입력을 보존). 반증 변이에서 그
> 테스트도 함께 빨개져 드러났다 — 나는 `smoke.spec.ts`만 보고 단정했다. 그물은 0이 아니라 1이었다.
> 다만 순서 규칙 자체는 유효하다: 새 테스트가 다른 경로(브랜치 프롬프트)를 덮어 2겹이 되고,
> `hosting.spec.ts`는 mock GitHub 서버가 필요해 회귀 그물로는 무겁다.

- [ ] **Step 1: 회귀 테스트 2건을 쓴다 (구현은 아직 그대로)**

`smoke.spec.ts` 끝에 추가한다. `PromptDialog`가 실제로 쓰이는 흐름 하나를 골라야 한다 — 실패를
만들 수 있는 곳(예: 이미 있는 이름으로 브랜치 만들기)이다. 어느 흐름을 골랐는지 주석에 적는다.

```ts
/**
 * E14b — 이름 짓기가 실패해도 입력한 값이 남아 있다 (E1a 요구사항 고정).
 *
 * PromptDialog는 "열릴 때 initialValue로 채우고 닫힐 때 비운다"를 useEffect + setState로 했는데,
 * react-hooks/set-state-in-effect 위반이라 remount로 바꾼다. remount 조건이 잘못되면 실패로
 * 열려 있는 동안 입력이 날아가는데(E1a가 명시한 요구사항), **그걸 고정하는 테스트가 저장소에
 * 하나도 없었다.** 구현을 바꾸기 전에 현재 동작이 초록임을 확인해 둔다.
 *
 * 실패 유도: 이미 있는 브랜치 이름으로 만들기를 시도한다 (git이 거부한다).
 */
test('E14b — 이름 짓기가 실패해도 입력한 값이 남아 있다 (E1a 요구사항 고정)', async () => {
  const repo = await createRepoWithChange()
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    // 먼저 브랜치 하나를 실제로 만든다 — 그 이름이 다음 시도의 충돌 대상이 된다
    await window.getByTestId('header-branch').click()
    await window.getByTestId('branch-new').click()
    await window.getByTestId('prompt-input').fill('dup-branch')
    await window.getByTestId('prompt-submit').click()
    await expect(window.getByTestId('header-branch')).toContainText('dup-branch')

    // 같은 이름으로 다시 시도 → git이 거부하고 다이얼로그는 열린 채 남는다
    await window.getByTestId('header-branch').click()
    await window.getByTestId('branch-new').click()
    await window.getByTestId('prompt-input').fill('dup-branch')
    await window.getByTestId('prompt-submit').click()

    // 실패가 실제로 일어났는지 먼저 확인한다 — 안 그러면 아래 단언이 공허해진다
    await expect(window.getByTestId('prompt-error')).toBeVisible()
    // 핵심: 다시 칠 필요 없이 방금 친 값이 그대로 있어야 한다 (E1a)
    await expect(window.getByTestId('prompt-input')).toHaveValue('dup-branch')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E14b — 워크트리 만들기 폼은 닫았다 다시 열면 초기화된다.
 * 같은 이유(useEffect + setState → remount)로 바꾸므로 먼저 고정한다.
 * 이쪽은 반대 방향 요구사항이다 — 닫으면 버려야 한다.
 */
test('E14b — 워크트리 만들기를 닫았다 열면 폼이 초기화된다', async () => {
  const repo = await createRepoWithChange()
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-worktrees').click()
    await window.getByTestId('worktree-add').click()
    // 기본값을 벗어난 상태를 만든다 — 모드를 바꾸고 경로를 직접 고친다
    await window.getByTestId('add-worktree-mode-new').click()
    await window.getByTestId('add-worktree-path').fill('/tmp/e14b-should-be-discarded')
    await window.getByTestId('add-worktree-cancel').click()

    // 다시 열면 방금 친 것이 남아 있으면 안 된다
    await window.getByTestId('worktree-add').click()
    await expect(window.getByTestId('add-worktree-path')).not.toHaveValue(
      '/tmp/e14b-should-be-discarded',
    )
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
```

> **testid를 실제와 대조하라.** `prompt-input` · `prompt-error` · `prompt-submit` ·
> `header-branch` · `branch-new` · `add-worktree-mode-new` · `add-worktree-path`는 확인된 것이고,
> `left-tab-worktrees` · `worktree-add` · `add-worktree-cancel`은 **이름을 추정했다.**
> 없으면 실제 testid로 바꾸고 **무엇을 바꿨는지 보고한다.**
>
> 두 번째 테스트가 `not.toHaveValue`인 이유: 경로 필드는 브랜치 이름에서 자동 제안되므로 초기값이
> 빈 문자열이 아닐 수 있다. "정확히 무엇인가"가 아니라 "방금 친 것이 사라졌는가"가 요구사항이다.

- [ ] **Step 2: 현재 코드에서 초록임을 확인한다**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm --filter @git-gui/desktop e2e
```
(**단일 포그라운드 호출 · `timeout: 600000`**)
Expected: **126 passed** (124 + 2). **여기서 빨간 것이 있으면 멈추고 보고한다** — 요구사항이
이미 깨져 있다는 뜻이고, 그건 이 에픽이 만든 게 아니다.

- [ ] **Step 3: 커밋 (테스트만 먼저)**

```bash
cd "/Users/sangyeop_kim/git gui"
git add apps/desktop/e2e/smoke.spec.ts
git commit -m "test(desktop): E14b 다이얼로그 회귀 2건 — key 도입 전에 먼저 고정

PromptDialog의 '실패로 열려 있는 동안 입력 보존'(E1a)을 고정하는 테스트가 저장소에
하나도 없었다. 구현을 바꾸기 전에 현재 동작이 초록임을 확인해 둔다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: `PromptDialog`를 내부 래퍼 + `key`로 바꾼다**

> **호출부에 `key`를 달지 않는다.** 확인 결과 `PromptDialog`는 **닫혀도 언마운트되지 않는다**
> (react-aria `Modal`이 `isOpen`으로 표시만 제어하고, `PromptDialog` 함수 자신은 계속 렌더된다).
> 그래서 `useState`가 살아남고, 이펙트가 그걸 비우고 있었다. 호출부는 `App.tsx`에 **6곳**이라
> 거기마다 `key`를 다는 건 지저분하고 새 호출부에서 빠뜨리기 쉽다.
>
> **정정(Task 4 실측): 호출부는 6곳이 아니라 7곳**이고 하나는 `App.tsx`가 아니다 —
> `components/ManageBranchesDialog.tsx:101`(이름 바꾸기 프롬프트). "호출부에 key를 단다"를
> 택했다면 그 하나가 조용히 빠졌을 것이다. 파일 안 분리가 그걸 막는다.
> 또한 언마운트되지 않는 근거는 react-aria의 동작이 아니라 **구조**다 — `useState`가
> `ModalOverlay`보다 위(`PromptDialog` 함수 본문)에 있고 호출부 7곳 전부 조건 없이 렌더한다.
>
> 대신 **한 파일 안에서** 껍데기와 알맹이를 나눈다 — 호출부는 하나도 안 바뀐다.

```tsx
// ui/PromptDialog.tsx

export function PromptDialog(props: PromptDialogProps) {
  // E14b — 예전엔 안쪽에서 useEffect + setValue로 "열릴 때 채우고 닫힐 때 비우기"를 했다
  // (react-hooks/set-state-in-effect). 이 컴포넌트는 닫혀도 언마운트되지 않아 상태가 살아남기
  // 때문이었다. 열림 여부를 key로 주면 열고 닫을 때 알맹이가 새로 만들어져 초기값 한 번이면
  // 충분하고, **열려 있는 동안에는 remount가 없어** 실패로 열린 채 입력이 보존된다
  // (E1a 요구사항 — E2E로 고정했다)
  return <PromptDialogBody key={props.isOpen ? 'open' : 'closed'} {...props} />
}

function PromptDialogBody({ isOpen, initialValue, /* …나머지 props 그대로… */ }: PromptDialogProps) {
  const [value, setValue] = useState(initialValue ?? '')
  // …기존 본문 그대로, useEffect만 삭제…
}
```

기존 `export function PromptDialog(...)`의 본문이 그대로 `PromptDialogBody`가 되고, 그 안의
`useEffect(() => { setValue(...) }, [isOpen, initialValue])` 만 사라진다.

- [ ] **Step 5: `AddWorktreeDialog`도 같은 모양으로 바꾼다**

같은 구조다 — `AddWorktreeDialog`가 껍데기가 되어 `key={isOpen ? 'open' : 'closed'}`로
`AddWorktreeDialogBody`를 감싸고, 몸통에서 `useEffect`(`:44-50`, 열릴 때 `setMode`/`setBranch`/
`setNewName`/`setPath`/`setPathEdited`를 초기화)를 지운 뒤 각 `useState`의 초기값으로 옮긴다.

`available`은 `branches`/`checkedOut`에서 파생되므로 몸통 안에서 그대로 계산하면 되고,
`const [branch, setBranch] = useState(available[0]?.name ?? '')` 처럼 초기값에 쓴다.

- [ ] **Step 6: 부채 목록에서 두 파일을 지운다**

`eslint.config.mjs`에서 `ui/PromptDialog.tsx` · `components/AddWorktreeDialog.tsx` 제거.

- [ ] **Step 7: 게이트 + 반증**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm lint && pnpm typecheck && pnpm test
cd "/Users/sangyeop_kim/git gui" && pnpm --filter @git-gui/desktop e2e
```
Expected: lint 에러 0 · typecheck 6/6 · 606 · **126 passed**

반증: `key`(또는 remount 조건)를 열려 있는 동안에도 바뀌게 만들어 재빌드 → 「입력이 남아 있다」가
빨개져야 한다. 원복 후 초록. 출력을 붙인다.

- [ ] **Step 8: 커밋**

```bash
cd "/Users/sangyeop_kim/git gui"
git add apps/desktop/src/renderer/src/ui/PromptDialog.tsx apps/desktop/src/renderer/src/components/AddWorktreeDialog.tsx eslint.config.mjs
git commit -m "fix(desktop): E14b 다이얼로그 2건 — 이펙트 setState를 key remount로

react-hooks/set-state-in-effect. '열릴 때 초기화'는 React 공식 처방대로 remount로 표현한다.
E1a의 '실패로 열려 있는 동안 입력 보존'은 앞 커밋의 회귀 테스트가 지킨다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `App.tsx`의 `set-state-in-effect` 2건

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx:467` · `:501`
- Modify: `eslint.config.mjs` (부채 목록에서 `App.tsx` 제거)

**두 건은 성격이 다르다.**

**(a) `:501` — `repoPath`가 바뀌면 `setFindScope(null)`.**
"prop이 바뀌면 로컬 상태를 리셋"이라 Task 4와 같은 처방(remount 또는 렌더 중 파생)을 쓴다.
`App` 전체를 remount할 수는 없으므로, `findScope`를 `repoPath`와 함께 들고 다니다가 렌더 중
비교해 파생하는 React 공식 패턴을 쓴다:

```tsx
// E14b — 예전엔 useEffect에서 setFindScope(null)을 불렀다(set-state-in-effect).
// "저장소가 바뀌면 옛 검색 스코프는 무효"라는 규칙은 상태를 지우는 게 아니라 **함께 기억했다가
// 비교**하면 이펙트 없이 표현된다 (E7i 보완 Step 4의 의도는 그대로)
const [findScopeState, setFindScopeState] = useState<{ scope: FindScope | null; repo: string | null }>({
  scope: null,
  repo: store.repoPath,
})
const findScope = findScopeState.repo === store.repoPath ? findScopeState.scope : null
const setFindScope = (scope: FindScope | null) => setFindScopeState({ scope, repo: store.repoPath })
```

`FindScope` 타입 이름은 실제 코드에 맞춘다(현재 `setFindScope`가 받는 타입).

> **정정(Task 5 실측) — 위 코드는 앱을 망가뜨린다. 쓰지 마라.**
> 래핑된 `setFindScope`가 `repoPath`를 클로저로 무는데, ⌘F 키다운 리스너는 `[]`로 마운트 1회만
> 등록되므로 **첫 렌더의 `repoPath`(= `null`, RepoPicker 화면)를 영영 붙든다.** 저장소를 연 뒤
> ⌘F를 누르면 비교가 매번 어긋나 **찾기가 아예 안 열린다**(실측: ⌘F E2E 7건 전부 빨강).
>
> `useState`가 준 **안정된 setter를 그대로 두고** 비교용 상태만 따로 둔다:
>
> ```tsx
> const [findScope, setFindScope] = useState<'history' | 'diff' | 'commit-files' | 'changes' | null>(null)
> const [findScopeRepo, setFindScopeRepo] = useState(store.repoPath)
> if (findScopeRepo !== store.repoPath) {
>   setFindScopeRepo(store.repoPath)
>   setFindScope(null)
> }
> ```
>
> **그물이 없다는 사실도 기록한다.** 이 비교를 죽이고 E2E 전량을 돌려도 **한 건도 빨개지지 않는다** —
> **E2E에 저장소를 두 번 여는 시나리오가 하나도 없기 때문이다**(`repo-picker`/저장소 열기를 건드리는
> 테스트 0건). E7i 보완 Step 4의 "저장소가 바뀌면 옛 ⌘F 스코프 무효"는 코드 리뷰로만 지켜진다.
> (b)의 "우측이 접힌 채 미리보기 → 펴진다"도 마찬가지로 그물이 없다.