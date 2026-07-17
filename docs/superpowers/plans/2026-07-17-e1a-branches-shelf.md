# E1a 실험 공간(branch)·보관함(stash) 구현 계획 (2차 피드백 ⑧ + 스펙 E1 전반부)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실험 공간(branch)을 목록·만들기·전환할 수 있게 하고(헤더 스위처 + 히스토리 우클릭), 전환이 막히면 스펙 원칙대로 변경을 보관함(stash)에 자동으로 넣고 진행하며, 보관함을 직접 보관·꺼내기·버리기할 수 있게 한다.

**Architecture:** 엔진 우선 — adapter에 `branches.{list,create,switch}`·`shelf.{save,list,restore,drop}`를 추가한다(for-each-ref·stash porcelain 파서는 refs-parser.ts). 전환은 **먼저 시도하고, "would be overwritten"으로 막힐 때만** 자동 보관 후 재시도한다 — 막힌 파일은 대상 브랜치와 반드시 다르므로 자동 복원은 거의 확실히 충돌한다 → 복원하지 않고 보관함에 남긴 채 안내한다(SwitchResult.autoShelved). UI는 헤더 브랜치 스위처(react-aria Menu)·보관함 Popover·히스토리 우클릭 ContextMenu·이름 입력 PromptDialog, 안내는 새 notice 배너로.

**Tech Stack:** 기존과 동일 (신규 의존성 없음 — react-aria-components의 Menu/Popover 활용).

**사용자 피드백 매핑:** ⑧브랜치 컨트롤(전환·생성) → Task 1~5·7, ⑦우클릭 메뉴(1차분: 여기서 실험 공간 만들기·해시 복사) → Task 8, 스펙 71행("덮을 수 있는 동작 전에 자동으로 보관함에") → Task 2 switch 흐름, 보관함 직접 사용(스펙 E1) → Task 2·6.

**실측으로 확정한 git 명령 (probe 저장소):**
- `git for-each-ref refs/heads --format=%(refname:short)\x1f%(HEAD)\x1f%(committerdate:unix)\x1f%(upstream:short)` — HEAD 마커는 `*`, upstream 없으면 빈 필드. (US 0x1f는 **리터럴 바이트**로 argv에 넣는다 — for-each-ref는 %x1f 이스케이프가 없다)
- `git check-ref-format --branch <name>` — 유효하면 exit 0, `bad name`·`-dash` 등은 exit 128 `fatal: '…' is not a valid branch name`.
- dirty 상태의 `git switch`는 **대상과 겹치는 파일이 있을 때만** 막힌다: `error: Your local changes to the following files would be overwritten by checkout:` — 겹치지 않으면 변경을 그대로 들고 전환된다(exit 0, `M 파일` 출력). 없는 브랜치는 `fatal: invalid reference: <name>`.
- `git stash push -u -m <msg>` — untracked 포함 보관. 깨끗한 트리에서는 `No local changes to save`(exit 0) — 엔진이 친절 에러로 변환한다.
- `git stash list --format=%gd%x1f%ct%x1f%gs` → `stash@{0}\x1f<epoch>\x1f<On main: msg>` (log 계열이라 %x1f 이스케이프 동작).
- `git stash pop <ref>` 충돌 시: 겹친 내용이 충돌 표시로 **적용되고** 항목은 보관함에 남는다(`The stash entry is kept in case you need it again.`).

**알려진 한계(의도적):** 보관·꺼내기는 git stash pop 특성상 staged/unstaged 구분과 staged 중간본을 유지하지 않는다 — **최종 작업물은 온전히 생존**(리뷰 실측). merge 충돌 중 switch·없는 stash index는 git이 막되 원어 에러가 노출된다(정상 플로우에서 도달 어려움 — E1b 충돌 UI에서 정리). 전환이 막혀 자동 보관했을 때 **자동 복원은 하지 않는다** — 막힌 파일은 대상 브랜치 내용과 반드시 다르므로 복원은 거의 확실히 충돌 표시를 만든다. 대신 notice로 보관함 위치를 안내한다(사용자가 꺼내는 순간은 스스로 선택). `stash@{n}` ref는 목록이 바뀌면 밀린다 — 모든 변이가 busy 가드로 직렬화되고 매 변이 후 스냅샷을 다시 읽으므로 실사용 레이스는 없다. 삭제(브랜치 지우기)·이름 바꾸기·합치기(merge)는 E1b.

---

## 파일 구조

```
packages/domain/src/repository.ts                    # BranchSummary·ShelfEntry·SwitchResult (수정)
packages/git-adapter/src/refs-parser.ts              # parseBranches·parseShelf (신규)
packages/git-adapter/src/client.ts                   # branches.*·shelf.* (수정)
packages/ipc-contract/src/index.ts                   # branches/shelf 채널 (수정)
apps/desktop/src/main/git-handlers.ts                # 핸들러 7개 + assertShelfRef (수정)
apps/desktop/src/preload/index.ts                    # 브리지 (수정)
apps/desktop/src/renderer/src/store/repository-store.ts # branches·shelf·notice·액션 (수정)
apps/desktop/src/renderer/src/ui/PromptDialog.tsx    # 이름 입력 다이얼로그 (신규)
apps/desktop/src/renderer/src/ui/ContextMenu.tsx     # 우클릭 메뉴 (신규, 범용)
apps/desktop/src/renderer/src/components/BranchSwitcher.tsx # 헤더 스위처 (신규)
apps/desktop/src/renderer/src/components/ShelfPopover.tsx   # 보관함 (신규)
apps/desktop/src/renderer/src/components/HistoryPanel.tsx   # 우클릭 배선 (수정)
apps/desktop/src/renderer/src/App.tsx                # 헤더·notice·다이얼로그 배선 (수정)
```

---

### Task 1: domain 타입 + refs 파서

**Files:**
- Modify: `packages/domain/src/repository.ts`
- Create: `packages/git-adapter/src/refs-parser.ts`
- Test: `packages/git-adapter/test/refs-parser.test.ts`

- [ ] **Step 1: domain 타입 추가**

`packages/domain/src/repository.ts` 끝에 추가:

```ts
/** 실험 공간(branch) 하나 — 스위처 목록용 */
export interface BranchSummary {
  name: string
  isCurrent: boolean
  /** epoch 초 — 이 공간의 마지막 저장 시점 */
  committedAt: number
  upstream: string | null
}

/** 보관함(stash) 항목 하나 */
export interface ShelfEntry {
  /** git stash ref — "stash@{n}". 목록 갱신 직후에만 유효하다(변이는 busy로 직렬화됨) */
  ref: string
  /** epoch 초 */
  savedAt: number
  message: string
}

/** 실험 공간 전환 결과 — 자동 보관이 개입했으면 UI가 보관함 위치를 안내한다 */
export interface SwitchResult {
  autoShelved: boolean
}
```

- [ ] **Step 2: 실패하는 파서 테스트**

Create `packages/git-adapter/test/refs-parser.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseBranches, parseShelf } from '../src/refs-parser'

const US = '\x1f'

describe('parseBranches', () => {
  it('for-each-ref 출력에서 이름·현재 여부·시각·upstream을 읽는다', () => {
    const raw =
      [`feat/x${US} ${US}1784279934${US}`, `main${US}*${US}1784279935${US}origin/main`].join('\n') +
      '\n'
    expect(parseBranches(raw)).toEqual([
      { name: 'feat/x', isCurrent: false, committedAt: 1784279934, upstream: null },
      { name: 'main', isCurrent: true, committedAt: 1784279935, upstream: 'origin/main' },
    ])
  })

  it('빈 출력이면 빈 배열, 기형 행은 건너뛴다', () => {
    expect(parseBranches('')).toEqual([])
    expect(parseBranches(`broken\nmain${US}*${US}not-a-number${US}\n`)).toEqual([])
  })
})

describe('parseShelf', () => {
  it('stash list 출력에서 ref·시각·메시지를 읽는다', () => {
    const raw =
      [
        `stash@{0}${US}1784279940${US}On main: 전환 자동 보관`,
        `stash@{1}${US}1784279930${US}WIP on side: abc1234 subject`,
      ].join('\n') + '\n'
    expect(parseShelf(raw)).toEqual([
      { ref: 'stash@{0}', savedAt: 1784279940, message: 'On main: 전환 자동 보관' },
      { ref: 'stash@{1}', savedAt: 1784279930, message: 'WIP on side: abc1234 subject' },
    ])
  })

  it('메시지에 구분자가 섞여도 나머지를 메시지로 합친다', () => {
    const raw = `stash@{0}${US}100${US}메시지${US}에 구분자\n`
    expect(parseShelf(raw)[0]?.message).toBe(`메시지${US}에 구분자`)
  })

  it('빈 출력이면 빈 배열', () => {
    expect(parseShelf('')).toEqual([])
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run packages/git-adapter/test/refs-parser.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: 파서 구현**

Create `packages/git-adapter/src/refs-parser.ts`:

```ts
import type { BranchSummary, ShelfEntry } from '@git-gui/domain'

const FIELD_SEPARATOR = '\x1f'

/**
 * `git for-each-ref refs/heads --format=%(refname:short)\x1f%(HEAD)\x1f%(committerdate:unix)\x1f%(upstream:short)`
 * 출력을 파싱한다. HEAD 마커는 현재 브랜치에서 '*', 아니면 공백. 기형 행은 건너뛴다.
 */
export function parseBranches(rawOutput: string): BranchSummary[] {
  const lines = rawOutput.split('\n').filter((line) => line !== '')
  const branches: BranchSummary[] = []
  for (const line of lines) {
    const fields = line.split(FIELD_SEPARATOR)
    if (fields.length < 4) continue
    const committedAt = Number(fields[2])
    if (!Number.isFinite(committedAt)) continue
    branches.push({
      name: fields[0]!,
      isCurrent: fields[1] === '*',
      committedAt,
      upstream: fields[3] === '' ? null : fields[3]!,
    })
  }
  return branches
}

/**
 * `git stash list --format=%gd%x1f%ct%x1f%gs` 출력을 파싱한다.
 * 메시지(%gs)는 git이 "On <branch>: <msg>"/"WIP on <branch>: …"로 만든 원문 그대로 둔다.
 */
export function parseShelf(rawOutput: string): ShelfEntry[] {
  const lines = rawOutput.split('\n').filter((line) => line !== '')
  const entries: ShelfEntry[] = []
  for (const line of lines) {
    const fields = line.split(FIELD_SEPARATOR)
    if (fields.length < 3) continue
    const savedAt = Number(fields[1])
    if (!Number.isFinite(savedAt)) continue
    entries.push({
      ref: fields[0]!,
      savedAt,
      // 메시지에 구분자가 섞이는 일은 없지만 방어적으로 나머지를 합친다
      message: fields.slice(2).join(FIELD_SEPARATOR),
    })
  }
  return entries
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run packages/git-adapter/test/refs-parser.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/repository.ts packages/git-adapter/src/refs-parser.ts packages/git-adapter/test/refs-parser.test.ts
git commit -m "feat(adapter): 실험 공간·보관함 타입과 refs 파서

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: adapter — branches·shelf 엔진

**Files:**
- Modify: `packages/git-adapter/src/client.ts`, `packages/git-adapter/src/index.ts`
- Test: `packages/git-adapter/test/client.test.ts`

- [ ] **Step 1: 실패하는 통합 테스트**

`packages/git-adapter/test/client.test.ts`의 `'history — 타임스탬프가 같아도…'` 테스트 **뒤**에 추가:

```ts
  it('branches — 목록(현재 표시·최신순)과 만들기, 특정 시점에서 만들기', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('exp-1', null)
    const root = (await client.history.list(1))[0]!
    await writeFixtureFile(repo, 'more.txt', 'm\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'second'], { cwd: repo })
    await client.branches.create('exp-old', root.hash)

    const branches = await client.branches.list()
    expect(branches.map((b) => b.name).sort()).toEqual(['exp-1', 'exp-old', 'main'])
    expect(branches.find((b) => b.name === 'main')?.isCurrent).toBe(true)
    expect(branches.find((b) => b.name === 'exp-1')?.isCurrent).toBe(false)
  })

  it('branches — 잘못된 이름·중복 이름을 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.branches.create('bad name', null)).rejects.toThrow(/이름으로는 만들 수 없어요/)
    await expect(client.branches.create('-dash', null)).rejects.toThrow(/이름으로는 만들 수 없어요/)
    await client.branches.create('dup', null)
    await expect(client.branches.create('dup', null)).rejects.toThrow(/이미 있는 이름/)
  })

  it('switch — 겹치지 않는 변경은 그대로 들고 전환한다 (자동 보관 없음)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('exp', null)
    await writeFixtureFile(repo, 'free.txt', 'f\n')
    const result = await client.branches.switch('exp')
    expect(result).toEqual({ autoShelved: false })
    const status = await client.repo.status()
    expect(status.branch.name).toBe('exp')
    expect(status.changes.find((c) => c.path === 'free.txt')?.unstaged).toBe('untracked')
    expect(await client.shelf.list()).toEqual([])
  })

  it('switch — 겹치는 변경으로 막히면 보관함에 자동 저장하고 전환한다 (복원은 하지 않는다)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    // 대상 브랜치의 README가 다르도록 만든다 — 전환이 "would be overwritten"으로 막히는 조건
    await execGitOrThrow(['checkout', '-b', 'other'], { cwd: repo })
    await writeFixtureFile(repo, 'README.md', '# other\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'other change'], { cwd: repo })
    await execGitOrThrow(['checkout', 'main'], { cwd: repo })
    await writeFixtureFile(repo, 'README.md', '# my work\n')

    const result = await client.branches.switch('other')
    expect(result).toEqual({ autoShelved: true })
    const status = await client.repo.status()
    expect(status.branch.name).toBe('other')
    // 작업 트리는 깨끗하고(변경은 보관함으로), 항목이 하나 생겼다
    expect(status.changes).toEqual([])
    const shelf = await client.shelf.list()
    expect(shelf).toHaveLength(1)
    expect(shelf[0]!.message).toContain('실험 공간 전환 자동 보관')
  })

  it('switch — 없는 실험 공간은 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.branches.switch('no-such')).rejects.toThrow(/실험 공간이 없어요/)
  })

  it('shelf — 보관·목록·꺼내기·버리기 왕복 (untracked 포함)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# changed\n')
    await writeFixtureFile(repo, 'new.txt', 'n\n')
    await client.shelf.save('직접 보관')

    let status = await client.repo.status()
    expect(status.changes).toEqual([])
    const shelf = await client.shelf.list()
    expect(shelf).toHaveLength(1)
    expect(shelf[0]!.message).toContain('직접 보관')

    await client.shelf.restore(shelf[0]!.ref)
    status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'README.md')?.unstaged).toBe('modified')
    expect(status.changes.find((c) => c.path === 'new.txt')?.unstaged).toBe('untracked')
    expect(await client.shelf.list()).toEqual([])

    await client.shelf.save('버릴 항목')
    const again = await client.shelf.list()
    await client.shelf.drop(again[0]!.ref)
    expect(await client.shelf.list()).toEqual([])
  })

  it('shelf — 깨끗한 트리 보관과 잘못된 ref를 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.shelf.save('없는 변경')).rejects.toThrow(/보관할 변경이 없어요/)
    // 패턴 필수 — 무패턴 toThrow는 가드를 제거해도 git 원시 에러로 통과해 버린다(변이 실증).
    // 가드가 없으면 '--quiet' 같은 입력이 플래그로 해석돼 엉뚱한 최신 항목이 pop된다.
    await expect(client.shelf.restore('HEAD')).rejects.toThrow(/올바른 보관함 항목이 아니에요/)
    await expect(client.shelf.drop('stash@{x}')).rejects.toThrow(/올바른 보관함 항목이 아니에요/)
  })

  it('shelf — 꺼내기가 겹치면 충돌 표시로 남기고 항목을 보관함에 보존한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# shelved\n')
    await client.shelf.save('겹침 테스트')
    await writeFixtureFile(repo, 'README.md', '# moved on\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'move on'], { cwd: repo })

    const shelf = await client.shelf.list()
    await expect(client.shelf.restore(shelf[0]!.ref)).rejects.toThrow(/겹치는 부분/)
    // 항목은 남아 있다 — 데이터 유실 없음
    expect(await client.shelf.list()).toHaveLength(1)
  })
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run packages/git-adapter/test/client.test.ts --testNamePattern "branches|switch|shelf"`
Expected: FAIL — `client.branches is not …`/`client.shelf is not …`

- [ ] **Step 3: client.ts 구현**

(a) import의 domain 타입에 `type BranchSummary,`·`type ShelfEntry,`·`type SwitchResult,`를 알파벳 순서 자리에 추가하고, 파서 import 행 추가:

```ts
import { parseBranches, parseShelf } from './refs-parser'
```

(b) `GitClient` 인터페이스의 `repo:` 블록 **뒤**에 추가:

```ts
  branches: {
    /** 실험 공간 목록 — 마지막 저장 시점 최신순 */
    list(): Promise<BranchSummary[]>
    /** 새 실험 공간 — fromHash가 있으면 그 시점에서, 없으면 지금(HEAD)에서. 만들기만 하고 전환하지 않는다 */
    create(name: string, fromHash: string | null): Promise<void>
    /**
     * 실험 공간 전환. 겹치지 않는 변경은 그대로 들고 간다(git 기본 동작).
     * 겹쳐서 막히면 스펙 원칙대로 변경을 보관함에 자동 저장하고 전환한다 —
     * 자동 복원은 하지 않는다(막힌 파일은 대상과 반드시 달라 복원이 거의 확실히 충돌한다).
     */
    switch(name: string): Promise<SwitchResult>
  }
  shelf: {
    /** 지금 변경(미추적 포함)을 보관함에 저장한다. 변경이 없으면 거부 */
    save(message: string): Promise<void>
    /** 보관함 목록 — 최신이 stash@{0} */
    list(): Promise<ShelfEntry[]>
    /** 꺼내기(pop) — 겹치면 충돌 표시로 적용되고 항목은 보관함에 남는다(에러로 알린다) */
    restore(ref: string): Promise<void>
    /** 버리기 — 되돌릴 수 없다 (확인창은 renderer 책임) */
    drop(ref: string): Promise<void>
  }
```

(c) `MISSING_COMMIT_MESSAGE` 상수 **뒤**에 추가:

```ts
/** 전환이 막혀 자동 보관할 때의 보관함 메시지 — UI·테스트가 이 문구로 항목을 식별한다 */
const AUTO_SHELF_MESSAGE = '실험 공간 전환 자동 보관'

/** stash ref 형식만 통과 — 임의 revision 표현식이 stash 명령으로 흘러가는 것을 차단 */
function assertShelfRef(ref: string): void {
  if (!/^stash@\{\d{1,6}\}$/.test(ref)) {
    throw new Error(`올바른 보관함 항목이 아니에요: ${ref}`)
  }
}
```

(d) 구현부 `repo:` 블록 **뒤**(changes 앞)에 추가:

```ts
    branches: {
      async list() {
        const cwd = await topLevel()
        const raw = await execGitOrThrow(
          [
            'for-each-ref',
            'refs/heads',
            '--sort=-committerdate',
            '--format=%(refname:short)\x1f%(HEAD)\x1f%(committerdate:unix)\x1f%(upstream:short)',
          ],
          { cwd },
        )
        return parseBranches(raw.stdout)
      },
      async create(name, fromHash) {
        const cwd = await topLevel()
        const valid = await execGit(['check-ref-format', '--branch', name], { cwd })
        if (valid.exitCode !== 0) {
          throw new Error(`"${name}"라는 이름으로는 만들 수 없어요. 공백 없이 지어 주세요.`)
        }
        if (fromHash !== null) assertFullHash(fromHash)
        const args =
          fromHash !== null
            ? ['branch', '--end-of-options', name, fromHash]
            : ['branch', '--end-of-options', name]
        const result = await execGit(args, { cwd })
        if (result.exitCode !== 0) {
          if (result.stderr.includes('already exists')) {
            throw new Error(`"${name}"는 이미 있는 이름이에요. 다른 이름을 지어 주세요.`)
          }
          throw new GitError(args, result)
        }
      },
      async switch(name) {
        const cwd = await topLevel()
        // 먼저 그대로 시도한다 — 겹치지 않는 변경은 git이 자연스럽게 들고 간다
        const first = await execGit(['switch', '--end-of-options', name], { cwd })
        if (first.exitCode === 0) return { autoShelved: false }
        if (first.stderr.includes('invalid reference')) {
          throw new Error(`"${name}"라는 실험 공간이 없어요.`)
        }
        if (!first.stderr.includes('would be overwritten')) {
          throw new GitError(['switch', '--end-of-options', name], first)
        }
        // 겹쳐서 막혔다 — 스펙 원칙: 변경을 보관함에 자동 저장하고 진행한다
        await execGitOrThrow(['stash', 'push', '-u', '-m', AUTO_SHELF_MESSAGE], { cwd })
        await execGitOrThrow(['switch', '--end-of-options', name], { cwd })
        return { autoShelved: true }
      },
    },
    shelf: {
      async save(message) {
        const cwd = await topLevel()
        const result = await execGitOrThrow(['stash', 'push', '-u', '-m', message], { cwd })
        if (result.stdout.includes('No local changes to save')) {
          throw new Error('보관할 변경이 없어요.')
        }
      },
      async list() {
        const cwd = await topLevel()
        const raw = await execGitOrThrow(['stash', 'list', '--format=%gd%x1f%ct%x1f%gs'], { cwd })
        return parseShelf(raw.stdout)
      },
      async restore(ref) {
        const cwd = await topLevel()
        assertShelfRef(ref)
        const result = await execGit(['stash', 'pop', ref], { cwd })
        if (result.exitCode !== 0) {
          // 겹침 — git이 충돌 표시로 적용하고 항목을 보관함에 남긴다 (유실 없음)
          if ((result.stdout + result.stderr).includes('kept in case you need it again')) {
            throw new Error(
              '겹치는 부분이 있어 충돌 표시(!)로 남겨뒀어요. 항목은 보관함에도 그대로 있어요.',
            )
          }
          throw new GitError(['stash', 'pop', ref], result)
        }
      },
      async drop(ref) {
        const cwd = await topLevel()
        assertShelfRef(ref)
        await execGitOrThrow(['stash', 'drop', ref], { cwd })
      },
    },
```

(e) `packages/git-adapter/src/index.ts` 끝에 추가:

```ts
export { parseBranches, parseShelf } from './refs-parser'
```

- [ ] **Step 4: 통과 확인 + 게이트**

Run: `pnpm test && pnpm typecheck`
Expected: **194 tests** PASS (181 + 파서 5 + 통합 8) + 5 Done

- [ ] **Step 5: Commit**

```bash
git add packages/git-adapter/src packages/git-adapter/test packages/domain/src
git commit -m "feat(adapter): 실험 공간 목록·만들기·전환(막히면 자동 보관)과 보관함 왕복

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: IPC — branches·shelf 채널

**Files:**
- Modify: `packages/ipc-contract/src/index.ts`, `apps/desktop/src/main/git-handlers.ts`, `apps/desktop/src/preload/index.ts`

- [ ] **Step 1: contract**

(a) import 타입에 `BranchSummary,`·`ShelfEntry,`·`SwitchResult,` 추가 (알파벳 순서).

(b) `GitApi`의 `repo:` 블록 **뒤**에 추가:

```ts
  branches: {
    list(repoPath: string): Promise<BranchSummary[]>
    /** fromHash는 40자 hex 전체 해시 또는 null(지금 위치에서) */
    create(repoPath: string, name: string, fromHash: string | null): Promise<void>
    switch(repoPath: string, name: string): Promise<SwitchResult>
  }
  shelf: {
    save(repoPath: string, message: string): Promise<void>
    list(repoPath: string): Promise<ShelfEntry[]>
    restore(repoPath: string, ref: string): Promise<void>
    drop(repoPath: string, ref: string): Promise<void>
  }
```

(c) `CHANNELS`에 추가 (`repoStatus` 행 뒤):

```ts
  branchesList: 'branches:list',
  branchesCreate: 'branches:create',
  branchesSwitch: 'branches:switch',
  shelfSave: 'shelf:save',
  shelfList: 'shelf:list',
  shelfRestore: 'shelf:restore',
  shelfDrop: 'shelf:drop',
```

- [ ] **Step 2: main 핸들러**

`apps/desktop/src/main/git-handlers.ts`:

(a) `assertNullableString` **뒤**에 추가:

```ts
/** stash ref 형식만 통과 — 임의 문자열이 stash 명령 인자로 흘러가는 것을 IPC 경계에서 차단 (adapter 검증은 심층 방어) */
function assertShelfRef(value: unknown): string {
  if (typeof value !== 'string' || !/^stash@\{\d{1,6}\}$/.test(value)) {
    throw new Error('잘못된 요청 형식이에요.')
  }
  return value
}

function assertNullableHash(value: unknown): string | null {
  if (value === null) return null
  return assertHash(value)
}
```

(b) `repoStatus` 핸들러 **뒤**에 추가:

```ts
  ipcMain.handle(CHANNELS.branchesList, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).branches.list(),
  )

  ipcMain.handle(
    CHANNELS.branchesCreate,
    (_event, repoPath: unknown, name: unknown, fromHash: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).branches.create(
        assertString(name),
        assertNullableHash(fromHash),
      ),
  )

  ipcMain.handle(CHANNELS.branchesSwitch, (_event, repoPath: unknown, name: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).branches.switch(assertString(name)),
  )

  ipcMain.handle(CHANNELS.shelfSave, (_event, repoPath: unknown, message: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).shelf.save(assertString(message)),
  )

  ipcMain.handle(CHANNELS.shelfList, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).shelf.list(),
  )

  ipcMain.handle(CHANNELS.shelfRestore, (_event, repoPath: unknown, ref: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).shelf.restore(assertShelfRef(ref)),
  )

  ipcMain.handle(CHANNELS.shelfDrop, (_event, repoPath: unknown, ref: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).shelf.drop(assertShelfRef(ref)),
  )
```

- [ ] **Step 3: preload**

`apps/desktop/src/preload/index.ts`의 `repo:` 블록 **뒤**에 추가:

```ts
  branches: {
    list: (repoPath) => ipcRenderer.invoke(CHANNELS.branchesList, repoPath),
    create: (repoPath, name, fromHash) =>
      ipcRenderer.invoke(CHANNELS.branchesCreate, repoPath, name, fromHash),
    switch: (repoPath, name) => ipcRenderer.invoke(CHANNELS.branchesSwitch, repoPath, name),
  },
  shelf: {
    save: (repoPath, message) => ipcRenderer.invoke(CHANNELS.shelfSave, repoPath, message),
    list: (repoPath) => ipcRenderer.invoke(CHANNELS.shelfList, repoPath),
    restore: (repoPath, ref) => ipcRenderer.invoke(CHANNELS.shelfRestore, repoPath, ref),
    drop: (repoPath, ref) => ipcRenderer.invoke(CHANNELS.shelfDrop, repoPath, ref),
  },
```

- [ ] **Step 4: 게이트**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build`
Expected: 194 tests + 5 Done + build

- [ ] **Step 5: Commit**

```bash
git add packages/ipc-contract/src/index.ts apps/desktop/src/main/git-handlers.ts apps/desktop/src/preload/index.ts
git commit -m "feat(ipc): branches·shelf 채널 — 이름은 엔진이, ref 형식은 경계가 검증

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: renderer — store 확장 (branches·shelf·notice)

**Files:**
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`

- [ ] **Step 1: store 수정 (부분 삽입 — 파일 전체 교체 아님)**

(a) import 타입에 `BranchSummary,`·`ShelfEntry,` 추가 (알파벳 순서).

(b) 인터페이스 필드 — `history: CommitSummary[]` 행 **앞**에:

```ts
  branches: BranchSummary[]
  shelf: ShelfEntry[]
```

`error: string | null` 행 **앞**에:

```ts
  /** 안내 배너 — 에러가 아닌 정보(자동 보관 등). 다음 작업 시작 시 지워진다 */
  notice: string | null
```

(c) 인터페이스 액션 — `refresh(): Promise<void>` 행 **뒤**에:

```ts
  /** 실험 공간 전환 — 막히면 엔진이 자동 보관한다. autoShelved면 notice로 안내 */
  switchBranch(name: string): Promise<void>
  /** 새 실험 공간을 만들고 바로 전환한다. fromHash가 있으면 그 시점에서 */
  createBranch(name: string, fromHash: string | null): Promise<void>
  /** 지금 변경을 보관함에 저장한다 */
  shelfSave(): Promise<void>
  shelfRestore(ref: string): Promise<void>
  shelfDrop(ref: string): Promise<void>
```

(d) `fetchSnapshot`을 교체 (branches·shelf 동시 조회):

```ts
/** 상태·역사·실험 공간·보관함을 동시 조회해 같은 렌더에 함께 갱신한다 — 시점 차이를 최소화 (원자 스냅샷은 아님) */
async function fetchSnapshot(
  repoPath: string,
  limit: number,
): Promise<Pick<RepositoryStore, 'status' | 'history' | 'branches' | 'shelf'>> {
  const [status, history, branches, shelf] = await Promise.all([
    git().repo.status(repoPath),
    git().history.list(repoPath, limit),
    git().branches.list(repoPath),
    git().shelf.list(repoPath),
  ])
  return { status, history, branches, shelf }
}
```

(e) `guard`의 `set({ busy: true, error: null })`을 `set({ busy: true, error: null, notice: null })`로 교체.

(f) 초기 상태 — `history: [],` 행 **뒤**에 `branches: [],`·`shelf: [],`, `error: null,` 행 **앞**에 `notice: null,` 추가.

(g) 구현 — `refresh()` 블록 **뒤**에 추가:

```ts
  async switchBranch(name) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      const result = await git().branches.switch(repoPath, name)
      // 다른 공간이다 — 보던 것들을 비우고 역사도 첫 페이지부터
      set({
        historyLimit: HISTORY_LIMIT,
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, HISTORY_LIMIT)),
        notice: result.autoShelved
          ? '저장 안 된 변경이 겹쳐서 보관함에 넣어뒀어요. 오른쪽 위 보관함에서 꺼낼 수 있어요.'
          : null,
      })
    })
  },

  async createBranch(name, fromHash) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().branches.create(repoPath, name, fromHash)
      const result = await git().branches.switch(repoPath, name)
      set({
        historyLimit: HISTORY_LIMIT,
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, HISTORY_LIMIT)),
        notice: result.autoShelved
          ? '저장 안 된 변경이 겹쳐서 보관함에 넣어뒀어요. 오른쪽 위 보관함에서 꺼낼 수 있어요.'
          : null,
      })
    })
  },

  async shelfSave() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().shelf.save(repoPath, '직접 보관')
      set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async shelfRestore(ref) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      // 겹침 에러가 나도 이미 충돌 표시가 적용됐을 수 있다 — finally로 실제 상태를 다시 읽는다
      try {
        await git().shelf.restore(repoPath, ref)
      } finally {
        set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
      }
    })
  },

  async shelfDrop(ref) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().shelf.drop(repoPath, ref)
      set({ ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },
```

- [ ] **Step 2: 게이트**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build`
Expected: 194 tests + 5 Done + build

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/store/repository-store.ts
git commit -m "feat(desktop): store — 실험 공간 전환·생성, 보관함 왕복, notice 배너

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: ui — PromptDialog·ContextMenu

**Files:**
- Create: `apps/desktop/src/renderer/src/ui/PromptDialog.tsx`, `apps/desktop/src/renderer/src/ui/prompt-dialog.css`, `apps/desktop/src/renderer/src/ui/ContextMenu.tsx`, `apps/desktop/src/renderer/src/ui/context-menu.css`

- [ ] **Step 1: PromptDialog**

Create `apps/desktop/src/renderer/src/ui/PromptDialog.tsx`:

```tsx
import { useState } from 'react'
import { Dialog, Heading, Input, Label, Modal, ModalOverlay, TextField } from 'react-aria-components'
import { Button } from './Button'
import './confirm-dialog.css'
import './prompt-dialog.css'

interface PromptDialogProps {
  isOpen: boolean
  title: string
  description: string
  label: string
  placeholder: string
  submitLabel: string
  onSubmit(value: string): void
  onCancel(): void
}

/** 한 줄 입력 다이얼로그 — Enter로 제출, ESC·바깥 클릭은 취소. 닫힐 때 입력을 비운다 */
export function PromptDialog({
  isOpen,
  title,
  description,
  label,
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState('')
  const submit = () => {
    const trimmed = value.trim()
    if (trimmed === '') return
    setValue('')
    onSubmit(trimmed)
  }
  const cancel = () => {
    setValue('')
    onCancel()
  }
  return (
    <ModalOverlay
      className="ui-modal-overlay"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) cancel()
      }}
      isDismissable
    >
      <Modal className="ui-modal">
        <Dialog className="ui-dialog">
          <Heading slot="title" className="ui-dialog__title">
            {title}
          </Heading>
          <p className="ui-dialog__body">{description}</p>
          <TextField
            className="ui-prompt__field"
            value={value}
            onChange={setValue}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
          >
            <Label className="ui-prompt__label">{label}</Label>
            <Input className="ui-prompt__input" placeholder={placeholder} data-testid="prompt-input" />
          </TextField>
          <div className="ui-dialog__actions">
            <Button variant="ghost" size="sm" onPress={cancel} testId="prompt-cancel">
              그만두기
            </Button>
            <Button
              variant="primary"
              size="sm"
              isDisabled={value.trim() === ''}
              onPress={submit}
              testId="prompt-submit"
            >
              {submitLabel}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
```

Create `apps/desktop/src/renderer/src/ui/prompt-dialog.css`:

```css
.ui-prompt__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0 0 var(--space-4);
}
.ui-prompt__label {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-text-muted);
}
.ui-prompt__input {
  font: inherit;
  font-size: var(--text-sm);
  padding: 7px 10px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: var(--color-text);
}
.ui-prompt__input:focus {
  outline: 2px solid var(--color-focus);
  outline-offset: 1px;
}
```

- [ ] **Step 2: ContextMenu**

Create `apps/desktop/src/renderer/src/ui/ContextMenu.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import './context-menu.css'

export interface ContextMenuItem {
  key: string
  label: string
  onSelect(): void
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose(): void
}

/** 우클릭 메뉴 — 바깥 클릭·ESC로 닫힌다. 항목 실행 후에도 닫힌다 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  // 화면 가장자리에서 잘리지 않게 최소한만 보정한다
  const left = Math.min(x, window.innerWidth - 240)
  const top = Math.min(y, window.innerHeight - items.length * 34 - 12)
  return createPortal(
    <div ref={ref} className="ui-context-menu" role="menu" style={{ left, top }}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className="ui-context-menu__item"
          onClick={() => {
            item.onSelect()
            onClose()
          }}
          data-testid={`context-${item.key}`}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
```

Create `apps/desktop/src/renderer/src/ui/context-menu.css`:

```css
.ui-context-menu {
  position: fixed;
  z-index: 120;
  min-width: 200px;
  padding: var(--space-1);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-2);
  display: flex;
  flex-direction: column;
}
.ui-context-menu__item {
  border: none;
  background: none;
  font: inherit;
  font-size: var(--text-sm);
  color: var(--color-text);
  text-align: left;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.ui-context-menu__item:hover {
  background: var(--color-surface-sunken);
}
```

- [ ] **Step 3: 게이트 + Commit**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build`
Expected: 194 tests + 5 Done + build (아직 소비자 없음 — Task 6·7·8에서 배선)

```bash
git add apps/desktop/src/renderer/src/ui
git commit -m "feat(desktop): ui — PromptDialog(한 줄 입력)·ContextMenu(우클릭)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: components — BranchSwitcher·ShelfPopover

**Files:**
- Create: `apps/desktop/src/renderer/src/components/BranchSwitcher.tsx`, `apps/desktop/src/renderer/src/components/branch-switcher.css`, `apps/desktop/src/renderer/src/components/ShelfPopover.tsx`, `apps/desktop/src/renderer/src/components/shelf-popover.css`

- [ ] **Step 1: BranchSwitcher**

Create `apps/desktop/src/renderer/src/components/BranchSwitcher.tsx`:

```tsx
import { Check, ChevronDown, Plus } from 'lucide-react'
import { Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components'
import type { BranchSummary } from '@git-gui/domain'
import { Button } from '../ui/Button'
import { Pictogram } from '../ui/Pictogram'
import { formatRelativeTime } from './relative-time'
import './branch-switcher.css'

interface BranchSwitcherProps {
  branches: BranchSummary[]
  currentName: string | null
  busy: boolean
  onSwitch(name: string): void
  onCreate(): void
}

const NEW_KEY = '__new__'

/** 헤더 실험 공간 스위처 (⑧) — 목록에서 전환하거나 새로 만든다 */
export function BranchSwitcher({ branches, currentName, busy, onSwitch, onCreate }: BranchSwitcherProps) {
  return (
    <MenuTrigger>
      <Button variant="ghost" size="sm" isDisabled={busy} testId="header-branch">
        <Pictogram kind="branch" size={13} label="실험 공간 (branch)" />
        {currentName ?? '(브랜치 없음)'}
        <ChevronDown size={12} aria-hidden="true" />
      </Button>
      <Popover className="branch-switcher__popover">
        <Menu
          className="branch-switcher__menu"
          onAction={(key) => {
            if (key === NEW_KEY) onCreate()
            else if (key !== currentName) onSwitch(String(key))
          }}
        >
          {branches.map((branch) => (
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
              <span className="branch-switcher__name">{branch.name}</span>
              <span className="branch-switcher__time">
                {formatRelativeTime(branch.committedAt, Date.now())}
              </span>
            </MenuItem>
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
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
```

Create `apps/desktop/src/renderer/src/components/branch-switcher.css`:

```css
.branch-switcher__popover {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-2);
  min-width: 240px;
}
.branch-switcher__menu {
  padding: var(--space-1);
  max-height: 320px;
  overflow-y: auto;
  outline: none;
}
.branch-switcher__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  cursor: pointer;
  outline: none;
}
.branch-switcher__item[data-focused] {
  background: var(--color-surface-sunken);
}
.branch-switcher__check {
  width: 14px;
  flex: none;
  color: var(--color-accent);
  display: inline-flex;
}
.branch-switcher__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.branch-switcher__time {
  flex: none;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
.branch-switcher__item--new {
  border-top: 1px solid var(--color-border);
  border-radius: 0 0 var(--radius-sm) var(--radius-sm);
  color: var(--color-accent);
  font-weight: 600;
}
```

- [ ] **Step 2: ShelfPopover**

Create `apps/desktop/src/renderer/src/components/ShelfPopover.tsx`:

```tsx
import { Archive } from 'lucide-react'
import { useState } from 'react'
import { Dialog, DialogTrigger, Popover } from 'react-aria-components'
import type { ShelfEntry } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { formatRelativeTime } from './relative-time'
import './shelf-popover.css'

interface ShelfPopoverProps {
  shelf: ShelfEntry[]
  busy: boolean
  onSave(): void
  onRestore(ref: string): void
  onDrop(ref: string): void
}

/** 보관함 (스펙 E1) — 잠시 치워 둔 변경을 보고 꺼내거나 버린다. 전환 자동 보관도 여기로 온다 */
export function ShelfPopover({ shelf, busy, onSave, onRestore, onDrop }: ShelfPopoverProps) {
  const [dropTarget, setDropTarget] = useState<ShelfEntry | null>(null)
  return (
    <>
      <DialogTrigger>
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
                    <div className="shelf-popover__meta">
                      <span className="shelf-popover__message" title={entry.message}>
                        {entry.message}
                      </span>
                      <span className="shelf-popover__time">
                        {formatRelativeTime(entry.savedAt, Date.now())}
                      </span>
                    </div>
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

Create `apps/desktop/src/renderer/src/components/shelf-popover.css`:

```css
.shelf-popover {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-2);
  width: 380px;
}
.shelf-popover__dialog {
  outline: none;
  padding: var(--space-3);
}
.shelf-popover__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  font-size: var(--text-sm);
  font-weight: 600;
  margin-bottom: var(--space-2);
}
.shelf-popover__empty {
  margin: 0;
  padding: var(--space-4) 0;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  text-align: center;
}
.shelf-popover__list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 280px;
  overflow-y: auto;
}
.shelf-popover__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 0;
  border-top: 1px solid var(--color-border);
}
.shelf-popover__meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.shelf-popover__message {
  font-size: var(--text-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.shelf-popover__time {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
```

- [ ] **Step 3: 게이트 + Commit**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build`
Expected: 194 tests + 5 Done + build

```bash
git add apps/desktop/src/renderer/src/components
git commit -m "feat(desktop): 헤더 실험 공간 스위처·보관함 팝오버

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: HistoryPanel 우클릭 + App 배선 + notice 배너

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/HistoryPanel.tsx`, `apps/desktop/src/renderer/src/App.tsx`, `apps/desktop/src/renderer/src/layout.css`

- [ ] **Step 1: HistoryPanel — 우클릭 메뉴 (⑦ 1차분)**

(a) import: `import { useEffect, useRef } from 'react'` → `import { useEffect, useRef, useState } from 'react'`, 그리고 `import { Badge } from '../ui/Badge'` 행 **앞**에:

```tsx
import { ContextMenu } from '../ui/ContextMenu'
```

(b) `HistoryPanelProps`에 `onLoadMore(): void` 행 **뒤**로 추가:

```tsx
  /** 우클릭 → "여기서 실험 공간 만들기" — 해시를 넘긴다 (⑦) */
  onCreateBranchAt(hash: string): void
```

그리고 함수 파라미터 구조 분해의 `onLoadMore,` 뒤에 `onCreateBranchAt,` 추가.

(c) `const truncated = …` 행 **앞**에 상태 추가:

```tsx
  const [menu, setMenu] = useState<{ x: number; y: number; commit: CommitSummary } | null>(null)
```

(d) 행 `<button …>`의 `onClick` 행 **뒤**에 추가:

```tsx
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setMenu({ x: event.clientX, y: event.clientY, commit })
                    }}
```

(e) `</Panel>` 닫기 **직전**(빈 상태/목록 분기 뒤)에 추가:

```tsx
      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            {
              key: 'branch-here',
              label: '여기서 실험 공간 만들기…',
              onSelect: () => onCreateBranchAt(menu.commit.hash),
            },
            {
              key: 'copy-hash',
              label: `해시 복사 (${menu.commit.shortHash})`,
              onSelect: () => {
                void navigator.clipboard.writeText(menu.commit.hash)
              },
            },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
```

- [ ] **Step 2: App 배선**

(a) import 추가 — `import { ChangesPanel } …` 행 **앞**에:

```tsx
import { BranchSwitcher } from './components/BranchSwitcher'
```

`import { RepoPicker } …` 행 **뒤**에:

```tsx
import { ShelfPopover } from './components/ShelfPopover'
```

`import { Pictogram } from './ui/Pictogram'` 행 **뒤**에:

```tsx
import { PromptDialog } from './ui/PromptDialog'
```

(`Pictogram` import는 유지 — app__state에서 계속 쓴다.)

(b) `const [rightWidth, …` 블록 **앞**에 상태 추가:

```tsx
  // 새 실험 공간 다이얼로그 — fromHash가 있으면 우클릭한 저장 시점에서 갈라진다
  const [branchPrompt, setBranchPrompt] = useState<{ fromHash: string | null } | null>(null)
```

(c) 헤더의 `app__branch` span 블록(`<span className="app__branch" …>…</span>`)을 다음으로 교체:

```tsx
            <BranchSwitcher
              branches={store.branches}
              currentName={status.branch.name}
              busy={store.busy}
              onSwitch={(name) => void store.switchBranch(name)}
              onCreate={() => setBranchPrompt({ fromHash: null })}
            />
```

(d) `app__actions`의 테마 토글 버튼 **앞**에 추가:

```tsx
          <ShelfPopover
            shelf={store.shelf}
            busy={store.busy}
            onSave={() => void store.shelfSave()}
            onRestore={(ref) => void store.shelfRestore(ref)}
            onDrop={(ref) => void store.shelfDrop(ref)}
          />
```

(e) error 배너 블록 **뒤**에 notice 배너 추가:

```tsx
      {store.notice && (
        <p className="app__notice" role="status" data-testid="notice">
          {store.notice}
        </p>
      )}
```

(f) HistoryPanel에 prop 추가 (`onLoadMore` 행 뒤):

```tsx
            onCreateBranchAt={(hash) => setBranchPrompt({ fromHash: hash })}
```

(g) `</main>` **뒤**, 루트 `</div>` **앞**에 다이얼로그 추가:

```tsx
      <PromptDialog
        isOpen={branchPrompt !== null}
        title="새 실험 공간 만들기"
        description={
          branchPrompt?.fromHash != null
            ? '우클릭한 저장 시점에서 갈라져 나와요. 만들면 바로 그 공간으로 이동해요.'
            : '지금 위치에서 갈라져 나와요. 만들면 바로 그 공간으로 이동해요.'
        }
        label="이름"
        placeholder="예: try-new-design"
        submitLabel="만들고 이동"
        onSubmit={(name) => {
          const fromHash = branchPrompt?.fromHash ?? null
          setBranchPrompt(null)
          void store.createBranch(name, fromHash)
        }}
        onCancel={() => setBranchPrompt(null)}
      />
```

- [ ] **Step 3: layout.css — notice 배너**

`.app__error` 블록 **뒤**에 추가:

```css
.app__notice {
  margin: 0;
  padding: var(--space-2) var(--space-5);
  background: var(--term-badge-bg);
  color: var(--term-badge);
  font-size: var(--text-sm);
  flex: none;
}
```

- [ ] **Step 4: 게이트 + Commit**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: 194 tests + 5 Done + build + **E2E 10 passed** (기존 회귀 없음)

```bash
git add apps/desktop/src/renderer/src
git commit -m "feat(desktop): 스위처·보관함·우클릭 배선 + notice 배너 (⑦·⑧)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: E2E — 실험 공간·보관함 4종

**Files:**
- Test: `apps/desktop/e2e/smoke.spec.ts`

- [ ] **Step 1: 실패하는 E2E 4개**

`apps/desktop/e2e/smoke.spec.ts` 끝에 추가:

```ts
test('실험 공간을 만들고 바로 이동한다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('header-branch').click()
    await window.getByTestId('branch-new').click()
    await window.getByTestId('prompt-input').fill('exp-1')
    await window.getByTestId('prompt-submit').click()
    await expect(window.getByTestId('header-branch')).toContainText('exp-1')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('전환이 막히면 변경을 보관함에 자동 보관하고 이동한다', async () => {
  const repo = await createRepoWithChange()
  // 대상 브랜치의 app.txt가 다르도록 — 전환이 막히는 조건을 만든다
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'other'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'other\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'other side'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'mine\n')
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('unstaged-count')).toHaveText('1')
    await window.getByTestId('header-branch').click()
    await window.getByTestId('branch-item-other').click()
    await expect(window.getByTestId('header-branch')).toContainText('other')
    await expect(window.getByTestId('notice')).toContainText('보관함')
    await expect(window.getByTestId('shelf-count')).toHaveText('1')
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('우클릭한 저장 시점에서 실험 공간을 만든다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '두 번째 저장'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-count')).toHaveText('2')
    // 가장 오래된(root) 커밋에서 갈라진다
    await window.locator('[data-testid^="history-item-"]').last().click({ button: 'right' })
    await window.getByTestId('context-branch-here').click()
    await window.getByTestId('prompt-input').fill('from-root')
    await window.getByTestId('prompt-submit').click()
    await expect(window.getByTestId('header-branch')).toContainText('from-root')
    // root 시점으로 이동했으므로 역사는 1개
    await expect(window.getByTestId('history-count')).toHaveText('1')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('변경을 보관함에 넣었다 꺼낸다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('unstaged-count')).toHaveText('1')
    await window.getByTestId('shelf-open').click()
    await window.getByTestId('shelf-save').click()
    await expect(window.getByTestId('shelf-count')).toHaveText('1')
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')
    // 스냅샷 갱신으로 팝오버가 닫혔을 수 있다 — 다시 연다
    await window.getByTestId('shelf-open').click()
    await window.getByTestId('shelf-restore-stash@{0}').click()
    await expect(window.getByTestId('unstaged-count')).toHaveText('1')
    await expect(window.getByTestId('shelf-count')).toHaveText('0')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Red 확인 → 전체 게이트**

Run: `cd apps/desktop && pnpm e2e`
Expected: 구현 전 기준이면 신규 4개 FAIL — 이 플랜 순서상 구현이 끝난 뒤이므로, Red는 Task 7 배선 **직전** 시점(HEAD)에 스펙만 얹어 실증하거나, 핵심 testid(`branch-new`) 임시 오타 변이로 검출력을 실증한다. 실증 후 원복.

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: **194 tests + typecheck 5 + build + E2E 14 passed** — 전부 exit 0

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts
git commit -m "test(desktop): E2E — 실험 공간 만들기·자동 보관 전환·우클릭 생성·보관함 왕복

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 최종 게이트 + 스크린샷 + README

- [ ] **Step 1: 전체 게이트**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: 194 tests + typecheck 5 + build + **E2E 14 passed** — 전부 exit 0

- [ ] **Step 2: 스크린샷 3장** (일회성 스크립트, 커밋 미포함, 1440×900 — **스크린샷 생성 후에는 playwright/e2e를 다시 실행하지 말 것**: test-results/가 비워진다. 사본을 스크래치패드에도 남긴다)

- (a) `e1a-switcher.png` — 브랜치 스위처 열림(브랜치 3개·현재 체크·새 실험 공간 항목) + 레인 그래프 배경
- (b) `e1a-autoshelf.png` — 막힌 전환 직후: notice 배너("보관함에 넣어뒀어요") + 보관함 팝오버 열림(항목 1)
- (c) `e1a-context-menu.png` — 히스토리 행 우클릭 메뉴 열림(여기서 실험 공간 만들기·해시 복사)

- [ ] **Step 3: README "현재 상태" 갱신**

나열 문장에서 "저장된 역사 타임라인(" 앞에 "실험 공간(branch) 전환·만들기(헤더 스위처·우클릭, 막히면 보관함 자동 보관), 보관함(stash) 넣기/꺼내기/버리기, "를 추가한다.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README — E1a 실험 공간·보관함 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 검증 게이트 요약

| 시점 | 기대치 |
| --- | --- |
| Task 1 후 | 186 tests (181 + 파서 5) |
| Task 2 후 | +8 (branches·shelf 통합) → **194 tests** |
| Task 7 후 | E2E 10 (기존 회귀 없음) |
| Task 8 후 | **E2E 14** |
| 최종 | 194 tests + typecheck 5 + build + E2E 14 — 전부 exit 0 |

(수치가 어긋나면 커밋 메시지가 아니라 이 표를 갱신한다 — 본질은 "전부 PASS + 신규 테스트 실존".)

## 후속 노트 (E1b 이관 후보)

- 실험 공간 삭제·이름 바꾸기, 우클릭 메뉴 확장(이 시점으로 되돌리기 revert 등 — 되돌리기 엔진 필요)
- 실험 공간 합치기(merge)·스마트 병합(스펙: 커밋 안 된 변경 자동 보관 후 병합)·충돌 해결 뷰
- pull/fetch(가져오기)와 non-ff 친절화
- detached HEAD에서 스위처로 복귀하는 흐름(현재는 "(브랜치 없음)" 표시만)
