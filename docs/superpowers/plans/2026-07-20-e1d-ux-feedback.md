# E1d UX 피드백 5건 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) 구문으로 추적한다.

**Goal:** 사용자 실사용 피드백 5건 반영 — 스크롤바 테마화, 보관함 미리보기, 알림 레이아웃 시프트 제거, 우측 상세 전환 시프트 제거, 브랜치 폴더 그룹핑(IntelliJ식).

**Architecture:** 렌더러 중심. 보관함 미리보기만 domain(ShelfEntry.hash)·어댑터(stash list 포맷)·기존 커밋 상세 흐름(selectCommit) 재사용으로 관통한다. 그룹핑 로직은 프레젠테이션과 분리한 순수 함수(branch-groups.ts)로.

**Tech Stack:** 기존 그대로 (Electron + React 19 + react-aria-components 1.19 + vitest + Playwright). 실측 확인: react-aria-components에 `MenuSection`·`Header` export 존재.

**기준 커밋:** main = `52cf5a4` (E1c 병합 직후). 브랜치 `feature/e1d-ux-feedback`.

**피드백 원문 대응표:**

| # | 피드백 | 태스크 |
| --- | --- | --- |
| 1 | 스크롤이 어색 — 다크 모드에 맞는 스크롤 또는 테마 무관 처리 | Task 1 |
| 2 | 보관함 항목 클릭 시 미리보기가 안 됨 | Task 5·6 |
| 3 | 상단 알림이 레이아웃 시프트 유발 | Task 2 |
| 4 | 우측 트리 클릭(커밋 상세 전환) 시 레이아웃 시프트 | Task 3 |
| 5 | 브랜치를 IntelliJ처럼 폴더 형태로 묶기 | Task 4 |

---

### Task 1: 스크롤바 테마화

OS 기본 스크롤바는 다크 모드에서 이질적이다(피드백 1). Chromium(Electron)이므로 `::-webkit-scrollbar`를 토큰 기반으로 전역 통일한다 — 트랙은 투명, thumb만 얇게. 두 테마 모두 토큰(`--color-border-strong`)이 배경과 자연스럽게 어울린다.

**Files:**
- Modify: `apps/desktop/src/renderer/src/ui/base.css`

- [ ] **Step 1: base.css 끝에 추가**

```css

/* 스크롤바 — OS 기본은 다크 모드에서 이질적이다(피드백 1). 토큰 기반 얇은 스타일로
   두 테마 모두 통일한다. 트랙은 투명 — 콘텐츠 배경이 그대로 비친다 */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border-radius: 5px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-faint);
  border: 2px solid transparent;
  background-clip: padding-box;
}
::-webkit-scrollbar-corner {
  background: transparent;
}
```

- [ ] **Step 2: 실렌더 확인** — 앱 기동(라이트·다크 각각), 히스토리·변경 목록·diff에서 스크롤바가 테마 색으로 보이는지, 스크롤 동작에 이상 없는지 확인.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/ui/base.css
git commit -m "fix(desktop): 스크롤바 테마화 — 토큰 기반 얇은 스타일 (피드백 1)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 알림 오버레이 — 레이아웃 시프트 제거

error/notice 배너가 일반 흐름에 있어 나타나고 사라질 때마다 본문 전체가 밀린다(피드백 3). 높이 0인 레이어에 절대 배치해 흐름 밖 오버레이로 바꾼다. **머지 바(app__merge-bar)는 상주 상태 표시이므로 흐름에 남긴다** — 밀림이 아니라 "상태가 자리를 차지하는 것"이 맞다.

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/layout.css`

- [ ] **Step 1: App.tsx — 배너를 레이어로 감싼다** (기존 error/notice 두 `<p>` 블록 교체)

```tsx
      {(store.error !== null || store.notice !== null) && (
        <div className="app__banner-layer">
          {store.error && (
            <p className="app__error" role="alert" data-testid="error">
              {store.error}
            </p>
          )}
          {store.notice && (
            <p className="app__notice" role="status" data-testid="notice">
              {store.notice}
            </p>
          )}
        </div>
      )}
```

- [ ] **Step 2: layout.css — `.app__notice` 블록 바로 뒤에 추가**

```css
/* 알림은 흐름 밖 오버레이로 — 나타나고 사라질 때 본문이 밀리지 않는다 (피드백 3).
   머지 바는 상주 상태 표시라 흐름에 남긴다 */
.app__banner-layer {
  position: relative;
  height: 0;
  z-index: 40;
  flex: none;
}
.app__banner-layer .app__error,
.app__banner-layer .app__notice {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  box-shadow: var(--shadow-2);
}
```

- [ ] **Step 3: 실렌더 확인** — 받아오기 실패(원격 없음) 에러·보관하기 notice에서 본문(3열)이 1px도 밀리지 않는지, 배너가 패널 위로 그림자와 함께 뜨는지, 사라질 때도 시프트가 없는지 확인. merging 중 머지 바 + notice 동시 표시 시 겹침 확인(배너가 머지 바 위를 덮는다 — 머지 바 상태는 notice가 사라지면 다시 보인다. 어색하면 리뷰에서 판단).

- [ ] **Step 4: 게이트** — 기존 E2E의 notice/error 단언은 가시성 기반이라 통과해야 한다. `pnpm --filter @git-gui/desktop build` 후 E2E 전체 24 passed 확인.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/layout.css
git commit -m "fix(desktop): 알림을 흐름 밖 오버레이로 — 레이아웃 시프트 제거 (피드백 3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 우측 상세 전환 시 열 폭 유지

커밋 클릭으로 우측이 상세로 전환될 때 `Math.max(rightWidth, 420)` 강제 확장이 grid 열 폭을 바꿔 중앙이 밀린다(피드백 4). 사용자가 정한 폭을 그대로 유지한다 — 좁으면 사용자가 손잡이로 넓히면 되고, 폭은 기억된다.

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`

- [ ] **Step 1: effectiveRight 강제 확장 제거** — 아래 블록을

```tsx
  // 상세 모드 최소폭도 뷰포트 클램프를 통과시킨다 — 좁은 창에서 중앙 diff가 살아남는다
  const effectiveRight =
    store.commitDetail !== null
      ? clampRightWidth(Math.max(rightWidth, 420), window.innerWidth)
      : rightWidth
```

다음으로 교체:

```tsx
  // 상세 전환이 열 폭을 강제로 넓히면 중앙이 밀린다(피드백 4: 레이아웃 시프트) —
  // 사용자가 정한 폭을 그대로 유지한다. 좁으면 손잡이로 넓히면 되고, 폭은 기억된다
  const effectiveRight = rightWidth
```

- [ ] **Step 2: 실렌더 확인** — 기본 폭(360px)에서 커밋 클릭 → 중앙 diff·좌측이 전혀 밀리지 않는지, 상세 패널(파일 목록·뒤로)이 360px에서 사용 가능한지(말줄임·줄바꿈 붕괴 없음), 960px 최소창에서도 확인.

- [ ] **Step 3: 게이트 + Commit** — E2E 24 회귀 없음 확인 후

```bash
git add apps/desktop/src/renderer/src/App.tsx
git commit -m "fix(desktop): 커밋 상세 전환 시 우측 열 폭 유지 — 레이아웃 시프트 제거 (피드백 4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 브랜치 폴더 그룹핑 (IntelliJ식)

`feature/a`처럼 `/`가 있는 브랜치를 첫 조각 폴더로 묶어 스위처에 섹션으로 보여준다(피드백 5). 로직은 순수 함수로 분리(레이어 분리 원칙), 스위처는 `MenuSection`+`Header`로 렌더한다. 동작 키는 전체 이름 그대로 — 전환·현재 표시·시간 표기는 기존과 동일.

**Files:**
- Create: `apps/desktop/src/renderer/src/components/branch-groups.ts`
- Test: `apps/desktop/test/branch-groups.test.ts`
- Modify: `apps/desktop/src/renderer/src/components/BranchSwitcher.tsx`
- Modify: `apps/desktop/src/renderer/src/components/branch-switcher.css`

- [ ] **Step 1: 실패하는 테스트** (`apps/desktop/test/branch-groups.test.ts` 신규)

```ts
import { describe, expect, it } from 'vitest'
import type { BranchSummary } from '@git-gui/domain'
import { branchDisplayName, groupBranches } from '../src/renderer/src/components/branch-groups'

const b = (name: string, committedAt = 0): BranchSummary => ({
  name,
  isCurrent: false,
  committedAt,
  upstream: null,
})

describe('groupBranches', () => {
  it("'/' 없는 브랜치는 loose, 있는 브랜치는 첫 조각 폴더로 묶는다", () => {
    const grouped = groupBranches([b('main'), b('feature/a'), b('fix/x'), b('feature/b')])
    expect(grouped.loose.map((x) => x.name)).toEqual(['main'])
    expect(grouped.folders.map((f) => f.name)).toEqual(['feature', 'fix'])
    expect(grouped.folders[0]!.branches.map((x) => x.name)).toEqual(['feature/a', 'feature/b'])
  })

  it('폴더 순서는 폴더의 첫 등장 위치를 따른다 (입력은 최근 커밋순)', () => {
    const grouped = groupBranches([b('fix/hot'), b('feature/a'), b('fix/old')])
    expect(grouped.folders.map((f) => f.name)).toEqual(['fix', 'feature'])
  })

  it('깊은 경로는 첫 조각으로만 묶고 나머지는 표시 이름에 남긴다', () => {
    const grouped = groupBranches([b('feature/ui/dark')])
    expect(grouped.folders[0]!.name).toBe('feature')
    expect(branchDisplayName('feature/ui/dark')).toBe('ui/dark')
  })

  it("'/' 없는 이름의 표시 이름은 그대로다", () => {
    expect(branchDisplayName('main')).toBe('main')
  })
})
```

- [ ] **Step 2: Red 확인** — `pnpm --filter @git-gui/desktop test` → FAIL(모듈 없음)

- [ ] **Step 3: 구현** (`apps/desktop/src/renderer/src/components/branch-groups.ts` 신규)

```ts
import type { BranchSummary } from '@git-gui/domain'

export interface BranchFolder {
  /** '/' 앞 첫 조각 — 폴더 이름 */
  name: string
  branches: BranchSummary[]
}

export interface GroupedBranches {
  /** '/' 없는 브랜치 — 목록 맨 위에 그대로 나열 */
  loose: BranchSummary[]
  /** '/'가 있는 브랜치를 첫 조각으로 묶는다 — IntelliJ식 폴더 (피드백 5) */
  folders: BranchFolder[]
}

/** 입력 순서(최근 커밋순)를 유지한다 — 폴더 위치는 그 폴더 브랜치가 처음 등장한 곳 */
export function groupBranches(branches: BranchSummary[]): GroupedBranches {
  const loose: BranchSummary[] = []
  const folders: BranchFolder[] = []
  const byName = new Map<string, BranchFolder>()
  for (const branch of branches) {
    const slash = branch.name.indexOf('/')
    if (slash <= 0) {
      loose.push(branch)
      continue
    }
    const name = branch.name.slice(0, slash)
    let folder = byName.get(name)
    if (folder === undefined) {
      folder = { name, branches: [] }
      byName.set(name, folder)
      folders.push(folder)
    }
    folder.branches.push(branch)
  }
  return { loose, folders }
}

/** 폴더 안에서는 접두사를 뗀 나머지만 보여준다 — 전체 이름은 title·동작 키로 유지 */
export function branchDisplayName(name: string): string {
  const slash = name.indexOf('/')
  return slash <= 0 ? name : name.slice(slash + 1)
}
```

- [ ] **Step 4: Green 확인** — 4건 PASS

- [ ] **Step 5: BranchSwitcher 렌더** (`BranchSwitcher.tsx` 전체 교체)

```tsx
import { Check, ChevronDown, Folder, Plus } from 'lucide-react'
import { Header, Menu, MenuItem, MenuSection, MenuTrigger, Popover } from 'react-aria-components'
import type { BranchSummary } from '@git-gui/domain'
import { Button } from '../ui/Button'
import { Pictogram } from '../ui/Pictogram'
import { branchDisplayName, groupBranches } from './branch-groups'
import { formatRelativeTime } from './relative-time'
import './branch-switcher.css'

interface BranchSwitcherProps {
  branches: BranchSummary[]
  currentName: string | null
  busy: boolean
  onSwitch(name: string): void
  onCreate(): void
  onManage(): void
}

const NEW_KEY = '__new__'
const MANAGE_KEY = '__manage__'

/** 헤더 실험 공간 스위처 (⑧) — 목록에서 전환하거나 새로 만든다. '/' 접두사는 폴더로 묶는다 (피드백 5) */
export function BranchSwitcher({ branches, currentName, busy, onSwitch, onCreate, onManage }: BranchSwitcherProps) {
  const grouped = groupBranches(branches)
  const renderItem = (branch: BranchSummary, display: string) => (
    <MenuItem
      key={branch.name}
      id={branch.name}
      className="branch-switcher__item"
      textValue={branch.name}
      data-testid={`branch-item-${branch.name}`}
    >
      <span className="branch-switcher__check" aria-hidden="true">
        {branch.isCurrent ? <Check size={12} /> : null}
      </span>
      <span className="branch-switcher__name" title={branch.name}>
        {display}
      </span>
      <span className="branch-switcher__time">
        {formatRelativeTime(branch.committedAt, Date.now())}
      </span>
    </MenuItem>
  )
  return (
    <MenuTrigger>
      <Button variant="ghost" size="sm" isDisabled={busy} testId="header-branch">
        <Pictogram kind="branch" size={13} label="실험 공간 (branch)" />
        <span className="branch-switcher__current">{currentName ?? '(브랜치 없음)'}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </Button>
      <Popover className="branch-switcher__popover">
        <Menu
          className="branch-switcher__menu"
          onAction={(key) => {
            if (key === NEW_KEY) onCreate()
            else if (key === MANAGE_KEY) onManage()
            else if (key !== currentName) onSwitch(String(key))
          }}
        >
          {grouped.loose.map((branch) => renderItem(branch, branch.name))}
          {grouped.folders.map((folder) => (
            <MenuSection key={folder.name} className="branch-switcher__section">
              <Header className="branch-switcher__folder">
                <Folder size={11} aria-hidden="true" /> {folder.name}/
              </Header>
              {folder.branches.map((branch) => renderItem(branch, branchDisplayName(branch.name)))}
            </MenuSection>
          ))}
          <MenuItem
            id={NEW_KEY}
            className="branch-switcher__item branch-switcher__item--new"
            textValue="새 실험 공간 만들기"
            data-testid="branch-new"
          >
            <span className="branch-switcher__check" aria-hidden="true">
              <Plus size={12} />
            </span>
            <span className="branch-switcher__name">새 실험 공간 만들기…</span>
          </MenuItem>
          <MenuItem
            id={MANAGE_KEY}
            className="branch-switcher__item branch-switcher__item--new"
            textValue="실험 공간 관리"
            data-testid="branch-manage"
          >
            <span className="branch-switcher__check" aria-hidden="true" />
            <span className="branch-switcher__name">실험 공간 관리…</span>
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
```

- [ ] **Step 6: CSS** (`branch-switcher.css` 끝에 추가)

```css
/* '/' 접두사 폴더 섹션 — IntelliJ식 그룹핑 (피드백 5) */
.branch-switcher__folder {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 3px;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-text-faint);
}
.branch-switcher__section .branch-switcher__item {
  padding-left: 24px;
}
```

- [ ] **Step 7: 실렌더 확인** — `feature/a`·`feature/b`·`fix/x`·`main`이 있는 저장소에서 스위처를 열어 폴더 헤더·들여쓰기·전환 동작(전체 이름 키)·현재 표시를 확인. 기존 E2E의 `branch-item-*` testid는 유지되므로 회귀 없음이 기대치.

- [ ] **Step 8: 게이트 + Commit** — 유닛(+4) + E2E 24 회귀 없음

```bash
git add apps/desktop/test/branch-groups.test.ts apps/desktop/src/renderer/src/components
git commit -m "feat(desktop): 실험 공간 스위처 폴더 그룹핑 — '/' 접두사를 IntelliJ식 섹션으로 (피드백 5)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 보관함 미리보기 — 엔진·UI 관통

보관함 항목을 클릭하면 무엇이 담겼는지 보여준다(피드백 2). stash 항목은 실제 커밋이므로 **기존 커밋 상세 흐름(selectCommit → 우측 상세 + 파일 diff)을 그대로 재사용**한다. 엔진은 `stash list` 포맷에 `%H`(커밋 해시)만 추가.

알려진 한계(후속 노트): untracked 전용 변경은 stash의 셋째 부모에 저장되어 첫 부모 기준 diff에는 보이지 않는다 — 미리보기에 tracked 변경만 나온다.

**Files:**
- Modify: `packages/domain/src/repository.ts` (ShelfEntry.hash)
- Modify: `packages/git-adapter/src/refs-parser.ts` (parseShelf)
- Modify: `packages/git-adapter/src/client.ts` (stash list 포맷)
- Test: `packages/git-adapter/test/refs-parser.test.ts`, `packages/git-adapter/test/client.test.ts`
- Modify: `apps/desktop/src/renderer/src/components/ShelfPopover.tsx` (+`shelf-popover.css`)
- Modify: `apps/desktop/src/renderer/src/App.tsx` (onPreview 배선)

- [ ] **Step 1: 파서 Red** — `refs-parser.test.ts`의 parseShelf 테스트 2건을 hash 포함으로 교체:

```ts
describe('parseShelf', () => {
  it('stash list 출력에서 ref·시각·해시·메시지를 읽는다', () => {
    const hashA = 'a'.repeat(40)
    const hashB = 'b'.repeat(40)
    const raw =
      [
        `stash@{0}${US}1784279940${US}${hashA}${US}On main: 전환 자동 보관`,
        `stash@{1}${US}1784279930${US}${hashB}${US}WIP on side: abc1234 subject`,
      ].join('\n') + '\n'
    expect(parseShelf(raw)).toEqual([
      { ref: 'stash@{0}', savedAt: 1784279940, hash: hashA, message: 'On main: 전환 자동 보관' },
      { ref: 'stash@{1}', savedAt: 1784279930, hash: hashB, message: 'WIP on side: abc1234 subject' },
    ])
  })

  it('메시지에 구분자가 섞여도 나머지를 메시지로 합친다', () => {
    const raw = `stash@{0}${US}100${US}${'c'.repeat(40)}${US}메시지${US}에 구분자\n`
    expect(parseShelf(raw)[0]?.message).toBe(`메시지${US}에 구분자`)
  })
```

(빈 출력 테스트는 그대로.) Run → FAIL 확인.

- [ ] **Step 2: domain + 파서 구현**

`packages/domain/src/repository.ts`의 ShelfEntry에 추가(`savedAt` 줄 앞):

```ts
  /** 보관 항목의 실제 커밋 해시 — 미리보기(커밋 상세 재사용)에 쓴다 (피드백 2) */
  hash: string
```

`refs-parser.ts`의 parseShelf 전체 교체:

```ts
export function parseShelf(rawOutput: string): ShelfEntry[] {
  const lines = rawOutput.split('\n').filter((line) => line !== '')
  const entries: ShelfEntry[] = []
  for (const line of lines) {
    const fields = line.split(FIELD_SEPARATOR)
    if (fields.length < 4) continue
    const savedAt = Number(fields[1])
    if (!Number.isFinite(savedAt)) continue
    entries.push({
      ref: fields[0]!,
      hash: fields[2]!,
      savedAt,
      // 메시지에 구분자가 섞이는 일은 없지만 방어적으로 나머지를 합친다
      message: fields.slice(3).join(FIELD_SEPARATOR),
    })
  }
  return entries
}
```

`client.ts`의 shelf list 호출 포맷 교체:

```ts
        const raw = await execGitOrThrow(['stash', 'list', '--format=%gd%x1f%ct%x1f%H%x1f%gs'], { cwd })
```

- [ ] **Step 3: 엔진 관통 테스트** — `client.test.ts`의 `'shelf — 보관·목록·꺼내기·버리기 왕복 (untracked 포함)'` 테스트 **앞**에 추가:

```ts
  it('shelf — 항목 해시로 커밋 상세(미리보기)를 열 수 있다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# changed\n')
    await client.shelf.save('미리보기 대상')

    const shelf = await client.shelf.list()
    expect(shelf[0]!.hash).toMatch(/^[0-9a-f]{40}$/)
    // stash 항목은 실제 커밋 — 기존 커밋 상세 흐름을 그대로 재사용한다
    const detail = await client.commits.show(shelf[0]!.hash)
    expect(detail.files.map((f) => f.path)).toContain('README.md')
  })
```

Run: `pnpm --filter @git-gui/git-adapter test` → 전체 PASS (기존 shelf 단언은 toHaveLength/toContain이라 영향 없음)

- [ ] **Step 4: ShelfPopover — 클릭 미리보기** (`ShelfPopover.tsx` 전체 교체)

```tsx
import { Archive } from 'lucide-react'
import { useState } from 'react'
import { Dialog, DialogTrigger, Popover } from 'react-aria-components'
import type { ShelfEntry } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { formatRelativeTime } from './relative-time'
import { parseShelfMessage } from './shelf-message'
import './shelf-popover.css'

interface ShelfPopoverProps {
  shelf: ShelfEntry[]
  busy: boolean
  onSave(): void
  /** 항목 미리보기 — 커밋 상세(우측)로 보여준다. 팝오버는 닫는다 (피드백 2) */
  onPreview(hash: string): void
  onRestore(ref: string): void
  onDrop(ref: string): void
}

/** 보관함 (스펙 E1) — 잠시 치워 둔 변경을 보고 꺼내거나 버린다. 전환 자동 보관도 여기로 온다 */
export function ShelfPopover({ shelf, busy, onSave, onPreview, onRestore, onDrop }: ShelfPopoverProps) {
  const [dropTarget, setDropTarget] = useState<ShelfEntry | null>(null)
  // 미리보기 클릭 시 닫아야 해서 제어형으로 둔다 — 그 외 동작은 기존과 같다
  const [open, setOpen] = useState(false)
  return (
    <>
      <DialogTrigger isOpen={open} onOpenChange={setOpen}>
        <Button variant="ghost" size="sm" testId="shelf-open">
          <Archive size={13} aria-hidden="true" /> 보관함{' '}
          <Badge tone="count">
            <span data-testid="shelf-count">{shelf.length}</span>
          </Badge>
        </Button>
        <Popover className="shelf-popover">
          <Dialog className="shelf-popover__dialog" aria-label="보관함">
            <div className="shelf-popover__head">
              <span>
                잠시 치워 둔 변경 <Badge tone="git">stash</Badge>
              </span>
              <Button variant="neutral" size="sm" isDisabled={busy} onPress={onSave} testId="shelf-save">
                지금 변경 보관하기
              </Button>
            </div>
            {shelf.length === 0 ? (
              <p className="shelf-popover__empty">
                비어 있어요. 실험 공간을 옮길 때 겹치는 변경이 있으면 자동으로 담기기도 해요.
              </p>
            ) : (
              <ul className="shelf-popover__list">
                {shelf.map((entry) => (
                  <li key={entry.ref} className="shelf-popover__row">
                    <button
                      type="button"
                      className="shelf-popover__meta"
                      title="무엇이 담겼는지 미리보기"
                      onClick={() => {
                        setOpen(false)
                        onPreview(entry.hash)
                      }}
                      data-testid={`shelf-preview-${entry.ref}`}
                    >
                      <span className="shelf-popover__message" title={entry.message}>
                        {parseShelfMessage(entry.message).text}
                      </span>
                      <span className="shelf-popover__time">
                        {parseShelfMessage(entry.message).branch !== null && (
                          <span className="shelf-popover__branch">
                            {parseShelfMessage(entry.message).branch}
                          </span>
                        )}
                        {formatRelativeTime(entry.savedAt, Date.now())}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      isDisabled={busy}
                      onPress={() => onRestore(entry.ref)}
                      testId={`shelf-restore-${entry.ref}`}
                    >
                      꺼내기
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      isDisabled={busy}
                      onPress={() => setDropTarget(entry)}
                      testId={`shelf-drop-${entry.ref}`}
                    >
                      버리기
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Dialog>
        </Popover>
      </DialogTrigger>
      <ConfirmDialog
        isOpen={dropTarget !== null}
        title="보관함 항목을 버릴까요?"
        confirmLabel="버리기"
        onConfirm={() => {
          if (dropTarget !== null) onDrop(dropTarget.ref)
          setDropTarget(null)
        }}
        onCancel={() => setDropTarget(null)}
      >
        "{dropTarget?.message}"를 버려요. 이 동작은 되돌릴 수 없어요.
      </ConfirmDialog>
    </>
  )
}
```

- [ ] **Step 5: CSS** (`shelf-popover.css`의 `.shelf-popover__meta` 블록 교체)

```css
.shelf-popover__meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  /* 버튼화(미리보기 클릭) — 기본 버튼 모양을 지우고 텍스트 블록처럼 보이게 */
  background: none;
  border: 0;
  padding: 2px 4px;
  margin: 0;
  text-align: left;
  cursor: pointer;
  border-radius: var(--radius-sm);
  color: inherit;
}
.shelf-popover__meta:hover {
  background: var(--color-surface-sunken);
}
```

- [ ] **Step 6: App 배선** (`App.tsx`의 ShelfPopover에 prop 추가 — `onSave` 줄 뒤)

```tsx
            onPreview={(hash) => void store.selectCommit(hash)}
```

- [ ] **Step 7: 실렌더 확인** — 변경 보관 → 보관함 열기 → 항목 클릭 → 팝오버가 닫히고 우측이 커밋 상세("On main: …")로 전환, 파일 클릭 시 중앙에 diff. "뒤로"로 복귀 확인.

- [ ] **Step 8: 게이트 + Commit** — 유닛 전체 + typecheck 5 Done

```bash
git add packages/domain/src packages/git-adapter/src packages/git-adapter/test apps/desktop/src/renderer/src
git commit -m "feat: 보관함 미리보기 — stash 해시로 커밋 상세 재사용 (피드백 2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: E2E — 보관함 미리보기

**Files:**
- Test: `apps/desktop/e2e/smoke.spec.ts`

- [ ] **Step 1: 추가** — `'변경을 보관함에 넣었다 꺼낸다'` 테스트 **바로 뒤**에:

```ts
test('보관함 항목을 클릭하면 담긴 내용을 미리 보여준다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('shelf-open').click()
    await window.getByTestId('shelf-save').click()
    await expect(window.getByTestId('shelf-count')).toHaveText('1')
    await window.getByTestId('shelf-preview-stash@{0}').click()
    // 팝오버가 닫히고 우측이 커밋 상세로 전환된다 — 담긴 파일이 보인다
    await expect(window.getByTestId('commit-detail-panel')).toBeVisible()
    await expect(window.getByTestId('commit-file-app.txt')).toBeVisible()
    // 뒤로 가면 타임라인으로 복귀
    await window.getByTestId('commit-detail-back').click()
    await expect(window.getByTestId('commit-detail-panel')).toHaveCount(0)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: 게이트** — `pnpm --filter @git-gui/desktop build` 후 E2E 전체 → **25 passed**

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts
git commit -m "test(desktop): E2E — 보관함 미리보기 (피드백 2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6-보완: 품질 리뷰 4건 (실렌더 실측 반영)

품질 리뷰(실기동·elementFromPoint 실측)가 잡은 결함:

- **(Important 1) merging 중 에러 배너가 머지 바를 가림** — banner-layer가 merge-bar보다 앞(JSX 순서)이라 같은 y에 겹치고, 배경색까지 같아 머지 바가 사라진 듯 보이며 **'합치기 취소'가 클릭 불가**(elementFromPoint = 배너). → 배너 레이어를 머지 바 **뒤**로 옮겨 본문 위로만 덮게 한다.
- **(Important 2) 미리보기 중 '버리기' 시 stale 상세** — `shelfDrop`만 `CLEAR_SELECTIONS`가 없어 지운 항목의 상세가 우측에 남는다. → restore와 대칭으로 클리어.
- **(Important 3·Minor 5) 미리보기 정체성·오정보** — untracked 전용 항목이 "메시지만 남긴 저장이에요"로 표기(실제로는 파일이 담김 — stash 셋째 부모 한계), 제목이 "저장 내용 commit"에 "병합된 저장 —" 내부 설명까지 붙는다. → 보관함 미리보기면 제목 "보관 내용 stash"·빈 목록 문구·병합 노트 억제로 분기.
- **(Important 4) 360px 상세에서 긴 경로 가로 오버플로** — 상세 파일 행이 좌측과 같은 `virtual-row--wide`(가로 스크롤 설계)를 써서 좁은 우측 열에서 잘림+가로 스크롤. → 상세만 말줄임으로 흡수(좌측 변경 목록의 가로 스크롤 ③은 그대로).

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx` (배너 순서·shelfPreview 계산·prop)
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts` (shelfDrop)
- Modify: `apps/desktop/src/renderer/src/components/CommitDetailPanel.tsx` (+`commit-detail-panel.css`)
- Test: `apps/desktop/e2e/smoke.spec.ts` (미리보기 정체성 단언)

- [ ] **Step 1: App.tsx — 배너 레이어를 머지 바 뒤로** — Task 2에서 넣은 `app__banner-layer` 블록을 잘라내 merge-bar 블록 **바로 뒤**에 붙인다. 최종 순서:

```tsx
      {(status?.state === 'merging' || status?.state === 'reverting') && (
        <div className="app__merge-bar" data-testid="merge-bar">
          …(기존 그대로)…
        </div>
      )}
      {/* 배너는 머지 바 '뒤' — 머지 바(상주 상태·취소 버튼)를 가리면 취소가 클릭 불가가 된다 (품질 리뷰 실측) */}
      {(store.error !== null || store.notice !== null) && (
        <div className="app__banner-layer">
          {store.error && (
            <p className="app__error" role="alert" data-testid="error">
              {store.error}
            </p>
          )}
          {store.notice && (
            <p className="app__notice" role="status" data-testid="notice">
              {store.notice}
            </p>
          )}
        </div>
      )}
```

- [ ] **Step 2: store — shelfDrop 클리어** (`shelfDrop` 전체 교체)

```ts
  async shelfDrop(ref) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().shelf.drop(repoPath, ref)
      // 지운 항목을 미리보기로 열어 둔 채면 stale 상세가 남는다 — restore와 대칭으로 선택을 지운다 (품질 리뷰)
      set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },
```

- [ ] **Step 3: App.tsx — shelfPreview 계산 + prop** — `repoName` 선언 뒤에 추가:

```tsx
  // 보관함 항목을 미리보기로 연 상태인가 — 상세 패널 문구를 보관함 맥락으로 분기한다 (품질 리뷰)
  const openDetail = store.commitDetail
  const shelfPreview =
    openDetail !== null && store.shelf.some((entry) => entry.hash === openDetail.hash)
```

CommitDetailPanel 호출에 prop 추가(`detail=` 줄 뒤):

```tsx
            shelfPreview={shelfPreview}
```

- [ ] **Step 4: CommitDetailPanel — 보관함 맥락 분기 + 말줄임**

(a) props에 추가(`detail: CommitDetail` 줄 뒤):

```ts
  /** 보관함 미리보기로 열렸는가 — 제목·문구를 보관함 맥락으로 분기한다 (품질 리뷰) */
  shelfPreview: boolean
```

(b) 구조 분해에 `shelfPreview` 추가, Panel 제목·배지 교체:

```tsx
      title={shelfPreview ? '보관 내용' : '저장 내용'}
```

```tsx
          <Badge tone="git">{shelfPreview ? 'stash' : 'commit'}</Badge>
```

(c) 빈 목록 문구 분기 — files-head 삼항 교체:

```tsx
        {detail.files.length > 0
          ? ' — 누르면 가운데에 비교를 보여드려요'
          : shelfPreview
            ? ' — 새로 만든 파일만 담긴 보관이에요. 여기 목록에는 안 보이지만, 꺼내면 그대로 돌아와요'
            : ' — 메시지만 남긴 저장이에요'}
```

(d) 병합 노트 억제 — meta의 병합 조건 교체:

```tsx
          {!shelfPreview &&
            detail.parents.length >= 2 &&
            ' · 병합된 저장 — 파일 목록은 합쳐지기 전 원래 줄기 기준이에요'}
```

(e) 파일 행 `<li>`의 className에서 `virtual-row--wide` 제거(가로 스크롤 → 말줄임):

```tsx
                className="virtual-row"
```

(f) `commit-detail-panel.css` 끝에 추가:

```css
/* 좁은 우측 열에서 긴 경로가 가로 스크롤을 만들지 않게 — 상세는 말줄임으로 흡수한다 (품질 리뷰).
   좌측 변경 목록의 가로 스크롤(③)은 그대로 — 이 규칙은 상세 행에만 적용된다 */
.commit-file-row .file-row__name {
  flex: 1 1 auto;
  min-width: 0;
}
.commit-file-row .file-row__dir {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 5: E2E 정체성 단언** — Task 6의 미리보기 테스트에서 `commit-detail-panel` 가시성 단언 **바로 뒤**에 추가:

```ts
    await expect(window.getByTestId('commit-detail-panel')).toContainText('보관 내용')
```

- [ ] **Step 6: 실렌더 확인 4건** — (1) merge 충돌 + 에러 배너 상태에서 '합치기 취소' 실클릭 성공, (2) 미리보기 열고 버리기 → 상세가 닫히고 타임라인 복귀, (3) untracked 전용 보관 미리보기 → "보관 내용 stash" 제목 + 새 문구·병합 노트 없음, (4) 360px 상세에서 긴 경로(`src/components/deep/nested/VeryLongComponentName.tsx`) 말줄임·가로 스크롤 없음.

- [ ] **Step 7: 게이트** — 루트 `pnpm test`(**238**) + typecheck(5 Done) + build + E2E 전체(**25 passed**)

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/src apps/desktop/e2e
git commit -m "fix(desktop): 품질 리뷰 — 배너가 머지 바 가림·보관함 미리보기 정체성·stale 상세·상세 말줄임

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 최종 게이트 + 스크린샷 + README

- [ ] **Step 1: 전체 게이트** — 루트 `pnpm test`(**238 tests**: 233 + branch-groups 4 + shelf 해시 1) + `pnpm typecheck`(5 Done) + `pnpm --filter @git-gui/desktop build` + E2E **25 passed** — 전부 exit 0

- [ ] **Step 2: 스크린샷 3장** (1440×900, test-results/ + scratchpad 사본, **생성 후 e2e 재실행 금지**)

- (a) `e1d-scrollbar-notice.png` — 다크 모드, 히스토리 스크롤바가 보이는 상태 + notice 오버레이(본문 안 밀림)
- (b) `e1d-branch-folders.png` — 스위처 열림, `feature/` 폴더 섹션 + loose 브랜치
- (c) `e1d-shelf-preview.png` — 보관함 항목 클릭 후 우측 커밋 상세(담긴 파일 목록)

- [ ] **Step 3: README** — 기능 나열의 "보관함" 서술에 "(항목 클릭 미리보기)"를, 적절한 위치에 브랜치 폴더 그룹핑을 한 줄로 반영한다(기존 문장 구조 유지, 최소 수정).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README — E1d UX 피드백 반영(보관함 미리보기·폴더 그룹핑)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 검증 게이트 요약

| 시점 | 기대치 |
| --- | --- |
| Task 4 후 | +4 → 237 tests |
| Task 5 후 | +1 → **238 tests** |
| Task 6 후 | **E2E 25** |
| 최종 | 238 tests + typecheck 5 + build + E2E 25 — 전부 exit 0 |

(수치가 어긋나면 이 표를 갱신한다.)

## 후속 노트 (이관 후보)

- 보관함 미리보기에서 untracked 전용 변경이 안 보인다(stash 셋째 부모) — 셋째 부모 diff 병합 표시 검토
- 스위처 폴더 접기/펼치기(현재는 항상 펼침), ManageBranchesDialog에도 같은 그룹핑 적용
- 알림 자동 사라짐(토스트 타이머) — 현재는 다음 작업까지 유지
