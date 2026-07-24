# E7h 피드백 폴리시 7건 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자 피드백 7건 — 알림 비가림·커밋 상세 파일 depth 트리·워크트리 전환 동시성·워크트리별 터미널 탭 묶음·브랜치 삭제 사유+동반 삭제·⌘F 4패널 검색·신호등 헤더 중앙.

**Architecture:** 스펙 docs/superpowers/specs/2026-07-24-e7h-feedback-polish-design.md 참조. 새 순수 모듈 3개(file-tree·find-matches·엔진 stderr 파싱은 client 내), 나머지는 기존 패널·훅의 확장. 배너 스택은 z-index 곡예 대신 좌측 열 폭에서 파생한 inline left로 구조 해소.

**Tech Stack:** 기존과 동일(Electron·React·zustand·@tanstack/react-virtual·vitest·Playwright). 신규 의존성 없음.

**Branch:** `feature/e7h-feedback-polish` (main c69978f 이후에서 생성)

**게이트 표기 관례:** 루트 테스트 기준치는 468에서 시작해 태스크마다 "+N(실측 정정)"으로 누적한다 — 실측이 다르면 구현자가 편차 보고, 컨트롤러가 표를 정정한다(E7g 관례). E2E smoke 기준 68.

**실측 확정(플랜 사전):**
- `git branch -d/-D` 거부 stderr는 두 케이스 모두 단일 형식: `error: cannot delete branch '<name>' used by worktree at '<path>'` (git 2.50.1 실측 — HEAD 케이스도 동일, 경로가 본체인지로 구분).
- 배너 스택 left 산식: `columns.left + 36` (app__main padding-left 20(--space-5) + gap 16(--space-4)). App은 `computeColumns` 결과 `columns.left`를 이미 렌더에서 사용 중(App.tsx:197·523).
- 가상 목록 점프: HistoryPanel·DiffView·CommitDetailPanel·ChangesPanel 전부 `useVirtualizer` — `virtualizer.scrollToIndex(i, { align: 'center' })`가 기존 사용례(HistoryPanel 헤드 추적)로 검증돼 있다.
- 터미널 세션: `use-terminal-sessions.ts`의 `TerminalTab`에 그룹 키를 더하는 구조(전체 코드 실독 완료 — Task 6에 반영).

**플랜 명시 미확정(실독·같은 취지·편차 보고):** HistoryPanel 행 렌더 내부(하이라이트 클래스 삽입점), DiffView 행 렌더 내부(마크 삽입점), ChangesPanel 목록 배열 이름·필터 삽입점, TerminalDock 렌더 전체(탭 필터 적용), App keydown 훅(⌘` 블록에 ⌘F 추가), Panel 컴포넌트의 자식 배치(FindBar 오버레이 삽입점), 각 css 파일의 기존 토큰.

---

### Task 1: 엔진 — branches.remove `usedByWorktree` 구조화 (⑤ 기반)

**Files:**
- Modify: `packages/domain/src/repository.ts` (RemoveBranchResult — 229-233행 부근)
- Modify: `packages/git-adapter/src/client.ts` (branches.remove — 567-582행 부근)
- Test: `packages/git-adapter/test/client.test.ts`

- [ ] **Step 1: 도메인 타입 확장.** `packages/domain/src/repository.ts`의 기존:

```ts
/** 실험 공간 지우기 결과 — 합쳐지지 않은 저장이 있으면 지우지 않고 needsForce로 알린다 */
export interface RemoveBranchResult {
  removed: boolean
  needsForce: boolean
}
```

교체:

```ts
/** 실험 공간 지우기 결과 — 합쳐지지 않은 저장이 있으면 지우지 않고 needsForce로 알린다.
 *  워크트리가 그 공간을 펼쳐 쓰는 중이면 usedByWorktree에 그 워크트리 경로를 담아 알린다(E7h ⑤) */
export interface RemoveBranchResult {
  removed: boolean
  needsForce: boolean
  /** 브랜치를 쓰는 링크드 워크트리 경로 — 없으면 null */
  usedByWorktree: string | null
}
```

- [ ] **Step 2: Red.** `packages/git-adapter/test/client.test.ts`에 기존 branches.remove 테스트 근처(실독) 추가:

```ts
  it('워크트리가 펼쳐 쓰는 실험 공간 지우기는 usedByWorktree로 알린다', async () => {
    const repo = await initRepo()
    await commitFile(repo, 'a.txt', 'a', 'init')
    await execGitOrThrow(['branch', 'wt-branch'], { cwd: repo })
    const wtPath = join(dirname(repo), `${basename(repo)}-wt`)
    await execGitOrThrow(['worktree', 'add', '--end-of-options', wtPath, 'wt-branch'], { cwd: repo })
    try {
      const result = await createGitClient().branches.remove(repo, 'wt-branch', false)
      expect(result.removed).toBe(false)
      expect(result.needsForce).toBe(false)
      expect(result.usedByWorktree).not.toBeNull()
      // macOS 실경로(/private/var) 차이를 realpath로 흡수한다 (E7c 관례)
      expect(await realpath(result.usedByWorktree!)).toBe(await realpath(wtPath))
    } finally {
      await execGitOrThrow(['worktree', 'remove', '--force', '--end-of-options', wtPath], { cwd: repo })
    }
  })

  it('본체가 쓰는(현재) 실험 공간 지우기는 기존 친절 에러를 던진다', async () => {
    const repo = await initRepo()
    await commitFile(repo, 'a.txt', 'a', 'init')
    await expect(createGitClient().branches.remove(repo, 'main', false)).rejects.toThrow(
      '지금 있는 실험 공간',
    )
  })
```

(테스트 파일의 기존 헬퍼 이름(initRepo·commitFile·execGitOrThrow·createGitClient 등)은 실독으로 정확 이름 확인 — 다르면 같은 취지로 조정·편차 보고. `realpath`는 `node:fs/promises`, `join/dirname/basename`은 `node:path` — import 실독 정리.)

- [ ] **Step 3: Red 확인** — `pnpm --filter @git-gui/git-adapter test` 실행, 새 테스트 2건 실패(usedByWorktree 미존재/메시지 분기 미구현) 확인.

- [ ] **Step 4: 구현.** `packages/git-adapter/src/client.ts`의 기존:

```ts
      async remove(name, force) {
        const cwd = await topLevel()
        const args = ['branch', force ? '-D' : '-d', '--end-of-options', name]
        const result = await execGit(args, { cwd })
        if (result.exitCode === 0) return { removed: true, needsForce: false }
        if (result.stderr.includes('not fully merged')) {
          return { removed: false, needsForce: true }
        }
        if (result.stderr.includes('used by worktree')) {
          throw new Error('지금 있는 실험 공간은 지울 수 없어요. 다른 공간으로 이동한 뒤 지워 주세요.')
        }
        if (result.stderr.includes('not found')) {
          throw new Error(`"${name}"라는 실험 공간이 없어요.`)
        }
        throw new GitError(args, result)
      },
```

교체:

```ts
      async remove(name, force) {
        const cwd = await topLevel()
        const args = ['branch', force ? '-D' : '-d', '--end-of-options', name]
        const result = await execGit(args, { cwd })
        if (result.exitCode === 0) return { removed: true, needsForce: false, usedByWorktree: null }
        if (result.stderr.includes('not fully merged')) {
          return { removed: false, needsForce: true, usedByWorktree: null }
        }
        if (result.stderr.includes('used by worktree')) {
          // 실측(git 2.50): "cannot delete branch '<name>' used by worktree at '<path>'" — HEAD 케이스도 동일 형식.
          // 본체(현재 저장소)가 쓰면 기존 친절 에러, 링크드 워크트리면 경로를 구조화해 UI가 동반 삭제를 제안한다(E7h ⑤)
          const match = result.stderr.match(/used by worktree at '([^']+)'/)
          const worktreePath = match?.[1] ?? null
          if (worktreePath !== null) {
            const [wtReal, cwdReal] = await Promise.all([
              realpath(worktreePath).catch(() => worktreePath),
              realpath(cwd).catch(() => cwd),
            ])
            if (wtReal !== cwdReal) {
              return { removed: false, needsForce: false, usedByWorktree: worktreePath }
            }
          }
          throw new Error('지금 있는 실험 공간은 지울 수 없어요. 다른 공간으로 이동한 뒤 지워 주세요.')
        }
        if (result.stderr.includes('not found')) {
          throw new Error(`"${name}"라는 실험 공간이 없어요.`)
        }
        throw new GitError(args, result)
      },
```

(`realpath`는 `node:fs/promises`에서 import — 파일 상단 import 실독 정리. 경로 파싱 실패(match null)면 기존 에러로 폴백 — 스펙 "파싱 실패 시 null 경로로도 같은 분기"보다 보수적이지만, 경로 없이는 동반 삭제를 실행할 수 없으므로 에러 폴백이 정직하다 — 스펙 편차로 기록됨.)

- [ ] **Step 5: worktrees.remove 반환도 타입 맞춤.** client.ts의 worktrees.remove(719행 부근)가 같은 `RemoveBranchResult`를 반환한다 — 반환 리터럴 2곳에 `usedByWorktree: null` 추가(실독으로 정확 위치). 다른 RemoveBranchResult 반환처가 더 있으면 전부 동일 처리(typecheck가 잡는다).

- [ ] **Step 6: 게이트** — `pnpm --filter @git-gui/git-adapter test` 전건 통과, 루트 `pnpm test` → **468+2(실측 정정)**, `pnpm typecheck` 전부 Done(도메인 필드 추가로 데스크톱 쪽 컴파일 에러가 나면 해당 사용처는 이 태스크에서 `usedByWorktree` 무시로만 맞추고 UI 흐름은 Task 7이 담당).

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/repository.ts packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(git-adapter): E7h 브랜치 삭제 — 워크트리 사용 중이면 usedByWorktree 구조화 반환

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: file-tree 순수 함수 (② 기반)

**Files:**
- Create: `apps/desktop/src/renderer/src/components/file-tree.ts`
- Test: `apps/desktop/test/file-tree.test.ts`

- [ ] **Step 1: Red.** `apps/desktop/test/file-tree.test.ts` 신규:

```ts
import { describe, expect, it } from 'vitest'
import {
  buildFileTree,
  flattenFileTree,
  type FileTreeRow,
} from '../src/renderer/src/components/file-tree'

interface Item {
  path: string
}

const items = (...paths: string[]): Item[] => paths.map((path) => ({ path }))

const rowKinds = (rows: FileTreeRow<Item>[]) =>
  rows.map((row) => (row.kind === 'folder' ? `d${row.depth}:${row.path}` : `f${row.depth}:${row.item.path}`))

describe('buildFileTree + flattenFileTree', () => {
  it('경로 세그먼트로 다단 중첩 트리를 만들고 입력 순서를 보존한다', () => {
    const rows = flattenFileTree(
      buildFileTree(items('src/a.ts', 'src/ui/b.ts', 'README.md')),
      new Set(),
    )
    expect(rowKinds(rows)).toEqual([
      'd0:src',
      'f1:src/a.ts',
      'd1:src/ui',
      'f2:src/ui/b.ts',
      'f0:README.md',
    ])
  })

  it('폴더 count는 하위 전체 파일 수다', () => {
    const rows = flattenFileTree(
      buildFileTree(items('src/a.ts', 'src/ui/b.ts', 'src/ui/c.ts')),
      new Set(),
    )
    const src = rows[0]
    if (src.kind !== 'folder') throw new Error('folder expected')
    expect(src.count).toBe(3)
  })

  it('접힌 폴더의 하위 행은 평탄화에서 빠진다(중첩 폴더 포함)', () => {
    const tree = buildFileTree(items('src/a.ts', 'src/ui/b.ts', 'top.txt'))
    const rows = flattenFileTree(tree, new Set(['src']))
    expect(rowKinds(rows)).toEqual(['d0:src', 'f0:top.txt'])
  })

  it('루트 파일만 있으면 폴더 행이 없다', () => {
    const rows = flattenFileTree(buildFileTree(items('a.txt', 'b.txt')), new Set())
    expect(rowKinds(rows)).toEqual(['f0:a.txt', 'f0:b.txt'])
  })
})
```

- [ ] **Step 2: Red 확인 후 구현.** `pnpm --filter @git-gui/desktop test -- -t 'buildFileTree'` 실패 확인 → `apps/desktop/src/renderer/src/components/file-tree.ts` 신규:

```ts
/**
 * 커밋 상세 파일 목록의 depth 트리 (E7h ②) — 경로 `/` 세그먼트 기반, 입력 순서 보존.
 * branch-tree(E7g)와 같은 규칙의 파일판. 제네릭 — path를 가진 어떤 항목이든 받는다(커밋 파일·보관 파일).
 */
export interface FileTreeFolder<T extends { path: string }> {
  kind: 'folder'
  /** 전체 경로 접두 — 접기 키로 쓴다 (예: 'src/ui') */
  path: string
  name: string
  /** 하위 전체 파일 수(재귀) */
  count: number
  children: FileTreeNode<T>[]
}

export interface FileTreeLeaf<T extends { path: string }> {
  kind: 'file'
  item: T
}

export type FileTreeNode<T extends { path: string }> = FileTreeFolder<T> | FileTreeLeaf<T>

export type FileTreeRow<T extends { path: string }> =
  | { kind: 'folder'; path: string; name: string; count: number; depth: number }
  | { kind: 'file'; item: T; depth: number }

export function buildFileTree<T extends { path: string }>(files: T[]): FileTreeNode<T>[] {
  const root: FileTreeNode<T>[] = []
  const folders = new Map<string, FileTreeFolder<T>>()

  const folderFor = (prefix: string, name: string, parent: FileTreeNode<T>[]): FileTreeFolder<T> => {
    const existing = folders.get(prefix)
    if (existing !== undefined) return existing
    const folder: FileTreeFolder<T> = { kind: 'folder', path: prefix, name, count: 0, children: [] }
    folders.set(prefix, folder)
    parent.push(folder)
    return folder
  }

  for (const item of files) {
    const segments = item.path.split('/')
    let siblings = root
    let prefix = ''
    for (const segment of segments.slice(0, -1)) {
      prefix = prefix === '' ? segment : `${prefix}/${segment}`
      const folder = folderFor(prefix, segment, siblings)
      folder.count += 1
      siblings = folder.children
    }
    siblings.push({ kind: 'file', item })
  }
  return root
}

export function flattenFileTree<T extends { path: string }>(
  nodes: FileTreeNode<T>[],
  collapsed: ReadonlySet<string>,
): FileTreeRow<T>[] {
  const rows: FileTreeRow<T>[] = []
  const walk = (list: FileTreeNode<T>[], depth: number) => {
    for (const node of list) {
      if (node.kind === 'file') {
        rows.push({ kind: 'file', item: node.item, depth })
        continue
      }
      rows.push({ kind: 'folder', path: node.path, name: node.name, count: node.count, depth })
      if (!collapsed.has(node.path)) walk(node.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return rows
}
```

- [ ] **Step 3: 게이트** — `pnpm --filter @git-gui/desktop test -- -t 'FileTree'`로 4건 통과 확인(이름 매칭이 어긋나면 파일 단위 실행), 루트 `pnpm test` → **468+2+4(실측 정정)**, typecheck Done.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/components/file-tree.ts apps/desktop/test/file-tree.test.ts
git commit -m "feat(desktop): E7h 파일 depth 트리 순수 함수 — build/flatten(접기)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 알림 비가림 (①)

**Files:**
- Modify: `apps/desktop/src/renderer/src/layout.css` (146-151행 부근 padding 블록)
- Modify: `apps/desktop/src/renderer/src/App.tsx` (459-460행 부근 top-stack 렌더)
- Test: `apps/desktop/e2e/smoke.spec.ts` (신규 1건)

- [ ] **Step 1: layout.css 하드코딩 패딩 제거.** 기존:

```css
/* E7a — 좌측 탭바(z-41)가 배너 위에 뜬다. 배너 텍스트가 탭 뒤로 숨지 않게 콘텐츠만 탭 구역 오른쪽에서 시작(배경은 전체 폭 유지) */
.app__error,
.app__notice,
.app__merge-bar {
  padding-left: 210px;
}
```

교체:

```css
/* E7h ① — 배너 스택은 좌측 열 오른쪽부터 시작한다(App이 top-stack left를 columns.left에서 파생).
   E7a의 padding-left 210px(탭 2개 시절 실측)는 탭이 늘며 깨졌다 — 하드코딩 폐기 */
```

- [ ] **Step 2: App top-stack에 inline left.** App.tsx의 기존:

```tsx
        <div className="app__top-layer">
          <div className="app__top-stack">
```

교체:

```tsx
        <div className="app__top-layer">
          {/* E7h ① — 좌측 탭바(z-41)와 아예 안 겹치게 스택을 좌측 열 오른쪽부터(패딩 20 + 열 폭 + gap 16) */}
          <div className="app__top-stack" style={{ left: columns.left + 36 }}>
```

- [ ] **Step 3: E2E 신규 1건.** smoke.spec.ts 파일 끝(E7g 테스트 뒤)에 추가 — 워크트리 탭을 켠 상태에서 알림을 띄우고, 알림 텍스트와 세 탭이 모두 가려지지 않음을 단언. 픽스처·헬퍼는 기존 스위트 관례(createRepoWithChange 등 실독) 재사용:

```ts
test('E7h — 알림 배너가 좌측 탭들을 가리지도, 가려지지도 않는다', async () => {
  const repo = await createRepoWithChange('notice-clear')
  const app = await electron.launch({ args: [APP_ROOT], env: E2E_ENV })
  try {
    const window = await app.firstWindow()
    await openRepo(window, repo)
    // 알림 유발: 실험 공간 만들기(생성 notice) — 가장 값싼 notice 경로 (실독으로 기존 관례 확인·조정 가능)
    await window.getByTestId('branch-switcher').click()
    await window.getByTestId('branch-create').click()
    await window.getByTestId('prompt-input').fill('e7h-notice')
    await window.getByTestId('prompt-confirm').click()
    const notice = window.getByTestId('notice')
    await expect(notice).toBeVisible()
    // 배너 박스가 탭바 구역(왼쪽)과 겹치지 않는다 — 탭 3개 모두 온전히 클릭 가능
    const noticeBox = (await notice.boundingBox())!
    const tabBox = (await window.getByTestId('left-tab-worktrees').boundingBox())!
    expect(noticeBox.x).toBeGreaterThanOrEqual(tabBox.x + tabBox.width)
    await window.getByTestId('left-tab-worktrees').click()
    await window.getByTestId('left-tab-changes').click()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

(testid `left-tab-worktrees`/`left-tab-changes`·`branch-create`·prompt testid·openRepo 헬퍼는 실독으로 정확 이름 확인 — 다르면 같은 취지 조정·편차 보고.)

- [ ] **Step 4: 게이트** — typecheck, `cd apps/desktop && npx electron-vite build && npx playwright test e2e/smoke.spec.ts` → **69 passed**(68+1), 루트 `pnpm test` 유지.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/layout.css apps/desktop/src/renderer/src/App.tsx apps/desktop/e2e/smoke.spec.ts
git commit -m "fix(desktop): E7h 알림 비가림 — 배너 스택을 좌측 열 오른쪽부터(하드코딩 패딩 폐기)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 커밋 상세 파일 depth 트리 (②)

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/CommitDetailPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/components/commit-detail-panel.css` (폴더 행 스타일 추가 — 실독)
- Test: `apps/desktop/e2e/smoke.spec.ts` (신규 1건)

- [ ] **Step 1: 트리 행 렌더로 교체.** CommitDetailPanel.tsx에서:
  1. import 추가: `import { buildFileTree, flattenFileTree } from './file-tree'` + `useState`에 `collapsed` 추가.
  2. 컴포넌트 상단(기존 menu state 근처)에:

```tsx
  // E7h ② — 파일 목록 depth 트리. 접기 상태는 로컬(커밋 전환 시 리셋 — key로 강제)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const rows = flattenFileTree(buildFileTree(detail.files), collapsed)
```

  3. virtualizer의 `count: detail.files.length` → `count: rows.length`.
  4. 가상 목록 map 내부의 기존 `const file = detail.files[item.index]!` 이하 `<CommitFileRow …/>` 렌더를 다음으로 교체(li 래퍼·virtual-row·measureElement는 유지):

```tsx
            const row = rows[item.index]!
            return (
              <li
                key={row.kind === 'folder' ? `d:${row.path}` : row.item.path}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="virtual-row"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {row.kind === 'folder' ? (
                  <button
                    type="button"
                    className="commit-file-folder"
                    style={{ paddingLeft: `${8 + row.depth * 14}px` }}
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev)
                        if (next.has(row.path)) next.delete(row.path)
                        else next.add(row.path)
                        return next
                      })
                    }
                    aria-expanded={!collapsed.has(row.path)}
                    data-testid={`commit-folder-${row.path}`}
                  >
                    <span className="commit-file-folder__chev" aria-hidden="true">
                      {collapsed.has(row.path) ? '▸' : '▾'}
                    </span>
                    <span className="commit-file-folder__name">{row.name}</span>
                    <span className="commit-file-folder__count">{row.count}</span>
                  </button>
                ) : (
                  <div style={{ paddingLeft: `${row.depth * 14}px` }}>
                    <CommitFileRow
                      file={row.item}
                      isSelected={selectedFile?.path === row.item.path}
                      busy={busy}
                      onSelect={() => onSelectFile(row.item)}
                      onMenu={(x, y) => setMenu({ x, y, file: row.item })}
                    />
                  </div>
                )}
              </li>
            )
```

  5. **커밋 전환 시 접기 리셋**: 파일 목록 스크롤 영역을 감싸는 곳에서 컴포넌트를 `key={detail.hash}`로 리마운트하는 대신(패널 전체 상태가 날아간다), `detail.hash` 변화에 접기만 리셋하는 이펙트를 이른 반환보다 앞에 둔다(Rules of Hooks — E7d 교훈):

```tsx
  useEffect(() => {
    setCollapsed(new Set())
  }, [detail.hash])
```

  (`detail.hash` 필드명은 CommitDetail 도메인 타입 실독 — shortHash만 있으면 그걸 쓴다. useEffect import 추가.)
  6. CommitFileRow 안의 `file-row__dir`(경로 흐림 부분)은 트리에서는 중복 정보다 — 파일 행에서 **디렉터리 표기를 제거**하고 basename만 남긴다(툴팁에는 전체 경로 유지). 단, ⑥의 검색 필터(평면 모드)에서는 전체 경로가 필요하므로 CommitFileRow에 `showDir: boolean` prop을 추가해 트리 모드 false/평면 모드 true로 분기(Task 8에서 평면 모드가 생긴다 — 이번 태스크에서는 항상 false로 렌더).

- [ ] **Step 2: 폴더 행 CSS.** commit-detail-panel.css에 추가(기존 토큰 실독·행 높이는 파일 행과 동일 계열):

```css
/* E7h ② — 파일 트리 폴더 행 */
.commit-file-folder {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: var(--text-sm);
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
}
.commit-file-folder:hover {
  background: var(--color-hover-bg, rgba(127, 127, 127, 0.08));
}
.commit-file-folder__chev {
  width: 12px;
  opacity: 0.6;
}
.commit-file-folder__name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.commit-file-folder__count {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
```

- [ ] **Step 3: E2E 신규 1건.** smoke.spec.ts 끝에 추가 — 폴더 2단 커밋을 만들고 상세를 열어: 폴더 행 존재 → 접기 → 하위 파일 행 소멸 → 펼치기 복원. 픽스처는 기존 커밋 상세 테스트(실독) 관례 재사용:

```ts
test('E7h — 커밋 상세 파일 목록이 폴더 트리로 접힌다', async () => {
  const repo = await createRepoWithChange('detail-tree')
  await writeFile(join(repo, 'nested.txt'), 'x')
  await execGitOrThrow(['add', '.'], { cwd: repo })
  await execGitOrThrow(['-c', 'user.email=e2e@test', '-c', 'user.name=E2E', 'commit', '-m', 'base'], { cwd: repo })
  const { mkdir } = await import('node:fs/promises')
  await mkdir(join(repo, 'src/ui'), { recursive: true })
  await writeFile(join(repo, 'src/ui/deep.txt'), 'deep')
  await writeFile(join(repo, 'root.txt'), 'root')
  await execGitOrThrow(['add', '.'], { cwd: repo })
  await execGitOrThrow(['-c', 'user.email=e2e@test', '-c', 'user.name=E2E', 'commit', '-m', 'tree files'], { cwd: repo })
  const app = await electron.launch({ args: [APP_ROOT], env: E2E_ENV })
  try {
    const window = await app.firstWindow()
    await openRepo(window, repo)
    await window.getByTestId('history-item-0').click()
    await expect(window.getByTestId('commit-folder-src')).toBeVisible()
    await expect(window.getByTestId('commit-file-src/ui/deep.txt')).toBeVisible()
    await window.getByTestId('commit-folder-src').click()
    await expect(window.getByTestId('commit-file-src/ui/deep.txt')).toHaveCount(0)
    await expect(window.getByTestId('commit-file-root.txt')).toBeVisible()
    await window.getByTestId('commit-folder-src').click()
    await expect(window.getByTestId('commit-file-src/ui/deep.txt')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

(`history-item-0` 등 testid는 기존 커밋 상세 E2E 실독으로 정확 이름 확인·조정.)

- [ ] **Step 4: 게이트** — typecheck, build, smoke → **70 passed**(69+1), 루트 `pnpm test` 유지. 기존 커밋 상세·보관함 미리보기 E2E가 `commit-file-<path>` testid로 파일 행을 찾으므로 무회귀 예상 — 깨지면 원인 수정(비활성 금지)·편차 보고.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/CommitDetailPanel.tsx apps/desktop/src/renderer/src/components/commit-detail-panel.css apps/desktop/e2e/smoke.spec.ts
git commit -m "feat(desktop): E7h 커밋 상세 파일 목록 depth 트리 — 폴더 접기·들여쓰기

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 워크트리 전환 동시성 (③) + 신호등 헤더 중앙 (⑦)

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx` (worktree select case)
- Modify: `apps/desktop/src/main/index.ts` (titleBarStyle)
- Test: `apps/desktop/e2e/smoke.spec.ts` (신규 1건 — 전환 동시성)

- [ ] **Step 1: 전환 순서 교체.** App.tsx의 기존:

```tsx
                  case 'select':
                    // 클릭의 기본 동작은 설정을 따른다 (우클릭엔 두 동작이 따로 있다 — 스펙)
                    setActiveWorktree({ cwd: action.path, label: action.label })
                    if (worktreeSelectAction === 'switch-app') void store.openWorktree(action.path)
                    else {
                      setDockOpen(() => {
                        saveDockOpen(true)
                        return true
                      })
                    }
                    break
```

교체:

```tsx
                  case 'select':
                    // 클릭의 기본 동작은 설정을 따른다 (우클릭엔 두 동작이 따로 있다 — 스펙)
                    if (worktreeSelectAction === 'switch-app') {
                      // E7h ③ — 앱 전환이 끝난 뒤 터미널 대상을 같이 바꾼다(먼저 바꾸면 시차·실패 시 어긋남)
                      void store.openWorktree(action.path).then((ok) => {
                        if (ok) setActiveWorktree({ cwd: action.path, label: action.label })
                      })
                    } else {
                      setActiveWorktree({ cwd: action.path, label: action.label })
                      setDockOpen(() => {
                        saveDockOpen(true)
                        return true
                      })
                    }
                    break
```

(`store.openWorktree`의 반환 타입 실독 — boolean을 반환하지 않으면(void), then 콜백에서 `store.getState?` 대신 **openWorktree를 성공 여부 boolean 반환으로 바꾸는 최소 수정**을 store에 가한다: guard 결과를 반환(기존 removeWorktree가 boolean 반환하는 관례 실독 후 동일 패턴). 편차 보고.)

- [ ] **Step 2: 신호등 위치.** main/index.ts의 기존:

```ts
    // E7f 한 줄 타이틀바(macOS) — OS 타이틀바 줄을 없애고 신호등만 인셋으로 띄워
    // 앱 헤더가 타이틀바를 겸한다(드래그·패딩은 renderer CSS). 숨김 캡처와 공존(실측 1)
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
```

교체:

```ts
    // E7f 한 줄 타이틀바(macOS) → E7h ⑦: hiddenInset은 신호등 y가 OS 고정이라 헤더와 안 맞았다 —
    // hidden + trafficLightPosition으로 헤더 세로 중앙에 맞춘다(헤더 실높이는 Step 3에서 실측해 y 확정).
    // 앱 헤더가 타이틀바를 겸한다(드래그·패딩은 renderer CSS). 숨김 캡처와 공존(실측 1)
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 20, y: 20 } }
      : {}),
```

- [ ] **Step 3: y 좌표 실측 확정.** dev 또는 E2E로 헤더 실높이를 잰다:

```bash
cd apps/desktop && npx electron-vite build && node -e "
const { _electron } = require('playwright');
(async () => {
  const app = await _electron.launch({ args: ['.'], env: { ...process.env, GIT_GUI_E2E: '1' } });
  const win = await app.firstWindow();
  const h = await win.evaluate(() => document.querySelector('.app__header').getBoundingClientRect().height);
  console.log('header height:', h);
  await app.close();
})();
"
```

`y = Math.round((헤더높이 - 14) / 2)` (신호등 지름 ≈14px 관례)로 Step 2의 `y: 20`을 실측값으로 교체(달라지면 편차 보고). 전체화면 push(E7f)·드래그 무변 확인은 코드 리뷰로(신호등 자체는 OS 크롬이라 E2E 불가).

- [ ] **Step 4: E2E 전환 동시성 1건.** smoke.spec.ts 끝에 추가 — 설정을 "앱 전체 전환"으로 바꾼 뒤 워크트리 행 클릭: 좌측 헤더의 저장소 경로와 도크 라벨이 **같은 시점 이후** 모두 새 워크트리를 가리킴(전환 완료 후 라벨 단언 — 시차 자체의 프레임 단위 검증은 불가하니 "성공 후에만 바뀐다"의 결과를 검증). 기존 E7c 설정 모달·워크트리 E2E 픽스처(실독) 재사용:

```ts
test('E7h — 앱 전체 전환 시 터미널 대상이 전환 완료 후 함께 바뀐다', async () => {
  const repo = await createRepoWithChange('switch-sync')
  await execGitOrThrow(['branch', 'wt-side'], { cwd: repo })
  const wtPath = `${repo}-side`
  await execGitOrThrow(['worktree', 'add', '--end-of-options', wtPath, 'wt-side'], { cwd: repo })
  const app = await electron.launch({ args: [APP_ROOT], env: E2E_ENV })
  try {
    const window = await app.firstWindow()
    await openRepo(window, repo)
    // 설정 → 워크트리 클릭 동작: 앱 전체 전환 (E7c 설정 모달 testid 실독)
    await window.getByTestId('settings-open').click()
    await window.getByTestId('setting-worktree-action-switch-app').click()
    await window.getByTestId('settings-close').click()
    await window.getByTestId('left-tab-worktrees').click()
    const sideName = wtPath.split('/').pop()!
    await window.getByTestId(`worktree-row-${sideName}`).click()
    // 앱 전환 완료(경로 표기)와 도크 라벨이 함께 새 워크트리를 가리킨다
    await expect(window.getByTestId('repo-path')).toContainText(sideName)
    await expect(window.getByTestId('terminal-dock')).toContainText(sideName)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(wtPath, { recursive: true, force: true })
  }
})
```

(설정 모달·repo-path·도크 라벨 testid 전부 실독 확인·같은 취지 조정. 도크가 닫혀 있으면 라벨 확인 전에 토글.)

- [ ] **Step 5: 게이트** — typecheck, build, smoke → **71 passed**(70+1), 루트 `pnpm test` 유지. 기존 E7c/E7f E2E(설정·타이틀바 관련) 무회귀 — hidden 전환으로 깨지는 창 옵션 단언이 있으면 같은 취지로 갱신·편차 보고.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/App.tsx apps/desktop/src/main/index.ts apps/desktop/e2e/smoke.spec.ts
git commit -m "feat(desktop): E7h 워크트리 전환 동시성 + 신호등 헤더 중앙(trafficLightPosition)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(store.openWorktree 반환 변경이 생기면 repository-store.ts도 add — 편차 보고.)

---

### Task 6: 워크트리별 터미널 탭 묶음 (④)

**Files:**
- Modify: `apps/desktop/src/renderer/src/ui/terminal/use-terminal-sessions.ts`
- Modify: `apps/desktop/src/renderer/src/ui/terminal/TerminalDock.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx` (removeWorktree 성공 시 그룹 정리 콜백 — 실독 배선)
- Test: `apps/desktop/e2e/smoke.spec.ts` (신규 2건)

- [ ] **Step 1: 훅에 그룹 키.** use-terminal-sessions.ts 수정 — `TerminalTab`에 `groupKey: string` 추가, `create`가 그룹 키를 계산해 동봉, 그룹별 마지막 활성 기억·그룹 필터 API 노출. 기존 전체 코드는 실독 완료 상태(플랜 사전) — 다음 diff를 같은 취지로 적용:

```ts
export interface TerminalTab {
  sessionId: string
  /** 탭 라벨 — "1: 쉘" 형태 */
  title: string
  exited: boolean
  /** 이 터미널이 열린 워크트리 경로(본체는 repoPath) — 도크가 그룹별로 필터한다 (E7h ④) */
  groupKey: string
}
```

`create`에서 탭 push 시:

```ts
      const groupKey = options?.cwd ?? repoPath
      setTabs((prev) => [
        ...prev,
        {
          sessionId,
          title: `${counterRef.current}: ${options?.label ?? '쉘'}`,
          exited: false,
          groupKey,
        },
      ])
      setActiveId(sessionId)
      lastActiveRef.current.set(groupKey, sessionId)
```

훅 상단에 그룹별 활성 기억:

```ts
  /** 그룹별 마지막 활성 탭 — 그룹 전환 시 복원한다 (E7h ④) */
  const lastActiveRef = useRef(new Map<string, string>())
```

`select`를 groupKey 기억형으로 교체(반환 객체의 `select: setActiveId`를 함수로):

```ts
  const select = (sessionId: string) => {
    setActiveId(sessionId)
    const tab = tabs.find((t) => t.sessionId === sessionId)
    if (tab !== undefined) lastActiveRef.current.set(tab.groupKey, sessionId)
  }
```

`close`의 다음 활성 선택은 **같은 그룹 안에서**:

```ts
    const next = tabs.filter((tab) => tab.sessionId !== sessionId)
    setTabs(next)
    const closedGroup = tabs.find((tab) => tab.sessionId === sessionId)?.groupKey
    if (activeId === sessionId) {
      const sameGroup = next.filter((tab) => tab.groupKey === closedGroup)
      const fallback = sameGroup[sameGroup.length - 1]?.sessionId ?? null
      setActiveId(fallback)
      if (closedGroup !== undefined) {
        if (fallback !== null) lastActiveRef.current.set(closedGroup, fallback)
        else lastActiveRef.current.delete(closedGroup)
      }
    }
```

그룹 전환·정리 API 추가(반환 객체에 `activateGroup`·`closeGroup` 동봉):

```ts
  /** 그룹 전환 (E7h ④) — 그 그룹의 기억된(없으면 마지막) 탭을 활성, 탭이 없으면 자동 1개 생성 */
  const activateGroup = async (groupKey: string, createOptions?: { cwd?: string; label?: string }) => {
    const group = tabs.filter((tab) => tab.groupKey === groupKey)
    if (group.length === 0) {
      await create(createOptions)
      return
    }
    const remembered = lastActiveRef.current.get(groupKey)
    const target = group.find((tab) => tab.sessionId === remembered) ?? group[group.length - 1]!
    setActiveId(target.sessionId)
  }

  /** 그룹 세션 전부 정리 — 워크트리 지우기 성공 시 (E7h ④) */
  const closeGroup = (groupKey: string) => {
    for (const tab of tabs.filter((t) => t.groupKey === groupKey)) close(tab.sessionId)
  }
```

(주의: `closeGroup`의 연속 close는 stale `tabs` 클로저 문제가 있다 — close를 함수형 setTabs 기반으로 재작성하거나, closeGroup에서 대상 sessionId 목록을 먼저 뽑아 하나씩 close하되 close가 stale해도 kill·dispose·필터는 sessionId 기준이라 안전한지 실측·재작성한다. **구현자는 세션 2개 그룹 정리가 실제로 둘 다 닫히는지 단위 또는 수동 검증하고 결과를 보고할 것.** 필요하면 close를 `setTabs((prev) => …)` 함수형으로 리팩터 — 같은 취지·편차 보고.)

- [ ] **Step 2: 도크 필터 렌더.** TerminalDock.tsx — `activeWorktree` prop과 repoPath로 현재 그룹 키를 정하고 탭바·자동 생성·＋를 그룹 기준으로(전체 코드 실독 후 같은 취지 적용):
  1. `const groupKey = activeWorktree?.cwd ?? repoPath` (repoPath null이면 도크 자체가 비활성 — 기존 가드 유지).
  2. 탭바 렌더 `sessions.tabs.map` → `sessions.tabs.filter((tab) => tab.groupKey === groupKey).map` (본문 세션 DOM은 **전체 탭** 유지 — 숨김 그룹도 pty·xterm 살아있어야 한다. display 조건은 기존 activeId 기준 그대로).
  3. 도크 열림 시 자동 생성 effect(기존 `if (sessions.tabs.length === 0) void sessions.create(...)`)를 그룹 기준으로: `if (현재 그룹 탭 0) void sessions.activateGroup(groupKey, activeWorktree ?? undefined)`.
  4. **그룹 키 변화 effect 추가**(이른 반환보다 앞): 도크가 열려 있는 상태에서 groupKey가 바뀌면 `void sessions.activateGroup(groupKey, activeWorktree ?? undefined)` — 복원 또는 자동 생성.
  5. ＋ 버튼 onPress은 기존 그대로 `sessions.create(activeWorktree ?? undefined)`(= 현재 그룹 cwd) — 라벨 유지.
- [ ] **Step 3: 워크트리 지우기 정리 배선.** removeWorktree 성공 경로(App.tsx confirmingRemoveWorktree onConfirm — 실독)에서 해당 경로 그룹 정리를 호출해야 한다. TerminalDock 내부 훅이라 App에서 직접 못 부른다 — **TerminalDock에 `purgeGroup?: string | null` prop을 추가하고 App이 지운 워크트리 경로를 1회성 상태로 내려보내면 도크 effect가 `sessions.closeGroup(purgeGroup)` 후 App 콜백(`onPurged()`)으로 상태를 비운다**(App 상태: `const [purgeTerminalGroup, setPurgeTerminalGroup] = useState<string | null>(null)` — removeWorktree 성공 시 `setPurgeTerminalGroup(target.path)`). 대안으로 세션 훅을 App으로 끌어올리는 큰 리팩터는 하지 않는다(YAGNI). 정확한 삽입점 실독·같은 취지 적용.
- [ ] **Step 4: E2E 신규 2건.** smoke.spec.ts 끝에 추가(픽스처는 Task 5와 같은 워크트리 관례):

```ts
test('E7h — 터미널 탭이 워크트리별 묶음으로 전환·복원된다', async () => {
  const repo = await createRepoWithChange('term-groups')
  await execGitOrThrow(['branch', 'grp-side'], { cwd: repo })
  const wtPath = `${repo}-grp`
  await execGitOrThrow(['worktree', 'add', '--end-of-options', wtPath, 'grp-side'], { cwd: repo })
  const app = await electron.launch({ args: [APP_ROOT], env: E2E_ENV })
  try {
    const window = await app.firstWindow()
    await openRepo(window, repo)
    // 본체 그룹: 도크 열면 자동 1탭, ＋로 2탭
    await window.getByTestId('terminal-toggle').click()
    await expect(window.getByTestId('terminal-dock')).toContainText('1: 쉘')
    await window.getByTestId('terminal-new-tab').click()
    await expect(window.getByTestId('terminal-dock')).toContainText('2: 쉘')
    // 워크트리로 터미널 대상 전환(기본 설정 = 터미널만) → 그 그룹의 새 탭만 보인다
    await window.getByTestId('left-tab-worktrees').click()
    const sideName = wtPath.split('/').pop()!
    await window.getByTestId(`worktree-row-${sideName}`).click()
    await expect(window.getByTestId('terminal-dock')).toContainText(`3: ${sideName}`)
    await expect(window.getByTestId('terminal-dock')).not.toContainText('1: 쉘')
    // 본체로 복귀 → 본체 탭 2개 복원
    const repoName = repo.split('/').pop()!
    await window.getByTestId(`worktree-row-${repoName}`).click()
    await expect(window.getByTestId('terminal-dock')).toContainText('1: 쉘')
    await expect(window.getByTestId('terminal-dock')).toContainText('2: 쉘')
    await expect(window.getByTestId('terminal-dock')).not.toContainText(`3: ${sideName}`)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(wtPath, { recursive: true, force: true })
  }
})

test('E7h — 워크트리를 지우면 그 그룹 터미널도 정리된다', async () => {
  const repo = await createRepoWithChange('term-purge')
  await execGitOrThrow(['branch', 'purge-side'], { cwd: repo })
  const wtPath = `${repo}-purge`
  await execGitOrThrow(['worktree', 'add', '--end-of-options', wtPath, 'purge-side'], { cwd: repo })
  const app = await electron.launch({ args: [APP_ROOT], env: E2E_ENV })
  try {
    const window = await app.firstWindow()
    await openRepo(window, repo)
    await window.getByTestId('left-tab-worktrees').click()
    const sideName = wtPath.split('/').pop()!
    await window.getByTestId(`worktree-row-${sideName}`).click() // 터미널 대상 → 그룹 탭 생성
    await expect(window.getByTestId('terminal-dock')).toContainText(sideName)
    // 본체로 대상 복귀 후 워크트리 지우기(우클릭 메뉴 — E7c testid 실독)
    const repoName = repo.split('/').pop()!
    await window.getByTestId(`worktree-row-${repoName}`).click()
    await window.getByTestId(`worktree-row-${sideName}`).click({ button: 'right' })
    await window.getByTestId('context-remove-worktree').click()
    await window.getByTestId('confirm-confirm').click()
    await expect(window.getByTestId(`worktree-row-${sideName}`)).toHaveCount(0)
    // 지워진 그룹 탭이 어디에도 안 남는다(본체 그룹 표시 중 — 그 워크트리 라벨 탭 부재)
    await expect(window.getByTestId('terminal-dock')).not.toContainText(`: ${sideName}`)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(wtPath, { recursive: true, force: true })
  }
})
```

(context-remove-worktree·confirm-confirm 등 testid 실독 확인·조정. 탭 라벨 카운터가 전역 순번이므로 `3:` 가정이 어긋나면 라벨 매치를 유연화(정규식) — 편차 보고.)

- [ ] **Step 5: 게이트** — typecheck, build, smoke → **73 passed**(71+2), 루트 `pnpm test` 유지. 기존 터미널 E2E 7건 무회귀(그룹 도입으로 라벨·자동 생성 동작이 변하는 단언이 있으면 같은 취지 갱신·편차 보고).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/ui/terminal/use-terminal-sessions.ts apps/desktop/src/renderer/src/ui/terminal/TerminalDock.tsx apps/desktop/src/renderer/src/App.tsx apps/desktop/e2e/smoke.spec.ts
git commit -m "feat(desktop): E7h 워크트리별 터미널 탭 묶음 — 그룹 전환·복원·자동 생성·지우기 정리

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 브랜치 삭제 사유 + 동반 삭제 (⑤ UI)

**Files:**
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts` (removeBranch — usedByWorktree 전달)
- Modify: `apps/desktop/src/renderer/src/App.tsx` (confirmingRemove 연쇄)
- Test: `apps/desktop/e2e/smoke.spec.ts` (신규 1건)

- [ ] **Step 1: store 반환 확장.** repository-store.ts의 기존:

```ts
  async removeBranch(name, force) {
    const { repoPath } = get()
    if (!repoPath) return false
    let needsForce = false
    await guard(set, get, async () => {
      const result = await git().branches.remove(repoPath, name, force)
      needsForce = result.needsForce
      if (result.removed) {
        set({
          ...(await fetchSnapshot(repoPath, get().historyLimit)),
          notice: `"${name}" 실험 공간을 지웠어요.`,
        })
      }
    })
    return needsForce
```

교체(인터페이스 선언 `removeBranch(name: string, force: boolean): Promise<boolean>`도 함께 교체 — 실독):

```ts
  async removeBranch(name, force) {
    const { repoPath } = get()
    if (!repoPath) return { needsForce: false, usedByWorktree: null }
    let needsForce = false
    let usedByWorktree: string | null = null
    await guard(set, get, async () => {
      const result = await git().branches.remove(repoPath, name, force)
      needsForce = result.needsForce
      usedByWorktree = result.usedByWorktree
      if (result.removed) {
        set({
          ...(await fetchSnapshot(repoPath, get().historyLimit)),
          notice: `"${name}" 실험 공간을 지웠어요.`,
        })
      }
    })
    return { needsForce, usedByWorktree }
```

인터페이스:

```ts
  /** 지우기 — needsForce면 2단 확인, usedByWorktree면 동반 삭제 확인으로 이어진다 (E7h ⑤) */
  removeBranch(
    name: string,
    force: boolean,
  ): Promise<{ needsForce: boolean; usedByWorktree: string | null }>
```

- [ ] **Step 2: App 연쇄.** App.tsx — 상태 추가(confirmingRemove 근처):

```tsx
  // E7h ⑤ — 워크트리가 쓰는 실험 공간: 워크트리 동반 삭제 확인
  const [confirmingRemoveWithWorktree, setConfirmingRemoveWithWorktree] = useState<{
    name: string
    force: boolean
    worktreePath: string
  } | null>(null)
```

기존 confirmingRemove onConfirm 내부:

```tsx
          void (async () => {
            // 합쳐지지 않은 저장이 있으면 엔진이 지우지 않고 needsForce로 알린다 — 2단 확인 (ManageBranches 관례)
            if (await store.removeBranch(target.name, target.force)) {
              if (!target.force) setConfirmingRemove({ name: target.name, force: true })
            }
          })()
```

교체:

```tsx
          void (async () => {
            // 합쳐지지 않은 저장 → needsForce 2단 확인(ManageBranches 관례),
            // 워크트리가 쓰는 중 → 동반 삭제 확인 (E7h ⑤)
            const result = await store.removeBranch(target.name, target.force)
            if (result.usedByWorktree !== null) {
              setConfirmingRemoveWithWorktree({
                name: target.name,
                force: target.force,
                worktreePath: result.usedByWorktree,
              })
            } else if (result.needsForce && !target.force) {
              setConfirmingRemove({ name: target.name, force: true })
            }
          })()
```

동반 삭제 확인창 추가(기존 confirmingRemove ConfirmDialog 뒤):

```tsx
      <ConfirmDialog
        isOpen={confirmingRemoveWithWorktree !== null}
        title={`워크트리가 이 실험 공간을 쓰는 중이에요 — 같이 지울까요?`}
        confirmLabel="워크트리도 지우고 계속"
        onConfirm={() => {
          const target = confirmingRemoveWithWorktree
          setConfirmingRemoveWithWorktree(null)
          if (target === null) return
          void (async () => {
            // 워크트리 제거(미저장 변경은 기존 2단 확인 재사용) → 성공 시 브랜치 삭제 재시도 (E7h ⑤)
            if (await store.removeWorktree(target.worktreePath, false)) {
              setConfirmingRemoveWorktree({ path: target.worktreePath, force: true })
              return
            }
            const retry = await store.removeBranch(target.name, target.force)
            if (retry.needsForce && !target.force) {
              setConfirmingRemove({ name: target.name, force: true })
            }
          })()
        }}
        onCancel={() => setConfirmingRemoveWithWorktree(null)}
      >
        {`"${confirmingRemoveWithWorktree?.name}"은 워크트리 "${
          confirmingRemoveWithWorktree?.worktreePath.split('/').pop() ?? ''
        }"(${confirmingRemoveWithWorktree?.worktreePath})가 펼쳐 쓰는 중이에요. 워크트리를 지우면 그 폴더가 사라져요 — 미저장 변경이 있으면 한 번 더 물어봐요.`}
      </ConfirmDialog>
```

(주의: 워크트리에 미저장 변경이 있어 removeWorktree가 needsForce true를 반환하면 기존 워크트리 2단 확인창(confirmingRemoveWorktree force:true)으로 넘어간다 — 그 흐름이 끝나도 브랜치 삭제 재시도까지 자동으로 이어지진 않는다(연쇄 3단은 과설계 — 스펙 에러표: "되돌리지 않음"). 사용자가 워크트리 강제 삭제를 승인해 지워진 뒤 브랜치를 다시 지우면 이번엔 usedByWorktree 없이 평소 흐름. 이 한계를 confirm 문구가 이미 안내한다. ConfirmDialog의 testid 유무 실독 — 없으면 기존 확인창 관례를 따른다.)

- [ ] **Step 3: E2E 신규 1건.** smoke.spec.ts 끝에 추가:

```ts
test('E7h — 워크트리가 쓰는 실험 공간은 동반 삭제로 지운다', async () => {
  const repo = await createRepoWithChange('remove-with-wt')
  await execGitOrThrow(['branch', 'wt-used'], { cwd: repo })
  const wtPath = `${repo}-used`
  await execGitOrThrow(['worktree', 'add', '--end-of-options', wtPath, 'wt-used'], { cwd: repo })
  const app = await electron.launch({ args: [APP_ROOT], env: E2E_ENV })
  try {
    const window = await app.firstWindow()
    await openRepo(window, repo)
    await window.getByTestId('left-tab-branches').click()
    await window.getByTestId('branch-row-wt-used').click({ button: 'right' })
    await window.getByTestId('context-remove-branch').click()
    await window.getByTestId('confirm-confirm').click() // 1단: 지울까요?
    // 동반 삭제 확인
    await expect(window.getByText('워크트리가 이 실험 공간을 쓰는 중이에요 — 같이 지울까요?')).toBeVisible()
    await window.getByTestId('confirm-confirm').click()
    // 워크트리·브랜치 모두 소멸
    await expect(window.getByTestId('branch-row-wt-used')).toHaveCount(0)
    await window.getByTestId('left-tab-worktrees').click()
    await expect(window.getByTestId(`worktree-row-${wtPath.split('/').pop()}`)).toHaveCount(0)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(wtPath, { recursive: true, force: true }).catch(() => {})
  }
})
```

(context-remove-branch 등 testid 실독. 두 번째 confirm-confirm이 동반 확인창의 버튼을 정확히 집는지 — 확인창이 겹치지 않고 순차로 뜨는 기존 관례(E3b 확인창 퇴장 즉시화)를 전제로 하되 셀렉터가 모호하면 다이얼로그 title 스코프로 좁힌다.)

- [ ] **Step 4: 게이트** — typecheck, build, smoke → **74 passed**(73+1), 루트 `pnpm test` 유지.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/store/repository-store.ts apps/desktop/src/renderer/src/App.tsx apps/desktop/e2e/smoke.spec.ts
git commit -m "feat(desktop): E7h 브랜치 삭제 — 워크트리 사용 사유 안내 + 동반 삭제 확인 연쇄

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: FindBar 공통 + ⌘F 라우팅 + 필터 2곳 (⑥ 전반)

**Files:**
- Create: `apps/desktop/src/renderer/src/components/find-matches.ts`
- Create: `apps/desktop/src/renderer/src/components/FindBar.tsx`
- Create: `apps/desktop/src/renderer/src/components/find-bar.css`
- Modify: `apps/desktop/src/renderer/src/App.tsx` (⌘F 라우팅·findScope 상태)
- Modify: `apps/desktop/src/renderer/src/components/CommitDetailPanel.tsx` (필터)
- Modify: `apps/desktop/src/renderer/src/components/ChangesPanel.tsx` (필터)
- Test: `apps/desktop/test/find-matches.test.ts`

- [ ] **Step 1: Red — 매치 순수 함수.** `apps/desktop/test/find-matches.test.ts` 신규:

```ts
import { describe, expect, it } from 'vitest'
import { cycleIndex, matchIndices } from '../src/renderer/src/components/find-matches'

describe('matchIndices', () => {
  it('대소문자 무시 부분 문자열 매치의 인덱스 목록', () => {
    expect(matchIndices(['Alpha', 'beta', 'ALPine'], 'al')).toEqual([0, 2])
  })
  it('빈 검색어는 매치 없음', () => {
    expect(matchIndices(['a'], '')).toEqual([])
  })
})

describe('cycleIndex', () => {
  it('다음·이전이 끝에서 순환한다', () => {
    expect(cycleIndex(2, 1, 3)).toBe(0)
    expect(cycleIndex(0, -1, 3)).toBe(2)
  })
  it('빈 목록은 -1', () => {
    expect(cycleIndex(0, 1, 0)).toBe(-1)
  })
})
```

- [ ] **Step 2: Red 확인 후 구현.** `find-matches.ts` 신규:

```ts
/** ⌘F 패널 검색의 매치 계산 (E7h ⑥) — 대소문자 무시 부분 문자열, 정규식 아님 */
export function matchIndices(texts: string[], query: string): number[] {
  if (query === '') return []
  const needle = query.toLowerCase()
  const hits: number[] = []
  texts.forEach((text, index) => {
    if (text.toLowerCase().includes(needle)) hits.push(index)
  })
  return hits
}

/** 현재 위치에서 delta(±1)만큼 순환 이동 — 길이 0이면 -1 */
export function cycleIndex(current: number, delta: number, length: number): number {
  if (length === 0) return -1
  return (((current + delta) % length) + length) % length
}
```

- [ ] **Step 3: FindBar 컴포넌트.** `FindBar.tsx` 신규:

```tsx
import { useEffect, useRef } from 'react'
import './find-bar.css'

interface FindBarProps {
  query: string
  /** 현재 매치 위치(0-based) — 매치 없으면 -1 */
  position: number
  count: number
  placeholder: string
  onQuery(query: string): void
  onNext(): void
  onPrev(): void
  onClose(): void
}

/** 패널 우상단 검색 오버레이 (E7h ⑥) — Enter/↓ 다음, ⇧Enter/↑ 이전, ESC 닫기 */
export function FindBar({
  query,
  position,
  count,
  placeholder,
  onQuery,
  onNext,
  onPrev,
  onClose,
}: FindBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  return (
    <div className="find-bar" data-testid="find-bar">
      <input
        ref={inputRef}
        className={`find-bar__input${query !== '' && count === 0 ? ' find-bar__input--empty' : ''}`}
        value={query}
        placeholder={placeholder}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          } else if (event.key === 'Enter' || event.key === 'ArrowDown') {
            event.preventDefault()
            if (event.key === 'Enter' && event.shiftKey) onPrev()
            else onNext()
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            onPrev()
          }
        }}
        data-testid="find-bar-input"
      />
      <span className="find-bar__count" data-testid="find-bar-count">
        {count === 0 ? '0/0' : `${position + 1}/${count}`}
      </span>
      <button type="button" className="find-bar__nav" onClick={onPrev} aria-label="이전 결과">
        ↑
      </button>
      <button type="button" className="find-bar__nav" onClick={onNext} aria-label="다음 결과">
        ↓
      </button>
      <button
        type="button"
        className="find-bar__nav"
        onClick={onClose}
        aria-label="검색 닫기"
        data-testid="find-bar-close"
      >
        ✕
      </button>
    </div>
  )
}
```

`find-bar.css` 신규:

```css
/* E7h ⑥ — 패널 우상단 검색 오버레이 */
.find-bar {
  position: absolute;
  top: 6px;
  right: 8px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 3px 6px;
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-2);
}
.find-bar__input {
  width: 150px;
  border: 0;
  outline: none;
  background: transparent;
  color: inherit;
  font-size: var(--text-sm);
}
.find-bar__input--empty {
  color: var(--color-text-faint);
}
.find-bar__count {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  min-width: 32px;
  text-align: right;
}
.find-bar__nav {
  border: 0;
  background: transparent;
  color: var(--color-text-faint);
  cursor: pointer;
  font-size: var(--text-sm);
  padding: 0 2px;
}
.find-bar__nav:hover {
  color: inherit;
}
```

(FindBar가 붙는 패널 조상은 `position: relative` 필요 — 각 패널 css 실독 후 없으면 해당 패널 루트에 추가·편차 보고.)

- [ ] **Step 4: App ⌘F 라우팅.** App.tsx — 상태·헬퍼:

```tsx
  // E7h ⑥ — ⌘F 검색 대상 패널(마우스 위치의 data-find-scope, 없으면 diff)
  const [findScope, setFindScope] = useState<'history' | 'diff' | 'commit-files' | 'changes' | null>(
    null,
  )
  const pointerRef = useRef({ x: 0, y: 0 })
```

포인터 추적·키 가로채기(기존 ⌘` keydown 훅 — 실독 — 에 이어서 같은 훅 또는 인접 훅으로):

```tsx
  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY }
    }
    window.addEventListener('pointermove', onPointerMove)
    return () => window.removeEventListener('pointermove', onPointerMove)
  }, [])
```

keydown 훅에 분기 추가(⌘` 블록과 같은 훅 내부):

```tsx
      if ((event.metaKey || event.ctrlKey) && (event.key === 'f' || event.key === 'F')) {
        // 터미널(xterm) 포커스면 쉘 검색을 존중 — 가로채지 않는다
        if (document.activeElement?.closest('.terminal-dock') !== null) return
        event.preventDefault()
        const { x, y } = pointerRef.current
        const scopeEl = document.elementFromPoint(x, y)?.closest('[data-find-scope]')
        const scope = (scopeEl?.getAttribute('data-find-scope') ??
          'diff') as NonNullable<typeof findScope>
        setFindScope(scope)
      }
```

각 대상 패널 래퍼에 `data-find-scope` 부여(App 렌더 실독): 히스토리 패널 래퍼 `data-find-scope="history"`, 중앙 diff 영역 `"diff"`, 커밋 상세 `"commit-files"`, 좌측 변경 열 `"changes"`. 각 패널에 `findOpen`/`onFindClose` prop 배선: `findOpen={findScope === 'history'}` 식. diff 파일 전환 시(선택 파일 변경 콜백 실독) `if (findScope === 'diff') setFindScope(null)`.

- [ ] **Step 5: 커밋 상세 필터.** CommitDetailPanel.tsx — props에 `findOpen: boolean`·`onFindClose(): void` 추가. 내부:

```tsx
  const [findQuery, setFindQuery] = useState('')
  const filterActive = findOpen && findQuery !== ''
  const matched = filterActive
    ? detail.files.filter((file) => file.path.toLowerCase().includes(findQuery.toLowerCase()))
    : null
  const rows = matched !== null
    ? matched.map((item) => ({ kind: 'file' as const, item, depth: 0 }))
    : flattenFileTree(buildFileTree(detail.files), collapsed)
```

(Task 4의 rows 계산을 이 형태로 교체. 평면 모드에서는 CommitFileRow `showDir`를 true로 — 전체 경로 노출. findOpen이 닫히면(또는 쿼리 비우면) 트리·접기 상태로 복원 — collapsed는 건드리지 않으므로 자동.) 패널 콘텐츠 최상단에:

```tsx
      {findOpen && (
        <FindBar
          query={findQuery}
          position={matched === null || matched.length === 0 ? -1 : 0}
          count={matched?.length ?? 0}
          placeholder="파일 이름 찾기"
          onQuery={setFindQuery}
          onNext={() => {}}
          onPrev={() => {}}
          onClose={() => {
            setFindQuery('')
            onFindClose()
          }}
        />
      )}
```

(필터형은 이동 개념이 없다 — onNext/onPrev 무동작, 카운트는 매치 수 표시. position은 count>0이면 0 표기 관례상 `1/N`이 자연스럽지만 필터에는 "위치"가 없으므로 count만 의미 — FindBar 카운트 표기가 부자연스러우면 position -1 유지로 `0/0` 대신 `N`만 보이게 FindBar에 `mode?: 'filter'`를 추가해 카운트만 렌더 — 같은 취지·편차 보고.)

- [ ] **Step 6: 좌측 변경 목록 필터.** ChangesPanel.tsx(실독)에 같은 패턴 — props `findOpen`/`onFindClose`, 내부 findQuery, 두 목록('지금 바뀐 것'·'저장 예정')의 렌더 배열을 `path.toLowerCase().includes(query)` 필터로 좁힌다(가상화 count도 필터 배열 기준). 전체 일괄 버튼(모두 올리기 등)은 필터와 무관하게 기존 전체 대상 유지(핸들러 무변). FindBar는 패널 상단 1개(두 목록 공용 필터). placeholder "파일 찾기".

- [ ] **Step 7: 게이트** — 루트 `pnpm test` → **+4(실측 정정)**, typecheck, build, smoke 기존 전건(E2E 신규는 Task 9에서 일괄).

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/src/components/find-matches.ts apps/desktop/src/renderer/src/components/FindBar.tsx apps/desktop/src/renderer/src/components/find-bar.css apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/components/CommitDetailPanel.tsx apps/desktop/src/renderer/src/components/ChangesPanel.tsx apps/desktop/test/find-matches.test.ts
git commit -m "feat(desktop): E7h ⌘F 기반 — FindBar·매치 계산·hover 라우팅·파일 목록 필터 2곳

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: ⌘F 점프 2곳 (히스토리·diff) + E2E 5건 (⑥ 완결)

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/HistoryPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/components/DiffView.tsx` (또는 DiffPanel — 가상화 소유자 실독)
- Modify: 관련 css (하이라이트 클래스)
- Test: `apps/desktop/e2e/smoke.spec.ts` (신규 5건)

- [ ] **Step 1: 히스토리 점프+하이라이트.** HistoryPanel.tsx — props `findOpen`/`onFindClose` 추가. 내부(이른 반환보다 앞):

```tsx
  const [findQuery, setFindQuery] = useState('')
  const [findPos, setFindPos] = useState(0)
  const findHits = findOpen
    ? matchIndices(
        history.map((commit) => `${commit.subject} ${commit.hash}`),
        findQuery,
      )
    : []
  const currentHit = findHits.length === 0 ? -1 : findHits[Math.min(findPos, findHits.length - 1)]!
```

(쿼리 변경 시 `setFindPos(0)` — onQuery 콜백에서. `commit.subject`/`hash` 필드명은 domain 실독 — 다르면 같은 취지.) 이동:

```tsx
  const moveFind = (delta: number) => {
    if (findHits.length === 0) return
    const nextPos = cycleIndex(Math.min(findPos, findHits.length - 1), delta, findHits.length)
    setFindPos(nextPos)
    virtualizer.scrollToIndex(findHits[nextPos]!, { align: 'center' })
  }
```

행 렌더(실독)에서 `item.index === currentHit`이면 행 래퍼에 `history-item--find-hit` 클래스 추가. FindBar 렌더(패널 콘텐츠 상단):

```tsx
      {findOpen && (
        <FindBar
          query={findQuery}
          position={findHits.length === 0 ? -1 : Math.min(findPos, findHits.length - 1)}
          count={findHits.length}
          placeholder="메시지·해시 찾기"
          onQuery={(q) => {
            setFindQuery(q)
            setFindPos(0)
            const hits = matchIndices(
              history.map((commit) => `${commit.subject} ${commit.hash}`),
              q,
            )
            if (hits.length > 0) virtualizer.scrollToIndex(hits[0]!, { align: 'center' })
          }}
          onNext={() => moveFind(1)}
          onPrev={() => moveFind(-1)}
          onClose={() => {
            setFindQuery('')
            onFindClose()
          }}
        />
      )}
```

하이라이트 css(history-panel.css):

```css
/* E7h ⑥ — 검색 현재 매치 행 */
.history-item--find-hit {
  outline: 1px solid var(--concept-branch);
  outline-offset: -1px;
  border-radius: var(--radius-sm);
}
```

(행 클래스 부착 지점·기존 클래스명은 실독 — 같은 취지 적용. 스냅샷 갱신으로 history가 줄면 findPos는 위 Math.min 클램프가 흡수.)

- [ ] **Step 2: diff 점프+하이라이트.** DiffView.tsx(가상화 소유자 — DiffPanel이면 그쪽, 실독) — 같은 패턴: rows(buildDiffRows 결과)에서 텍스트를 뽑아 matchIndices(행 텍스트 필드는 diff-rows.ts 실독 — 좌우 나란히면 양쪽 텍스트 연결) → moveFind는 `virtualizer.scrollToIndex(hit, { align: 'center' })` → 현재 매치 행에 `diff-row--find-hit` 클래스(양쪽 셀 공통 래퍼 — 실독) + 행 내 매치 부분 `<mark>`는 **하지 않는다**(가상 행 재사용·성능 — 행 전체 하이라이트로 충분, 스펙 "행 내 매치 부분 마크"에서 후퇴하는 편차 — 리뷰에서 승인받을 것. 반대로 쉽게 가능하면 텍스트 렌더 지점에서 split-마크 적용). FindBar placeholder "diff에서 찾기". css(diff-panel.css)에 `--find-hit` 하이라이트(history와 같은 outline 계열).
- [ ] **Step 3: E2E 신규 5건.** smoke.spec.ts 끝에 추가 — 4패널 각 1건 + hover 라우팅 1건. 공통 픽스처: 파일 여러 개 커밋 2개. 마우스 hover는 `window.mouse.move(패널 중심)` 후 `window.keyboard.press('Meta+f')`(darwin) — E2E는 darwin 로컬 실행 관례:

```ts
test('E7h ⌘F — 히스토리에서 커밋을 찾아 점프한다', async () => { /* hover history-panel → ⌘F → 'tree files' 입력 → find-bar-count '1/1' → history-item에 --find-hit 클래스(또는 해당 커밋 가시) → ESC로 닫힘 */ })
test('E7h ⌘F — diff에서 단어를 찾아 하이라이트한다', async () => { /* 파일 diff 열고 hover → ⌘F → 본문 단어 → count 1+ → 하이라이트 행 가시 */ })
test('E7h ⌘F — 커밋 상세 파일 목록을 필터한다', async () => { /* 상세 열고 hover → ⌘F → 'deep' → 매치 파일만 렌더(트리 폴더 행 부재) → 닫으면 트리 복원 */ })
test('E7h ⌘F — 좌측 변경 목록을 필터한다', async () => { /* 변경 2파일 → hover changes → ⌘F → 1파일명 → 그 행만 → 닫기 복원 */ })
test('E7h ⌘F — 마우스 위치의 패널에 열린다', async () => { /* history hover ⌘F → find-bar가 history 패널 내부에 1개만 존재 단언(diff 쪽 부재) */ })
```

각 테스트는 위 주석 시나리오를 완전한 코드로 구현(픽스처·testid·hover 좌표는 기존 스위트 관례 실독 — `find-bar`·`find-bar-input`·`find-bar-count` testid 사용). 플랜은 시나리오를 정본으로 하고 코드 세부는 같은 취지·편차 보고.

- [ ] **Step 4: 게이트** — typecheck, build, smoke → **79 passed**(74+5), 루트 `pnpm test` 유지, 신규 5건 단독 -g 1회 non-flaky.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/HistoryPanel.tsx apps/desktop/src/renderer/src/components/DiffView.tsx apps/desktop/src/renderer/src/components/history-panel.css apps/desktop/src/renderer/src/components/diff-panel.css apps/desktop/src/renderer/src/App.tsx apps/desktop/e2e/smoke.spec.ts
git commit -m "feat(desktop): E7h ⌘F 점프 검색 — 히스토리·diff 하이라이트/순환 + E2E 5건

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(DiffPanel 쪽 수정이면 add 경로 조정 — 편차 보고.)

---

### Task 10: 최종 게이트 + README + 공식 스크린샷 3장

**Files:**
- Modify: `README.md`
- Test: 전체

- [ ] **Step 1: 전체 게이트** — 루트 `pnpm test` **482 내외(누적 실측 정정 — Task 1 +2·T2 +4·T8 +4)** · typecheck 전부 Done · desktop build · `pnpm --filter @git-gui/desktop e2e` → **85**(smoke 79 + hosting 6) · last-screen 아티팩트 0건.
- [ ] **Step 2: README.** 기존 E7g 문단 끝(실독) 뒤에 한 문장 추가:

```markdown
E7h 피드백 폴리시: 알림이 좌측 탭을 피해서 뜨고, 커밋 상세 파일 목록이 폴더 트리로 접히며, 워크트리 전환은 앱·터미널이 함께 바뀌고 터미널 탭은 워크트리별 묶음으로 전환·복원됩니다. 워크트리가 쓰는 실험 공간은 사유와 함께 "워크트리도 같이 지우기"를 제안하고, ⌘F로 히스토리·diff(점프)·커밋 상세·변경 목록(필터)을 패널별로 검색하며, macOS 신호등은 헤더 세로 중앙에 정렬됩니다.
```

- [ ] **Step 3: 공식 스크린샷 3장** — 임시 spec `apps/desktop/e2e/tmp-shots-e7h.spec.ts`(관례: harness electron·1440×900·finally 정리·scratchpad 사본·촬영 후 삭제·전체 e2e 재실행 금지): **(1) e7h-commit-file-tree.png** — 다단 폴더 커밋 상세(트리 + 폴더 행). **(2) e7h-find-diff.png** — diff 열고 FindBar 검색 중(매치 하이라이트 + N/M). **(3) e7h-notice-clear.png** — 워크트리 탭 + 알림 동시 표시(비가림). 컨트롤러 육안 검수 + 사용자 전송.
- [ ] **Step 4: Commit** (README만 — 실행 기록은 컨트롤러 별도 docs 커밋)

```bash
git add README.md
git commit -m "docs: README — E7h 피드백 폴리시(알림 비가림·파일 트리·워크트리 동시성·터미널 그룹·동반 삭제·⌘F·신호등) 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 게이트 표 (누적 — 실측 정정 대상)

| 시점 | 루트 테스트 | smoke |
| --- | --- | --- |
| 시작 | 468 | 68 |
| Task 1 후 | +2 → 470 | 68 |
| Task 2 후 | +4 → 474 | 68 |
| Task 3 후 | 474 | +1 → 69 |
| Task 4 후 | 474 | +1 → 70 |
| Task 5 후 | 474 | +1 → 71 |
| Task 6 후 | 474 | +2 → 73 |
| Task 7 후 | 474 | +1 → 74 |
| Task 8 후 | +4 → 478 | 74 |
| Task 9 후 | 478 | +5 → 79 |
| Task 10 | 478 · e2e 85(79+6) | — |

## Self-Review (플랜 자체 점검)

1. **스펙 커버리지**: ①=T3, ②=T2+T4, ③=T5, ④=T6, ⑤=T1+T7, ⑥=T8+T9, ⑦=T5. 에러표 — 리사이즈 파생(T3 inline left), 전환 실패 유지(T5 then-ok 게이트), 자동 생성 실패·상한(T6 기존 에러 줄 재사용— activateGroup의 create가 기존 에러 경로), 동반 삭제 부분 실패(T7 주석·문구), 검색 중 갱신 클램프(T9 Math.min), diff 파일 전환 닫기(T8 Step 4), 비 macOS(T5 darwin 분기 유지). 전부 매핑됨.
2. **플레이스홀더**: 없음 — "실독·같은 취지·편차 보고"는 프로젝트 관례(E7g)로 명시 목록화됨. T9 Step 3의 E2E 5건은 시나리오 정본+코드화 지시로, 세부 코드는 구현자 몫임을 명시(관례상 편차 보고 대상).
3. **타입 일관성**: RemoveBranchResult.usedByWorktree(T1)↔store 반환(T7)↔App 연쇄(T7) 동명. FileTreeRow(T2)↔T4 rows. matchIndices/cycleIndex(T8)↔T9 사용. TerminalTab.groupKey·activateGroup·closeGroup(T6) 내부 일관. findScope 값 4종↔data-find-scope 문자열 일치.
4. **알려진 설계 후퇴 2건(리뷰 승인 대상)**: T9 diff 행 내 부분 `<mark>` 생략(행 하이라이트로 후퇴 가능), T1 경로 파싱 실패 시 에러 폴백(스펙은 null 경로 분기) — 둘 다 본문에 사유 명시.
