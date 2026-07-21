# E5a 파일 단위 작업(우클릭) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) 구문으로 추적한다.

**Goal:** 커밋 상세·보관함 미리보기의 파일 행과 좌측 변경 목록의 파일 행에 우클릭 메뉴를 달아, 파일 단위로 "이 파일만 지금 코드에 적용(checkout)"·"지금 코드와 비교(diff)"·"올리기/내리기/되돌리기/삭제"를 제공한다.

**Architecture:** git-adapter에 엔진 3개(`commits.restoreFile` — 파일 단위 자동 보관 후 checkout, `commits.diffAgainstWorktree` — 워크트리 대비 diff, `changes.removeFile` — 가드 후 fs rm)를 기존 관례(`:(literal)` pathspec·`--end-of-options`·친절 에러·assertFullHash·assertRepoRelative) 그대로 추가하고, IPC 3채널을 뚫는다. store에는 액션 3개와 최소 상태 1개(`diffLabel: string | null` — 공용 diff 슬롯의 제목 덮어쓰기)만 더한다. UI는 CommitDetailPanel·ChangesPanel이 각자 ContextMenu(HistoryPanel 관례)와 확인창을 관리한다.

**Tech Stack:** 기존 그대로 — TypeScript, Electron(main/preload/renderer), zustand, vitest, Playwright(Electron E2E).

**기준 커밋:** `feature/e5a-file-actions` = `85e288a`. 기준선 실측: 단위 **300 tests**(26 files), E2E **35**(smoke 29 + hosting 6).

## 사용자 피드백 원문 대응표

| # | 피드백 원문 | 태스크 |
| --- | --- | --- |
| 1 | "우측 트리에서 스테시나, 트리 클릭해서 나오는 파일들에서도 우클릭해서 이 파일만 지금 코드에 적용 같은 기능도 있었으면 좋겠어." | Task 1(엔진)·Task 6(UI) — 보관함 미리보기는 CommitDetailPanel 재사용이라 메뉴가 자동으로 생기고, 라벨만 "이 파일만 꺼내 적용"으로 분기 |
| 2 | "좌측 리스트에서도 똑같이 파일 우클릭하면 이 파일만 되돌리기, 이 파일만 올리기, 삭제, 로컬과 비교 등도 있었으면 좋겠어" | Task 3(삭제 엔진)·Task 7(UI — 올리기·내리기·되돌리기·삭제. "로컬과 비교"는 좌측 행 클릭=기존 diff가 이미 그 기능이라 메뉴 중복 없이 유지) |
| 6(일부) | "로컬과 비교하는 기능도 있었으면 좋겠어. 커밋안된 로컬이랑 비교" | Task 2(엔진)·Task 6(UI — 커밋 상세 파일 우클릭 → "지금 코드와 비교 (diff)", 워크트리(미저장 포함) 대비) |

## 사전 실측 기록 (2026-07-21, git 로컬 프로브)

플랜 지시의 실측 요구 ①②를 포함해, 설계가 기대는 git 동작을 전부 실측했다. 프로브 저장소: scratchpad `/probe`.

1. **파일 단위 stash가 staged-only 변경도 보관하는가 → 예.** `a.txt`를 staged-only(`1 M.`)로 만들고 `git stash push -u -m 'probe' -- ':(literal)a.txt'` → exit 0, 워크트리가 HEAD 내용으로 복귀, `git stash show -p`에 staged 내용(`+staged-only`)이 담김. **따라서 dirty 판정은 "status에 그 파일 행이 있으면"으로 충분하다** — staged/unstaged/untracked 모두 한 갈래로 처리한다(untracked도 `-u`로 보관됨을 별도 실측).
2. **커밋에 없는 파일 checkout의 stderr** — `git checkout --end-of-options <hash> -- ':(literal)c.txt'` → exit 1, stderr `error: pathspec ':(literal)c.txt' did not match any file(s) known to git`. 단, **stash 후 checkout이 실패하면 사용자 변경만 보관함으로 사라지는 흐름**이 되므로, checkout stderr 매칭 대신 **`git ls-tree -r <hash> -- pathspec` 사전 검사**(빈 출력 = 그 시점에 없음)로 앞당긴다. checkout stderr 매칭은 심층 방어로 남기지 않는다(사전 검사가 동일 조건을 selessness 없이 커버 — GitError 전파로 충분).
3. **존재하지 않는 해시** — `ls-tree`: exit 128, stderr `fatal: not a tree object`(0000…·deadbeef… 동일). `diff <hash> --`: exit 128, stderr `fatal: bad object <hash>`. 각각 부분 문구로 잡아 `MISSING_COMMIT_MESSAGE`로 변환한다.
4. **`git checkout <hash> -- <path>`는 index와 워크트리를 함께 갱신한다** — 적용 후 status가 `1 M.`(staged 수정)로 잡힌다. 즉 적용 결과는 좌측 "저장 예정(staged)"에 나타난다(HEAD와 같은 내용이면 깨끗). stash 항목의 커밋 해시로도 동일하게 동작한다(파일 단위 꺼내기).
5. **워크트리 대비 diff** — `git diff -M --no-color --no-ext-diff --end-of-options <hash> -- ':(literal)a.txt'`가 커밋 시점 vs 지금 워크트리(미저장 포함)의 patch를 준다. 그 시점에 없던(이후 추가된 tracked) 파일은 "new file"로 나온다. 한계: **untracked 파일은 이 diff에 나타나지 않는다** — 비교 메뉴는 커밋 상세(그 시점에 존재하는 파일 목록)에서만 제공하므로 문제되지 않는다(후속 노트에 기록).
6. **status pathspec 판정** — `git status --porcelain=v2 -uall -z -- ':(literal)<path>'`는 깨끗하면 빈 출력, 변경이 있으면 그 파일 행만 출력한다(`--branch` 없이 쓰면 헤더도 없다).

---

### Task 1: 엔진 — `commits.restoreFile` (이 파일만 그 시점 내용으로 적용)

**Files:**
- Modify: `packages/domain/src/repository.ts` (RestoreFileResult 추가)
- Modify: `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts`

- [ ] **Step 1: 실패하는 테스트 7건** — `packages/git-adapter/test/client.test.ts`

먼저 import 한 줄 수정 (`readFile` 추가). 기존:

```ts
import { mkdir, mkdtemp, symlink, unlink } from 'node:fs/promises'
```

교체:

```ts
import { mkdir, mkdtemp, readFile, symlink, unlink } from 'node:fs/promises'
```

그리고 `it('discard — 충돌 중인 파일은 읽히는 메시지로 거부한다 (이관)', async () => {` 블록 **앞**에 다음 테스트를 추가:

```ts
  it('restoreFile — 깨끗한 파일에 그 시점 내용을 적용한다 (적용 결과는 staged로 보인다)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# v2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v2'], { cwd: repo })
    const initHash = (
      await execGitOrThrow(['rev-list', '--max-parents=0', 'HEAD'], { cwd: repo })
    ).stdout.trim()

    const result = await client.commits.restoreFile(initHash, 'README.md')
    expect(result).toEqual({ autoShelved: false })
    // 디스크 실측 — 그 시점(init) 내용으로 바뀌었다
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('# fixture\n')
    // checkout은 index도 함께 갱신한다(실측) — 적용 결과가 staged로 보인다
    const status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'README.md')?.staged).toBe('modified')
    expect(await client.shelf.list()).toEqual([])
  })

  it('restoreFile — 미저장(unstaged) 변경이 있으면 보관함에 자동 보관 후 적용한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# v2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v2'], { cwd: repo })
    const initHash = (
      await execGitOrThrow(['rev-list', '--max-parents=0', 'HEAD'], { cwd: repo })
    ).stdout.trim()
    await writeFixtureFile(repo, 'README.md', '# 작업 중\n')

    const result = await client.commits.restoreFile(initHash, 'README.md')
    expect(result).toEqual({ autoShelved: true })
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('# fixture\n')
    const shelf = await client.shelf.list()
    expect(shelf).toHaveLength(1)
    expect(shelf[0]!.message).toContain('파일 적용 자동 보관')
    // 사라질 뻔한 내용이 보관 항목에 실제로 담겨 있다 (커밋 상세 재사용으로 검증)
    const detail = await client.commits.show(shelf[0]!.hash)
    expect(detail.files.map((f) => f.path)).toContain('README.md')
  })

  it('restoreFile — staged-only 변경도 파일 단위 자동 보관에 담긴다 (실측 근거 고정)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# v2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v2'], { cwd: repo })
    const initHash = (
      await execGitOrThrow(['rev-list', '--max-parents=0', 'HEAD'], { cwd: repo })
    ).stdout.trim()
    // staged-only 상태(1 M.) — 워크트리·index 모두 새 내용, 커밋만 안 됨
    await writeFixtureFile(repo, 'README.md', '# staged 작업\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })

    const result = await client.commits.restoreFile(initHash, 'README.md')
    expect(result).toEqual({ autoShelved: true })
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('# fixture\n')
    // 파일 단위 stash push가 staged 내용을 담았다(실측: 사전 프로브와 동일)
    const shown = await execGitOrThrow(['stash', 'show', '-p', 'stash@{0}'], { cwd: repo })
    expect(shown.stdout).toContain('+# staged 작업')
  })

  it('restoreFile — 그 시점에 없는 파일은 친절 에러, dirty 변경이 보관함으로 사라지지 않는다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    const initHash = (
      await execGitOrThrow(['rev-list', '--max-parents=0', 'HEAD'], { cwd: repo })
    ).stdout.trim()
    await writeFixtureFile(repo, 'new.txt', 'work\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'add new'], { cwd: repo })
    await writeFixtureFile(repo, 'new.txt', 'dirty\n')

    await expect(client.commits.restoreFile(initHash, 'new.txt')).rejects.toThrow(
      /그 시점에는 이 파일이 없어요/,
    )
    // 사전 검사 순서 보장 — 실패했는데 변경만 보관함으로 사라지면 안 된다
    expect(await client.shelf.list()).toEqual([])
    expect(await readFile(join(repo, 'new.txt'), 'utf8')).toBe('dirty\n')
  })

  it('restoreFile — 사라진 커밋·잘못된 해시·저장소 밖 경로를 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(
      client.commits.restoreFile('0123456789012345678901234567890123456789', 'README.md'),
    ).rejects.toThrow(/그 저장 시점을 찾을 수 없어요/)
    // 패턴 필수 — 가드가 없으면 'HEAD~' 같은 ref 표현식이 checkout 인자로 흘러간다
    await expect(client.commits.restoreFile('HEAD', 'README.md')).rejects.toThrow(
      /올바른 커밋 해시가 아니에요/,
    )
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await expect(client.commits.restoreFile(head, '../outside.txt')).rejects.toThrow(
      /저장소 밖 경로/,
    )
  })

  it('restoreFile — 충돌 중인 파일은 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()

    // checkout이 index를 덮어 충돌이 "해소된 것처럼" 위장되는 것을 막는다 (discard 가드와 동일 계열)
    await expect(client.commits.restoreFile(head, 'README.md')).rejects.toThrow(/충돌 화면에서/)
  })

  it('restoreFile — 보관함 항목 해시로 그 파일만 꺼내 적용한다 (항목은 보관함에 남는다)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# shelved\n')
    await client.shelf.save('부분 꺼내기 대상')
    const shelf = await client.shelf.list()

    const result = await client.commits.restoreFile(shelf[0]!.hash, 'README.md')
    expect(result).toEqual({ autoShelved: false })
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('# shelved\n')
    // pop이 아니라 파일 단위 적용 — 항목은 그대로 남는다
    expect(await client.shelf.list()).toHaveLength(1)
  })
```

- [ ] **Step 2: Red 확인** — `cd packages/git-adapter && npx vitest run test/client.test.ts -t restoreFile` → **7건 FAIL** (`client.commits.restoreFile is not a function`)

- [ ] **Step 3: domain 타입** — `packages/domain/src/repository.ts`의 `/** 실험 공간 합치기 결과 */` 줄 **앞**에 추가:

```ts
/** 파일 하나를 특정 시점 내용으로 적용한 결과 — 자동 보관이 개입했으면 UI가 보관함 위치를 안내한다 */
export interface RestoreFileResult {
  autoShelved: boolean
}

```

- [ ] **Step 4: 구현** — `packages/git-adapter/src/client.ts`

(1) import에 타입 추가 — 기존:

```ts
  type RepositoryStatus,
```

교체:

```ts
  type RepositoryStatus,
  type RestoreFileResult,
```

(2) GitClient 인터페이스 commits — 기존:

```ts
    diffFile(hash: string, path: string, origPath: string | null): Promise<FileDiff>
```

교체:

```ts
    diffFile(hash: string, path: string, origPath: string | null): Promise<FileDiff>
    /**
     * 이 파일만 그 시점(hash) 내용으로 적용한다(checkout — index·워크트리 동시 갱신, 실측).
     * 파일에 미저장 변경이 있으면 먼저 파일 단위로 보관함에 자동 보관한다(§6 — staged-only도 담긴다, 실측).
     * 보관함 항목의 커밋 해시로도 동작한다(파일 단위 꺼내기). 충돌 파일·그 시점에 없는 파일은 거부
     */
    restoreFile(hash: string, path: string): Promise<RestoreFileResult>
```

(3) 상수 — 기존:

```ts
const REVERT_SHELF_MESSAGE = '저장 되돌리기 자동 보관'
```

교체:

```ts
const REVERT_SHELF_MESSAGE = '저장 되돌리기 자동 보관'

/** 파일 단위 적용이 미저장 변경을 덮기 전 자동 보관할 때의 보관함 메시지 */
const RESTORE_FILE_SHELF_MESSAGE = '파일 적용 자동 보관'
```

(4) 구현 본체 — `      async revert(hash) {` 줄 **앞**에 추가:

```ts
      async restoreFile(hash, path) {
        const cwd = await topLevel()
        assertFullHash(hash)
        assertRepoRelative(path)
        // 충돌(unmerged) 파일 가드 — checkout이 index를 덮어 충돌이 해소된 것처럼 위장된다 (discard 가드와 동일 계열)
        const unmerged = await execGitOrThrow(['ls-files', '-u', '--', `:(literal)${path}`], { cwd })
        if (unmerged.stdout.trim() !== '') {
          throw new Error(
            '충돌 중인 파일은 다른 시점 내용으로 덮을 수 없어요. 충돌 화면에서 한쪽을 고르거나 병합을 취소해 주세요.',
          )
        }
        // 사전 검사 — stash 후 checkout이 실패하면 사용자 변경만 보관함으로 사라진다.
        // 그 시점에 파일이 있는지(ls-tree)와 해시 존재를 먼저 확인한다 (실측: 없는 해시는 'not a tree object')
        const treeArgs = ['ls-tree', '-r', '--end-of-options', hash, '--', `:(literal)${path}`]
        const tree = await execGit(treeArgs, { cwd })
        if (tree.exitCode !== 0) {
          if (tree.stderr.includes('not a tree object')) {
            throw new Error(MISSING_COMMIT_MESSAGE)
          }
          throw new GitError(treeArgs, tree)
        }
        if (tree.stdout.trim() === '') {
          throw new Error('그 시점에는 이 파일이 없어요.')
        }
        // dirty 판정 — staged/unstaged/untracked 어느 쪽이든 status가 이 파일 행을 낸다.
        // 파일 단위 stash push는 staged-only 변경도 함께 보관한다 (플랜 서두 실측 기록 1)
        const dirty = await execGitOrThrow(
          ['status', '--porcelain=v2', '-uall', '-z', '--', `:(literal)${path}`],
          { cwd },
        )
        const autoShelved = dirty.stdout.trim() !== ''
        if (autoShelved) {
          // 스펙 원칙(§6): 덮기 전 자동 보관 — switch/merge/pull/revert와 동일 패턴의 파일 단위 판
          await execGitOrThrow(
            ['stash', 'push', '-u', '-m', RESTORE_FILE_SHELF_MESSAGE, '--', `:(literal)${path}`],
            { cwd },
          )
        }
        await execGitOrThrow(['checkout', '--end-of-options', hash, '--', `:(literal)${path}`], {
          cwd,
        })
        return { autoShelved }
      },
```

- [ ] **Step 5: Green 확인** — `cd packages/git-adapter && npx vitest run test/client.test.ts -t restoreFile` → **7건 PASS**

- [ ] **Step 6: 전체 게이트 + Commit** — 루트 `pnpm test` → **307 passed** (300+7)

```bash
git add packages/domain/src/repository.ts packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(git-adapter): commits.restoreFile — 이 파일만 그 시점 내용으로 적용 (파일 단위 자동 보관)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 엔진 — `commits.diffAgainstWorktree` (지금 코드와 비교)

**Files:**
- Modify: `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts`

- [ ] **Step 1: 실패하는 테스트 3건** — Task 1에서 추가한 `it('restoreFile — 보관함 항목 해시로 그 파일만 꺼내 적용한다 (항목은 보관함에 남는다)', …)` 블록 **뒤**에 추가:

```ts
  it('diffAgainstWorktree — 그 시점과 지금 코드(미저장 포함)의 차이를 반환한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    const initHash = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    // 커밋하지 않은 워크트리 편집 그대로 비교된다 — "커밋 안 된 로컬이랑 비교" (피드백 6)
    await writeFixtureFile(repo, 'README.md', '# 지금 작업\n')

    const diff = await client.commits.diffAgainstWorktree(initHash, 'README.md', null)
    const lines = diff.hunks.flatMap((hunk) => hunk.lines)
    expect(lines).toContainEqual({ kind: 'del', oldLine: 1, newLine: null, text: '# fixture' })
    expect(lines).toContainEqual({ kind: 'add', oldLine: null, newLine: 1, text: '# 지금 작업' })
  })

  it('diffAgainstWorktree — 그 시점에 없던(이후 추가된) 파일은 새 파일로 보인다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    const initHash = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await writeFixtureFile(repo, 'new.txt', 'hello\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'add new'], { cwd: repo })

    const diff = await client.commits.diffAgainstWorktree(initHash, 'new.txt', null)
    expect(diff.hunks.flatMap((h) => h.lines).some((l) => l.kind === 'add' && l.text === 'hello')).toBe(
      true,
    )
  })

  it('diffAgainstWorktree — 사라진 커밋·잘못된 해시·저장소 밖 경로를 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(
      client.commits.diffAgainstWorktree(
        '0123456789012345678901234567890123456789',
        'README.md',
        null,
      ),
    ).rejects.toThrow(/그 저장 시점을 찾을 수 없어요/)
    await expect(client.commits.diffAgainstWorktree('HEAD', 'README.md', null)).rejects.toThrow(
      /올바른 커밋 해시가 아니에요/,
    )
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await expect(client.commits.diffAgainstWorktree(head, '../x', null)).rejects.toThrow(
      /저장소 밖 경로/,
    )
  })
```

- [ ] **Step 2: Red 확인** — `cd packages/git-adapter && npx vitest run test/client.test.ts -t diffAgainstWorktree` → **3건 FAIL**

- [ ] **Step 3: 구현** — `packages/git-adapter/src/client.ts`

(1) 인터페이스 — Task 1에서 넣은 `    restoreFile(hash: string, path: string): Promise<RestoreFileResult>` 줄 **뒤**에 추가:

```ts
    /** 그 시점(hash)과 지금 워크트리(미저장 포함)의 단일 파일 diff — diffFile(부모 대비)의 형제. rename이면 origPath 동봉 */
    diffAgainstWorktree(hash: string, path: string, origPath: string | null): Promise<FileDiff>
```

(2) 구현 본체 — Task 1에서 넣은 restoreFile 구현의 닫는 `      },` 바로 **뒤**(= `      async revert(hash) {` 앞)에 추가:

```ts
      async diffAgainstWorktree(hash, path, origPath) {
        const cwd = await topLevel()
        assertFullHash(hash)
        assertRepoRelative(path)
        if (origPath != null) assertRepoRelative(origPath)
        // diffFile과 동일 — rename 감지를 위해 원래 경로도 pathspec에 넣는다
        const pathspecs =
          origPath != null ? [`:(literal)${path}`, `:(literal)${origPath}`] : [`:(literal)${path}`]
        const args = [
          'diff',
          '-M',
          '--no-color',
          '--no-ext-diff',
          '--end-of-options',
          hash,
          '--',
          ...pathspecs,
        ]
        const result = await execGit(args, { cwd })
        if (result.exitCode !== 0) {
          // 실측 stderr: "fatal: bad object <hash>" — 사라진(존재하지 않는) 해시
          if (result.stderr.includes('bad object')) {
            throw new Error(MISSING_COMMIT_MESSAGE)
          }
          throw new GitError(args, result)
        }
        return parsePatch(result.stdout)
      },
```

- [ ] **Step 4: Green 확인** — `cd packages/git-adapter && npx vitest run test/client.test.ts -t diffAgainstWorktree` → **3건 PASS**

- [ ] **Step 5: 전체 게이트 + Commit** — 루트 `pnpm test` → **310 passed**

```bash
git add packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(git-adapter): commits.diffAgainstWorktree — 그 시점과 지금 코드 비교 (피드백 6)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 엔진 — `changes.removeFile` (파일 삭제)

**Files:**
- Modify: `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts`

- [ ] **Step 1: 실패하는 테스트 4건** — Task 2에서 추가한 `it('diffAgainstWorktree — 사라진 커밋·잘못된 해시·저장소 밖 경로를 거부한다', …)` 블록 **뒤**에 추가:

```ts
  it('removeFile — tracked 파일을 디스크에서 지우고 삭제 변경으로 잡힌다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.changes.removeFile('README.md')
    expect(existsSync(join(repo, 'README.md'))).toBe(false)
    const status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'README.md')?.unstaged).toBe('deleted')
  })

  it('removeFile — untracked 파일은 지우면 목록에서 사라진다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'junk.txt', 'j\n')
    await client.changes.removeFile('junk.txt')
    expect(existsSync(join(repo, 'junk.txt'))).toBe(false)
    expect((await client.repo.status()).changes).toEqual([])
  })

  it('removeFile — 없는 파일·디렉터리·심볼릭 링크·밖 경로를 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.changes.removeFile('ghost.txt')).rejects.toThrow(/이미 없는 파일이에요/)
    await mkdir(join(repo, 'sub'))
    await expect(client.changes.removeFile('sub')).rejects.toThrow(/폴더는/)
    // 저장소 밖을 가리키는(끊어진 것 포함) 링크 — readText와 동일 계열로 거부한다
    await symlink(join(tmpdir(), 'no-such-target'), join(repo, 'link'))
    await expect(client.changes.removeFile('link')).rejects.toThrow(/링크 파일/)
    await expect(client.changes.removeFile('../outside')).rejects.toThrow(/저장소 밖 경로/)
    await expect(client.changes.removeFile('')).rejects.toThrow(/저장소 밖 경로/)
  })

  it('removeFile — 충돌 중인 파일은 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')

    await expect(client.changes.removeFile('README.md')).rejects.toThrow(/충돌 화면에서/)
  })
```

- [ ] **Step 2: Red 확인** — `cd packages/git-adapter && npx vitest run test/client.test.ts -t removeFile` → **4건 FAIL**

- [ ] **Step 3: 구현** — `packages/git-adapter/src/client.ts`

(1) fs import — 기존:

```ts
import { lstat, readFile, writeFile } from 'node:fs/promises'
```

교체:

```ts
import { lstat, readFile, rm, writeFile } from 'node:fs/promises'
```

(2) 인터페이스 changes — 기존:

```ts
    diff(path: string, options: DiffOptions): Promise<FileDiff>
```

교체:

```ts
    diff(path: string, options: DiffOptions): Promise<FileDiff>
    /**
     * 파일 하나를 디스크에서 삭제한다 — tracked는 status가 삭제 변경으로 잡고 untracked는 그대로 사라진다.
     * 되돌릴 수 없다(확인창은 UI 책임). 부재 파일·디렉터리·심볼릭 링크·충돌 파일은 친절 에러로 거부
     */
    removeFile(path: string): Promise<void>
```

(3) 구현 본체 — `      async diff(path, options) {` 줄 **앞**에 추가:

```ts
      async removeFile(path) {
        const cwd = await topLevel()
        assertRepoRelative(path)
        // 충돌(unmerged) 파일 가드 — 삭제는 충돌 정리 흐름을 우회한다 (discard 가드와 동일 계열)
        const unmerged = await execGitOrThrow(['ls-files', '-u', '--', `:(literal)${path}`], { cwd })
        if (unmerged.stdout.trim() !== '') {
          throw new Error(
            '충돌 중인 파일은 삭제로 정리할 수 없어요. 충돌 화면에서 한쪽을 고르거나 병합을 취소해 주세요.',
          )
        }
        const filePath = join(cwd, path)
        const stats = await lstat(filePath).catch(() => null)
        if (stats === null) {
          throw new Error('이미 없는 파일이에요. 새로고침 후 다시 확인해 주세요.')
        }
        // 심볼릭 링크는 저장소 밖을 가리킬 수 있다 — readText·saveText와 동일 계열로 거부한다
        if (stats.isSymbolicLink()) {
          throw new Error('링크 파일이라 여기서는 지울 수 없어요.')
        }
        if (stats.isDirectory()) {
          throw new Error('폴더는 여기서 지울 수 없어요. 파일만 지울 수 있어요.')
        }
        await rm(filePath)
      },
```

- [ ] **Step 4: Green 확인** — `cd packages/git-adapter && npx vitest run test/client.test.ts -t removeFile` → **4건 PASS**

- [ ] **Step 5: 전체 게이트 + Commit** — 루트 `pnpm test` → **314 passed**

```bash
git add packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(git-adapter): changes.removeFile — 파일 삭제 (심링크·디렉터리·충돌 가드)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: IPC 3채널 — contract·main 핸들러·preload

**Files:**
- Modify: `packages/ipc-contract/src/index.ts`
- Modify: `apps/desktop/src/main/git-handlers.ts`
- Modify: `apps/desktop/src/preload/index.ts`

- [ ] **Step 1: contract** — `packages/ipc-contract/src/index.ts`

(1) domain import — 기존:

```ts
  RevertResult,
```

교체:

```ts
  RestoreFileResult,
  RevertResult,
```

(2) GitApi changes — 기존:

```ts
    diff(repoPath: string, path: string, options: DiffOptions): Promise<FileDiff>
```

교체:

```ts
    diff(repoPath: string, path: string, options: DiffOptions): Promise<FileDiff>
    /** 파일 하나를 디스크에서 삭제 — 되돌릴 수 없다 (확인창은 renderer 책임) */
    removeFile(repoPath: string, path: string): Promise<void>
```

(3) GitApi commits — 기존:

```ts
    diffFile(repoPath: string, hash: string, path: string, origPath: string | null): Promise<FileDiff>
```

교체:

```ts
    diffFile(repoPath: string, hash: string, path: string, origPath: string | null): Promise<FileDiff>
    /** 이 파일만 그 시점 내용으로 적용(checkout) — 미저장 변경은 엔진이 파일 단위 자동 보관 후 진행 */
    restoreFile(repoPath: string, hash: string, path: string): Promise<RestoreFileResult>
    /** 그 시점과 지금 워크트리(미저장 포함)의 단일 파일 diff — rename이면 origPath 동봉 */
    diffAgainstWorktree(repoPath: string, hash: string, path: string, origPath: string | null): Promise<FileDiff>
```

(4) CHANNELS — 기존:

```ts
  changesDiff: 'changes:diff',
```

교체:

```ts
  changesDiff: 'changes:diff',
  changesRemoveFile: 'changes:remove-file',
```

기존:

```ts
  commitsDiffFile: 'commits:diff-file',
```

교체:

```ts
  commitsDiffFile: 'commits:diff-file',
  commitsRestoreFile: 'commits:restore-file',
  commitsDiffWorktree: 'commits:diff-worktree',
```

- [ ] **Step 2: main 핸들러** — `apps/desktop/src/main/git-handlers.ts`의 `  ipcMain.handle(CHANNELS.historyList, (_event, repoPath: unknown, limit: unknown) =>` 줄 **앞**에 추가 (기존 unknown 검증 관례 — assertHash·assertString·assertNullableString):

```ts
  ipcMain.handle(
    CHANNELS.commitsRestoreFile,
    (_event, repoPath: unknown, hash: unknown, path: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).commits.restoreFile(
        assertHash(hash),
        assertString(path),
      ),
  )

  ipcMain.handle(
    CHANNELS.commitsDiffWorktree,
    (_event, repoPath: unknown, hash: unknown, path: unknown, origPath: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).commits.diffAgainstWorktree(
        assertHash(hash),
        assertString(path),
        assertNullableString(origPath),
      ),
  )

  ipcMain.handle(CHANNELS.changesRemoveFile, (_event, repoPath: unknown, path: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).changes.removeFile(assertString(path)),
  )

```

- [ ] **Step 3: preload** — `apps/desktop/src/preload/index.ts`

(1) changes — 기존:

```ts
    discard: (repoPath, trackedPaths, untrackedPaths) =>
      ipcRenderer.invoke(CHANNELS.changesDiscard, repoPath, trackedPaths, untrackedPaths),
```

교체:

```ts
    discard: (repoPath, trackedPaths, untrackedPaths) =>
      ipcRenderer.invoke(CHANNELS.changesDiscard, repoPath, trackedPaths, untrackedPaths),
    removeFile: (repoPath, path) => ipcRenderer.invoke(CHANNELS.changesRemoveFile, repoPath, path),
```

(2) commits — 기존:

```ts
    diffFile: (repoPath, hash, path, origPath) =>
      ipcRenderer.invoke(CHANNELS.commitsDiffFile, repoPath, hash, path, origPath),
```

교체:

```ts
    diffFile: (repoPath, hash, path, origPath) =>
      ipcRenderer.invoke(CHANNELS.commitsDiffFile, repoPath, hash, path, origPath),
    restoreFile: (repoPath, hash, path) =>
      ipcRenderer.invoke(CHANNELS.commitsRestoreFile, repoPath, hash, path),
    diffAgainstWorktree: (repoPath, hash, path, origPath) =>
      ipcRenderer.invoke(CHANNELS.commitsDiffWorktree, repoPath, hash, path, origPath),
```

- [ ] **Step 4: 게이트 + Commit** — 루트 `pnpm typecheck` → 전 프로젝트 Done(**6 Done**, 에러 0 — E4 게이트와 동일 표기), 루트 `pnpm test` → 314 유지

```bash
git add packages/ipc-contract/src/index.ts apps/desktop/src/main/git-handlers.ts apps/desktop/src/preload/index.ts
git commit -m "feat(desktop): E5a IPC 3채널 — restore-file·diff-worktree·remove-file

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: store — 액션 3개 + `diffLabel` 최소 상태

**설계 판단(플랜 지시 "네가 결정하라"):** 비교 결과는 기존 공용 diff 슬롯(`diff`)을 그대로 쓰되, 제목만 구분하는 **문자열 상태 하나** `diffLabel: string | null`을 둔다. non-null이면 DiffPanel 제목이 이 값(`"<파일> — 지금 코드와 비교"`)으로 덮이고, 부모 대비 diff(selectCommitFile)·좌측 diff(selectFile)를 열 때마다 null로 되돌려 오인을 막는다. CLEAR_SELECTIONS에도 포함해 저장소 내용이 바뀌는 모든 지점에서 함께 무효화된다. 새 대형 상태 없음.

**Files:**
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`

- [ ] **Step 1: 상태 필드** — 기존:

```ts
  selected: SelectedFile | null
  diff: FileDiff | null
```

교체:

```ts
  selected: SelectedFile | null
  diff: FileDiff | null
  /** 공용 diff 슬롯의 제목 덮어쓰기 — "지금 코드와 비교"처럼 부모 대비 diff와 구분해야 할 때만 non-null */
  diffLabel: string | null
```

- [ ] **Step 2: 액션 시그니처** — 기존:

```ts
  discard(trackedPaths: string[], untrackedPaths: string[]): Promise<void>
```

교체:

```ts
  discard(trackedPaths: string[], untrackedPaths: string[]): Promise<void>
  /** 파일 하나를 디스크에서 삭제한다 — 확인창(UI 책임)을 통과한 뒤에만 호출된다. 되돌릴 수 없다 */
  removeFile(path: string): Promise<void>
```

기존:

```ts
  selectCommitFile(file: CommitFileChange): Promise<void>
```

교체:

```ts
  selectCommitFile(file: CommitFileChange): Promise<void>
  /** 이 파일만 그 시점 내용으로 적용(checkout) — 확인창(UI 책임) 경유. 미저장 변경은 엔진이 파일 단위 자동 보관 */
  restoreFileFromCommit(hash: string, path: string): Promise<void>
  /** 그 시점과 지금 워크트리의 비교를 공용 diff 슬롯에 띄운다 — 제목은 diffLabel로 구분 */
  compareFileWithWorktree(hash: string, path: string, origPath: string | null): Promise<void>
```

- [ ] **Step 3: CLEAR_SELECTIONS** — 기존:

```ts
const CLEAR_SELECTIONS = {
  selected: null,
  diff: null,
  commitDetail: null,
  commitFile: null,
  conflictFile: null,
  pullDetail: null,
} as const
```

교체:

```ts
const CLEAR_SELECTIONS = {
  selected: null,
  diff: null,
  diffLabel: null,
  commitDetail: null,
  commitFile: null,
  conflictFile: null,
  pullDetail: null,
} as const
```

- [ ] **Step 4: 초기 상태** — 기존:

```ts
  selected: null,
  diff: null,
  commitDetail: null,
  commitFile: null,
  conflictFile: null,
  notice: null,
```

교체:

```ts
  selected: null,
  diff: null,
  diffLabel: null,
  commitDetail: null,
  commitFile: null,
  conflictFile: null,
  notice: null,
```

- [ ] **Step 5: 기존 set 지점에 diffLabel 정리 추가** — 5곳을 각각 교체:

(1) selectFile — 기존:

```ts
      set({ selected, diff, commitDetail: null, commitFile: null, conflictFile: null })
```

교체:

```ts
      set({ selected, diff, diffLabel: null, commitDetail: null, commitFile: null, conflictFile: null })
```

(2) clearSelection — 기존:

```ts
    set({ selected: null, diff: null })
```

교체:

```ts
    set({ selected: null, diff: null, diffLabel: null })
```

(3) selectCommit — 기존:

```ts
      set({
        commitDetail,
        commitFile: null,
        conflictFile: null,
        selected: null,
        diff: null,
        pullDetail: null,
      })
```

교체:

```ts
      set({
        commitDetail,
        commitFile: null,
        conflictFile: null,
        selected: null,
        diff: null,
        diffLabel: null,
        pullDetail: null,
      })
```

(4) selectCommitFile — 기존:

```ts
      set({ diff, commitFile: file })
```

교체:

```ts
      set({ diff, commitFile: file, diffLabel: null })
```

(5) clearCommit — 기존:

```ts
    set({ commitDetail: null, commitFile: null, diff: null })
```

교체:

```ts
    set({ commitDetail: null, commitFile: null, diff: null, diffLabel: null })
```

(6) clearCommitFile — 기존:

```ts
    set({ commitFile: null, diff: null })
```

교체:

```ts
    set({ commitFile: null, diff: null, diffLabel: null })
```

(7) selectConflict — 기존:

```ts
      set({
        conflictFile: { path, content },
        selected: null,
        diff: null,
        commitDetail: null,
        commitFile: null,
      })
```

교체:

```ts
      set({
        conflictFile: { path, content },
        selected: null,
        diff: null,
        diffLabel: null,
        commitDetail: null,
        commitFile: null,
      })
```

- [ ] **Step 6: 새 액션 3개**

(1) `  async selectFile(selected) {` 줄 **앞**에 추가 (discard 바로 뒤 위치):

```ts
  async removeFile(path) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      // 파괴적 작업 — 실패해도 디스크가 이미 바뀌었을 수 있다. finally로 실제 상태를 다시 읽는다 (discard 관례)
      try {
        await git().changes.removeFile(repoPath, path)
      } finally {
        set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
      }
    })
  },

```

(2) `  clearCommit() {` 줄 **앞**에 추가 (selectCommitFile 바로 뒤 위치):

```ts
  async restoreFileFromCommit(hash, path) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      // 파괴 작업 — 자동 보관까지 간 뒤 실패해도 보관함 카운트가 낡지 않게 스냅샷은 finally로 (revert 관례)
      let notice: string | null = null
      try {
        const result = await git().commits.restoreFile(repoPath, hash, path)
        notice = `이 시점의 "${path}"을 지금 코드에 적용했어요.${
          result.autoShelved ? ' 저장 안 된 변경은 보관함에 넣어뒀어요.' : ''
        }`
      } finally {
        set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)), notice })
      }
    })
  },

  async compareFileWithWorktree(hash, path, origPath) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      const diff = await git().commits.diffAgainstWorktree(repoPath, hash, path, origPath)
      // 같은 diff 슬롯 재사용 — 부모 대비 diff(commitFile 제목)와 오인하지 않게 제목만 diffLabel로 덮는다.
      // commitFile은 비워 부모 대비 제목 규칙이 끼어들지 않게 한다 (상세 파일 목록은 열린 채 유지)
      set({ diff, diffLabel: `${path} — 지금 코드와 비교`, commitFile: null })
    })
  },

```

- [ ] **Step 7: 게이트 + Commit** — 루트 `pnpm typecheck` → 전부 Done, 루트 `pnpm test` → 314 유지

```bash
git add apps/desktop/src/renderer/src/store/repository-store.ts
git commit -m "feat(desktop): store — restoreFileFromCommit·compareFileWithWorktree·removeFile + diffLabel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: CommitDetailPanel 파일 행 우클릭 — 적용·비교 + App 연결

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/CommitDetailPanel.tsx` (전체 교체)
- Modify: `apps/desktop/src/renderer/src/App.tsx`

- [ ] **Step 1: CommitDetailPanel.tsx 전체를 다음 내용으로 교체**

```tsx
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowLeft } from 'lucide-react'
import { useRef, useState } from 'react'
import type { CommitDetail, CommitFileChange } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { ContextMenu } from '../ui/ContextMenu'
import { Panel } from '../ui/Panel'
import { KIND_GLYPHS, KIND_LABELS } from './change-kind'
import { formatRelativeTime } from './relative-time'
import './commit-detail-panel.css'
import './virtual.css'

interface CommitDetailPanelProps {
  detail: CommitDetail
  /** 보관함 미리보기로 열렸는가 — 제목·문구를 보관함 맥락으로 분기한다 (품질 리뷰) */
  shelfPreview: boolean
  /** 상세 안에서 선택된 파일 — diff는 좌측 흐름과 동일하게 중앙 패널(공용 diff 슬롯)에 뜬다 */
  selectedFile: CommitFileChange | null
  busy: boolean
  onSelectFile(file: CommitFileChange): void
  /** 우클릭 → "이 파일만 … 적용 (checkout)" — 확인창을 거친 뒤 호출된다 (E5a 피드백 1) */
  onRestoreFile(file: CommitFileChange): void
  /** 우클릭 → "지금 코드와 비교 (diff)" — 그 시점과 미저장 워크트리의 비교 (E5a 피드백 6) */
  onCompareFile(file: CommitFileChange): void
  onBack(): void
}

function CommitFileRow({
  file,
  isSelected,
  busy,
  onSelect,
  onMenu,
}: {
  file: CommitFileChange
  isSelected: boolean
  busy: boolean
  onSelect(): void
  onMenu(x: number, y: number): void
}) {
  const kindLabel = KIND_LABELS[file.kind]
  const tooltip =
    file.kind === 'renamed' && file.origPath !== null
      ? `${file.origPath} → ${file.path} — ${kindLabel}`
      : `${file.path} — ${kindLabel}`
  const slashIndex = file.path.lastIndexOf('/')
  const directory = slashIndex >= 0 ? file.path.slice(0, slashIndex) : ''
  const basename = slashIndex >= 0 ? file.path.slice(slashIndex + 1) : file.path
  return (
    <button
      type="button"
      className={`file-row__main file-row__main--${file.kind} commit-file-row${
        isSelected ? ' commit-file-row--selected' : ''
      }`}
      disabled={busy}
      onClick={onSelect}
      onContextMenu={(event) => {
        event.preventDefault()
        onMenu(event.clientX, event.clientY)
      }}
      title={tooltip}
      aria-label={tooltip}
      data-testid={`commit-file-${file.path}`}
    >
      <span className="file-row__kind" aria-hidden="true">
        {KIND_GLYPHS[file.kind]}
      </span>
      <span className="file-row__name">
        <span className="file-row__base">{basename}</span>
        {directory && <span className="file-row__dir">{directory}</span>}
      </span>
    </button>
  )
}

/**
 * 커밋 클릭 상세 (#6·3차 피드백) — 우측 열이 타임라인에서 이 패널로 전환된다:
 * 상단 파일 목록(가상), 하단 메시지. 파일을 누르면 diff는 중앙 패널에 뜬다.
 * 파일 행 우클릭 — 이 파일만 적용(checkout)·지금 코드와 비교(diff) (E5a).
 * 보관함 미리보기도 이 패널을 재사용하므로 같은 메뉴가 생긴다 — 적용 라벨만 분기.
 */
export function CommitDetailPanel({
  detail,
  shelfPreview,
  selectedFile,
  busy,
  onSelectFile,
  onRestoreFile,
  onCompareFile,
  onBack,
}: CommitDetailPanelProps) {
  // 우클릭 메뉴·확인창 상태는 패널이 관리한다 (HistoryPanel·다이얼로그 관례)
  const [menu, setMenu] = useState<{ x: number; y: number; file: CommitFileChange } | null>(null)
  const [confirmingRestore, setConfirmingRestore] = useState<CommitFileChange | null>(null)
  // 대형 커밋(수천 파일)에서도 파일 목록은 가시 범위만 렌더한다 (#4)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: detail.files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 31,
    overscan: 10,
  })

  const runRestore = () => {
    const file = confirmingRestore
    setConfirmingRestore(null)
    if (file !== null) onRestoreFile(file)
  }

  return (
    <Panel
      title={shelfPreview ? '보관 내용' : '저장 내용'}
      accessory={
        <>
          {/* 해시 배지는 좁은 우측 열에서 잘려 겹친다(실측) — 해시는 아래 메시지 meta로 */}
          <Badge tone="git">{shelfPreview ? 'stash' : 'commit'}</Badge>
          <Button
            variant="ghost"
            size="sm"
            isDisabled={busy}
            onPress={onBack}
            testId="commit-detail-back"
          >
            <ArrowLeft size={13} aria-hidden="true" /> 목록으로
          </Button>
        </>
      }
      testId="commit-detail-panel"
    >
      <div className="commit-detail__files-head">
        바뀐 파일 <span data-testid="commit-detail-file-count">{detail.files.length}</span>개
        {detail.files.length > 0
          ? shelfPreview
            ? ' — 누르면 가운데에 비교를 보여드려요. 새로 만든 파일은 이 목록에 안 보여요 — 꺼내면 함께 돌아와요'
            : ' — 누르면 가운데에 비교를 보여드려요'
          : shelfPreview
            ? ' — 새로 만든 파일만 담긴 보관이에요. 여기 목록에는 안 보이지만, 꺼내면 그대로 돌아와요'
            : ' — 메시지만 남긴 저장이에요'}
      </div>
      <div ref={scrollRef} className="virtual-scroll commit-detail__files">
        <ul
          className="changes-panel__list"
          style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const file = detail.files[item.index]!
            return (
              <li
                key={file.path}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="virtual-row"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <CommitFileRow
                  file={file}
                  isSelected={selectedFile?.path === file.path}
                  busy={busy}
                  onSelect={() => onSelectFile(file)}
                  onMenu={(x, y) => setMenu({ x, y, file })}
                />
              </li>
            )
          })}
        </ul>
      </div>
      <div className="commit-detail__message">
        <p className="commit-detail__subject" data-testid="commit-detail-subject">
          {detail.subject}
        </p>
        {detail.body !== '' && (
          <pre className="commit-detail__body" data-testid="commit-detail-body">
            {detail.body}
          </pre>
        )}
        <p className="commit-detail__meta">
          {detail.shortHash} · {formatRelativeTime(detail.committedAt, Date.now())} ·{' '}
          {detail.authorName}
          {!shelfPreview &&
            detail.parents.length >= 2 &&
            ' · 병합된 저장 — 파일 목록은 합쳐지기 전 원래 줄기 기준이에요'}
        </p>
      </div>
      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            {
              key: 'restore-file',
              label: shelfPreview
                ? '이 파일만 꺼내 적용 (checkout)'
                : '이 파일만 지금 코드에 적용 (checkout)',
              onSelect: () => setConfirmingRestore(menu.file),
            },
            {
              key: 'compare-worktree',
              label: '지금 코드와 비교 (diff)',
              onSelect: () => onCompareFile(menu.file),
            },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      <ConfirmDialog
        isOpen={confirmingRestore !== null}
        title={shelfPreview ? '이 파일만 꺼내 적용할까요?' : '이 파일만 이 시점 내용으로 적용할까요?'}
        confirmLabel="적용"
        onConfirm={runRestore}
        onCancel={() => setConfirmingRestore(null)}
      >
        지금 파일이 이 시점 내용으로 바뀌어요. 미저장 변경은 보관함에 넣어 드려요.
      </ConfirmDialog>
    </Panel>
  )
}
```

- [ ] **Step 2: App.tsx — CommitDetailPanel 연결** — 기존:

```tsx
          <CommitDetailPanel
            detail={store.commitDetail}
            shelfPreview={shelfPreview}
            selectedFile={store.commitFile}
            busy={store.busy}
            onSelectFile={(file) => void store.selectCommitFile(file)}
            onBack={() => store.clearCommit()}
          />
```

교체:

```tsx
          <CommitDetailPanel
            detail={store.commitDetail}
            shelfPreview={shelfPreview}
            selectedFile={store.commitFile}
            busy={store.busy}
            onSelectFile={(file) => void store.selectCommitFile(file)}
            onRestoreFile={(file) =>
              void store.restoreFileFromCommit(store.commitDetail!.hash, file.path)
            }
            onCompareFile={(file) =>
              void store.compareFileWithWorktree(store.commitDetail!.hash, file.path, file.origPath)
            }
            onBack={() => store.clearCommit()}
          />
```

- [ ] **Step 3: App.tsx — DiffPanel 제목에 diffLabel 우선 적용** — 기존:

```tsx
            <DiffPanel
              path={
                store.commitFile !== null && store.commitDetail !== null
                  ? `${store.commitFile.path} — 저장 ${store.commitDetail.shortHash}`
                  : store.selected?.change.path ?? null
              }
```

교체:

```tsx
            <DiffPanel
              path={
                store.diffLabel ??
                (store.commitFile !== null && store.commitDetail !== null
                  ? `${store.commitFile.path} — 저장 ${store.commitDetail.shortHash}`
                  : store.selected?.change.path ?? null)
              }
```

- [ ] **Step 4: 게이트 + 실렌더 확인** — 루트 `pnpm typecheck` 전부 Done. `pnpm --filter @git-gui/desktop dev`로 실행해 (1) 커밋 상세 파일 우클릭 → 메뉴 2항목, (2) "이 파일만 지금 코드에 적용" → 확인창 → notice + 보관함 카운트(미저장 변경이 있었으면 +1), (3) "지금 코드와 비교" → 중앙 diff 제목 `<파일> — 지금 코드와 비교`, 상세 패널 유지, (4) 보관함 미리보기에서 같은 메뉴의 적용 라벨이 "이 파일만 꺼내 적용 (checkout)"인지 확인.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/CommitDetailPanel.tsx apps/desktop/src/renderer/src/App.tsx
git commit -m "feat(desktop): 커밋 상세 파일 우클릭 — 이 파일만 적용·지금 코드와 비교 (피드백 1·6)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: ChangesPanel 파일 행 우클릭 — 올리기·되돌리기·삭제·내리기 + App 연결

**설계 판단(플랜 지시 "네가 결정하라"):** conflicted 행은 항목들을 전부 disabled로 늘어놓는 대신 **사유를 담은 disabled 항목 1개**("충돌 중인 파일이에요 — 충돌 화면에서 정리해요")로 대체한다 — 상태를 숨기지 않으면서(ContextMenu disabled 관례) 이유 없는 회색 버튼 나열보다 다음 행동이 명확하다. 엔진 가드(Task 1·3)가 심층 방어로 남는다. "로컬과 비교"는 좌측 행 클릭(기존 diff)이 이미 그 기능이므로 메뉴에 중복 항목을 만들지 않는다.

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/ChangesPanel.tsx` (전체 교체)
- Modify: `apps/desktop/src/renderer/src/App.tsx`

- [ ] **Step 1: ChangesPanel.tsx 전체를 다음 내용으로 교체**

```tsx
import { useVirtualizer } from '@tanstack/react-virtual'
import { CircleMinus, CirclePlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FileChange } from '@git-gui/domain'
import type { SelectedFile } from '../store/repository-store'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { ContextMenu } from '../ui/ContextMenu'
import { Panel } from '../ui/Panel'
import { KIND_GLYPHS, KIND_LABELS } from './change-kind'
import './changes-panel.css'
import './virtual.css'

interface ChangesPanelProps {
  changes: FileChange[]
  selected: SelectedFile | null
  /** 작업 중에는 모든 버튼을 비활성화한다 — 연타로 git 작업이 겹치면 index.lock 충돌이 난다 */
  busy: boolean
  onStage(paths: string[]): void
  onUnstage(paths: string[]): void
  /** 선택 파일 변경 취소 — tracked 경로와 untracked 경로를 분리해 넘긴다. 되돌릴 수 없다 */
  onDiscard(trackedPaths: string[], untrackedPaths: string[]): void
  /** 우클릭 → "파일 삭제 (delete)" — 확인창을 거친 뒤 호출된다. 되돌릴 수 없다 (E5a 피드백 2) */
  onRemoveFile(path: string): void
  onSelect(selected: SelectedFile): void
}

/** 이름 변경은 새 경로와 원래 경로가 index에 쌍으로 있다 — 함께 넘겨야 반쪽 unstage가 안 된다 */
function actionPaths(change: FileChange, staged: boolean): string[] {
  if (staged && change.staged === 'renamed' && change.origPath !== null) {
    return [change.path, change.origPath]
  }
  return [change.path]
}

interface FileRowProps {
  change: FileChange
  staged: boolean
  isSelected: boolean
  isChecked: boolean
  busy: boolean
  onToggle(): void
  onSelect(): void
  /** 우클릭 메뉴 — 좌표만 올린다. 메뉴 구성은 목록이 담당 (E5a) */
  onMenu(x: number, y: number): void
}

function FileRow({
  change,
  staged,
  isSelected,
  isChecked,
  busy,
  onToggle,
  onSelect,
  onMenu,
}: FileRowProps) {
  const kind = staged ? change.staged : change.unstaged
  const kindLabel = kind ? KIND_LABELS[kind] : ''
  // 이름 변경은 "무엇이었는지"가 핵심 정보 — 원래 경로를 툴팁에 병기한다
  const tooltip =
    kind === 'renamed' && change.origPath !== null
      ? `${change.origPath} → ${change.path} — ${kindLabel}`
      : `${change.path} — ${kindLabel}`
  // IntelliJ처럼 파일명을 먼저, 경로를 뒤에 흐리게 — 좁은 열에서는 경로부터 축소한다
  const slashIndex = change.path.lastIndexOf('/')
  const directory = slashIndex >= 0 ? change.path.slice(0, slashIndex) : ''
  const basename = slashIndex >= 0 ? change.path.slice(slashIndex + 1) : change.path
  return (
    <div className={`file-row${isSelected ? ' file-row--selected' : ''}`}>
      {/* 칩(sticky) — 가로 스크롤 중에도 체크박스가 왼쪽에 남는다 */}
      <span className="file-row__checkcell">
        <input
          type="checkbox"
          className="file-row__check"
          checked={isChecked}
          onChange={onToggle}
          disabled={busy}
          aria-label={`${change.path} 선택`}
          data-testid={`check-${staged ? 'staged' : 'unstaged'}-${change.path}`}
        />
      </span>
      <button
        type="button"
        className={`file-row__main file-row__main--${kind ?? 'none'}`}
        disabled={busy}
        onClick={onSelect}
        onContextMenu={(event) => {
          event.preventDefault()
          onMenu(event.clientX, event.clientY)
        }}
        title={tooltip}
        aria-label={tooltip}
        data-testid={`file-${staged ? 'staged' : 'unstaged'}-${change.path}`}
      >
        <span className="file-row__kind" aria-hidden="true">
          {kind ? KIND_GLYPHS[kind] : ''}
        </span>
        <span className="file-row__name">
          <span className="file-row__base">{basename}</span>
          {directory && <span className="file-row__dir">{directory}</span>}
        </span>
      </button>
    </div>
  )
}

interface FileListProps {
  title: string
  termBadge: string
  countTestId: string
  emptyText: string
  changes: FileChange[]
  staged: boolean
  selected: SelectedFile | null
  busy: boolean
  bulkLabel: string
  /** unstaged 목록에만 있다 — 확인창을 거쳐 선택 파일의 변경을 취소한다 */
  onDiscard?: (trackedPaths: string[], untrackedPaths: string[]) => void
  /** unstaged 목록에만 있다 — 우클릭 "파일 삭제". 확인창은 이 목록이 관리한다 (E5a) */
  onRemoveFile?: (path: string) => void
  onAction(paths: string[]): void
  onSelect(selected: SelectedFile): void
}

function FileList({
  title,
  termBadge,
  countTestId,
  emptyText,
  changes,
  staged,
  selected,
  busy,
  bulkLabel,
  onDiscard,
  onRemoveFile,
  onAction,
  onSelect,
}: FileListProps) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  // 목록에서 사라진 경로는 체크에서 자동 제외한다 — stage/unstage 후 잔존 방지
  const validChecked = changes.filter((c) => checked.has(c.path))
  const allChecked = changes.length > 0 && validChecked.length === changes.length
  const side = staged ? 'staged' : 'unstaged'

  // 사라졌던 경로가 목록에 돌아와도 저절로 다시 체크되지 않게, 목록 변경 시 stale 경로를 정리한다
  useEffect(() => {
    setChecked((prev) => {
      const valid = new Set(changes.filter((c) => prev.has(c.path)).map((c) => c.path))
      return valid.size === prev.size ? prev : valid
    })
  }, [changes])

  // 수천 개 행에서도 DOM은 가시 범위만 유지한다 (#4). 행 높이는 실측(measureElement)한다
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: changes.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 31,
    overscan: 10,
  })

  const toggle = (path: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
  const toggleAll = () => {
    setChecked(allChecked ? new Set() : new Set(changes.map((c) => c.path)))
  }
  const runBulk = () => {
    onAction(validChecked.flatMap((change) => actionPaths(change, staged)))
    setChecked(new Set())
  }
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const discardTracked = validChecked.filter((c) => c.unstaged !== 'untracked').map((c) => c.path)
  const discardUntracked = validChecked.filter((c) => c.unstaged === 'untracked').map((c) => c.path)
  const runDiscard = () => {
    setConfirmingDiscard(false)
    onDiscard?.(discardTracked, discardUntracked)
    setChecked(new Set())
  }

  // 우클릭 메뉴와 단일 파일 확인창(되돌리기·삭제) — 이 목록이 관리한다 (E5a 피드백 2)
  const [menu, setMenu] = useState<{ x: number; y: number; change: FileChange } | null>(null)
  const [menuDiscard, setMenuDiscard] = useState<FileChange | null>(null)
  const [menuRemove, setMenuRemove] = useState<FileChange | null>(null)
  const runMenuDiscard = () => {
    const change = menuDiscard
    setMenuDiscard(null)
    if (change === null) return
    if (change.unstaged === 'untracked') onDiscard?.([], [change.path])
    else onDiscard?.([change.path], [])
  }
  const runMenuRemove = () => {
    const change = menuRemove
    setMenuRemove(null)
    if (change !== null) onRemoveFile?.(change.path)
  }

  return (
    <Panel
      title={title}
      accessory={
        <>
          <Badge tone="git">{termBadge}</Badge>
          <Badge tone="count">
            <span data-testid={countTestId}>{changes.length}</span>
          </Badge>
        </>
      }
    >
      {changes.length === 0 ? (
        <p className="changes-panel__empty">{emptyText}</p>
      ) : (
        <>
          <div className="file-list__bulk">
            <label className="file-list__check-all">
              <input
                type="checkbox"
                checked={allChecked}
                ref={(element) => {
                  // 일부만 체크된 중간 상태 표시
                  if (element) element.indeterminate = validChecked.length > 0 && !allChecked
                }}
                onChange={toggleAll}
                disabled={busy}
                data-testid={`check-all-${side}`}
              />
              모두 선택
            </label>
            {onDiscard && (
              <Button
                variant="danger"
                size="sm"
                isDisabled={busy || validChecked.length === 0}
                onPress={() => setConfirmingDiscard(true)}
                testId="discard-selected"
              >
                변경 취소 ({validChecked.length})
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              isDisabled={busy || validChecked.length === 0}
              onPress={runBulk}
              testId={`${staged ? 'unstage' : 'stage'}-selected`}
            >
              {staged ? (
                <CircleMinus size={13} aria-hidden="true" />
              ) : (
                <CirclePlus size={13} aria-hidden="true" />
              )}
              선택 {bulkLabel} ({validChecked.length})
            </Button>
          </div>
          <div ref={scrollRef} className="virtual-scroll" data-testid={`file-scroll-${side}`}>
            <ul
              className="changes-panel__list"
              style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const change = changes[item.index]!
                return (
                  <li
                    key={`${side}-${change.path}`}
                    ref={virtualizer.measureElement}
                    data-index={item.index}
                    className="virtual-row virtual-row--wide"
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    <FileRow
                      change={change}
                      staged={staged}
                      isSelected={
                        selected !== null &&
                        selected.staged === staged &&
                        selected.change.path === change.path
                      }
                      isChecked={checked.has(change.path)}
                      busy={busy}
                      onToggle={() => toggle(change.path)}
                      onSelect={() => onSelect({ change, staged })}
                      onMenu={(x, y) => setMenu({ x, y, change })}
                    />
                  </li>
                )
              })}
            </ul>
          </div>
          {onDiscard && (
            <ConfirmDialog
              isOpen={confirmingDiscard}
              title="변경 내용을 취소할까요?"
              confirmLabel="변경 취소"
              onConfirm={runDiscard}
              onCancel={() => setConfirmingDiscard(false)}
            >
              선택한 파일 {validChecked.length}개의 아직 올리지 않은 변경 내용을 되돌려요. 올려둔
              (staged) 내용은 남아요.
              {discardUntracked.length > 0 && ` 새 파일 ${discardUntracked.length}개는 삭제돼요.`} 이
              동작은 되돌릴 수 없어요.
            </ConfirmDialog>
          )}
          {menu !== null && (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              items={
                menu.change.staged === 'conflicted' || menu.change.unstaged === 'conflicted'
                  ? [
                      // 사유를 담은 disabled 항목 1개 — 이유 없는 회색 나열보다 다음 행동이 명확하다.
                      // 실제 차단은 엔진 가드(restore/remove/discard의 unmerged 거부)가 심층 방어한다
                      {
                        key: 'conflicted-info',
                        label: '충돌 중인 파일이에요 — 충돌 화면에서 정리해요',
                        disabled: true,
                        onSelect: () => {},
                      },
                    ]
                  : staged
                    ? [
                        {
                          key: 'unstage-file',
                          label: '내리기 (unstage)',
                          onSelect: () => onAction(actionPaths(menu.change, true)),
                        },
                      ]
                    : [
                        {
                          key: 'stage-file',
                          label: '올리기 (stage)',
                          onSelect: () => onAction(actionPaths(menu.change, false)),
                        },
                        {
                          key: 'discard-file',
                          label: '이 파일만 되돌리기 (discard)',
                          onSelect: () => setMenuDiscard(menu.change),
                        },
                        {
                          key: 'remove-file',
                          label: '파일 삭제 (delete)',
                          onSelect: () => setMenuRemove(menu.change),
                        },
                      ]
              }
              onClose={() => setMenu(null)}
            />
          )}
          <ConfirmDialog
            isOpen={menuDiscard !== null}
            title="이 파일의 변경을 취소할까요?"
            confirmLabel="변경 취소"
            onConfirm={runMenuDiscard}
            onCancel={() => setMenuDiscard(null)}
          >
            "{menuDiscard?.path}"의 아직 올리지 않은 변경 내용을 되돌려요. 올려둔(staged) 내용은
            남아요.
            {menuDiscard?.unstaged === 'untracked' && ' 새 파일이라 파일 자체가 삭제돼요.'} 이 동작은
            되돌릴 수 없어요.
          </ConfirmDialog>
          <ConfirmDialog
            isOpen={menuRemove !== null}
            title="파일을 삭제할까요?"
            confirmLabel="파일 삭제"
            onConfirm={runMenuRemove}
            onCancel={() => setMenuRemove(null)}
          >
            "{menuRemove?.path}" 파일을 디스크에서 삭제해요. 이 동작은 되돌릴 수 없어요.
          </ConfirmDialog>
        </>
      )}
    </Panel>
  )
}

export function ChangesPanel({
  changes,
  selected,
  busy,
  onStage,
  onUnstage,
  onDiscard,
  onRemoveFile,
  onSelect,
}: ChangesPanelProps) {
  const stagedChanges = changes.filter((c) => c.staged !== null)
  const unstagedChanges = changes.filter((c) => c.unstaged !== null)

  return (
    <div className="changes-panel">
      <FileList
        title="지금 바뀐 것"
        termBadge="unstaged"
        countTestId="unstaged-count"
        emptyText="바뀐 파일이 없어요"
        changes={unstagedChanges}
        staged={false}
        selected={selected}
        busy={busy}
        bulkLabel="올리기"
        onAction={onStage}
        onDiscard={onDiscard}
        onRemoveFile={onRemoveFile}
        onSelect={onSelect}
      />
      <FileList
        title="저장 예정"
        termBadge="staged"
        countTestId="staged-count"
        emptyText="파일을 올리면 여기에 모여요"
        changes={stagedChanges}
        staged
        selected={selected}
        busy={busy}
        bulkLabel="내리기"
        onAction={onUnstage}
        onSelect={onSelect}
      />
    </div>
  )
}
```

- [ ] **Step 2: App.tsx — onRemoveFile 연결** — 기존:

```tsx
          onDiscard={(trackedPaths, untrackedPaths) =>
            void store.discard(trackedPaths, untrackedPaths)
          }
```

교체:

```tsx
          onDiscard={(trackedPaths, untrackedPaths) =>
            void store.discard(trackedPaths, untrackedPaths)
          }
          onRemoveFile={(path) => void store.removeFile(path)}
```

- [ ] **Step 3: 게이트 + 실렌더 확인** — 루트 `pnpm typecheck` 전부 Done. dev 실행으로 (1) unstaged 행 우클릭 → 3항목(올리기·되돌리기·삭제), (2) staged 행 우클릭 → 내리기 1항목, (3) 되돌리기·삭제는 각각 확인창("되돌릴 수 없어요") 경유, untracked 행의 되돌리기 확인창에 "새 파일이라 파일 자체가 삭제돼요" 병기, (4) 합치기 충돌 중 conflicted(!) 행 우클릭 → disabled 사유 항목 1개, (5) 클릭=기존 diff(비교) 그대로 동작 확인.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/components/ChangesPanel.tsx apps/desktop/src/renderer/src/App.tsx
git commit -m "feat(desktop): 좌측 파일 우클릭 — 올리기·되돌리기·삭제·내리기 (피드백 2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: E2E 3건 + 검출력 변이 실증

**Files:**
- Modify: `apps/desktop/e2e/smoke.spec.ts`

- [ ] **Step 1: import 추가** — 기존:

```ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
```

교체:

```ts
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
```

- [ ] **Step 2: 테스트 3건 추가** — 파일 맨 끝(마지막 test 블록 뒤)에 추가:

```ts
test('커밋 상세에서 파일 우클릭 — 이 파일만 그 시점 내용으로 적용한다 (미저장 변경은 보관함으로)', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('unstaged-count')).toHaveText('1')
    // init 커밋(v1) 상세를 열고 파일 행을 우클릭한다
    await window.locator('[data-testid^="history-item-"]').first().click()
    await window.getByTestId('commit-file-app.txt').click({ button: 'right' })
    await window.getByTestId('context-restore-file').click()
    // 확인창 — 자동 보관 안내를 담는다
    await expect(window.getByRole('alertdialog')).toContainText('보관함에 넣어 드려요')
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId('notice')).toContainText('지금 코드에 적용했어요')
    await expect(window.getByTestId('notice')).toContainText('보관함')
    // dirty였던 v2는 보관함으로 +1, 디스크는 그 시점(v1) 내용 — 실측
    await expect(window.getByTestId('shelf-count')).toHaveText('1')
    expect(await readFile(join(repo, 'app.txt'), 'utf8')).toBe('v1\n')
    // 적용 결과가 HEAD와 같아 변경 목록은 비고, 파괴 작업 관례대로 상세가 닫혀 타임라인으로 복귀한다
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')
    await expect(window.getByTestId('history-panel')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('좌측 파일 우클릭 — 올리기(stage)와 파일 삭제(delete)', async () => {
  const repo = await createRepoWithChange()
  await writeFile(join(repo, 'junk.txt'), 'j\n')
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('unstaged-count')).toHaveText('2')
    // 올리기 (stage) — staged 목록으로 이동한다
    await window.getByTestId('file-unstaged-app.txt').click({ button: 'right' })
    await window.getByTestId('context-stage-file').click()
    await expect(window.getByTestId('staged-count')).toHaveText('1')
    await expect(window.getByTestId('unstaged-count')).toHaveText('1')
    // 파일 삭제 (delete) — "되돌릴 수 없어요" 확인창을 거쳐 행과 디스크가 함께 사라진다
    await window.getByTestId('file-unstaged-junk.txt').click({ button: 'right' })
    await window.getByTestId('context-remove-file').click()
    await expect(window.getByRole('alertdialog')).toContainText('되돌릴 수 없어요')
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')
    expect(existsSync(join(repo, 'junk.txt'))).toBe(false)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('커밋 상세에서 지금 코드와 비교 — 중앙 diff 제목이 비교로 구분된다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.locator('[data-testid^="history-item-"]').first().click()
    await window.getByTestId('commit-file-app.txt').click({ button: 'right' })
    await window.getByTestId('context-compare-worktree').click()
    // 부모 대비 제목("— 저장 <hash>")이 아니라 비교 제목이 뜬다
    await expect(window.getByTestId('diff-panel')).toContainText('app.txt — 지금 코드와 비교')
    // 커밋 시점(v1)과 커밋 안 된 워크트리(v2)의 차이가 그대로 보인다 (피드백 6)
    await expect(window.getByTestId('diff-view-unified')).toContainText('v2')
    // 상세(파일 목록)는 열린 채 유지된다 — 다른 파일을 이어서 비교할 수 있다
    await expect(window.getByTestId('commit-detail-panel')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

- [ ] **Step 3: E2E 실행** — `pnpm --filter @git-gui/desktop e2e` → **38 passed** (smoke 32 + hosting 6)

- [ ] **Step 4: 검출력 변이 실증 1건** — `packages/git-adapter/src/client.ts`의 restoreFile에서 자동 보관 블록을 임시 무력화:

```ts
        if (autoShelved) {
```

를 임시로

```ts
        if (false && autoShelved) {
```

로 바꾸고 `cd apps/desktop && npx playwright test e2e/smoke.spec.ts -g "이 파일만 그 시점 내용으로 적용한다"` 실행 → **FAIL** 확인(기대 shelf-count '1', 실측 '0' — 미저장 변경이 조용히 사라지는 회귀를 이 테스트가 잡는다). 확인 즉시 원복(`if (autoShelved) {`)하고 같은 명령 재실행 → PASS. 변이 결과(FAIL 단언 위치)를 작업 로그에 남긴다.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts
git commit -m "test(e2e): E5a 파일 우클릭 3건 — 적용(보관함 실측)·올리기/삭제·지금 코드와 비교

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 최종 게이트 + 공식 스크린샷 2장 + README 한 줄

- [ ] **Step 1: 전체 게이트** — 순서대로 전부 exit 0:
  - 루트 `pnpm test` → **314 passed**
  - 루트 `pnpm typecheck` → 전 프로젝트 Done
  - `pnpm --filter @git-gui/desktop build`
  - `pnpm --filter @git-gui/desktop e2e` → **38 passed**

- [ ] **Step 2: README 한 줄** — `README.md` 기존:

```
다크/라이트 테마를 전환할 수 있고, 대형 저장소를 위해 변경 목록·역사·diff는 가상 스크롤로 렌더됩니다.
```

교체:

```
다크/라이트 테마를 전환할 수 있고, 대형 저장소를 위해 변경 목록·역사·diff는 가상 스크롤로 렌더됩니다. E5a로 파일 단위 우클릭 작업이 추가되었습니다 — 커밋 상세·보관함 미리보기에서 "이 파일만 지금 코드에 적용(checkout, 미저장 변경은 자동 보관)"·"지금 코드와 비교(diff)", 좌측 변경 목록에서 올리기/내리기/이 파일만 되돌리기/파일 삭제.
```

- [ ] **Step 3: 공식 스크린샷 2장** (1440×900, `test-results/` + scratchpad `/private/tmp/claude-501/-Users-sangyeop-kim-git-gui/47e198c4-f65c-435f-b962-13de0c0d68a0/scratchpad/` 사본, **생성 후 e2e 재실행 금지** — 재실행하면 test-results가 갈린다)

임시 파일 `apps/desktop/e2e/screens-e5a.spec.ts`를 다음 내용으로 만들고:

```ts
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { execGitOrThrow } from '@git-gui/git-process'

const APP_ROOT = join(__dirname, '..')
const SCRATCH =
  '/private/tmp/claude-501/-Users-sangyeop-kim-git-gui/47e198c4-f65c-435f-b962-13de0c0d68a0/scratchpad'

test('공식 스크린샷 — E5a 파일 우클릭 메뉴 2장 (1440×900)', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'git-gui-shot-'))
  await execGitOrThrow(['init', '--initial-branch=main'], { cwd: repo })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: repo })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'v1\n')
  await writeFile(join(repo, 'style.css'), 'body {}\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '화면 구성 저장'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'v2\n')
  await writeFile(join(repo, 'notes.txt'), 'memo\n')
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.setSize(1440, 900)
    })
    await expect(window.getByTestId('unstaged-count')).toHaveText('2')
    // (1) 커밋 상세 파일 우클릭 메뉴
    await window.locator('[data-testid^="history-item-"]').first().click()
    await window.getByTestId('commit-file-app.txt').click({ button: 'right' })
    await expect(window.getByTestId('context-restore-file')).toBeVisible()
    await window.screenshot({ path: 'test-results/e5a-commit-file-menu.png' })
    await window.keyboard.press('Escape')
    await window.getByTestId('commit-detail-back').click()
    // (2) 좌측 변경 목록 파일 우클릭 메뉴
    await window.getByTestId('file-unstaged-app.txt').click({ button: 'right' })
    await expect(window.getByTestId('context-stage-file')).toBeVisible()
    await window.screenshot({ path: 'test-results/e5a-changes-menu.png' })
    await copyFile(
      'test-results/e5a-commit-file-menu.png',
      join(SCRATCH, 'e5a-commit-file-menu.png'),
    )
    await copyFile('test-results/e5a-changes-menu.png', join(SCRATCH, 'e5a-changes-menu.png'))
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

실행·정리 (build는 Step 1에서 이미 됐다 — 재빌드 없이 이 파일만 실행):

```bash
cd apps/desktop && npx playwright test e2e/screens-e5a.spec.ts
rm apps/desktop/e2e/screens-e5a.spec.ts
```

스크린샷 2장(`e5a-commit-file-menu.png`·`e5a-changes-menu.png`)이 test-results/와 scratchpad 양쪽에 있는지, 메뉴가 실제로 찍혔는지 눈으로 확인한다. 이후 e2e를 다시 돌리지 않는다.

- [ ] **Step 4: Commit** (README만 — 스크린샷·test-results/는 미추적)

```bash
git add README.md
git commit -m "docs: README — E5a 파일 단위 우클릭 작업 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8-보완: 품질 리뷰 4건 (실측 반영)

품질 리뷰(유실 안전 전 시나리오 실측 통과) 지적:

- **(Important) merging/reverting 중 restoreFile 원문 에러** — 충돌 중 히스토리 우클릭으로 도달 가능. stash가 unmerged index에서 `could not write index` 원문으로 죽는다(데이터는 안전). → revert와 동일 관례의 상태 가드.
- **(Minor) notice 3건** — ① 적용 결과가 staged로 올라가는 것 안내 부재, ② 조사 오류(`"app.txt"을`), ③ 보관함 꺼내기에도 "이 시점" 커밋 어투. → 문장 재구성으로 일괄 해소.
- **(Minor) 실패 시 커밋 상세 닫힘** — finally의 CLEAR_SELECTIONS 무조건 실행. → 성공 시에만 선택 정리.

**Files:**
- Modify: `packages/git-adapter/src/client.ts` (+`packages/git-adapter/test/client.test.ts`)
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`
- Modify: `apps/desktop/e2e/smoke.spec.ts` (notice 단언 갱신)

- [ ] **Step 1: 엔진 가드 테스트 (Red)** — client.test.ts의 restoreFile 테스트 묶음 끝에 추가:

```ts
  it('restoreFile — 합치는 중(merging)에는 읽히는 메시지로 거부한다 (변경·보관함 무손상)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')

    await writeFixtureFile(repo, 'other.txt', 'precious\n')
    const head = (await client.history.list(1))[0]!
    await expect(client.commits.restoreFile(head.hash, 'other.txt')).rejects.toThrow(
      /먼저 마무리하거나 취소/,
    )
    // 변경은 그대로, 보관함도 생기지 않았다 — stash 선실행 유실 경로 차단 확인
    expect(await client.files.readText('other.txt')).toBe('precious\n')
    expect(await client.shelf.list()).toHaveLength(0)
  })
```

Run: FAIL 확인(현재 가드 없음 — 원문 GitError).

- [ ] **Step 2: 엔진 가드** — `restoreFile`의 `assertRepoRelative(path)` 줄 **뒤**(unmerged 가드 앞)에 추가:

```ts
        // merging·reverting 도중의 적용은 병합 index를 중간 변경하고, stash도 unmerged index에서
        // 원문 에러로 죽는다(품질 리뷰 실측) — revert와 동일 관례로 먼저 마무리를 안내한다
        const gitDir = (await execGitOrThrow(['rev-parse', '--absolute-git-dir'], { cwd })).stdout.trim()
        if (detectState(await readGitDirMarkers(gitDir)) !== 'normal') {
          throw new Error('지금 진행 중인 작업을 먼저 마무리하거나 취소해야 적용할 수 있어요.')
        }
```

Green: 신규 1건 포함 전체 PASS (**315 tests**).

- [ ] **Step 3: store — notice 재구성·실패 시 상세 유지** (`restoreFileFromCommit` 전체 교체)

```ts
  async restoreFileFromCommit(hash, path) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      // 파괴 작업 — 자동 보관까지 간 뒤 실패해도 보관함 카운트가 낡지 않게 스냅샷은 finally로 (revert 관례).
      // 실패 시에는 선택(커밋 상세)을 유지해 맥락을 잃지 않는다 (품질 리뷰)
      let succeeded = false
      let notice: string | null = null
      try {
        const result = await git().commits.restoreFile(repoPath, hash, path)
        succeeded = true
        // "이 시점" 어투를 빼 커밋·보관함 공통으로 읽히게, staged로 올라간 것도 함께 안내한다 (품질 리뷰)
        notice = `"${path}"에 이 내용을 적용하고 저장 예정에 올려뒀어요 — 저장하기로 확정해요.${
          result.autoShelved ? ' 저장 안 된 변경은 보관함에 넣어뒀어요.' : ''
        }`
      } finally {
        set({
          ...(succeeded ? CLEAR_SELECTIONS : {}),
          ...(await fetchSnapshot(repoPath, get().historyLimit)),
          notice,
        })
      }
    })
  },
```

- [ ] **Step 4: E2E 단언 갱신** — `'커밋 상세에서 파일 우클릭 — 이 파일만 그 시점 내용으로 적용한다'`의 notice 단언 교체:

```ts
    await expect(window.getByTestId('notice')).toContainText('저장 예정에 올려뒀어요')
```

- [ ] **Step 5: 게이트** — 루트 `pnpm test`(**315**) + typecheck(6 Done) + build + E2E 전체(**38 passed**) 전부 exit 0

- [ ] **Step 6: Commit**

```bash
git add packages/git-adapter apps/desktop/src apps/desktop/e2e
git commit -m "fix: 품질 리뷰 — restoreFile 상태 가드·notice 재구성(staged 안내)·실패 시 상세 유지

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 검증 게이트 요약

| 시점 | 기대치 |
| --- | --- |
| 기준선 (85e288a, 실측) | **300 tests** + E2E **35** (smoke 29 + hosting 6) |
| Task 1 후 | +7 → **307 tests** |
| Task 2 후 | +3 → **310 tests** |
| Task 3 후 | +4 → **314 tests** |
| Task 4·5 후 | 314 유지 + typecheck 전부 Done |
| Task 6·7 후 | typecheck 전부 Done + 실렌더 확인 |
| Task 8 후 | E2E **38 passed** (smoke 32 + hosting 6) + 변이 실증 1건(FAIL→원복 PASS) |
| 최종 (Task 9) | 314 tests + typecheck + build + E2E 38 — 전부 exit 0 + 스크린샷 2장 + README |

## 인용 앵커 검증 기록

플랜의 "기존:" 코드 블록은 전부 `grep -cF`로 대상 파일에서 **정확히 1회** 매칭됨을 확인했다(2026-07-21, 85e288a): client.ts의 `REVERT_SHELF_MESSAGE`·`diffFile(hash: …)`·`diff(path: …)`·`async revert(hash) {`·`async diff(path, options) {`·fs import 줄, domain의 `/** 실험 공간 합치기 결과 */`, ipc-contract의 diffFile·diff·`commitsDiffFile:`·`changesDiff:`·`  RevertResult,`, preload의 diffFile invoke·`diff: (repoPath, …`, git-handlers의 historyList 핸들러 줄, store의 `const CLEAR_SELECTIONS = {`·각 set 지점·인터페이스 줄, App.tsx의 DiffPanel path·CommitDetailPanel props·onDiscard 블록, smoke.spec.ts·client.test.ts의 import 줄, README 문장. 다중 매칭 위험이 있던 앵커(`diff: null` 단독 등)는 모두 다중 행 블록으로 확장해 유일화했다.

## 후속 노트 (이관 후보)

- **비교의 untracked 한계**: `git diff <hash> -- <path>`는 untracked 파일을 비추지 않는다(실측 5). 지금은 비교 진입점이 커밋 상세(그 시점에 존재하는 파일)뿐이라 문제없지만, 좌측 목록에 "그 시점과 비교" 같은 역방향 진입점을 만들면 untracked 처리(--no-index 병용)가 필요하다.
- **적용이 staged로 잡히는 UX**: checkout이 index까지 갱신해 적용 결과가 "저장 예정"에 나타난다(실측 4). 사용자가 "적용했는데 왜 올려져 있지?"라고 물으면 notice에 한 줄("적용 결과는 저장 예정에 올라가 있어요") 추가를 검토.
- **rename된 파일의 restore**: 커밋 상세의 renamed 파일을 적용하면 옛 경로가 아니라 현재(커밋 시점) 경로로 복원된다. 워크트리에 staged rename이 걸쳐 있는 교차 케이스는 유실은 없지만(새 경로 비접촉) 결과가 낯설 수 있다 — 사용자 보고 시 확인창 문구 보강.
- **conflicted 행 메뉴**: disabled 사유 항목 1개로 대체했다. 충돌 뷰로 바로 이동하는 활성 항목("충돌 화면 열기")으로 승격 검토.
- **보관함 파일 단위 꺼내기와 항목 정리**: restoreFile은 stash 항목을 소비하지 않는다(남는다). 파일 하나만 꺼낸 뒤 항목을 지울지 묻는 흐름은 후속.
- **`파일 적용 자동 보관` 메시지의 파일명 병기**: 지금은 어떤 파일의 보관인지 메시지로 구분되지 않는다 — `shelf-message.ts` 계열에서 경로 병기 검토(메시지 포맷 변경은 E2E 문구 단언과 함께).
