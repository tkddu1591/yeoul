# E0-1 디자인 기반 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 디자인 토큰 + Pretendard + Lucide + React Aria + 개념 픽토그램 시스템을 구축하고, 현재 동작하는 기능(열기·변경·diff·stage/unstage·commit)에 정식 레이아웃을 입힌다.

**Architecture:** renderer 안에 `ui/`(디자인 시스템: 토큰 CSS + 재사용 컴포넌트)와 `components/`(화면 컴포넌트)를 분리한다. 모든 색·간격·타이포는 `ui/tokens.css`의 CSS 변수로만 정의하고 컴포넌트는 `var()`만 사용한다(스펙 10장). 로직은 기존 스토어 그대로 — 이번 계획은 프레젠테이션 계층만 바꾼다.

**Tech Stack:** react-aria-components(버튼 등 접근성 프리미티브), lucide-react(단일 아이콘 세트), pretendard(한글 서체, npm 셀프호스팅 — CSP 'self' 준수), CSS 변수 토큰(라이트/다크).

**참조 스펙:** `docs/superpowers/specs/2026-07-15-easy-mode-design.md` 5장(메인 화면)·10장(디자인 시스템, 시각 언어), `docs/superpowers/specs/2026-07-15-tech-stack-design.md`

**범위 주의:** 스펙의 E0 전체(백업·역사 보기·메시지 자동 제안)가 아니라 그 **디자인 기반**이다. 백업·역사는 엔진(push/log)이 없으므로 "저장된 역사" 패널은 자리(placeholder)만 만든다. 스펙 로드맵의 나머지 E0 항목은 E0-2 계획에서 다룬다.

**검증 방식 주의:** renderer에는 단위 테스트 인프라(jsdom)가 없다 — 이번 범위에서 도입하지 않는다(YAGNI, E2E가 회귀 그물). 각 태스크의 게이트는 `pnpm typecheck` + `pnpm --filter @git-gui/desktop build` + (해당 시) E2E이며, 마지막에 스크린샷을 캡처해 사람이 육안 확인한다.

**금지 사항(스펙 10장):** 보라 그라데이션 남용, 이모지 아이콘, 과도한 glassmorphism, 임의 색(토큰 밖 색상값). 타입 스케일과 매크로 간격은 토큰을 사용하되, 컴포넌트 내부 미세 수치(패딩 1~2px 조정 등)는 허용한다. 이 계획의 코드가 디자인 정본이다 — 구현자는 임의로 "개선"하지 않는다.

**후속(E0-2/E1) 노트 — 이번 범위 아님:** 앱 내 테마 토글용 `[data-theme]` 셀렉터 병기(지금은 OS 설정 연동만), danger 버튼 hover/bg 토큰 계열(E1 되돌리기 확정 UI에서), 입력 테두리(`--color-border-strong`) 비텍스트 대비 3:1 보강(E1 폼 정비에서), 에러 상태 E2E(다이얼로그 스텁으로 role=alert·danger 색 검증), 웰컴 화면 용어 통일("프로젝트 폴더" vs "저장소" — E0-2 문구 정비), repoName 추출의 Windows 경로 분리자 처리(도메인 유틸로 이동 시), 좁은 창에서 사이드 열 `minmax(280px, …)` 완화, 충돌 마커(`<<<<<<<`) 라인의 별도 시각 처리(E0-2 충돌 UX).

---

## 파일 구조

```
apps/desktop/src/renderer/src/
  ui/                       # 디자인 시스템 (프레젠테이션 전용, 스토어 접근 금지)
    tokens.css              # 모든 토큰 — 라이트/다크
    base.css                # 리셋·기본 타이포·포커스 링
    Button.tsx + button.css # react-aria 버튼 (primary/neutral/ghost, md/sm)
    Badge.tsx + badge.css   # 칩 (git 용어 병기, 카운트)
    Panel.tsx + panel.css   # 패널 프레임 (제목+본문)
    Pictogram.tsx + pictogram.css # 개념 픽토그램 6종 + 변경 종류 배지
  components/               # 화면 컴포넌트 (기존 파일 리디자인)
    RepoPicker.tsx + repo-picker.css
    ChangesPanel.tsx + changes-panel.css
    DiffPanel.tsx + diff-panel.css
    CommitForm.tsx + commit-form.css
    HistoryPlaceholder.tsx + history-placeholder.css  # 신규
  App.tsx                   # 헤더 + 3열 레이아웃
  layout.css                # 앱 셸 레이아웃 (app.css 대체)
  main.tsx                  # 폰트·토큰·베이스 import
apps/desktop/e2e/smoke.spec.ts  # data-testid 기반으로 재정비 + 스크린샷
```

---

### Task 1: 의존성 + 디자인 토큰·베이스 스타일

**Files:**
- Modify: `apps/desktop/package.json` (의존성 추가 — pnpm add로)
- Create: `apps/desktop/src/renderer/src/ui/tokens.css`, `apps/desktop/src/renderer/src/ui/base.css`
- Modify: `apps/desktop/src/renderer/src/main.tsx`

- [ ] **Step 1: 의존성 설치**

Run: `pnpm --filter @git-gui/desktop add react-aria-components lucide-react pretendard`
Expected: exit 0. 해석된 버전을 보고에 기록할 것.

- [ ] **Step 2: 토큰 작성**

`apps/desktop/src/renderer/src/ui/tokens.css`:
```css
/* 디자인 토큰 — 모든 색·간격·타이포·모서리·그림자는 여기서만 정의한다.
   컴포넌트는 var()만 사용한다 (스펙 10장). */
:root {
  /* 다크 모드에서 네이티브 컨트롤(스크롤바·리사이즈 핸들)도 함께 전환 */
  color-scheme: light dark;

  /* 타이포 */
  --font-sans: 'Pretendard Variable', Pretendard, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  --text-xs: 11px;
  --text-sm: 12.5px;
  --text-md: 14px;
  --text-lg: 16px;
  --text-xl: 20px;
  --text-2xl: 22px;

  /* 간격 (4px 기반) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;

  /* 모서리·그림자 */
  --radius-sm: 6px;
  --radius-md: 9px;
  --radius-lg: 14px;
  --shadow-1: 0 1px 3px rgb(16 24 40 / 0.06), 0 1px 2px rgb(16 24 40 / 0.04);
  --shadow-2: 0 6px 16px rgb(16 24 40 / 0.1);

  /* 중립 */
  --color-bg: #f4f5f7;
  --color-surface: #ffffff;
  --color-surface-sunken: #f8f9fb;
  --color-border: #e4e7ec;
  --color-border-strong: #d0d5dd;
  --color-text: #1c2230;
  --color-text-muted: #5f6673;
  --color-text-faint: #6b7484; /* 정보 텍스트에도 쓰인다 — surface 대비 4.5:1 이상 유지 필수 */

  /* 주 액션·상태 */
  --color-accent: #2e5ce6;
  --color-accent-hover: #244fd0;
  --color-accent-active: #1e44bd; /* 눌림(pressed) 피드백 */
  --color-accent-text: #ffffff;
  --color-danger: #d92d20;
  --color-focus: #2e5ce6; /* 전역 포커스 링 — 비텍스트 3:1 이상 유지 필수 */
  --color-selection-bg: #e9eefc; /* 선택 상태 — 개념색(commit 파랑)과 분리된 전용 토큰 */
  --opacity-disabled: 0.45;

  /* Git 원어 병기 배지 — "파란 모노 pill = Git 원어"를 별도 정체성으로 고정 (개념색과 디커플링) */
  --term-badge: #2563eb;
  --term-badge-bg: #e8f0fe;

  /* 개념 정체성 — 앱 전체 고정 (스펙 10장 시각 언어: 내 작업·실험 공간·저장 시점·보관함·백업·충돌)
     색약(적록)에서 shelf↔conflict, branch↔commit은 색만으로 구분되지 않는다 —
     이 개념들의 아이콘 단독(라벨 없는) 사용은 금지, 항상 라벨·형태를 병행한다 */
  --concept-mine: #0e7a4e;
  --concept-mine-bg: #e6f5ec;
  --concept-branch: #6d4fc4;
  --concept-branch-bg: #efe9fb;
  --concept-commit: #2563eb;
  --concept-commit-bg: #e8f0fe;
  --concept-shelf: #9a6119;
  --concept-shelf-bg: #fdf1e2;
  --concept-backup: #0e7490;
  --concept-backup-bg: #e7f6f8;
  --concept-conflict: #b53c0c;
  --concept-conflict-bg: #fdeaea;

  /* 변경 종류 */
  --change-modified: #9a6119;
  --change-added: #0e7a4e;
  --change-deleted: #d92d20;
  --change-renamed: #6d4fc4;
  --change-untracked: #0e7490;

  /* diff */
  --diff-add-bg: #e9f7ee;
  --diff-add-text: #14663d;
  --diff-del-bg: #fdeeee;
  --diff-del-text: #b42318;
  --diff-hunk-bg: #eef2ff;
  --diff-hunk-text: #4f5ec0;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #16181d;
    --color-surface: #1e2128;
    --color-surface-sunken: #191c22;
    --color-border: #2c313b;
    --color-border-strong: #3a4150;
    --color-text: #e8eaf0;
    --color-text-muted: #a3abba;
    --color-text-faint: #828da0;

    --color-accent: #7c97fb;
    --color-accent-hover: #93a9fc;
    --color-accent-active: #a8b9fd;
    --color-accent-text: #10131a;
    --color-danger: #f97066;
    --color-focus: #4d69c9;
    --color-selection-bg: #222c47;
    --term-badge: #7aa2ff;
    --term-badge-bg: #1c2a4a;

    --concept-mine: #4ccb8f;
    --concept-mine-bg: #123527;
    --concept-branch: #a78bfa;
    --concept-branch-bg: #2b2440;
    --concept-commit: #7aa2ff;
    --concept-commit-bg: #1c2a4a;
    --concept-shelf: #e2a458;
    --concept-shelf-bg: #38290f;
    --concept-backup: #5cc8dc;
    --concept-backup-bg: #10333b;
    --concept-conflict: #f08c5a;
    --concept-conflict-bg: #3d1f12;

    --change-modified: #e2a458;
    --change-added: #4ccb8f;
    --change-deleted: #f97066;
    --change-renamed: #a78bfa;
    --change-untracked: #5cc8dc;

    --diff-add-bg: #12301f;
    --diff-add-text: #6fd39b;
    --diff-del-bg: #3a1a18;
    --diff-del-text: #f9a8a0;
    --diff-hunk-bg: #232a4a;
    --diff-hunk-text: #a5b4fc;

    --shadow-1: 0 1px 3px rgb(0 0 0 / 0.4);
    --shadow-2: 0 6px 16px rgb(0 0 0 / 0.5);
  }
}
```

`apps/desktop/src/renderer/src/ui/base.css`:
```css
*,
*::before,
*::after {
  box-sizing: border-box;
}
html,
body,
#root {
  height: 100%;
}
body {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--text-md);
  color: var(--color-text);
  background: var(--color-bg);
  -webkit-font-smoothing: antialiased;
}
button,
input,
textarea,
select {
  font: inherit;
}
:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
```

- [ ] **Step 3: main.tsx에 import 추가** (기존 app.css는 Task 6까지 유지 — 화면이 깨지지 않게)

`apps/desktop/src/renderer/src/main.tsx` 전체 교체:
```tsx
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import './ui/tokens.css'
import './ui/base.css'
import './app.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
```

- [ ] **Step 4: 대비 회귀 테스트** — 토큰이 디자인 정본이므로 WCAG 대비를 테스트로 고정한다 (색을 바꾸면 게이트가 잡는다)

루트 `vitest.config.ts` 전체 교체:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts'] },
})
```

`apps/desktop/vitest.config.ts` 생성:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } })
```

`apps/desktop/test/tokens-contrast.test.ts` 생성:
```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// 토큰 CSS가 디자인 정본이다 — 여기서 WCAG 대비를 고정해 색 회귀를 막는다
const css = readFileSync(join(__dirname, '../src/renderer/src/ui/tokens.css'), 'utf8')

function parseTokens(block: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const match of block.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    map.set(match[1]!, match[2]!)
  }
  return map
}

const mediaIndex = css.indexOf('@media')
const lightTokens = parseTokens(css.slice(0, mediaIndex))
const darkTokens = new Map([...lightTokens, ...parseTokens(css.slice(mediaIndex))])

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(foreground: string, background: string): number {
  const [bright, dim] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (bright! + 0.05) / (dim! + 0.05)
}

/** [전경 토큰, 배경 토큰, 최소 대비] — 텍스트 4.5:1, 비텍스트(포커스 링) 3:1 */
const PAIRS: Array<[string, string, number]> = [
  ['--color-text', '--color-surface', 4.5],
  ['--color-text-muted', '--color-surface', 4.5],
  ['--color-text-faint', '--color-surface', 4.5],
  ['--color-accent-text', '--color-accent', 4.5],
  ['--color-accent-text', '--color-accent-active', 4.5],
  ['--color-danger', '--color-surface', 4.5],
  ['--color-focus', '--color-surface', 3],
  ['--term-badge', '--term-badge-bg', 4.5],
  ['--concept-mine', '--concept-mine-bg', 4.5],
  ['--concept-branch', '--concept-branch-bg', 4.5],
  ['--concept-commit', '--concept-commit-bg', 4.5],
  ['--concept-shelf', '--concept-shelf-bg', 4.5],
  ['--concept-backup', '--concept-backup-bg', 4.5],
  ['--concept-conflict', '--concept-conflict-bg', 4.5],
  ['--diff-add-text', '--diff-add-bg', 4.5],
  ['--diff-del-text', '--diff-del-bg', 4.5],
  ['--diff-hunk-text', '--diff-hunk-bg', 4.5],
]

describe.each([
  ['라이트', lightTokens],
  ['다크', darkTokens],
] as const)('%s 테마 토큰 대비 (WCAG)', (_theme, tokens) => {
  it.each(PAIRS)('%s / %s ≥ %s:1', (foreground, background, minimum) => {
    const fg = tokens.get(foreground)
    const bg = tokens.get(background)
    expect(fg, `${foreground} 토큰이 없다`).toBeDefined()
    expect(bg, `${background} 토큰이 없다`).toBeDefined()
    expect(contrast(fg!, bg!)).toBeGreaterThanOrEqual(minimum)
  })
})
```

- [ ] **Step 5: 검증**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: 모두 exit 0 — **72 tests** (기존 38 + 대비 34), E2E 1 passed (기존 화면 그대로 + 폰트만 바뀜)

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/renderer/src/ui apps/desktop/src/renderer/src/main.tsx apps/desktop/vitest.config.ts apps/desktop/test vitest.config.ts
git commit -m "feat(desktop): 디자인 토큰·베이스 스타일과 Pretendard 도입

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: UI 킷 — Button, Badge, Panel

**Files:**
- Create: `apps/desktop/src/renderer/src/ui/Button.tsx`, `ui/button.css`, `ui/Badge.tsx`, `ui/badge.css`, `ui/Panel.tsx`, `ui/panel.css`

- [ ] **Step 1: Button (react-aria)**

`apps/desktop/src/renderer/src/ui/Button.tsx`:
```tsx
import type { ReactNode } from 'react'
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'
import './button.css'

type Variant = 'primary' | 'neutral' | 'ghost'
type Size = 'md' | 'sm'

interface ButtonProps extends Omit<AriaButtonProps, 'className' | 'children' | 'style'> {
  variant?: Variant
  size?: Size
  /** E2E용 data-testid */
  testId?: string
  children: ReactNode
}

export function Button({ variant = 'neutral', size = 'md', testId, children, ...rest }: ButtonProps) {
  // data-* 속성은 컴포넌트 props 타입에 없으므로 스프레드로 전달한다
  const testProps = testId ? { 'data-testid': testId } : {}
  return (
    <AriaButton {...rest} {...testProps} className={`ui-button ui-button--${variant} ui-button--${size}`}>
      {children}
    </AriaButton>
  )
}
```

`apps/desktop/src/renderer/src/ui/button.css`:
```css
.ui-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.ui-button--md {
  padding: 7px 14px;
  font-size: var(--text-sm);
}
.ui-button--sm {
  padding: 4px 10px;
  font-size: var(--text-xs);
  border-radius: var(--radius-sm);
}
.ui-button--primary {
  background: var(--color-accent);
  color: var(--color-accent-text);
}
.ui-button--primary[data-hovered] {
  background: var(--color-accent-hover);
}
.ui-button--primary[data-pressed] {
  background: var(--color-accent-active);
}
.ui-button--neutral {
  background: var(--color-surface);
  color: var(--color-text);
  border-color: var(--color-border-strong);
  box-shadow: var(--shadow-1);
}
.ui-button--neutral[data-hovered] {
  border-color: var(--color-text-faint);
}
.ui-button--neutral[data-pressed] {
  background: var(--color-surface-sunken);
}
.ui-button--ghost {
  background: transparent;
  color: var(--color-text-muted);
}
.ui-button--ghost[data-hovered] {
  background: var(--color-surface-sunken);
  color: var(--color-text);
}
.ui-button--ghost[data-pressed] {
  background: var(--color-border);
}
.ui-button[data-disabled] {
  opacity: var(--opacity-disabled);
  cursor: default;
}
/* 포커스 링은 base.css의 전역 :focus-visible이 단일 진실 — 여기서 중복 정의하지 않는다 */
```

- [ ] **Step 2: Badge**

`apps/desktop/src/renderer/src/ui/Badge.tsx`:
```tsx
import type { ReactNode } from 'react'
import './badge.css'

interface BadgeProps {
  children: ReactNode
  /** git: Git 용어 병기(모노스페이스, 파랑) / count: 숫자 카운트 / neutral: 일반 */
  tone?: 'neutral' | 'git' | 'count'
}

export function Badge({ children, tone = 'neutral' }: BadgeProps) {
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>
}
```

`apps/desktop/src/renderer/src/ui/badge.css`:
```css
.ui-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: var(--text-xs);
  font-weight: 600;
  background: var(--color-surface-sunken);
  color: var(--color-text-muted);
}
.ui-badge--git {
  font-family: var(--font-mono);
  font-weight: 500;
  background: var(--term-badge-bg);
  color: var(--term-badge);
}
.ui-badge--count {
  min-width: 22px;
  justify-content: center;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 3: Panel**

`apps/desktop/src/renderer/src/ui/Panel.tsx`:
```tsx
import type { ReactNode } from 'react'
import './panel.css'

interface PanelProps {
  title: string
  /** 제목 옆 배지 등 */
  accessory?: ReactNode
  children: ReactNode
  testId?: string
}

export function Panel({ title, accessory, children, testId }: PanelProps) {
  return (
    <section className="ui-panel" data-testid={testId}>
      <header className="ui-panel__head">
        <h2>{title}</h2>
        {accessory}
      </header>
      <div className="ui-panel__body">{children}</div>
    </section>
  )
}
```

`apps/desktop/src/renderer/src/ui/panel.css`:
```css
.ui-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-1);
  overflow: hidden;
}
.ui-panel__head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border);
  flex: none;
}
.ui-panel__head h2 {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 700;
}
.ui-panel__body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
```

- [ ] **Step 4: 검증**

Run: `pnpm typecheck && pnpm --filter @git-gui/desktop build`
Expected: exit 0 (아직 사용처 없음 — 컴파일만 확인)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/ui
git commit -m "feat(desktop): UI 킷 — Button(react-aria)·Badge·Panel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: UI 킷 — 개념 픽토그램과 변경 종류 배지

**Files:**
- Create: `apps/desktop/src/renderer/src/ui/Pictogram.tsx`, `ui/pictogram.css`

- [ ] **Step 1: Pictogram + ChangeKindBadge**

`apps/desktop/src/renderer/src/ui/Pictogram.tsx`:
```tsx
import type { ReactNode } from 'react'
import type { ChangeKind } from '@git-gui/domain'
import './pictogram.css'

export type ConceptKind = 'mine' | 'branch' | 'commit' | 'shelf' | 'backup' | 'conflict'

/** 개념별 고정 픽토그램 — 스펙 10장: 앱 전체에서 동일한 시각 정체성을 유지한다 */
const CONCEPT_PATHS: Record<ConceptKind, ReactNode> = {
  mine: (
    <>
      <path d="M12 3 v18" />
      <circle cx="12" cy="21" r="2.2" fill="currentColor" stroke="none" />
    </>
  ),
  branch: (
    <>
      <path d="M6 3 v18 M6 9 Q6 15 15 15" />
      <circle cx="18" cy="15" r="2.4" />
    </>
  ),
  commit: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2 v4 M12 18 v4" />
    </>
  ),
  shelf: <path d="M4 8 h16 v11 H4 z M9 8 V5 h6 v3" />,
  backup: (
    <path d="M7 17 Q3 17 3 13 Q3 9 7 9 Q8 5 12 5 Q16 5 17 9 Q21 9 21 13 Q21 17 17 17 M12 19 v-6 m0 0 l-2.5 2.5 M12 13 l2.5 2.5" />
  ),
  conflict: (
    <>
      <path d="M12 4 L21 19 H3 z M12 10 v3" />
      <circle cx="12" cy="16.6" r="1.15" fill="currentColor" stroke="none" />
    </>
  ),
}

interface PictogramProps {
  kind: ConceptKind
  /** 아이콘 크기(px). 배경 박스는 +10px */
  size?: number
  /** 의미 전달용이면 라벨 필수(접근성 — 아이콘 단독 의미 전달 금지). 순수 장식이면 생략 */
  label?: string
}

export function Pictogram({ kind, size = 18, label }: PictogramProps) {
  const box = size + 10
  return (
    <span
      className={`ui-pictogram ui-pictogram--${kind}`}
      style={{ width: box, height: box }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {CONCEPT_PATHS[kind]}
      </svg>
    </span>
  )
}

const CHANGE_LABELS: Record<ChangeKind, string> = {
  modified: '수정됨',
  added: '추가됨',
  deleted: '삭제됨',
  renamed: '이름 변경',
  copied: '복사됨',
  typechange: '형식 변경',
  untracked: '새 파일',
  conflicted: '충돌',
}

/** 변경 종류 = 색 점 + 짧은 라벨. 색 단독으로 의미를 전달하지 않는다(접근성) */
export function ChangeKindBadge({ kind }: { kind: ChangeKind }) {
  return (
    <span className={`ui-change-badge ui-change-badge--${kind}`}>
      <span className="ui-change-badge__dot" aria-hidden="true" />
      {CHANGE_LABELS[kind]}
    </span>
  )
}
```

`apps/desktop/src/renderer/src/ui/pictogram.css`:
```css
.ui-pictogram {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  flex: none;
}
.ui-pictogram--mine {
  color: var(--concept-mine);
  background: var(--concept-mine-bg);
}
.ui-pictogram--branch {
  color: var(--concept-branch);
  background: var(--concept-branch-bg);
}
.ui-pictogram--commit {
  color: var(--concept-commit);
  background: var(--concept-commit-bg);
}
.ui-pictogram--shelf {
  color: var(--concept-shelf);
  background: var(--concept-shelf-bg);
}
.ui-pictogram--backup {
  color: var(--concept-backup);
  background: var(--concept-backup-bg);
}
.ui-pictogram--conflict {
  color: var(--concept-conflict);
  background: var(--concept-conflict-bg);
}

.ui-change-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--color-text-muted);
  flex: none;
}
.ui-change-badge__dot {
  width: 7px;
  height: 7px;
  border-radius: 2.5px;
  background: var(--color-text-faint);
}
.ui-change-badge--modified .ui-change-badge__dot {
  background: var(--change-modified);
}
.ui-change-badge--added .ui-change-badge__dot {
  background: var(--change-added);
}
.ui-change-badge--deleted .ui-change-badge__dot {
  background: var(--change-deleted);
}
.ui-change-badge--renamed .ui-change-badge__dot,
.ui-change-badge--copied .ui-change-badge__dot {
  background: var(--change-renamed);
}
.ui-change-badge--typechange .ui-change-badge__dot {
  background: var(--change-modified);
}
.ui-change-badge--untracked .ui-change-badge__dot {
  background: var(--change-untracked);
}
.ui-change-badge--conflicted {
  color: var(--concept-conflict);
  font-weight: 700;
}
.ui-change-badge--conflicted .ui-change-badge__dot {
  background: var(--concept-conflict);
}
```

- [ ] **Step 2: 검증**

Run: `pnpm typecheck && pnpm --filter @git-gui/desktop build`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/ui
git commit -m "feat(desktop): 개념 픽토그램 6종과 변경 종류 배지

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: RepoPicker 웰컴 화면

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/RepoPicker.tsx` (전체 교체)
- Create: `apps/desktop/src/renderer/src/components/repo-picker.css`

- [ ] **Step 1: 구현**

`apps/desktop/src/renderer/src/components/RepoPicker.tsx` 전체 교체:
```tsx
import { FolderOpen } from 'lucide-react'
import { Button } from '../ui/Button'
import { Pictogram } from '../ui/Pictogram'
import './repo-picker.css'

interface RepoPickerProps {
  onOpen(): void
  error: string | null
}

export function RepoPicker({ onOpen, error }: RepoPickerProps) {
  return (
    <div className="repo-picker">
      <div className="repo-picker__card">
        <div className="repo-picker__marks" aria-hidden="true">
          <Pictogram kind="commit" size={20} />
          <Pictogram kind="branch" size={20} />
          <Pictogram kind="shelf" size={20} />
        </div>
        <h1>Git GUI</h1>
        <p className="repo-picker__desc">
          프로젝트 폴더를 열면 바뀐 파일을 확인하고
          <br />
          안전하게 저장할 수 있어요.
        </p>
        <Button variant="primary" onPress={onOpen} testId="open-repo">
          <FolderOpen size={16} aria-hidden="true" /> 저장소 열기
        </Button>
        {error && (
          <p className="repo-picker__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
```

`apps/desktop/src/renderer/src/components/repo-picker.css`:
```css
.repo-picker {
  display: grid;
  place-items: center;
  height: 100vh;
  background: var(--color-bg);
}
.repo-picker__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-8) 56px;
  max-width: 420px; /* 긴 에러 메시지가 카드를 무한 확장시키지 않게 */
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-2);
  text-align: center;
}
.repo-picker__marks {
  display: flex;
  gap: var(--space-2);
}
.repo-picker__card h1 {
  margin: var(--space-2) 0 0;
  font-size: var(--text-2xl);
  letter-spacing: -0.01em;
}
/* 설명문은 전용 클래스로 — 요소 셀렉터(p)는 특이도로 __error를 덮어쓴다 */
.repo-picker__desc {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  line-height: 1.6;
}
.repo-picker__error {
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
  color: var(--color-danger);
}
```

- [ ] **Step 2: 검증**

Run: `pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: 모두 exit 0 (E2E는 RepoPicker를 거치지 않으므로 기존 그대로 통과)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/components
git commit -m "feat(desktop): RepoPicker 웰컴 화면 리디자인

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 작업 화면 컴포넌트 리디자인 + E2E data-testid 재정비

UI 문구·구조와 E2E 셀렉터가 함께 바뀌므로 한 태스크로 원자적으로 처리한다(스위트 green 유지).

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/ChangesPanel.tsx`, `DiffPanel.tsx`, `CommitForm.tsx` (전체 교체)
- Create: `components/changes-panel.css`, `components/diff-panel.css`, `components/commit-form.css`, `components/HistoryPlaceholder.tsx`, `components/history-placeholder.css`
- Modify: `apps/desktop/e2e/smoke.spec.ts` (셀렉터 재정비 + 스크린샷)

- [ ] **Step 1: ChangesPanel**

`apps/desktop/src/renderer/src/components/ChangesPanel.tsx` 전체 교체:
```tsx
import { CircleMinus, CirclePlus } from 'lucide-react'
import type { FileChange } from '@git-gui/domain'
import type { SelectedFile } from '../store/repository-store'
import { Badge } from '../ui/Badge'
import { Panel } from '../ui/Panel'
import { ChangeKindBadge } from '../ui/Pictogram'
import './changes-panel.css'

interface ChangesPanelProps {
  changes: FileChange[]
  selected: SelectedFile | null
  /** 작업 중에는 모든 버튼을 비활성화한다 — 연타로 git 작업이 겹치면 index.lock 충돌이 난다 */
  busy: boolean
  onStage(paths: string[]): void
  onUnstage(paths: string[]): void
  onSelect(selected: SelectedFile): void
}

interface FileRowProps {
  change: FileChange
  staged: boolean
  isSelected: boolean
  busy: boolean
  onSelect(): void
  onAction(): void
}

function FileRow({ change, staged, isSelected, busy, onSelect, onAction }: FileRowProps) {
  const kind = staged ? change.staged : change.unstaged
  const actionLabel = staged ? '내리기' : '올리기'
  // 좁은 열에서 파일명이 먼저 잘리지 않도록 디렉터리와 파일명을 분리해 디렉터리부터 축소한다
  const slashIndex = change.path.lastIndexOf('/')
  const directory = slashIndex >= 0 ? change.path.slice(0, slashIndex + 1) : ''
  const basename = slashIndex >= 0 ? change.path.slice(slashIndex + 1) : change.path
  return (
    <li className={`file-row${isSelected ? ' file-row--selected' : ''}`}>
      <button
        type="button"
        className="file-row__main"
        disabled={busy}
        onClick={onSelect}
        data-testid={`file-${staged ? 'staged' : 'unstaged'}-${change.path}`}
      >
        <span className="file-row__name">
          {directory && <span className="file-row__dir">{directory}</span>}
          <span className="file-row__base">{basename}</span>
        </span>
        {kind && <ChangeKindBadge kind={kind} />}
      </button>
      <button
        type="button"
        className="file-row__action"
        disabled={busy}
        onClick={onAction}
        aria-label={`${change.path} ${actionLabel}`}
        data-testid={`${staged ? 'unstage' : 'stage'}-${change.path}`}
      >
        {staged ? (
          <CircleMinus size={14} aria-hidden="true" />
        ) : (
          <CirclePlus size={14} aria-hidden="true" />
        )}
        {actionLabel}
      </button>
    </li>
  )
}

export function ChangesPanel({
  changes,
  selected,
  busy,
  onStage,
  onUnstage,
  onSelect,
}: ChangesPanelProps) {
  const stagedChanges = changes.filter((c) => c.staged !== null)
  const unstagedChanges = changes.filter((c) => c.unstaged !== null)

  return (
    <div className="changes-panel">
      <Panel
        title="지금 바뀐 것"
        accessory={
          <>
            <Badge tone="git">unstaged</Badge>
            <Badge tone="count">
              <span data-testid="unstaged-count">{unstagedChanges.length}</span>
            </Badge>
          </>
        }
      >
        {unstagedChanges.length === 0 ? (
          <p className="changes-panel__empty">바뀐 파일이 없어요</p>
        ) : (
          <ul className="changes-panel__list">
            {unstagedChanges.map((change) => (
              <FileRow
                key={`unstaged-${change.path}`}
                change={change}
                staged={false}
                isSelected={
                  selected !== null && !selected.staged && selected.change.path === change.path
                }
                busy={busy}
                onSelect={() => onSelect({ change, staged: false })}
                onAction={() => onStage([change.path])}
              />
            ))}
          </ul>
        )}
      </Panel>
      <Panel
        title="저장 예정"
        accessory={
          <>
            <Badge tone="git">staged</Badge>
            <Badge tone="count">
              <span data-testid="staged-count">{stagedChanges.length}</span>
            </Badge>
          </>
        }
      >
        {stagedChanges.length === 0 ? (
          <p className="changes-panel__empty">파일을 올리면 여기에 모여요</p>
        ) : (
          <ul className="changes-panel__list">
            {stagedChanges.map((change) => (
              <FileRow
                key={`staged-${change.path}`}
                change={change}
                staged
                isSelected={
                  selected !== null && selected.staged && selected.change.path === change.path
                }
                busy={busy}
                onSelect={() => onSelect({ change, staged: true })}
                onAction={() => onUnstage([change.path])}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
```

`apps/desktop/src/renderer/src/components/changes-panel.css`:
```css
.changes-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 0;
}
.changes-panel > .ui-panel {
  flex: 1;
}
.changes-panel__list {
  list-style: none;
  margin: 0;
  padding: var(--space-1);
}
.changes-panel__empty {
  padding: var(--space-4);
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-faint);
  text-align: center;
}
.file-row {
  display: flex;
  align-items: stretch;
  gap: var(--space-1);
  border-radius: var(--radius-sm);
}
.file-row--selected {
  background: var(--color-selection-bg);
}
.file-row__main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: 7px 10px;
  border: none;
  background: none;
  cursor: pointer;
  text-align: left;
  border-radius: var(--radius-sm);
  color: var(--color-text);
}
.file-row__main:hover:not(:disabled) {
  background: var(--color-surface-sunken);
}
.file-row--selected .file-row__main:hover:not(:disabled) {
  background: transparent;
}
.file-row__name {
  display: flex;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}
/* 디렉터리부터 축소 — 파일명(basename)은 항상 보인다 */
.file-row__dir {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 0 1 auto;
  color: var(--color-text-muted);
}
.file-row__base {
  white-space: nowrap;
  flex: none;
}
.file-row__action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  padding: 0 10px;
  border-radius: var(--radius-sm);
}
.file-row__action:hover:not(:disabled) {
  color: var(--color-accent);
  background: var(--color-surface-sunken);
}
.file-row__main:disabled,
.file-row__action:disabled {
  opacity: var(--opacity-disabled);
  cursor: default;
}
```

- [ ] **Step 2: DiffPanel**

`apps/desktop/src/renderer/src/components/diff-lines.ts` (순수 로직 — 컴포넌트와 분리, 단위 테스트 대상):
```ts
export type LineTone = 'add' | 'del' | 'hunk' | 'meta' | 'context'

/**
 * 표시용 diff 라인 분류 — hunk 구조 해석(diff 모델)은 1단계에서 adapter가 맡는다.
 * '---'/'+++' 파일 헤더는 첫 @@ 이전(헤더 구간)에만 나타난다 — 위치 기반으로 구분해
 * '--'로 시작하는 삭제 라인(SQL 주석 등)이나 '++' 추가 라인이 meta로 위장되지 않게 한다.
 */
export function classifyLines(lines: string[]): LineTone[] {
  let inHunk = false
  return lines.map((line) => {
    if (line.startsWith('diff ')) {
      inHunk = false
      return 'meta'
    }
    if (line.startsWith('@@')) {
      inHunk = true
      return 'hunk'
    }
    if (!inHunk) return 'meta'
    if (line.startsWith('\\')) return 'meta'
    if (line.startsWith('+')) return 'add'
    if (line.startsWith('-')) return 'del'
    return 'context'
  })
}
```

`apps/desktop/test/diff-lines.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { classifyLines } from '../src/renderer/src/components/diff-lines'

describe('classifyLines', () => {
  it('첫 @@ 이전의 헤더는 전부 meta다', () => {
    const tones = classifyLines([
      'diff --git a/f.sql b/f.sql',
      'index abc..def 100644',
      '--- a/f.sql',
      '+++ b/f.sql',
      '@@ -1,2 +1,2 @@',
    ])
    expect(tones).toEqual(['meta', 'meta', 'meta', 'meta', 'hunk'])
  })

  it("hunk 안의 '--'/'++' 시작 라인은 del/add로 분류한다 (SQL 주석·증감 연산)", () => {
    const tones = classifyLines(['@@ -1 +1 @@', '--- SQL comment', '+++counter', ' context'])
    expect(tones).toEqual(['hunk', 'del', 'add', 'context'])
  })

  it('rename·binary 등 hunk 없는 diff는 전부 meta다', () => {
    const tones = classifyLines([
      'diff --git a/old.ts b/new.ts',
      'similarity index 100%',
      'rename from old.ts',
      'rename to new.ts',
    ])
    expect(tones).toEqual(['meta', 'meta', 'meta', 'meta'])
  })

  it('개행 없음 마커는 meta다', () => {
    const tones = classifyLines(['@@ -1 +1 @@', '-old', '+new', '\\ No newline at end of file'])
    expect(tones).toEqual(['hunk', 'del', 'add', 'meta'])
  })

  it('여러 파일 diff에서 새 파일 헤더가 나오면 다시 meta 구간이 된다', () => {
    const tones = classifyLines(['@@ -1 +1 @@', '-a', 'diff --git a/b b/b', 'index 1..2'])
    expect(tones).toEqual(['hunk', 'del', 'meta', 'meta'])
  })
})
```

`apps/desktop/src/renderer/src/components/DiffPanel.tsx` 전체 교체:
```tsx
import { Badge } from '../ui/Badge'
import { Panel } from '../ui/Panel'
import { classifyLines } from './diff-lines'
import './diff-panel.css'

interface DiffPanelProps {
  path: string | null
  diffText: string
}

export function DiffPanel({ path, diffText }: DiffPanelProps) {
  if (!path) {
    return (
      <Panel title="변경 내용" testId="diff-panel">
        <p className="diff-panel__empty">파일을 선택하면 무엇이 바뀌었는지 보여드려요</p>
      </Panel>
    )
  }
  const lines = diffText.length > 0 ? diffText.split('\n') : []
  const tones = classifyLines(lines)
  return (
    <Panel title={path} accessory={<Badge tone="git">diff</Badge>} testId="diff-panel">
      {lines.length === 0 ? (
        <p className="diff-panel__empty">변경 내용이 없어요</p>
      ) : (
        <pre className="diff-panel__code">
          {lines.map((line, index) => (
            <span key={index} className={`diff-line diff-line--${tones[index]}`}>
              {line || ' '}
            </span>
          ))}
        </pre>
      )}
    </Panel>
  )
}
```

`apps/desktop/src/renderer/src/components/diff-panel.css`:
```css
.diff-panel__empty {
  padding: var(--space-6);
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-faint);
  text-align: center;
}
.diff-panel__code {
  margin: 0;
  padding: var(--space-3) 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.7;
  display: flex;
  flex-direction: column;
}
.diff-line {
  padding: 0 var(--space-4);
  white-space: pre-wrap;
  overflow-wrap: anywhere; /* 공백 우선으로 접는다 — break-all은 단어 중간을 자른다 */
}
.diff-line--add {
  background: var(--diff-add-bg);
  color: var(--diff-add-text);
}
.diff-line--del {
  background: var(--diff-del-bg);
  color: var(--diff-del-text);
}
.diff-line--hunk {
  background: var(--diff-hunk-bg);
  color: var(--diff-hunk-text);
}
.diff-line--meta {
  color: var(--color-text-faint);
}
```

- [ ] **Step 3: CommitForm**

`apps/desktop/src/renderer/src/components/CommitForm.tsx` 전체 교체:
```tsx
import { useState } from 'react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import './commit-form.css'

interface CommitFormProps {
  stagedCount: number
  busy: boolean
  onCommit(message: string): Promise<boolean>
}

export function CommitForm({ stagedCount, busy, onCommit }: CommitFormProps) {
  const [message, setMessage] = useState('')
  const disabled = busy || stagedCount === 0 || message.trim().length === 0

  return (
    <form
      className="commit-form"
      onSubmit={(event) => {
        event.preventDefault()
        // 커밋이 실패하면(훅 거부, 충돌 상태 등) 입력한 메시지를 보존한다
        void onCommit(message).then((committed) => {
          if (committed) setMessage('')
        })
      }}
    >
      <label className="commit-form__label" htmlFor="commit-message">
        저장 메시지 <Badge tone="git">commit</Badge>
      </label>
      <textarea
        id="commit-message"
        data-testid="commit-message"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="무엇을 바꿨는지 적어 주세요"
        rows={3}
      />
      <Button variant="primary" type="submit" isDisabled={disabled} testId="commit-button">
        저장하기 — {stagedCount}개 파일
      </Button>
    </form>
  )
}
```

`apps/desktop/src/renderer/src/components/commit-form.css`:
```css
.commit-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-1);
  flex: none;
}
.commit-form__label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  font-weight: 700;
}
.commit-form textarea {
  resize: vertical;
  min-height: 64px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--color-text);
  background: var(--color-surface);
}
.commit-form textarea:focus {
  outline: 2px solid var(--color-focus);
  outline-offset: 1px;
  border-color: transparent;
}
```

- [ ] **Step 4: HistoryPlaceholder**

`apps/desktop/src/renderer/src/components/HistoryPlaceholder.tsx`:
```tsx
import { Badge } from '../ui/Badge'
import { Panel } from '../ui/Panel'
import { Pictogram } from '../ui/Pictogram'
import './history-placeholder.css'

/** 저장된 역사 자리 — 목록 엔진(log)은 다음 단계에서 붙는다 (스펙 5장 레이아웃의 자리 확보) */
export function HistoryPlaceholder() {
  return (
    <Panel title="저장된 역사" accessory={<Badge tone="git">log</Badge>}>
      <div className="history-placeholder">
        <Pictogram kind="commit" size={20} label="저장 시점" />
        <p>
          저장할 때마다 시점이 여기에 쌓여요.
          <br />
          목록 보기는 다음 업데이트에서 제공돼요.
        </p>
      </div>
    </Panel>
  )
}
```

`apps/desktop/src/renderer/src/components/history-placeholder.css`:
```css
.history-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-8) var(--space-4);
  text-align: center;
}
.history-placeholder p {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  line-height: 1.7;
}
```

- [ ] **Step 5: E2E 셀렉터 재정비**

`apps/desktop/e2e/smoke.spec.ts`의 테스트 본문(try 블록 내부)을 다음으로 교체 (fixture·launch·finally는 그대로):
```ts
    const window = await app.firstWindow()

    // 변경 파일이 '지금 바뀐 것' 목록에 보인다
    await expect(window.getByTestId('file-unstaged-app.txt')).toBeVisible()
    await window.screenshot({ path: 'test-results/app-initial.png' })

    // stage
    await window.getByTestId('stage-app.txt').click()
    await expect(window.getByTestId('staged-count')).toHaveText('1')
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')

    // commit
    await window.getByTestId('commit-message').fill('e2e: 첫 저장')
    await window.getByTestId('commit-button').click()
    await expect(window.getByTestId('staged-count')).toHaveText('0')
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')
    await window.screenshot({ path: 'test-results/app-after-commit.png' })

    // 실제 커밋이 생겼는지 검증
    const log = await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: repo })
    expect(log.stdout.trim()).toBe('e2e: 첫 저장')
```

참고: 새 컴포넌트들은 기존 App.tsx와 props 시그니처가 동일하므로 App 수정 없이 컴파일된다 (App 리디자인은 Task 6). `HistoryPlaceholder`는 Task 6 전까지 사용처가 없어도 무방하다.

- [ ] **Step 6: 컴파일 확인**

Run: `pnpm typecheck`
Expected: exit 0 — 기존 App.tsx가 새 컴포넌트 시그니처와 그대로 호환됨을 확인

- [ ] **Step 7: 검증**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: 모두 exit 0 — **77 tests** (72 + diff-lines 5), E2E 1 passed, `apps/desktop/test-results/app-*.png` 2장 생성

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/src/components apps/desktop/e2e/smoke.spec.ts
git commit -m "feat(desktop): 작업 화면 리디자인 — 픽토그램 배지·diff 컬러링·E2E testid

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: App 헤더·3열 레이아웃

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx` (전체 교체)
- Create: `apps/desktop/src/renderer/src/layout.css`
- Delete: `apps/desktop/src/renderer/src/app.css`
- Modify: `apps/desktop/src/renderer/src/main.tsx` (import 교체)

- [ ] **Step 1: App.tsx 전체 교체**

```tsx
import { RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import type { RepositoryStateKind } from '@git-gui/domain'
import { ChangesPanel } from './components/ChangesPanel'
import { CommitForm } from './components/CommitForm'
import { DiffPanel } from './components/DiffPanel'
import { HistoryPlaceholder } from './components/HistoryPlaceholder'
import { RepoPicker } from './components/RepoPicker'
import { useRepositoryStore } from './store/repository-store'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Pictogram } from './ui/Pictogram'

/** 일상어 + 원어 병기(스펙 5장 문구 원칙) — 상태를 숨기지 않는다 */
const STATE_LABELS: Record<RepositoryStateKind, string> = {
  normal: '정상',
  merging: '합치는 중',
  rebasing: '다시 쌓는 중',
  'cherry-picking': '가져오는 중',
  reverting: '되돌리는 중',
  bisecting: '원인 찾는 중',
}

export function App() {
  const store = useRepositoryStore()

  useEffect(() => {
    void store.init()
    // 마운트 시 1회만 실행
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!store.repoPath) {
    return <RepoPicker onOpen={() => void store.openRepository()} error={store.error} />
  }

  const status = store.status
  const stagedCount = status?.changes.filter((c) => c.staged !== null).length ?? 0
  const repoName = store.repoPath.split('/').pop() ?? store.repoPath

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__repo">
          <strong>{repoName}</strong>
          <span className="app__repo-path" title={store.repoPath}>
            {store.repoPath}
          </span>
        </div>
        {status && (
          <div className="app__status">
            <span className="app__branch" data-testid="header-branch">
              <Pictogram kind="branch" size={13} label="실험 공간 (branch)" />
              {status.branch.name ?? '(브랜치 없음 — detached HEAD)'}
            </span>
            {status.state !== 'normal' && (
              <span className="app__state">
                <Pictogram kind="conflict" size={13} label="진행 중 작업" />
                {STATE_LABELS[status.state]}{' '}
                <span className="app__state-raw">{status.state}</span>
              </span>
            )}
            {status.branch.ahead !== null && status.branch.behind !== null && (
              <Badge>
                ↑{status.branch.ahead} ↓{status.branch.behind}
              </Badge>
            )}
          </div>
        )}
        <div className="app__actions">
          <Button
            variant="ghost"
            size="sm"
            isDisabled={store.busy}
            onPress={() => void store.refresh()}
            testId="refresh"
          >
            <RefreshCw size={13} aria-hidden="true" /> 새로고침
          </Button>
        </div>
      </header>
      {store.error && (
        <p className="app__error" role="alert" data-testid="error">
          {store.error}
        </p>
      )}
      <main className="app__main">
        <ChangesPanel
          changes={status?.changes ?? []}
          selected={store.selected}
          busy={store.busy}
          onStage={(paths) => void store.stage(paths)}
          onUnstage={(paths) => void store.unstage(paths)}
          onSelect={(selected) => void store.selectFile(selected)}
        />
        <div className="app__center">
          <DiffPanel path={store.selected?.change.path ?? null} diffText={store.diffText} />
          <CommitForm
            stagedCount={stagedCount}
            busy={store.busy}
            onCommit={(message) => store.commit(message)}
          />
        </div>
        <HistoryPlaceholder />
      </main>
    </div>
  )
}
```

- [ ] **Step 2: layout.css 작성, app.css 삭제, main.tsx import 교체**

`apps/desktop/src/renderer/src/layout.css`:
```css
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.app__header {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-3) var(--space-5);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  flex: none;
}
.app__repo {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.app__repo strong {
  font-size: var(--text-lg);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 380px;
}
.app__repo-path {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  max-width: 380px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app__status {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.app__branch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--concept-branch);
}
.app__state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--concept-conflict);
}
.app__state-raw {
  font-family: var(--font-mono);
  font-weight: 400;
  color: var(--color-text-faint);
  font-size: var(--text-xs);
}
.app__actions {
  margin-left: auto;
}
.app__error {
  margin: 0;
  padding: var(--space-2) var(--space-5);
  background: var(--concept-conflict-bg);
  color: var(--concept-conflict);
  font-size: var(--text-sm);
  flex: none;
}
.app__main {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr) 260px;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  flex: 1;
  min-height: 0;
}
.app__center {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 0;
}
.app__center > .ui-panel {
  flex: 1;
}
```

`apps/desktop/src/renderer/src/main.tsx` 전체 교체:
```tsx
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import './ui/tokens.css'
import './ui/base.css'
import './layout.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
```

`apps/desktop/src/renderer/src/app.css` 삭제:
```bash
git rm apps/desktop/src/renderer/src/app.css
```

- [ ] **Step 3: 검증**

Run: `pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: 모두 exit 0, E2E 1 passed, 스크린샷 갱신

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src
git commit -m "feat(desktop): 헤더·3열 정식 레이아웃 — 저장된 역사 자리 포함

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 최종 게이트 + 육안 확인 스크린샷 + README

**Files:**
- Modify: `apps/desktop/src/main/index.ts` (창 최소 크기), `apps/desktop/src/renderer/src/layout.css` (저장소명 말줄임)
- Modify: `README.md` ("현재 상태"에 디자인 기반 반영, "다음 단계" 갱신)

- [ ] **Step 0: Task 6 리뷰 반영 — 창 최소 크기·저장소명 말줄임**

`apps/desktop/src/main/index.ts`의 BrowserWindow 옵션에 추가 (700px 이하에서 3열 고정 열이 붕괴하는 것을 실렌더로 확인):
```ts
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 600,
```
(이하 webPreferences 등 기존 그대로)

`apps/desktop/src/renderer/src/layout.css`의 `.app__repo strong` 교체:
```css
.app__repo strong {
  font-size: var(--text-lg);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 380px;
}
```

- [ ] **Step 1: 전체 게이트**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: 77 tests + typecheck 5개 + build + E2E 1 passed, 전부 exit 0

- [ ] **Step 2: 스크린샷 확보**

`apps/desktop/test-results/app-initial.png`, `app-after-commit.png`가 최신 E2E 실행으로 생성되었는지 확인 (코디네이터가 사용자에게 전달해 육안 확인 받는다).

- [ ] **Step 3: README 갱신**

`README.md`의 "현재 상태" 첫 문단을 다음으로 교체:
```markdown
0단계(기반) 최소 수직 기능과 E0-1 디자인 기반이 동작합니다: 저장소 열기, 상태 감지, 변경 파일 목록, diff 보기, stage/unstage, commit — 디자인 토큰·픽토그램 시스템·정식 3열 레이아웃 적용.
```

"다음 단계" 목록을 다음으로 교체:
```markdown
1. E0-2: 저장된 역사(log 엔진 + 목록), 백업(push), 저장 메시지 자동 제안
2. 취소 가능한 Git 프로세스와 실행 로그
3. 1단계: 보관함(stash), 실험 공간(branch) 만들기·합치기
4. 충돌 및 중단 상태별 테스트 fixture 확장
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README — E0-1 디자인 기반 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
