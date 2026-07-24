# E7g — 디자인 정합 구현 계획 (depth 트리·3단 클릭·아이콘 상태·톤 통일)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) 구문으로 추적한다.

**Goal:** 실험 공간을 depth 트리+3단 인터랙션(1클릭 선택·더블클릭 조회·우클릭 메뉴)으로 재설계하고, 상태를 칩→아이콘(➤·인라인 컬러 ↑↓)으로, 워크트리·터미널을 같은 행 언어로 통일. 스펙 `docs/superpowers/specs/2026-07-24-e7g-design-unify-design.md`.

**Architecture:** 조회는 엔진 `history.list(limit, ref?)`+store `historyRef`로 — fetchSnapshot 호출부 39곳을 건드리지 않도록 **fetchSnapshot 내부에서 store 상태를 직접 읽고**(zustand getState), 조회 브랜치 소멸 시 내부에서 조용히 복귀한다. 트리는 순수 빌더 2함수(build/flatten)+검색 평면화. 색은 ahead/behind 토큰 신설(WCAG 대비 회귀 테스트 동반). BranchesPanel·branches-panel.css는 전면 교체, 워크트리·터미널은 시각만.

**Tech Stack:** 기존 그대로 (신규 의존성 없음).

**기준 커밋:** main = `e3dbebb`. 기준선: 단위 **450 tests**(38 files), E2E **71**(smoke 65 + hosting 6). 작업 브랜치: **`feature/e7g-design-unify`** (Task 1 Step 0에서 생성).

## 사전 실측 기록 (2026-07-24)

1. **E2E branch-row 클릭 의존 전수**: 6곳 중 5곳은 이미 우클릭(`click({ button: 'right' })` — E7a 메뉴 흐름 그대로 유효). **좌클릭은 1곳뿐** — E7d ① 충돌 탭 전환 테스트(`branch-row-clash').click()` → context-merge). 우클릭 1줄 전환으로 충분(Task 5에 포함).
2. **history.list 현행**: `--all`+exclude(stash·notes·replace)+decorate-exclude+`--date-order` 고정. ref 모드는 `--all`·`--exclude`를 빼고 `--end-of-options <ref>`만 — decorate·date-order·format은 공유(파서 무변).
3. **색 토큰**: success/warning 계열 없음(danger만) → `--color-ahead`(초록)·`--color-behind`(주황) 라이트/다크 신설 + `tokens-contrast.test.ts`에 대비 단언 추가.
4. **groupBranches 사용처**: BranchesPanel(교체 대상)+**BranchSwitcher(헤더 — 유지)**. groupBranches는 삭제하지 않고 트리 빌더를 별도 파일(branch-tree.ts)로 신설.
5. **fetchSnapshot 호출부 39곳** → 인자 추가 대신 내부 getState() 읽기(Architecture).
6. **LocalBranchStatus**: ahead/behind는 `number | null`(upstream 없음/gone이면 null — 0 위장 금지 관례 유지).

## 파일 구조 (책임 지도)

| 파일 | 책임 |
| --- | --- |
| `packages/git-adapter/src/client.ts` (수정) + `test/client.test.ts` | history.list(limit, ref?) |
| `packages/ipc-contract/src/index.ts`·`preload/index.ts` (수정) | list 3인자 |
| `apps/desktop/src/renderer/src/store/repository-store.ts` (수정) | historyRef·viewHistory/clearHistoryView·fetchSnapshot 내부 조회 |
| `apps/desktop/src/renderer/src/components/branch-tree.ts` (신규) + `test/branch-tree.test.ts` | 트리 빌더·평탄화·검색(순수) |
| `apps/desktop/src/renderer/src/ui/tokens.css` (수정) + `test/tokens-contrast.test.ts` | ahead/behind 색 |
| `apps/desktop/src/renderer/src/components/BranchesPanel.tsx`·`branches-panel.css` (전면 교체) | depth 트리·3단 인터랙션·아이콘 상태 |
| `apps/desktop/src/renderer/src/components/HistoryPanel.tsx` (수정) | "조회 중" 알약 |
| `apps/desktop/src/renderer/src/App.tsx` (수정) | view 액션·pill 배선·E2E 1줄 |
| `apps/desktop/src/renderer/src/components/WorktreesPanel.tsx`·`worktrees-panel.css` (수정) | 톤(시각만) |
| `apps/desktop/src/renderer/src/ui/terminal/TerminalDock.tsx`·`terminal-dock.css` (수정) | 밑줄 탭(시각만) |
| `apps/desktop/e2e/smoke.spec.ts` (수정) | 좌클릭 1건 전환 + 신규 3건 |

## 검증 게이트 요약

| 시점 | 기대치 |
| --- | --- |
| 기준선 (e3dbebb) | 450 tests + E2E 71 (smoke 65 + hosting 6) |
| Task 1 후 | +2 → **452** (엔진 ref) |
| Task 2 후 | 452 유지 + typecheck (배선) |
| Task 3 후 | +8 → **460** (트리 빌더) |
| Task 4 후 | +1 → **461** (색 대비) |
| Task 5 후 | 461 유지 + smoke **65 유지**(우클릭 5건 무회귀 + 좌클릭 1건 전환 포함 — 전 스위트) |
| Task 6·7 후 | 461 유지 + build (워크트리·터미널 시각) |
| Task 8 후 | smoke **68** (신규 3) |
| 최종 (Task 9) | **461 tests** + typecheck + build + E2E **74**(smoke 68 + hosting 6) + last-screen 0건 + 스크린샷 3장 + README |

---

### Task 1: 엔진 — history.list(limit, ref?)

**Files:**
- Modify: `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts` (+2)

- [ ] **Step 0: 브랜치 생성** — main(e3dbebb)에서 `git checkout -b feature/e7g-design-unify`.

- [ ] **Step 1: Red.** client.test.ts의 E7e 마지막 테스트(`branches.backup — 첫 연결은 linked...` — 실독으로 정확 위치 확인) 바로 뒤에 추가:

```ts

  it('history.list — ref를 주면 그 브랜치 계보만 본다(--all 아님) (E7g)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('side-view', null)
    await execGitOrThrow(['checkout', 'side-view'], { cwd: repo })
    await writeFixtureFile(repo, 'side.txt', 's\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'side-only'], { cwd: repo })
    await execGitOrThrow(['checkout', 'main'], { cwd: repo })
    await writeFixtureFile(repo, 'main2.txt', 'm\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'main-only'], { cwd: repo })
    const viewed = await client.history.list(50, 'side-view')
    const subjects = viewed.map((commit) => commit.subject)
    expect(subjects).toContain('side-only')
    expect(subjects).not.toContain('main-only')
    // 전체 그래프(무인자)는 둘 다 본다 — 기존 동작 무변
    const all = (await client.history.list(50)).map((commit) => commit.subject)
    expect(all).toContain('side-only')
    expect(all).toContain('main-only')
  })

  it('history.list — 없는 ref는 에러다(조용한 복귀는 store 몫) (E7g)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.history.list(50, 'vanished-branch')).rejects.toThrow()
  })
```

(client.test.ts의 삽입 앵커·헬퍼 import는 실독 — writeFixtureFile 등 기존재. 편차 보고.)

- [ ] **Step 2: Red 확인** — `pnpm vitest run --project @git-gui/git-adapter -t 'history.list — ref'` → 인자 무시로 실패 확인.

- [ ] **Step 3: 구현.** client.ts 편집 2곳.

(a) 인터페이스 기존:

```ts
  history: {
    /** 최신순 커밋 요약. limit은 1~10000으로 잘린다 */
    list(limit: number): Promise<CommitSummary[]>
  }
```

교체:

```ts
  history: {
    /** 최신순 커밋 요약. limit은 1~10000으로 잘린다. ref를 주면 그 계보만(조회 모드 — E7g), 없으면 전체 그래프(--all) */
    list(limit: number, ref?: string): Promise<CommitSummary[]>
  }
```

(b) 런타임 — 기존 `async list(limit) {` 시그니처를 `async list(limit, ref) {`로, args 조립부의 기존:

```ts
          '--exclude=refs/stash',
          '--exclude=refs/notes/*',
          '--exclude=refs/replace/*',
          '--all',
```

교체:

```ts
          // 조회 모드(E7g): ref의 계보만 — --all·--exclude는 전체 그래프 전용.
          // --end-of-options: 대시로 시작하는 ref가 옵션으로 해석되는 것 차단 (관례)
          ...(ref === undefined
            ? ['--exclude=refs/stash', '--exclude=refs/notes/*', '--exclude=refs/replace/*', '--all']
            : ['--end-of-options', ref]),
```

주의: `--end-of-options`가 args 중간에 오면 이후 `--date-order` 등 옵션이 인자로 오해된다 — **실제 배치는 옵션 전부 뒤·format 앞이 아니라, ref 항목을 args 배열의 맨 끝(-z 뒤)으로**. 구현 시 args 순서를 실독해 `-z` 뒤에 `...(ref === undefined ? [...] : ['--end-of-options', ref])`가 오도록 조정하고, 전체 그래프 모드의 `--all`·exclude는 **원래 위치 유지**(옵션 순서 보존) — 즉 (b)는 두 편집: 원위치 exclude+--all 블록을 `...(ref === undefined ? ['--exclude=refs/stash', '--exclude=refs/notes/*', '--exclude=refs/replace/*', '--all'] : []),`로, `-z',` 뒤에 `...(ref === undefined ? [] : ['--end-of-options', ref]),` 추가. 편차 보고.

- [ ] **Step 4: Green + 게이트** — 신규 2건 + 기존 history 테스트 무회귀. 루트 `pnpm test` → **452 passed**. typecheck Done.

- [ ] **Step 5: Commit**

```bash
git add packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(git-adapter): E7g history.list ref 인자 — 조회 모드(계보만)·전체 그래프 무변

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 배선 — historyRef·viewHistory·fetchSnapshot 내부 조회

**Files:**
- Modify: `packages/ipc-contract/src/index.ts`
- Modify: `apps/desktop/src/main/git-handlers.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`

- [ ] **Step 1: 계약·핸들러·preload.** ipc-contract 기존:

```ts
  history: {
    /** 최신순 커밋 요약. limit은 1~10000 정수 — 범위 밖은 IPC에서 거부된다 (adapter의 clamp는 심층 방어) */
    list(repoPath: string, limit: number): Promise<CommitSummary[]>
  }
```

교체:

```ts
  history: {
    /** 최신순 커밋 요약. limit은 1~10000 정수 — 범위 밖은 IPC에서 거부된다 (adapter의 clamp는 심층 방어). ref는 조회 모드(E7g) */
    list(repoPath: string, limit: number, ref?: string): Promise<CommitSummary[]>
  }
```

git-handlers의 historyList 핸들러(실독)에 ref 관통: `(_event, repoPath, limit, ref)` — `ref === undefined ? undefined : assertString(ref)` 후 `history.list(limit 검증값, refValue)` (같은 취지·편차 보고). preload `list: (repoPath, limit, ref) => ipcRenderer.invoke(CHANNELS.historyList, repoPath, limit, ref)` (현행 실독).

- [ ] **Step 2: store.** 편집 4곳.

(a) 상태 필드 — 기존:

```ts
  /** 마지막 원격 새로고침(fetch) 성공 시각 — 자동·수동 공통, 영속 안 함 (E7e) */
  lastFetchAt: number | null
```

교체:

```ts
  /** 마지막 원격 새로고침(fetch) 성공 시각 — 자동·수동 공통, 영속 안 함 (E7e) */
  lastFetchAt: number | null
  /** 역사 조회 모드(E7g) — 더블클릭한 브랜치. null이면 전체 그래프(지금 여기 기준) */
  historyRef: string | null
```

(b) 액션 선언 — setPullMode 선언(E7e) 뒤:

```ts
  /** 브랜치 더블클릭 조회 — 우측 역사가 그 계보로 바뀐다 (E7g) */
  viewHistory(ref: string): Promise<void>
  /** 조회 해제 — 전체 그래프 복귀 (E7g) */
  clearHistoryView(): Promise<void>
```

(c) fetchSnapshot — history 조회를 내부화. 기존:

```ts
  const [status, history, branches, shelf, branchOverview, worktrees] = await Promise.all([
    git().repo.status(repoPath),
    git().history.list(repoPath, limit),
```

교체:

```ts
  // 조회 모드(E7g) — 호출부 39곳을 바꾸지 않도록 스냅샷이 store에서 직접 읽는다.
  // 조회 브랜치가 사라졌으면 조용히 전체 그래프로 복귀(스펙 — 오류 아님)
  const loadHistory = async (): Promise<CommitSummary[]> => {
    const ref = useRepositoryStore.getState().historyRef
    if (ref === null) return git().history.list(repoPath, limit)
    try {
      return await git().history.list(repoPath, limit, ref)
    } catch {
      useRepositoryStore.setState({ historyRef: null })
      return git().history.list(repoPath, limit)
    }
  }
  const [status, history, branches, shelf, branchOverview, worktrees] = await Promise.all([
    git().repo.status(repoPath),
    loadHistory(),
```

(CommitSummary 타입 import 확인 — store에 기존재. useRepositoryStore는 아래에서 정의되는 const지만 호출 시점엔 초기화 완료 — lastGuardEndAt 모듈 변수 관례와 같은 계열. 초기 렌더 전 fetchSnapshot 호출은 init/openRepository — 모두 store 생성 후.)

(d) 초기 상태 `lastFetchAt: null,` 뒤에 `historyRef: null,`. 액션 구현 — setPullMode 구현 뒤:

```ts
  async viewHistory(ref) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      set({ historyRef: ref })
      set({ ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async clearHistoryView() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      set({ historyRef: null })
      set({ ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },
```

(e) 저장소 전환은 조회 해제 — openRepository·openWorktree의 `set({ repoPath: ...` 객체에 `historyRef: null,` 추가(실독·2곳·편차 보고).

- [ ] **Step 3: 게이트** — typecheck Done, 루트 `pnpm test` → **452 유지**, desktop build.

- [ ] **Step 4: Commit**

```bash
git add packages/ipc-contract/src/index.ts apps/desktop/src/main/git-handlers.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/src/store/repository-store.ts
git commit -m "feat(desktop): E7g 조회 배선 — historyRef·viewHistory/clearHistoryView·스냅샷 내부 조회(소멸 조용 복귀)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 트리 빌더 순수 함수 (branch-tree.ts)

**Files:**
- Create: `apps/desktop/src/renderer/src/components/branch-tree.ts`
- Test: `apps/desktop/test/branch-tree.test.ts` (신규, +8)

- [ ] **Step 1: Red.** `apps/desktop/test/branch-tree.test.ts` 신규:

```ts
import { describe, expect, it } from 'vitest'
import { buildBranchTree, flattenBranchTree, flatSearch } from '../src/renderer/src/components/branch-tree'

const b = (name: string) => ({ name })

describe('buildBranchTree', () => {
  it('한 단 폴더 — 리프와 폴더가 입력 순서대로 공존한다', () => {
    const tree = buildBranchTree([b('main'), b('feature/login'), b('hotfix'), b('feature/signup')])
    expect(tree.map((node) => [node.kind, node.name])).toEqual([
      ['leaf', 'main'],
      ['folder', 'feature'],
      ['leaf', 'hotfix'],
    ])
    const feature = tree[1]!
    expect(feature.kind === 'folder' && feature.children.map((child) => child.name)).toEqual([
      'login',
      'signup',
    ])
  })

  it('다단 중첩 — a/b/c는 폴더 a > 폴더 b > 리프 c', () => {
    const tree = buildBranchTree([b('a/b/c'), b('a/b/d'), b('a/e')])
    const a = tree[0]!
    expect(a.kind).toBe('folder')
    if (a.kind !== 'folder') return
    expect(a.children.map((child) => [child.kind, child.name])).toEqual([
      ['folder', 'b'],
      ['leaf', 'e'],
    ])
    const ab = a.children[0]!
    expect(ab.kind === 'folder' && ab.children.map((child) => child.name)).toEqual(['c', 'd'])
  })

  it('리프 이름과 폴더 접두 공존(feat와 feat-x는 폴더가 아니다) — 세그먼트 단위로만 묶는다', () => {
    const tree = buildBranchTree([b('feat'), b('feat-x'), b('feat/y')])
    expect(tree.map((node) => [node.kind, node.name])).toEqual([
      ['leaf', 'feat'],
      ['leaf', 'feat-x'],
      ['folder', 'feat'],
    ])
  })

  it('폴더 count는 하위 리프 전체 수(다단 포함)', () => {
    const tree = buildBranchTree([b('a/b/c'), b('a/b/d'), b('a/e')])
    const a = tree[0]!
    expect(a.kind === 'folder' && a.count).toBe(3)
  })
})

describe('flattenBranchTree', () => {
  it('접힌 폴더의 하위는 행에서 빠지고 depth가 매겨진다', () => {
    const tree = buildBranchTree([b('main'), b('a/b/c'), b('a/e')])
    const open = flattenBranchTree(tree, new Set())
    expect(open.map((row) => [row.depth, row.node.kind, row.node.name])).toEqual([
      [0, 'leaf', 'main'],
      [0, 'folder', 'a'],
      [1, 'folder', 'b'],
      [2, 'leaf', 'c'],
      [1, 'leaf', 'e'],
    ])
    const collapsed = flattenBranchTree(tree, new Set(['a']))
    expect(collapsed.map((row) => row.node.name)).toEqual(['main', 'a'])
  })

  it('중간 폴더만 접으면 그 아래만 숨는다', () => {
    const tree = buildBranchTree([b('a/b/c'), b('a/e')])
    const rows = flattenBranchTree(tree, new Set(['a/b']))
    expect(rows.map((row) => row.node.name)).toEqual(['a', 'b', 'e'])
  })
})

describe('flatSearch', () => {
  it('검색은 평면 매치 — 전체 경로로 부분 일치', () => {
    const rows = flatSearch([b('main'), b('feature/login'), b('feature/signup')], 'log')
    expect(rows.map((row) => row.name)).toEqual(['feature/login'])
  })

  it('빈 질의는 전체를 평면으로 돌려주지 않는다(트리 렌더 몫) — null 반환', () => {
    expect(flatSearch([b('main')], '')).toBeNull()
  })
})
```

- [ ] **Step 2: Red 확인 후 구현.** `-t 'buildBranchTree'` 실패 확인 → `apps/desktop/src/renderer/src/components/branch-tree.ts` 신규:

```ts
/**
 * 실험 공간 depth 트리 (E7g) — '/' 세그먼트 단위 접이식 트리의 순수 로직.
 * groupBranches(1단 납작 — 헤더 스위처가 계속 씀)와 별개다. 입력 순서(최근 커밋순)를 보존한다:
 * 폴더 위치는 그 폴더의 첫 등장 지점, 하위도 입력 순서대로.
 */
export type BranchTreeNode<T extends { name: string }> =
  | { kind: 'leaf'; name: string; path: string; branch: T }
  | { kind: 'folder'; name: string; path: string; count: number; children: BranchTreeNode<T>[] }

export interface BranchTreeRow<T extends { name: string }> {
  depth: number
  node: BranchTreeNode<T>
}

export function buildBranchTree<T extends { name: string }>(branches: T[]): BranchTreeNode<T>[] {
  const roots: BranchTreeNode<T>[] = []
  const folderByPath = new Map<string, Extract<BranchTreeNode<T>, { kind: 'folder' }>>()
  for (const branch of branches) {
    const segments = branch.name.split('/')
    let siblings = roots
    let path = ''
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i]!
      path = path === '' ? segment : `${path}/${segment}`
      let folder = folderByPath.get(path)
      if (folder === undefined) {
        folder = { kind: 'folder', name: segment, path, count: 0, children: [] }
        folderByPath.set(path, folder)
        siblings.push(folder)
      }
      folder.count += 1
      siblings = folder.children
    }
    const leafName = segments[segments.length - 1]!
    siblings.push({ kind: 'leaf', name: leafName, path: branch.name, branch })
  }
  return roots
}

/** 접힌 폴더(경로 집합) 아래를 걸러 depth를 매긴 행 목록으로 — 렌더는 이 배열만 순회한다 */
export function flattenBranchTree<T extends { name: string }>(
  nodes: BranchTreeNode<T>[],
  collapsed: ReadonlySet<string>,
  depth = 0,
): BranchTreeRow<T>[] {
  const rows: BranchTreeRow<T>[] = []
  for (const node of nodes) {
    rows.push({ depth, node })
    if (node.kind === 'folder' && !collapsed.has(node.path)) {
      rows.push(...flattenBranchTree(node.children, collapsed, depth + 1))
    }
  }
  return rows
}

/** 검색 중엔 트리 대신 평면 매치(전체 경로 표시) — 빈 질의는 null(트리 렌더로) (스펙) */
export function flatSearch<T extends { name: string }>(branches: T[], query: string): T[] | null {
  if (query === '') return null
  return branches.filter((branch) => branch.name.includes(query))
}
```

- [ ] **Step 3: 게이트** — 루트 `pnpm test` → **460 passed**. typecheck Done.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/components/branch-tree.ts apps/desktop/test/branch-tree.test.ts
git commit -m "feat(desktop): E7g 트리 빌더 — 다단 접이식(build/flatten)·검색 평면화 순수 함수

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: ahead/behind 색 토큰 + 대비 회귀

**Files:**
- Modify: `apps/desktop/src/renderer/src/ui/tokens.css`
- Test: `apps/desktop/test/tokens-contrast.test.ts` (+1)

- [ ] **Step 1: Red.** tokens-contrast.test.ts는 PAIRS 테이블을 순회한다 — 기존:

```ts
  ['--color-danger', '--color-surface', 4.5],
```

교체(선택 행 위에서도 읽혀야 한다 — change-* 관례):

```ts
  ['--color-danger', '--color-surface', 4.5],
  // E7g 인라인 ↑↓ — 평상시·선택 행 양쪽에서 텍스트 대비 (라이트·다크 공통 순회)
  ['--color-ahead', '--color-surface', 4.5],
  ['--color-behind', '--color-surface', 4.5],
  ['--color-ahead', '--color-selection-bg', 4.5],
  ['--color-behind', '--color-selection-bg', 4.5],
```

Red: 토큰 부재로 대비 계산 실패(undefined) 확인. (PAIRS 순회가 라이트·다크 두 테마를 도는 구조인지 실독 — it 수 증가가 아니라 기존 it 내 단언 증가면 게이트 카운트는 +0일 수 있음: **실측으로 카운트 확정·게이트 표 편차 보고**.)

- [ ] **Step 2: 토큰 구현.** tokens.css 기존:

```css
  --color-danger: #d92d20;
```

(라이트 블록) 교체:

```css
  --color-danger: #d92d20;
  /* E7g 인라인 ↑↓ — 올릴 것(ahead)·받을 것(behind). 서피스 대비 4.5:1 이상(대비 회귀 테스트) */
  --color-ahead: #067647;
  --color-behind: #b54708;
```

다크 블록의 기존 `--color-danger: #f97066;` 교체:

```css
  --color-danger: #f97066;
  --color-ahead: #4ade80;
  --color-behind: #fdb022;
```

(다크 서피스 대비 실측으로 4.5 미달이면 명도 조정·편차 보고.)

- [ ] **Step 3: 게이트** — 대비 테스트 Green(실측 조정 포함). 루트 `pnpm test` → **461 passed**.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/ui/tokens.css apps/desktop/test/tokens-contrast.test.ts
git commit -m "feat(desktop): E7g ahead/behind 색 토큰 — 라이트/다크 2벌·WCAG 대비 회귀

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: BranchesPanel 전면 개편 + HistoryPanel 알약 + App 배선

**Files:**
- Rewrite: `apps/desktop/src/renderer/src/components/BranchesPanel.tsx`
- Rewrite: `apps/desktop/src/renderer/src/components/branches-panel.css`
- Modify: `apps/desktop/src/renderer/src/components/HistoryPanel.tsx` (+ 해당 css 실독)
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/e2e/smoke.spec.ts` (좌클릭 1건 전환)

- [ ] **Step 1: BranchesPanel.tsx 전체 교체.** 다음 내용으로(compare 뷰·메뉴 빌더·fetch 줄은 현행 유지 — 전체 파일):

```tsx
import { useState, type MouseEvent } from 'react'
import { RefreshCw } from 'lucide-react'
import type { BranchCompare, BranchOverview, CommitSummary, LocalBranchStatus, RemoteBranchRef } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu'
import { Panel } from '../ui/Panel'
import { buildBranchTree, flatSearch, flattenBranchTree } from './branch-tree'
import { formatRelativeTime } from './relative-time'
import './branches-panel.css'

export type BranchPanelAction =
  | { kind: 'switch'; name: string }
  | { kind: 'branch-from'; name: string; hash: string }
  | { kind: 'merge'; name: string }
  | { kind: 'rebase'; name: string }
  | { kind: 'compare'; name: string }
  | { kind: 'update'; name: string }
  | { kind: 'backup'; name: string }
  | { kind: 'rename'; name: string }
  | { kind: 'remove'; name: string }
  | { kind: 'checkout-remote'; name: string }
  | { kind: 'remove-remote'; name: string }
  /** 더블클릭 조회 — 우측 역사가 이 계보로 (E7g) */
  | { kind: 'view'; name: string }

interface BranchesPanelProps {
  overview: BranchOverview | null
  /** "지금과 비교" 결과 — non-null이면 목록 대신 비교 뷰를 보여준다 */
  compare: { name: string; result: BranchCompare } | null
  currentBranch: string | null
  /** 역사 조회 중인 브랜치 — 해당 행을 보라 하이라이트 (E7g) */
  historyRef: string | null
  busy: boolean
  /** 진행 중 작업(merging 등) — 파괴적 항목을 사유와 함께 비활성한다 */
  actionsDisabled: boolean
  /** 마지막 원격 새로고침 시각 — null이면 아직 없음 (E7e) */
  lastFetchAt: number | null
  /** 수동 원격 새로고침 (E7e) */
  onFetchRemotes(): void
  onAction(action: BranchPanelAction): void
  onCloseCompare(): void
}

interface MenuState {
  x: number
  y: number
  target: { kind: 'local'; branch: LocalBranchStatus } | { kind: 'remote'; name: string }
}

/**
 * 실험 공간 패널 (E7a → E7g 개편) — depth 트리·3단 인터랙션.
 * 1클릭=선택만(중립) · 더블클릭=조회(view) · 우클릭=메뉴. 빠른 전환은 헤더 스위처가 담당
 */
export function BranchesPanel({
  overview,
  compare,
  currentBranch,
  historyRef,
  busy,
  actionsDisabled,
  lastFetchAt,
  onFetchRemotes,
  onAction,
  onCloseCompare,
}: BranchesPanelProps) {
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  // 불가 항목은 숨기지 않고 사유와 함께 비활성한다 (HistoryPanel undo/reword 관례)
  const buildLocalMenu = (branch: LocalBranchStatus): ContextMenuEntry[] => {
    const isCurrent = branch.name === currentBranch
    const noUpstream = branch.upstream === null
    return [
      {
        key: 'switch',
        label: isCurrent
          ? '이 공간으로 이동 (checkout) — 지금 여기예요'
          : '이 공간으로 이동 (checkout)',
        disabled: busy || actionsDisabled || isCurrent,
        onSelect: () => onAction({ kind: 'switch', name: branch.name }),
      },
      {
        key: 'branch-from',
        label: '여기서 새 실험 공간…',
        disabled: busy,
        onSelect: () => onAction({ kind: 'branch-from', name: branch.name, hash: branch.hash }),
      },
      { key: 'sep-1', separator: true },
      {
        key: 'merge',
        label: isCurrent ? '지금 것과 합치기 (merge) — 자기 자신이에요' : '지금 것과 합치기 (merge)',
        disabled: busy || actionsDisabled || isCurrent,
        onSelect: () => onAction({ kind: 'merge', name: branch.name }),
      },
      {
        key: 'rebase',
        label: isCurrent
          ? '지금 것을 이 위로 재배치 (rebase) — 자기 자신이에요'
          : '지금 것을 이 위로 재배치 (rebase)',
        disabled: busy || actionsDisabled || isCurrent,
        onSelect: () => onAction({ kind: 'rebase', name: branch.name }),
      },
      {
        key: 'compare',
        label: isCurrent ? '지금과 비교 — 자기 자신이에요' : '지금과 비교…',
        disabled: busy || isCurrent,
        onSelect: () => onAction({ kind: 'compare', name: branch.name }),
      },
      { key: 'sep-2', separator: true },
      {
        key: 'update',
        label: isCurrent
          ? '원격 최신으로 업데이트 (pull)'
          : noUpstream
            ? '원격 최신으로 업데이트 — 원격과 연결된 적이 없어요'
            : branch.upstreamGone
              ? '원격 최신으로 업데이트 — 원격에서 지워졌어요'
              : '원격 최신으로 업데이트',
        disabled: busy || actionsDisabled || noUpstream || branch.upstreamGone,
        onSelect: () => onAction({ kind: 'update', name: branch.name }),
      },
      {
        key: 'backup',
        label: '백업 (push)',
        disabled: busy || actionsDisabled,
        onSelect: () => onAction({ kind: 'backup', name: branch.name }),
      },
      { key: 'sep-3', separator: true },
      {
        key: 'rename',
        label: '이름 바꾸기…',
        disabled: busy || actionsDisabled,
        onSelect: () => onAction({ kind: 'rename', name: branch.name }),
      },
      {
        key: 'remove',
        label: isCurrent ? '지우기 — 지금 있는 공간이에요' : '지우기…',
        disabled: busy || actionsDisabled || isCurrent,
        onSelect: () => onAction({ kind: 'remove', name: branch.name }),
      },
    ]
  }

  const buildRemoteMenu = (name: string): ContextMenuEntry[] => [
    {
      key: 'checkout-remote',
      label: '내 공간으로 가져오기 (checkout)',
      disabled: busy || actionsDisabled,
      onSelect: () => onAction({ kind: 'checkout-remote', name }),
    },
    {
      key: 'compare-remote',
      label: '지금과 비교…',
      disabled: busy,
      onSelect: () => onAction({ kind: 'compare', name }),
    },
    { key: 'sep-1', separator: true },
    {
      key: 'remove-remote',
      label: '원격에서 지우기…',
      disabled: busy || actionsDisabled,
      onSelect: () => onAction({ kind: 'remove-remote', name }),
    },
  ]

  const openMenu = (event: MouseEvent, target: MenuState['target']) => {
    event.preventDefault()
    // 키보드(Enter/Space) 활성화는 좌표가 (0,0)으로 온다 — 커서 대신 행 자체에 앵커한다 (품질 리뷰)
    if (event.clientX === 0 && event.clientY === 0) {
      const rect = event.currentTarget.getBoundingClientRect()
      setMenu({ x: rect.left + 8, y: rect.bottom, target })
      return
    }
    setMenu({ x: event.clientX, y: event.clientY, target })
  }

  if (compare !== null) {
    const { result } = compare
    const section = (title: string, commits: CommitSummary[], overflow: boolean, empty: string) => (
      <>
        <p className="branch-compare__section">
          {title} <span className="branch-row__count">{commits.length}</span>
        </p>
        {commits.length === 0 ? (
          <p className="branches-panel__empty">{empty}</p>
        ) : (
          commits.map((commit) => (
            <div
              key={commit.hash}
              className="branch-compare__row"
              data-testid={`compare-row-${commit.hash}`}
            >
              <span className="branch-compare__hash">{commit.shortHash}</span>
              <span className="branch-row__name">{commit.subject}</span>
            </div>
          ))
        )}
        {overflow && <p className="branch-compare__overflow">100개까지만 보여요 — 더 있어요.</p>}
      </>
    )
    return (
      <Panel
        title={`지금 ↔ "${compare.name}"`}
        accessory={<Badge tone="git">compare</Badge>}
        testId="branches-panel"
      >
        <div className="branches-panel">
          <div>
            {/* in-flight revive가 clear를 덮어쓰는 레이스 방지 — busy 중엔 닫기도 잠근다 (DiffPanel 관례, E7d ⑤) */}
            <Button
              variant="ghost"
              size="sm"
              isDisabled={busy}
              onPress={onCloseCompare}
              testId="branch-compare-back"
            >
              ← 목록으로
            </Button>
          </div>
          <div className="branches-panel__scroll" data-testid="branch-compare-view">
            {section(
              `"${compare.name}"에만 있는 저장`,
              result.onlyInSelected,
              result.selectedOverflow,
              '없어요 — 전부 지금 공간에도 있어요.',
            )}
            {section(
              '지금 공간에만 있는 저장',
              result.onlyInCurrent,
              result.currentOverflow,
              '없어요 — 전부 그 공간에도 있어요.',
            )}
          </div>
        </div>
      </Panel>
    )
  }

  const locals = overview?.locals ?? []
  const remotes = overview?.remotes ?? []
  const toggleFolder = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  /** 상태 툴팁 — 칩 대신 아이콘·타이포이므로 설명은 여기서 (스펙 ③) */
  const localTitle = (branch: LocalBranchStatus): string => {
    if (branch.name === currentBranch) return `${branch.name} — 지금 여기(현재 작업 중)`
    if (branch.upstreamGone) return `${branch.name} — 원격에서 사라진 연결. 백업하면 다시 만들어져요`
    if (branch.upstream === null) return `${branch.name} — 아직 원격과 연결 안 됨`
    return branch.name
  }

  /** 인라인 컬러 ↑↓ — 0이거나 알 수 없으면(연결 없음) 숨김 (스펙 ③) */
  const aheadBehind = (branch: LocalBranchStatus) => (
    <>
      {branch.ahead !== null && branch.ahead > 0 && (
        <span className="branch-row__ahead">↑{branch.ahead}</span>
      )}
      {branch.behind !== null && branch.behind > 0 && (
        <span className="branch-row__behind">↓{branch.behind}</span>
      )}
    </>
  )

  const localRow = (branch: LocalBranchStatus, displayName: string, depth: number) => {
    const isCurrent = branch.name === currentBranch
    const dimmed = branch.upstream === null || branch.upstreamGone
    return (
      <button
        key={branch.name}
        type="button"
        className={[
          'branch-row',
          selectedName === branch.name ? 'branch-row--selected' : '',
          historyRef === branch.name ? 'branch-row--viewing' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        title={localTitle(branch)}
        onClick={() => setSelectedName(branch.name)}
        onDoubleClick={() => onAction({ kind: 'view', name: branch.name })}
        onContextMenu={(event) => openMenu(event, { kind: 'local', branch })}
        data-testid={`branch-row-${branch.name}`}
      >
        <span className={`branch-row__glyph${isCurrent ? ' branch-row__glyph--here' : ''}`}>
          {isCurrent ? '➤' : '⎇'}
        </span>
        <span
          className={[
            'branch-row__name',
            isCurrent ? 'branch-row__name--here' : '',
            dimmed ? 'branch-row__name--dim' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {displayName}
        </span>
        {aheadBehind(branch)}
      </button>
    )
  }

  const remoteRow = (name: string, displayName: string, depth: number) => (
    <button
      key={name}
      type="button"
      className={[
        'branch-row',
        'branch-row--remote',
        selectedName === name ? 'branch-row--selected' : '',
        historyRef === name ? 'branch-row--viewing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ paddingLeft: `${8 + depth * 16}px` }}
      title={name}
      onClick={() => setSelectedName(name)}
      onDoubleClick={() => onAction({ kind: 'view', name })}
      onContextMenu={(event) => openMenu(event, { kind: 'remote', name })}
      data-testid={`branch-row-${name}`}
    >
      <span className="branch-row__glyph">☁</span>
      <span className="branch-row__name">{displayName}</span>
    </button>
  )

  const folderRow = (path: string, name: string, count: number, depth: number) => (
    <button
      key={`folder:${path}`}
      type="button"
      className="branch-row branch-row--folder"
      style={{ paddingLeft: `${8 + depth * 16}px` }}
      onClick={() => toggleFolder(path)}
      data-testid={`branch-folder-${path}`}
    >
      <span className="branch-row__glyph">{collapsed.has(path) ? '▸' : '▾'}</span>
      <span className="branch-row__name branch-row__name--folder">{name}</span>
      <span className="branch-row__count">{count}</span>
    </button>
  )

  const searchLocals = flatSearch(locals, query)
  const searchRemotes = flatSearch(remotes, query)
  const localRows = flattenBranchTree(buildBranchTree(locals), collapsed)
  const remoteRows = flattenBranchTree(buildBranchTree(remotes), collapsed)

  return (
    <Panel title="실험 공간" accessory={<Badge tone="git">branch</Badge>} testId="branches-panel">
      <div className="branches-panel">
        <div className="branches-panel__fetch">
          <Button variant="ghost" size="sm" isDisabled={busy} onPress={onFetchRemotes} testId="fetch-remotes">
            <RefreshCw size={13} aria-hidden="true" /> 원격 새로고침
          </Button>
          {lastFetchAt !== null && (
            <span className="branches-panel__fetch-at" data-testid="fetch-at">
              {formatRelativeTime(Math.floor(lastFetchAt / 1000), Date.now())} 새로고침
            </span>
          )}
        </div>
        <input
          className="branches-panel__search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="이름으로 찾기"
          aria-label="실험 공간 검색"
          data-testid="branches-search"
        />
        <div className="branches-panel__scroll" data-testid="branches-list">
          {locals.length === 0 && remotes.length === 0 ? (
            <p className="branches-panel__empty">보여줄 실험 공간이 없어요.</p>
          ) : searchLocals !== null ? (
            <>
              {/* 검색 중엔 평면 매치 — 전체 경로 표시 (스펙 ①) */}
              {searchLocals.map((branch) => localRow(branch, branch.name, 0))}
              {(searchRemotes ?? []).map((remote) => remoteRow(remote.name, remote.name, 0))}
              {searchLocals.length === 0 && (searchRemotes ?? []).length === 0 && (
                <p className="branches-panel__empty">일치하는 이름이 없어요.</p>
              )}
            </>
          ) : (
            <>
              {locals.length > 0 && <p className="branches-panel__group">내 공간 (로컬)</p>}
              {localRows.map((row) =>
                row.node.kind === 'folder'
                  ? folderRow(row.node.path, row.node.name, row.node.count, row.depth)
                  : localRow(row.node.branch, row.node.name, row.depth),
              )}
              {remotes.length > 0 && <p className="branches-panel__group">원격</p>}
              {remoteRows.map((row) =>
                row.node.kind === 'folder'
                  ? folderRow(row.node.path, row.node.name, row.node.count, row.depth)
                  : remoteRow(row.node.branch.name, row.node.name, row.depth),
              )}
            </>
          )}
        </div>
      </div>
      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={
            menu.target.kind === 'local'
              ? buildLocalMenu(menu.target.branch)
              : buildRemoteMenu(menu.target.name)
          }
          onClose={() => setMenu(null)}
        />
      )}
    </Panel>
  )
}
```

주의(구현자): `RemoteBranchRef` 타입 이름은 domain 실독(overview.remotes 항목 타입 — 다르면 실제 이름으로·편차 보고). `branchDisplayName`·`groupBranches`·`trackBadgeLabel` import 제거 — trackBadgeLabel이 이 파일 밖 사용처 없으면 branch-badges.ts는 남겨두되(스위처 확인) 미사용 경고는 없다(파일 단위). 실독·편차 보고.

- [ ] **Step 2: branches-panel.css 전체 교체.**

```css
/* E7g — 실험 공간 패널: file-row와 같은 행 언어(토큰), depth 트리, 아이콘 상태 */
.branches-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  gap: var(--space-2);
}
.branches-panel__fetch {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.branches-panel__fetch-at {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
.branches-panel__search {
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-sm);
  color: inherit;
  background: transparent;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
}
.branches-panel__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.branches-panel__group {
  margin: var(--space-2) var(--space-1) var(--space-1);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
.branches-panel__empty {
  padding: var(--space-3);
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-faint);
}
/* 행 — file-row 관례: 토큰 간격·radius-sm·hover·선택/조회 하이라이트 */
.branch-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: 2px var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font-size: var(--text-sm);
}
.branch-row:hover {
  background: var(--color-hover-bg, rgba(127, 127, 127, 0.08));
}
.branch-row--selected {
  background: var(--color-selection-bg);
}
.branch-row--viewing {
  background: var(--concept-branch-bg);
  outline: 1px solid var(--concept-branch);
}
.branch-row__glyph {
  width: 15px;
  flex: none;
  text-align: center;
  color: var(--color-text-faint);
}
.branch-row__glyph--here {
  color: var(--concept-branch);
  font-weight: 700;
}
.branch-row__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.branch-row__name--here {
  font-weight: 700;
}
.branch-row__name--dim {
  color: var(--color-text-faint);
}
.branch-row__name--folder {
  font-weight: 600;
}
.branch-row--remote .branch-row__name {
  color: var(--color-text-muted);
}
/* 인라인 컬러 ↑↓ — 이름 바로 옆 (스펙 ③, IntelliJ 참고) */
.branch-row__ahead {
  flex: none;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-ahead);
}
.branch-row__behind {
  flex: none;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-behind);
}
.branch-row__count {
  flex: none;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
/* 비교 뷰(E7a 유지) */
.branch-compare__section {
  margin: var(--space-2) var(--space-1) var(--space-1);
  font-size: var(--text-sm);
  font-weight: 600;
}
.branch-compare__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 2px var(--space-2);
  font-size: var(--text-sm);
}
.branch-compare__hash {
  flex: none;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
.branch-compare__overflow {
  margin: var(--space-1);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
```

주의(구현자): 토큰 실명(`--text-xs`·`--text-sm`·`--space-1·2·3`·`--radius-sm`·`--font-mono`·`--concept-branch(-bg)`·hover 토큰 유무)은 tokens.css 실독으로 확정 — 없는 토큰은 기존 유사 토큰으로 치환하고 편차 보고. 기존 css의 비교 뷰 클래스와 시각적 등가 유지.

- [ ] **Step 3: HistoryPanel 알약.** HistoryPanel.tsx의 props에 `historyRef: string | null`·`onClearView(): void` 추가(interface 실독), accessory의 기존:

```tsx
        <>
          <Badge tone="git">log</Badge>
```

교체:

```tsx
        <>
          {historyRef !== null && (
            <span className="history-view-pill" data-testid="history-view-pill">
              조회 중: {historyRef}
              <button
                type="button"
                className="history-view-pill__clear"
                aria-label="조회 해제 — 전체 그래프로"
                onClick={onClearView}
                data-testid="history-view-clear"
              >
                ✕
              </button>
            </span>
          )}
          <Badge tone="git">log</Badge>
```

(구조 분해에 두 prop 추가 — 실독.) HistoryPanel이 import하는 css(실독)에 추가:

```css
/* E7g 조회 알약 — 우측 역사가 어느 계보인지 상시 표시 */
.history-view-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-2);
  font-size: var(--text-xs);
  border: 1px solid var(--concept-branch);
  border-radius: 10px;
  background: var(--concept-branch-bg);
  color: var(--concept-branch);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-view-pill__clear {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0;
}
```

- [ ] **Step 4: App 배선.** BranchesPanel 렌더(실독)에 `historyRef={store.historyRef}` 추가, onAction 스위치에 `case 'view': void store.viewHistory(action.name); break` 추가(기존 case 뒤·같은 취지). HistoryPanel 렌더(실독)에 `historyRef={store.historyRef}`·`onClearView={() => void store.clearHistoryView()}` 추가.

- [ ] **Step 5: E2E 좌클릭 1건 전환.** smoke.spec.ts 기존:

```ts
    await window.getByTestId('branch-row-clash').click()
    await window.getByTestId('context-merge').click()
```

교체:

```ts
    // E7g: 좌클릭은 선택만 — 메뉴는 우클릭 (3단 인터랙션)
    await window.getByTestId('branch-row-clash').click({ button: 'right' })
    await window.getByTestId('context-merge').click()
```

- [ ] **Step 6: 게이트** — typecheck Done, 루트 `pnpm test` → **461 유지**, `cd apps/desktop && npx electron-vite build && npx playwright test e2e/smoke.spec.ts` → **65 passed**(우클릭 5건 + 전환 1건 포함 전 스위트 — 실패 시 원인 수정).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/components/BranchesPanel.tsx apps/desktop/src/renderer/src/components/branches-panel.css apps/desktop/src/renderer/src/components/HistoryPanel.tsx apps/desktop/src/renderer/src/App.tsx apps/desktop/e2e/smoke.spec.ts
git commit -m "feat(desktop): E7g 실험 공간 개편 — depth 트리·1클릭 선택/더블클릭 조회/우클릭 메뉴·인라인 ↑↓·조회 알약

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(HistoryPanel css 파일이 별도면 add 포함 — 편차 보고.)

---

### Task 6: 워크트리 톤 통일 (시각만 — 동작·testid 무변)

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/WorktreesPanel.tsx` (행 렌더부)
- Rewrite: `apps/desktop/src/renderer/src/components/worktrees-panel.css` (행 언어부 — add-worktree 다이얼로그 클래스는 유지)

- [ ] **Step 1: 행 렌더 교체.** WorktreesPanel.tsx의 기존 행 버튼 블록(worktrees.map 내부 — 실독으로 정확 앵커):

```tsx
              <span className="worktree-row__top">
                <span className="worktree-row__name">
                  {worktree.isMain ? '🏠' : '🌳'} {folderName(worktree.path)}
                </span>
                {worktree.path === currentPath && <Badge tone="git">지금 여기</Badge>}
                {worktree.path === activePath && <Badge tone="git">터미널 대상</Badge>}
                <span className="worktree-row__branch">{branchLabel(worktree)}</span>
              </span>
              <span className="worktree-row__path">{worktree.path}</span>
```

교체(칩→글리프·2줄→1줄 — 스펙 ④):

```tsx
              <span
                className={`worktree-row__glyph${worktree.path === currentPath ? ' worktree-row__glyph--here' : ''}`}
              >
                {worktree.path === currentPath ? '➤' : '⌂'}
              </span>
              <span
                className={`worktree-row__name${worktree.path === currentPath ? ' worktree-row__name--here' : ''}`}
              >
                {folderName(worktree.path)}
              </span>
              <span className="worktree-row__path">{worktree.path}</span>
              {worktree.path === activePath && (
                <span className="worktree-row__terminal" title="터미널 대상 — 새 터미널이 이 폴더에서 열려요">
                  ❯_
                </span>
              )}
              <span className="worktree-row__branch">{branchLabel(worktree)}</span>
```

행 버튼의 title에 상태 설명 병기(실독 — 현행 `title={worktree.path}`를 `title={worktree.path === currentPath ? \`${worktree.path} — 지금 여기\` : worktree.path}`로). Badge import가 미사용이 되면 제거(실독·편차 보고).

- [ ] **Step 2: css 행 언어부 교체.** worktrees-panel.css의 `.worktree-row` ~ `.worktree-row__path` 블록(실독)을 다음으로 교체(`.add-worktree__*`·`.worktrees-panel__empty`·`.worktrees-panel(스크롤)` 유지·토큰화):

```css
.worktree-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: 2px var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font-size: var(--text-sm);
}
.worktree-row:hover {
  background: var(--color-hover-bg, rgba(127, 127, 127, 0.08));
}
.worktree-row--gone {
  opacity: var(--opacity-disabled);
}
.worktree-row--add {
  color: var(--color-text-faint);
}
.worktree-row__glyph {
  width: 15px;
  flex: none;
  text-align: center;
  color: var(--color-text-faint);
}
.worktree-row__glyph--here {
  color: var(--concept-branch);
  font-weight: 700;
}
.worktree-row__name {
  flex: none;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.worktree-row__name--here {
  font-weight: 700;
}
.worktree-row__path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
.worktree-row__terminal {
  flex: none;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--concept-branch);
}
.worktree-row__branch {
  flex: none;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
```

(기존 `.worktree-row__top` 래퍼는 행이 1줄이 되면서 불필요 — JSX에서 제거되었으므로 css에서도 삭제. 실독·편차 보고.)

- [ ] **Step 3: 게이트** — typecheck·build, 루트 `pnpm test` 461, `npx playwright test e2e/smoke.spec.ts -g "워크트리"` → E7c·E7d 워크트리 E2E 전건 통과(testid·동작 무변 검증).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/components/WorktreesPanel.tsx apps/desktop/src/renderer/src/components/worktrees-panel.css
git commit -m "feat(desktop): E7g 워크트리 톤 — 글리프 상태(➤/⌂/❯_)·한 줄 경로·토큰 행 언어(동작 무변)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 터미널 톤 통일 (시각만)

**Files:**
- Modify: `apps/desktop/src/renderer/src/ui/terminal/terminal-dock.css`

- [ ] **Step 1: 탭 밑줄형 전환.** 기존:

```css
.terminal-dock__tab {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 0 2px;
}
.terminal-dock__tab--on {
  border-color: var(--color-border-strong);
}
```

교체(좌측 탭바와 같은 시각 규칙 — 스펙 ⑤):

```css
.terminal-dock__tab {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  padding: 0 var(--space-1) 2px;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.terminal-dock__tab--on {
  border-bottom-color: var(--concept-branch);
  color: inherit;
  font-weight: 600;
}
```

- [ ] **Step 2: 나머지 하드코딩 px 토큰화.** terminal-dock.css 전체를 실독해 px 간격·글꼴 크기를 등가 토큰으로 치환(시각 등가 — 값이 토큰과 1px 이내로 다르면 토큰 채택). 각 치환을 편차 보고. `.terminal-dock__error`·`.terminal-dock__hint`·`.terminal-dock__label`은 `--text-sm`/`--text-xs`·`--color-text-faint` 계열로.

- [ ] **Step 3: 게이트** — build, `npx playwright test e2e/smoke.spec.ts -g "터미널"` → 터미널 E2E 전건 통과. 루트 `pnpm test` 461.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/ui/terminal/terminal-dock.css
git commit -m "feat(desktop): E7g 터미널 톤 — 밑줄형 탭·타이포 토큰화(동작 무변)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: E2E — 3단 인터랙션·트리 신규 3건

**Files:**
- Modify: `apps/desktop/e2e/smoke.spec.ts` (+3)

- [ ] **Step 1: 파일 끝(E7f 창 제목 테스트 뒤)에 추가.**

```ts

test('실험 공간 — 한 번 클릭은 선택만, 역사는 그대로다 (E7g)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'quiet-branch'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-branches').click()
    await window.getByTestId('branch-row-quiet-branch').click()
    // 선택 하이라이트만 — 조회 알약도, 메뉴도, 역사 변화도 없다
    await expect(window.getByTestId('branch-row-quiet-branch')).toHaveClass(/branch-row--selected/)
    await expect(window.getByTestId('history-view-pill')).toHaveCount(0)
    await expect(window.locator('.ui-context-menu')).toHaveCount(0)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('실험 공간 — 더블클릭 조회로 역사가 그 계보로 바뀌고 ✕로 복귀한다 (E7g)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  // 다른 계보 — side에만 있는 저장
  await execGitOrThrow(['checkout', '-b', 'side-line'], { cwd: repo })
  await writeFile(join(repo, 'side.txt'), 's\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '옆줄 저장'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  await writeFile(join(repo, 'main.txt'), 'm\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '본줄 저장'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    // 전체 그래프는 둘 다 보인다
    await expect(window.getByTestId('history-list')).toContainText('옆줄 저장')
    await expect(window.getByTestId('history-list')).toContainText('본줄 저장')
    await window.getByTestId('left-tab-branches').click()
    await window.getByTestId('branch-row-side-line').dblclick()
    // 조회 모드 — side 계보만
    await expect(window.getByTestId('history-view-pill')).toContainText('side-line')
    await expect(window.getByTestId('history-list')).toContainText('옆줄 저장')
    await expect(window.getByTestId('history-list')).not.toContainText('본줄 저장')
    await expect(window.getByTestId('branch-row-side-line')).toHaveClass(/branch-row--viewing/)
    // ✕ 복귀
    await window.getByTestId('history-view-clear').click()
    await expect(window.getByTestId('history-view-pill')).toHaveCount(0)
    await expect(window.getByTestId('history-list')).toContainText('본줄 저장')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('실험 공간 — 폴더를 접으면 하위 브랜치가 숨는다 (E7g)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'feature/login'], { cwd: repo })
  await execGitOrThrow(['branch', 'feature/signup'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-branches').click()
    await expect(window.getByTestId('branch-row-feature/login')).toBeVisible()
    await window.getByTestId('branch-folder-feature').click()
    await expect(window.getByTestId('branch-row-feature/login')).toHaveCount(0)
    await expect(window.getByTestId('branch-row-feature/signup')).toHaveCount(0)
    await window.getByTestId('branch-folder-feature').click()
    await expect(window.getByTestId('branch-row-feature/login')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: 게이트** — `cd apps/desktop && npx electron-vite build && npx playwright test e2e/smoke.spec.ts` → **68 passed**. 신규 3건 단독 -g non-flaky. 루트 461·typecheck.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts
git commit -m "test(desktop): E7g E2E — 1클릭 선택만·더블클릭 조회/복귀·폴더 접기

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 최종 게이트 + 공식 스크린샷 3장 + README

- [ ] **Step 1: 전체 게이트** — 루트 `pnpm test` **461** · typecheck 전부 Done · desktop build · `pnpm --filter @git-gui/desktop e2e` **74**(smoke 68 + hosting 6) · last-screen 0건.

- [ ] **Step 2: README.** 기존(E7f 문단 끝):

```
`pnpm --filter @git-gui/desktop package`로 설치 가능한 .app/.dmg를 만들 수 있습니다(이름·아이콘·터미널(node-pty)까지 검증 스크립트로 확인).
```

교체:

```
`pnpm --filter @git-gui/desktop package`로 설치 가능한 .app/.dmg를 만들 수 있습니다(이름·아이콘·터미널(node-pty)까지 검증 스크립트로 확인). E7g로 디자인이 한 몸이 됐습니다 — 실험 공간이 IntelliJ처럼 접이식 depth 트리가 되고(한 번 클릭=선택, 두 번 클릭=우측 역사가 그 계보로 전환+"조회 중" 알약, 우클릭=메뉴), "지금 여기" 같은 상태는 칩 대신 아이콘(➤)과 이름 옆 컬러 ↑↓(초록=올릴 것·주황=받을 것)로 조용히 표시되며, 워크트리·터미널도 같은 행 언어·토큰으로 통일됐습니다.
```

- [ ] **Step 3: 공식 스크린샷 3장** — 임시 spec `apps/desktop/e2e/tmp-shots-e7g.spec.ts`(관례: harness electron·1440×900·finally 정리·scratchpad 사본·촬영 후 삭제·e2e 재실행 금지): **(1) e7g-branches-tree.png** — feature/login·signup + fix/a 픽스처(로컬 bare 원격 + ahead/behind 연출: 원격과 발산시켜 ↑↓ 표시) → 실험 공간 탭, side 브랜치 더블클릭 조회 상태(트리+➤+↑↓+조회 알약). **(2) e7g-worktrees-tone.png** — 워크트리 1개 추가 + 활성 지정 상태(➤·⌂·❯_·한 줄 경로). **(3) e7g-terminal-tone.png** — 터미널 탭 2개(밑줄형 탭). 컨트롤러 육안 검수(시각 결함 시 CSS 보완·재촬영 — E7c 관례) + 사용자 전송.

- [ ] **Step 4: Commit** (README만 — 실행 기록은 컨트롤러 별도 docs 커밋)

```bash
git add README.md
git commit -m "docs: README — E7g 디자인 정합(depth 트리·3단 클릭·아이콘 상태·톤 통일) 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

## Self-review 수정 기록 (인라인 반영)

1. **스펙 커버리지**: ①T3·T5 ②T1·T2·T5 ③T4·T5 ④T6 ⑤T7 + E2E T5(전환 1건)·T8 — 전부 매핑. 스펙의 "조회 브랜치 소멸 자동 복귀"는 fetchSnapshot 내부 try/catch(T2)가 담당 — 감시발 갱신·모든 변이에서 동작.
2. **39곳 호출부 문제**: fetchSnapshot 인자 추가 대신 내부 getState() — 호출부 무변·조회가 모든 갱신 경로에 자동 관통(E7d ⑤ 원칙과 정합). openRepository/openWorktree만 명시 해제.
3. **E2E 재작성 부담 실측으로 축소**: 좌클릭 의존 1건뿐(실측 1) — 스펙의 "전수 조사" 완료, 5건은 이미 우클릭.
4. **BranchSwitcher 보존**: groupBranches는 헤더 스위처가 계속 사용(실측 4) — 트리 빌더는 별도 파일.
5. **테스트 수 재검산**: T1 +2, T3 +8, T4 +1(PAIRS 방식이면 +0일 수 있음 — 게이트 표는 461 기준, 실측 편차 보고 지침 포함) → 450+11=**461**. smoke 65+3=**68**, 전체 74.
6. **타입 일관성**: BranchPanelAction 'view' ↔ App case 'view' ↔ store.viewHistory / historyRef prop 3곳(BranchesPanel·HistoryPanel·store) 동명.

## 인용 앵커 검증 기록

**스크립트 실검증(2026-07-24, main=e3dbebb):** "기존:" 블록 전수 — 기준선 정확 1회 매칭 **12개**, 미래 앵커 1개, 불일치 **0**. (전면 교체 파일들은 앵커 검증 대상 외 — 유지부는 현행 전문과 대조.)

작성 시점(main=e3dbebb) 실측 원문 발췌 앵커: client.ts(history 인터페이스·exclude+--all 블록), ipc-contract(history 블록), store(lastFetchAt 필드·Promise.all 선두), tokens.css(danger 라이트·다크 줄), tokens-contrast(danger PAIRS 줄), BranchesPanel(전면 교체 — 앵커 불요·현행 전문은 위 전체 코드의 유지부와 대조), WorktreesPanel(행 블록), worktrees-panel.css(행 언어부 — 실독 교체), terminal-dock.css(탭 블록), smoke(clash 좌클릭 2줄·파일 끝), README(E7f 문단 끝), HistoryPanel(accessory 선두). **미확정(구현 시 실독·같은 취지·편차 보고): client.test 삽입 앵커, historyList 핸들러·preload 현행, store 액션 선언 삽입점(setPullMode 뒤)·openRepository/openWorktree set 객체, overview.remotes 항목 타입 이름, HistoryPanel props 구조 분해·css 파일명, App 3곳 렌더 프롭, WorktreesPanel title·Badge import, terminal-dock.css 잔여 px, 토큰 실명(text-xs 등).** Task 2→5(historyRef 상태), T3→5(트리 함수), T4→5(색 토큰) 순서 의존 — 엄수.

## 후속 노트 (이관 후보)

- 접기 상태 영속·트리 가상화·조회 중 비교/diff 연동(스펙 범위 밖 재확인), 키보드 트리 탐색(←/→ 접기), trackBadgeLabel·branch-badges 정리(사용처 소멸 시).



