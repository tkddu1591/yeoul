# E1b 실험 공간 합치기(merge)·충돌 해결 구현 계획 (스펙 E1 후반부 + E1a 이관)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 다른 실험 공간을 지금 공간으로 합치고(스마트 병합 — 막히면 자동 보관), 충돌이 나면 파일 단위로 한쪽을 고르거나 직접 수정해 해소하고, 언제든 병합을 취소할 수 있게 한다.

**Architecture:** 엔진 우선 — `branches.merge`(선시도 → `would be overwritten`이면 자동 보관 후 재시도, 결과는 fast-forward/merged/conflict/up-to-date), `merge.abort`, `conflicts.resolve(ours|theirs)`·`markResolved`, `files.readText`(충돌 뷰용, 크기 상한). 충돌 파일 클릭은 store가 diff 대신 충돌 뷰로 라우팅한다 — 중앙 ConflictPanel이 마커(<<<<<<<) 구간을 색으로 구분해 보여주고 [내 것 유지 / 가져온 것 사용 / 직접 수정했어요]를 제공한다. 병합 마무리는 **기존 저장하기(commit)가 그대로 수행**한다(실측: `commit -F -`가 merge commit을 만든다). 합치기 진입은 헤더 버튼 → ListDialog(브랜치 선택).

**Tech Stack:** 기존과 동일 (신규 의존성 없음).

**사용자 결정(원 브레인스토밍) 매핑:** "한 쪽 고르기(A안)로 시작 + 자세히 보기·직접 수정(B)" → 파일 단위 ours/theirs + 마커 뷰 + 직접 수정 후 해결 표시. "충돌 병합 취소도 필요" → merge --abort + 확인창. "스마트 병합처럼 커밋 안 된 것들도 아카이브에 넣고 병합" → 막히면 자동 보관(E1a switch와 동일 패턴). E1a 이관: 충돌 파일 변경 취소 친절화, 보관함 "On <branch>:" 접두사 배지 파싱, 960px 커밋 폼 버튼 줄바꿈.

**실측으로 확정한 git 명령 (probe 저장소):**
- fast-forward 병합: exit 0 + stdout `Fast-forward`. 일반 병합 성공: exit 0(그 외). 이미 반영됨: `Already up to date.`
- 충돌: exit 1 + 출력(stdout)에 `CONFLICT`/`Automatic merge failed; fix conflicts and then commit the result.` — 충돌 상태가 남는다.
- dirty로 막힘: stderr `error: Your local changes to the following files would be overwritten by merge:` — switch와 같은 키 문구.
- 충돌 상태의 porcelain v2는 `u UU …` 라인 — 기존 status-parser가 conflicted로 매핑한다(기존 `!` 표시 동작).
- 충돌 파일 내용: `<<<<<<< HEAD` / `=======` / `>>>>>>> <branch>` 마커.
- `git checkout --theirs -- :(literal)path` + `git add -- :(literal)path` → `1 M.`(해소·staged)로 전환.
- 해소 후 `git commit -F -` → **merge commit 생성**(부모 2) — 기존 commits.create가 병합 마무리를 겸한다.
- `git merge --abort` → exit 0, 충돌 전 상태로 복귀(변경 0).
- unmerged 파일 `git restore --` → exit 1 `error: path '…' is unmerged` (discard 친절화의 근거).

**알려진 한계(의도적):** 한쪽 고르기는 **파일 단위**다(블록 단위 선택·앱 내 에디터는 다음 단계 — "직접 수정"은 외부 에디터로 고치고 앱에서 해결 표시). octopus 병합·rebase형 합치기는 다루지 않는다. 충돌 뷰는 텍스트 파일 전용(바이너리는 안내 문구), 1MB 상한. 자동 보관된 변경의 복원은 E1a와 동일하게 수동(보관함).

---

## 파일 구조

```
packages/domain/src/repository.ts                     # MergeResult (수정)
packages/git-adapter/src/client.ts                    # branches.merge·merge.abort·conflicts.*·files.readText (수정)
packages/ipc-contract/src/index.ts                    # merge/conflicts/files 채널 (수정)
apps/desktop/src/main/git-handlers.ts                 # 핸들러 6개 + assertConflictChoice (수정)
apps/desktop/src/preload/index.ts                     # 브리지 (수정)
apps/desktop/src/renderer/src/components/conflict-markers.ts # 마커 파서 (신규)
apps/desktop/src/renderer/src/components/ConflictPanel.tsx   # 충돌 뷰 (신규)
apps/desktop/src/renderer/src/components/shelf-message.ts    # "On <branch>:" 접두사 파싱 (신규, 이관)
apps/desktop/src/renderer/src/ui/ListDialog.tsx       # 목록 선택 다이얼로그 (신규)
apps/desktop/src/renderer/src/store/repository-store.ts # merge·conflict 액션 (수정)
apps/desktop/src/renderer/src/App.tsx                 # 합치기 버튼·머지 바·중앙 분기 (수정)
apps/desktop/src/renderer/src/components/ShelfPopover.tsx    # 접두사 배지 (수정, 이관)
apps/desktop/src/renderer/src/components/commit-form.css     # 960px 버튼 줄바꿈 (수정, 이관)
```

---

### Task 1: domain + 엔진 — branches.merge (스마트 병합)

**Files:**
- Modify: `packages/domain/src/repository.ts`, `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts`

- [ ] **Step 1: domain 타입**

`packages/domain/src/repository.ts`의 `SwitchResult` 블록 **뒤**에 추가:

```ts
/** 실험 공간 합치기 결과 */
export interface MergeResult {
  /** conflict면 충돌 상태가 남아 있다 — 해소·마무리(commit) 또는 취소(abort)가 필요하다 */
  outcome: 'fast-forward' | 'merged' | 'conflict' | 'up-to-date'
  /** 막혀서 변경을 보관함에 자동 저장했는가 (스펙: 덮기 전 자동 보관) */
  autoShelved: boolean
}
```

- [ ] **Step 2: 실패하는 통합 테스트**

`packages/git-adapter/test/client.test.ts`의 `'switch — 충돌 정리 중에는 읽히는 메시지로 거부한다'` 테스트 **뒤**에 추가:

```ts
  it('merge — 빨리 감기(fast-forward)와 병합 커밋을 구분해 알려준다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    // ff: main이 뒤처진 상태에서 exp를 합친다
    await client.branches.create('exp', null)
    await client.branches.switch('exp')
    await writeFixtureFile(repo, 'exp.txt', 'e\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'exp work'], { cwd: repo })
    await client.branches.switch('main')
    const ff = await client.branches.merge('exp')
    expect(ff).toEqual({ outcome: 'fast-forward', autoShelved: false })

    // merged: 서로 다른 파일을 바꾼 두 갈래
    await client.branches.create('exp2', null)
    await client.branches.switch('exp2')
    await writeFixtureFile(repo, 'exp2.txt', 'e2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'exp2 work'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'main.txt', 'm\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'main work'], { cwd: repo })
    const merged = await client.branches.merge('exp2')
    expect(merged).toEqual({ outcome: 'merged', autoShelved: false })
    const head = (await client.history.list(1))[0]!
    expect(head.parents).toHaveLength(2)
  })

  it('merge — 이미 반영된 공간은 up-to-date를 알려준다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('same', null)
    const result = await client.branches.merge('same')
    expect(result).toEqual({ outcome: 'up-to-date', autoShelved: false })
  })

  it('merge — 같은 줄을 바꾼 두 갈래는 conflict 상태로 남는다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival change'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'my change'], { cwd: repo })

    const result = await client.branches.merge('rival')
    expect(result).toEqual({ outcome: 'conflict', autoShelved: false })
    const status = await client.repo.status()
    expect(status.state).toBe('merging')
    expect(status.changes.find((c) => c.path === 'README.md')?.unstaged).toBe('conflicted')
  })

  it('merge — 막힌 변경은 보관함에 자동 저장하고 진행한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    // exp가 README를 바꿨고, main 워크트리에도 커밋 안 된 README 변경이 있다(덮어쓰기 차단 조건)
    await client.branches.create('exp', null)
    await client.branches.switch('exp')
    await writeFixtureFile(repo, 'README.md', '# from exp\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'exp readme'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# uncommitted\n')

    const result = await client.branches.merge('exp')
    expect(result).toEqual({ outcome: 'fast-forward', autoShelved: true })
    const shelf = await client.shelf.list()
    expect(shelf).toHaveLength(1)
    expect(shelf[0]!.message).toContain('실험 공간 합치기 자동 보관')
    const status = await client.repo.status()
    expect(status.changes).toEqual([])
  })

  it('merge — 없는 실험 공간은 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.branches.merge('no-such')).rejects.toThrow(/실험 공간이 없어요/)
  })
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run packages/git-adapter/test/client.test.ts --testNamePattern "merge"`
Expected: FAIL — `client.branches.merge is not a function`

- [ ] **Step 4: 구현**

`packages/git-adapter/src/client.ts` 수정:

(a) import 타입에 `type MergeResult,` 추가(알파벳 순서).

(b) `GitClient` 인터페이스 branches 블록의 `switch(...)` 행 **뒤**에 추가 (merge/conflicts/files 블록은 Task 2에서):

```ts
    /**
     * name 공간을 지금 공간으로 합친다(스마트 병합). 막히면 변경을 보관함에 자동 저장 후 재시도.
     * conflict면 충돌 상태를 남긴다 — 마무리는 commits.create(저장하기), 취소는 merge.abort.
     */
    merge(name: string): Promise<MergeResult>
```

(c) `AUTO_SHELF_MESSAGE` 상수 행 **뒤**에 추가:

```ts
/** 합치기가 막혀 자동 보관할 때의 보관함 메시지 */
const MERGE_SHELF_MESSAGE = '실험 공간 합치기 자동 보관'
```

(d) branches 구현부 `switch` **뒤**에 추가:

```ts
      async merge(name) {
        const cwd = await topLevel()
        const classify = (output: string): MergeResult['outcome'] => {
          if (output.includes('Already up to date')) return 'up-to-date'
          if (output.includes('Fast-forward')) return 'fast-forward'
          return 'merged'
        }
        const run = () => execGit(['merge', '--no-edit', '--end-of-options', name], { cwd })
        const first = await run()
        const firstOut = first.stdout + first.stderr
        if (first.exitCode === 0) return { outcome: classify(firstOut), autoShelved: false }
        if (firstOut.includes('not something we can merge')) {
          throw new Error(`"${name}"라는 실험 공간이 없어요.`)
        }
        if (firstOut.includes('CONFLICT') || firstOut.includes('Automatic merge failed')) {
          return { outcome: 'conflict', autoShelved: false }
        }
        if (!firstOut.includes('would be overwritten')) {
          throw new GitError(['merge', '--no-edit', '--end-of-options', name], first)
        }
        // 막혔다 — 스펙 원칙: 변경을 보관함에 자동 저장하고 진행한다 (E1a switch와 동일 패턴)
        await execGitOrThrow(['stash', 'push', '-u', '-m', MERGE_SHELF_MESSAGE], { cwd })
        const second = await run()
        const secondOut = second.stdout + second.stderr
        if (second.exitCode === 0) return { outcome: classify(secondOut), autoShelved: true }
        if (secondOut.includes('CONFLICT') || secondOut.includes('Automatic merge failed')) {
          return { outcome: 'conflict', autoShelved: true }
        }
        throw new GitError(['merge', '--no-edit', '--end-of-options', name], second)
      },
```

- [ ] **Step 5: 통과 확인 + 게이트**

Run: `pnpm test && pnpm typecheck`
Expected: **202 tests** PASS (197 + 5) + 5 Done

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/repository.ts packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(adapter): branches.merge — 스마트 병합(막히면 자동 보관), ff/merged/conflict/up-to-date

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 엔진 — merge.abort·conflicts·discard 친절화·files.readText

**Files:**
- Modify: `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts`

- [ ] **Step 1: 실패하는 테스트**

Task 1의 merge 테스트들 **뒤**에 추가:

```ts
  it('merge.abort — 충돌 상태를 버리고 합치기 전으로 돌아간다', async () => {
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

    await client.merge.abort()
    const status = await client.repo.status()
    expect(status.state).toBe('normal')
    expect(status.changes).toEqual([])
  })

  it('merge.abort — 합치는 중이 아니면 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.merge.abort()).rejects.toThrow(/합치는 중이 아니에요/)
  })

  it('conflicts — ours/theirs 확정과 직접 수정 표시가 해소(staged)로 이어진다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await writeFixtureFile(repo, 'second.md', 'r\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await writeFixtureFile(repo, 'second.md', 'm\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')

    await client.conflicts.resolve('README.md', 'theirs')
    let status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'README.md')?.unstaged).not.toBe('conflicted')
    expect(await client.files.readText('README.md')).toBe('# rival\n')

    // 직접 수정 후 해결 표시
    await writeFixtureFile(repo, 'second.md', 'hand-fixed\n')
    await client.conflicts.markResolved('second.md')
    status = await client.repo.status()
    expect(status.changes.some((c) => c.unstaged === 'conflicted')).toBe(false)

    // 저장하기(commit)가 병합을 마무리한다
    await client.commits.create('합치기 마무리')
    const head = (await client.history.list(1))[0]!
    expect(head.parents).toHaveLength(2)
  })

  it('discard — 충돌 중인 파일은 읽히는 메시지로 거부한다 (이관)', async () => {
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

    await expect(client.changes.discard(['README.md'], [])).rejects.toThrow(/충돌 화면에서/)
  })

  it('files.readText — 저장소 상대 텍스트만, 상한 초과·바이너리·밖 경로 거부', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    expect(await client.files.readText('README.md')).toBe('# fixture\n')
    await writeFixtureFile(repo, 'big.txt', 'x'.repeat(1_000_001))
    await expect(client.files.readText('big.txt')).rejects.toThrow(/너무 커요/)
    await writeFixtureFile(repo, 'bin.dat', 'a\0b')
    await expect(client.files.readText('bin.dat')).rejects.toThrow(/텍스트가 아닌/)
    await expect(client.files.readText('../outside.txt')).rejects.toThrow()
    await expect(client.files.readText('/etc/hosts')).rejects.toThrow()
  })
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run packages/git-adapter/test/client.test.ts --testNamePattern "abort|conflicts|충돌 중인|readText"`
Expected: FAIL — `client.merge`/`client.conflicts`/`client.files` 미존재, discard는 원어 에러

- [ ] **Step 3: 구현**

`packages/git-adapter/src/client.ts` 수정:

(a) 파일 상단 import에 추가 (`import { execGit, … }` 행 **뒤**):

```ts
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
```

(b) `GitClient` 인터페이스 branches 블록 **뒤**(shelf 앞)에 추가:

```ts
  merge: {
    /** 합치기 취소 — 충돌 상태를 버리고 합치기 전으로 되돌린다 */
    abort(): Promise<void>
  }
  conflicts: {
    /** 충돌 파일을 한쪽으로 확정한다 — ours=내 것 유지, theirs=가져온 것 사용. 해소(staged)로 표시된다 */
    resolve(path: string, choice: 'ours' | 'theirs'): Promise<void>
    /** 직접 수정을 마쳤다고 표시한다(git add) — 마커가 남았는지는 UI가 확인창으로 경고한다 */
    markResolved(path: string): Promise<void>
  }
  files: {
    /** 워크트리 텍스트 파일 읽기(충돌 뷰용) — 1MB 상한, 바이너리 거부 */
    readText(path: string): Promise<string>
  }
```

(c) 구현부 branches 블록 **뒤**(shelf 앞)에 추가:

```ts
    merge: {
      async abort() {
        const cwd = await topLevel()
        const result = await execGit(['merge', '--abort'], { cwd })
        if (result.exitCode !== 0) {
          if (result.stderr.includes('MERGE_HEAD')) {
            throw new Error('지금은 합치는 중이 아니에요.')
          }
          throw new GitError(['merge', '--abort'], result)
        }
      },
    },
    conflicts: {
      async resolve(path, choice) {
        const cwd = await topLevel()
        assertRepoRelative(path)
        // checkout --ours/--theirs는 충돌이 아닌 파일에서도 조용히 성공하며(exit 0, 실측)
        // 워크트리의 미저장 편집을 index 버전으로 덮어쓴다 — 충돌(unmerged) 파일만 통과시킨다
        const unmerged = await execGitOrThrow(['ls-files', '-u', '--', `:(literal)${path}`], { cwd })
        if (unmerged.stdout.trim() === '') {
          throw new Error('지금은 겹침(충돌) 상태가 아닌 파일이에요. 새로고침 후 다시 확인해 주세요.')
        }
        const side = choice === 'ours' ? '--ours' : '--theirs'
        await execGitOrThrow(['checkout', side, '--', `:(literal)${path}`], { cwd })
        await execGitOrThrow(['add', '--', `:(literal)${path}`], { cwd })
      },
      async markResolved(path) {
        const cwd = await topLevel()
        assertRepoRelative(path)
        await execGitOrThrow(['add', '--', `:(literal)${path}`], { cwd })
      },
    },
    files: {
      async readText(path) {
        const cwd = await topLevel()
        assertRepoRelative(path)
        const filePath = join(cwd, path)
        // 심볼릭 링크는 저장소 밖을 가리킬 수 있다(실측 — 문자열 검증으로는 못 막는다). 링크는 거부한다
        const stats = await lstat(filePath)
        if (stats.isSymbolicLink()) {
          throw new Error('링크 파일이라 내용을 보여드릴 수 없어요.')
        }
        const buffer = await readFile(filePath)
        if (buffer.byteLength > 1_000_000) {
          throw new Error('파일이 너무 커요. 외부 편집기로 열어 주세요.')
        }
        if (buffer.includes(0)) {
          throw new Error('텍스트가 아닌 파일이라 내용을 보여드릴 수 없어요.')
        }
        return buffer.toString('utf8')
      },
    },
```

(d) `changes.discard`의 restore 실행을 에러 매핑 형태로 교체 — 기존 `if (trackedPaths.length > 0) { await execGitOrThrow(['restore', …]) }` 블록을:

```ts
        if (trackedPaths.length > 0) {
          const restoreArgs = ['restore', '--', ...toPathspecs(trackedPaths)]
          const result = await execGit(restoreArgs, { cwd })
          if (result.exitCode !== 0) {
            // 충돌 중인 파일은 restore가 거부한다 — 원어 에러 대신 다음 행동을 안내한다 (E1a 이관)
            if (result.stderr.includes('is unmerged')) {
              throw new Error(
                '충돌 중인 파일은 변경 취소로 정리할 수 없어요. 충돌 화면에서 한쪽을 고르거나 병합을 취소해 주세요.',
              )
            }
            throw new GitError(restoreArgs, result)
          }
        }
```

- [ ] **Step 4: 통과 확인 + 게이트**

Run: `pnpm test && pnpm typecheck`
Expected: **207 tests** PASS (202 + 5) + 5 Done

- [ ] **Step 5: Commit**

```bash
git add packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(adapter): 병합 취소·충돌 확정(ours/theirs)·해결 표시·파일 읽기 + 충돌 discard 친절화

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2-보완: 엔진 가드 3건 (스펙 리뷰 실측 반영)

리뷰 실증: (1) `checkout --ours`가 **비충돌 파일에서 조용히 성공하며 미저장 편집을 덮어씀** — resolve에 unmerged 확인 가드, (2) readText가 심링크로 저장소 밖을 읽음 — lstat 거부, (3) 충돌이 남은 채 저장하면 원어 GitError 노출 — commits.create 매핑. Task 2의 resolve·readText 블록과 fs import가 갱신되었다.

**Files:**
- Modify: `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts`

- [ ] **Step 1: 실패하는 테스트 3개**

Task 2에서 추가한 `'files.readText — …'` 테스트 **뒤**에 추가:

```ts
  it('conflicts.resolve — 충돌이 아닌 파일은 거부한다 (미저장 편집 덮어쓰기 차단)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# precious edit\n')
    await expect(client.conflicts.resolve('README.md', 'ours')).rejects.toThrow(/충돌\) 상태가 아닌/)
    // 미저장 편집이 살아 있어야 한다
    expect(await client.files.readText('README.md')).toBe('# precious edit\n')
  })

  it('files.readText — 저장소 밖을 가리키는 심볼릭 링크를 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await symlink('/etc/hosts', join(repo, 'link-out'))
    await expect(client.files.readText('link-out')).rejects.toThrow(/링크 파일/)
  })

  it('commit — 겹침이 남아 있으면 읽히는 메시지로 거부한다', async () => {
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

    await expect(client.commits.create('아직 안 끝났는데')).rejects.toThrow(/정리해야 저장/)
  })
```

그리고 파일 상단 `import { existsSync } from 'node:fs'` 행의 import에 `symlink`를 추가한다 — `import { mkdir, mkdtemp } from 'node:fs/promises'`를 `import { mkdir, mkdtemp, symlink } from 'node:fs/promises'`로 교체.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run packages/git-adapter/test/client.test.ts --testNamePattern "충돌이 아닌|심볼릭|겹침이 남아"`
Expected: 3 FAIL — resolve는 조용히 성공(편집 소실), readText는 /etc/hosts 내용 반환, commit은 원어 GitError

- [ ] **Step 3: 구현 — 갱신 블록 byte 재동기화 + commits.create 매핑**

Task 2의 갱신된 resolve·readText 블록과 `lstat` import에 맞추고, `commits.create` 구현을 교체:

```ts
      async create(message) {
        const cwd = await topLevel()
        // 메시지는 stdin으로 전달해 따옴표·개행 이스케이프 문제를 피한다.
        // 빈 메시지는 git이 거부한다 — GitError로 전파된다.
        const result = await execGit(['commit', '-F', '-'], { cwd, stdin: message })
        if (result.exitCode !== 0) {
          // 겹침이 남은 채 저장(병합 마무리) 시도 — 원어 에러 대신 다음 행동을 안내한다 (리뷰 실측)
          if (result.stderr.includes('unmerged files')) {
            throw new Error('겹침(!)을 모두 정리해야 저장할 수 있어요.')
          }
          throw new GitError(['commit', '-F', '-'], result)
        }
      },
```

- [ ] **Step 4: 통과 확인 + 게이트**

Run: `pnpm test && pnpm typecheck`
Expected: **210 tests** PASS + 5 Done

- [ ] **Step 5: Commit**

```bash
git add packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "fix(adapter): resolve 비충돌 가드·readText 심링크 거부·충돌 중 저장 친절 에러

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: IPC — merge·conflicts·files 채널

**Files:**
- Modify: `packages/ipc-contract/src/index.ts`, `apps/desktop/src/main/git-handlers.ts`, `apps/desktop/src/preload/index.ts`

- [ ] **Step 1: contract**

(a) import 타입에 `MergeResult,` 추가(알파벳 순서).

(b) `GitApi`의 branches 블록에 `switch(...)` 행 **뒤**로 추가:

```ts
    /** name 공간을 지금 공간으로 합친다(스마트 병합) — conflict면 충돌 상태가 남는다 */
    merge(repoPath: string, name: string): Promise<MergeResult>
```

(c) `GitApi`의 branches 블록 **뒤**(shelf 앞)에 추가:

```ts
  merge: {
    abort(repoPath: string): Promise<void>
  }
  conflicts: {
    /** choice는 'ours'(내 것 유지) | 'theirs'(가져온 것 사용)만 허용된다 */
    resolve(repoPath: string, path: string, choice: 'ours' | 'theirs'): Promise<void>
    markResolved(repoPath: string, path: string): Promise<void>
  }
  files: {
    /** 워크트리 텍스트 읽기(충돌 뷰용) — 1MB 상한, 바이너리 거부 */
    readText(repoPath: string, path: string): Promise<string>
  }
```

(d) `CHANNELS`에 추가 (`branchesSwitch` 행 뒤):

```ts
  branchesMerge: 'branches:merge',
  mergeAbort: 'merge:abort',
  conflictsResolve: 'conflicts:resolve',
  conflictsMarkResolved: 'conflicts:mark-resolved',
  filesReadText: 'files:read-text',
```

- [ ] **Step 2: main 핸들러**

(a) `assertShelfRef` **뒤**에 추가:

```ts
/** 충돌 확정 방향은 두 값만 — 임의 문자열이 checkout 인자로 흘러가는 것을 차단 */
function assertConflictChoice(value: unknown): 'ours' | 'theirs' {
  if (value !== 'ours' && value !== 'theirs') {
    throw new Error('잘못된 요청 형식이에요.')
  }
  return value
}
```

(b) `branchesSwitch` 핸들러 **뒤**에 추가:

```ts
  ipcMain.handle(CHANNELS.branchesMerge, (_event, repoPath: unknown, name: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).branches.merge(assertString(name)),
  )

  ipcMain.handle(CHANNELS.mergeAbort, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).merge.abort(),
  )

  ipcMain.handle(
    CHANNELS.conflictsResolve,
    (_event, repoPath: unknown, path: unknown, choice: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).conflicts.resolve(
        assertString(path),
        assertConflictChoice(choice),
      ),
  )

  ipcMain.handle(CHANNELS.conflictsMarkResolved, (_event, repoPath: unknown, path: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).conflicts.markResolved(assertString(path)),
  )

  ipcMain.handle(CHANNELS.filesReadText, (_event, repoPath: unknown, path: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).files.readText(assertString(path)),
  )
```

- [ ] **Step 3: preload**

branches 블록에 `switch:` 행 **뒤**로 추가:

```ts
    merge: (repoPath, name) => ipcRenderer.invoke(CHANNELS.branchesMerge, repoPath, name),
```

branches 블록 **뒤**(shelf 앞)에 추가:

```ts
  merge: {
    abort: (repoPath) => ipcRenderer.invoke(CHANNELS.mergeAbort, repoPath),
  },
  conflicts: {
    resolve: (repoPath, path, choice) =>
      ipcRenderer.invoke(CHANNELS.conflictsResolve, repoPath, path, choice),
    markResolved: (repoPath, path) =>
      ipcRenderer.invoke(CHANNELS.conflictsMarkResolved, repoPath, path),
  },
  files: {
    readText: (repoPath, path) => ipcRenderer.invoke(CHANNELS.filesReadText, repoPath, path),
  },
```

- [ ] **Step 4: 게이트 + Commit**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build`
Expected: 210 tests + 5 Done + build

```bash
git add packages/ipc-contract/src/index.ts apps/desktop/src/main/git-handlers.ts apps/desktop/src/preload/index.ts
git commit -m "feat(ipc): merge·conflicts·files 채널 — choice는 경계에서 두 값만

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: renderer — 충돌 마커 파서 + 보관함 메시지 파서(이관)

**Files:**
- Create: `apps/desktop/src/renderer/src/components/conflict-markers.ts`, `apps/desktop/src/renderer/src/components/shelf-message.ts`
- Test: `apps/desktop/test/conflict-markers.test.ts`, `apps/desktop/test/shelf-message.test.ts`

- [ ] **Step 1: 실패하는 테스트**

Create `apps/desktop/test/conflict-markers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseConflictContent } from '../src/renderer/src/components/conflict-markers'

const SAMPLE = [
  'line1',
  '<<<<<<< HEAD',
  'MINE',
  '=======',
  'THEIRS',
  '>>>>>>> feat',
  'line3',
].join('\n')

describe('parseConflictContent', () => {
  it('마커 구간을 내 것/가져온 것으로 분류한다', () => {
    const rows = parseConflictContent(SAMPLE)
    expect(rows.map((r) => r.kind)).toEqual([
      'context',
      'marker-ours',
      'ours',
      'marker-sep',
      'theirs',
      'marker-theirs',
      'context',
    ])
    expect(rows[1]!.text).toBe('<<<<<<< HEAD')
    expect(rows[2]!.text).toBe('MINE')
    expect(rows[4]!.text).toBe('THEIRS')
  })

  it('마커가 없으면 전부 context — hasConflictMarkers는 false', () => {
    const rows = parseConflictContent('a\nb\n')
    expect(rows.every((r) => r.kind === 'context')).toBe(true)
  })

  it('충돌 블록 수를 센다', () => {
    const twice = `${SAMPLE}\nmid\n${SAMPLE}`
    const rows = parseConflictContent(twice)
    expect(rows.filter((r) => r.kind === 'marker-ours')).toHaveLength(2)
  })

  it('중첩·비정상 마커에서도 죽지 않는다 — 알 수 없는 구간은 context로', () => {
    const weird = '=======\n>>>>>>> x\nplain\n'
    const rows = parseConflictContent(weird)
    expect(rows).toHaveLength(3)
    expect(rows[2]!.kind).toBe('context')
  })
})
```

Create `apps/desktop/test/shelf-message.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseShelfMessage } from '../src/renderer/src/components/shelf-message'

describe('parseShelfMessage', () => {
  it('"On <branch>: " 접두사를 브랜치와 본문으로 나눈다', () => {
    expect(parseShelfMessage('On main: 직접 보관')).toEqual({ branch: 'main', text: '직접 보관' })
  })

  it('"WIP on <branch>: " (메시지 없는 stash)도 나눈다', () => {
    expect(parseShelfMessage('WIP on feat/x: abc1234 subject')).toEqual({
      branch: 'feat/x',
      text: 'abc1234 subject',
    })
  })

  it('접두사가 없으면 원문 그대로', () => {
    expect(parseShelfMessage('그냥 메시지')).toEqual({ branch: null, text: '그냥 메시지' })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run apps/desktop/test/conflict-markers.test.ts apps/desktop/test/shelf-message.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

Create `apps/desktop/src/renderer/src/components/conflict-markers.ts`:

```ts
/** 충돌 파일의 한 줄 — 마커 구간을 색으로 구분해 렌더하기 위한 분류 */
export interface ConflictRow {
  kind: 'context' | 'marker-ours' | 'ours' | 'marker-sep' | 'theirs' | 'marker-theirs'
  text: string
}

/**
 * 충돌 마커(<<<<<<< / ======= / >>>>>>>)를 구간으로 분류한다.
 * 비정상 순서의 마커는 죽지 않고 context로 취급한다(파일을 있는 그대로 보여주는 게 우선).
 */
export function parseConflictContent(content: string): ConflictRow[] {
  const lines = content.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  const rows: ConflictRow[] = []
  let zone: 'context' | 'ours' | 'theirs' = 'context'
  for (const line of lines) {
    if (zone === 'context' && line.startsWith('<<<<<<<')) {
      rows.push({ kind: 'marker-ours', text: line })
      zone = 'ours'
      continue
    }
    if (zone === 'ours' && line.startsWith('=======')) {
      rows.push({ kind: 'marker-sep', text: line })
      zone = 'theirs'
      continue
    }
    if (zone === 'theirs' && line.startsWith('>>>>>>>')) {
      rows.push({ kind: 'marker-theirs', text: line })
      zone = 'context'
      continue
    }
    rows.push({ kind: zone === 'context' ? 'context' : zone, text: line })
  }
  return rows
}

/** 충돌 블록이 남아 있는가 — "직접 수정했어요" 확인창 경고에 쓴다 */
export function hasConflictMarkers(content: string): boolean {
  return parseConflictContent(content).some((row) => row.kind === 'marker-ours')
}
```

Create `apps/desktop/src/renderer/src/components/shelf-message.ts`:

```ts
/** git stash가 붙이는 "On <branch>: "/"WIP on <branch>: " 접두사를 배지용으로 분리한다 (E1a 이관) */
export function parseShelfMessage(message: string): { branch: string | null; text: string } {
  const match = /^(?:WIP on|On) ([^:]+): (.*)$/.exec(message)
  if (match === null) return { branch: null, text: message }
  return { branch: match[1]!, text: match[2]! }
}
```

- [ ] **Step 4: 통과 확인 + Commit**

Run: `npx vitest run apps/desktop/test/conflict-markers.test.ts apps/desktop/test/shelf-message.test.ts`
Expected: PASS (7 tests)

```bash
git add apps/desktop/src/renderer/src/components/conflict-markers.ts apps/desktop/src/renderer/src/components/shelf-message.ts apps/desktop/test/conflict-markers.test.ts apps/desktop/test/shelf-message.test.ts
git commit -m "feat(desktop): 충돌 마커 파서 + 보관함 메시지 접두사 파서

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: renderer — store merge·충돌 액션

**Files:**
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`

- [ ] **Step 1: store 수정 (부분 삽입)**

(a) import 타입에 `MergeResult,`는 **불필요**(반환값을 바로 소비) — 대신 인터페이스 필드/액션만 추가한다. 인터페이스 `commitFile: CommitFileChange | null` 행 **뒤**에:

```ts
  /** 충돌 뷰 — 열려 있으면 중앙 패널이 충돌 해결 화면이 된다. diff·커밋 상세와 상호 배타 */
  conflictFile: { path: string; content: string } | null
```

(b) 인터페이스 액션 — `createBranch(...)` 행 **뒤**에:

```ts
  /** name 공간을 지금 공간으로 합친다(스마트 병합) — 결과를 notice로 안내한다 */
  mergeBranch(name: string): Promise<void>
  /** 합치기 취소 — 확인창(UI 책임)을 통과한 뒤에만 호출된다 */
  abortMerge(): Promise<void>
  /** 충돌 파일 열기 — 워크트리 내용을 읽어 충돌 뷰로 */
  selectConflict(path: string): Promise<void>
  /** 충돌 뷰 내용 재조회(외부 편집 반영) — 읽기 전용이라 guard 없이. 실패 시 null */
  reloadConflict(path: string): Promise<string | null>
  /** 충돌을 한쪽으로 확정한다 */
  resolveConflict(path: string, choice: 'ours' | 'theirs'): Promise<void>
  /** 직접 수정을 마쳤다고 표시한다 */
  markConflictResolved(path: string): Promise<void>
```

(c) `CLEAR_SELECTIONS` 상수에 `conflictFile: null,` 추가 (`commitFile: null,` 행 뒤).

(d) 초기 상태 — `commitFile: null,` 행 **뒤**에 `conflictFile: null,` 추가.

(e) `selectFile` 구현을 교체 — 충돌 파일은 diff 대신 충돌 뷰로 라우팅한다:

```ts
  async selectFile(selected) {
    const { repoPath } = get()
    if (!repoPath) return
    // 충돌 파일은 diff가 아니라 충돌 해결 화면으로 — 한쪽을 고르거나 직접 수정한다
    if (selected.change.staged === 'conflicted' || selected.change.unstaged === 'conflicted') {
      await get().selectConflict(selected.change.path)
      return
    }
    await guard(set, get, async () => {
      const untracked = selected.change.unstaged === 'untracked'
      const diff = await git().changes.diff(repoPath, selected.change.path, {
        staged: selected.staged,
        untracked,
        // staged rename은 원래 경로를 동봉해야 rename으로 표시된다 (unstage와 대칭)
        origPath: selected.staged ? selected.change.origPath : null,
      })
      // 파일 diff·커밋 상세·충돌 뷰는 상호 배타 — 중앙 패널이 하나다
      set({ selected, diff, commitDetail: null, commitFile: null, conflictFile: null })
    })
  },
```

(f) `clearCommit()` 구현 **뒤**에 추가:

```ts
  async mergeBranch(name) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      const result = await git().branches.merge(repoPath, name)
      const notices: Record<typeof result.outcome, string | null> = {
        'fast-forward': `"${name}"의 저장 내용을 모두 가져왔어요.`,
        merged: `"${name}"와 합쳤어요 — 병합 저장이 만들어졌어요.`,
        // 충돌 안내는 머지 바가 상주하며 담당한다 — notice까지 겹치면 같은 문장이 2줄이 된다 (리뷰 반영)
        conflict: null,
        'up-to-date': '이미 모두 반영되어 있어요.',
      }
      const shelfNotice = result.autoShelved
        ? ' 저장 안 된 변경은 보관함에 넣어뒀어요.'
        : ''
      set({
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: `${notices[result.outcome] ?? ''}${shelfNotice}` || null,
      })
    })
  },

  async abortMerge() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().merge.abort(repoPath)
      set({
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: '합치기를 취소하고 이전 상태로 돌아왔어요.',
      })
    })
  },

  async selectConflict(path) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      const content = await git().files.readText(repoPath, path)
      set({
        conflictFile: { path, content },
        selected: null,
        diff: null,
        commitDetail: null,
        commitFile: null,
      })
    })
  },

  async reloadConflict(path) {
    const { repoPath } = get()
    if (!repoPath) return null
    // 읽기 전용 재조회 — guard(busy)를 잡지 않아 확인 흐름을 막지 않는다
    try {
      const content = await git().files.readText(repoPath, path)
      set({ conflictFile: { path, content } })
      return content
    } catch (cause) {
      set({ error: toErrorMessage(cause) })
      return null
    }
  },

  async resolveConflict(path, choice) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().conflicts.resolve(repoPath, path, choice)
      set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async markConflictResolved(path) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().conflicts.markResolved(repoPath, path)
      set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },
```

- [ ] **Step 2: 게이트 + Commit**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build`
Expected: 217 tests + 5 Done + build

```bash
git add apps/desktop/src/renderer/src/store/repository-store.ts
git commit -m "feat(desktop): store — 합치기·취소·충돌 뷰 라우팅·한쪽 확정·해결 표시

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: renderer — ListDialog·ConflictPanel

**Files:**
- Create: `apps/desktop/src/renderer/src/ui/ListDialog.tsx`, `apps/desktop/src/renderer/src/ui/list-dialog.css`, `apps/desktop/src/renderer/src/components/ConflictPanel.tsx`, `apps/desktop/src/renderer/src/components/conflict-panel.css`

- [ ] **Step 1: ListDialog**

Create `apps/desktop/src/renderer/src/ui/ListDialog.tsx`:

```tsx
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { Button } from './Button'
import './confirm-dialog.css'
import './list-dialog.css'

export interface ListDialogOption {
  key: string
  label: string
  meta?: string
}

interface ListDialogProps {
  isOpen: boolean
  title: string
  description: string
  options: ListDialogOption[]
  emptyText: string
  onSelect(key: string): void
  onCancel(): void
}

/** 목록에서 하나 고르는 다이얼로그 — 합치기 대상 선택 등 */
export function ListDialog({
  isOpen,
  title,
  description,
  options,
  emptyText,
  onSelect,
  onCancel,
}: ListDialogProps) {
  return (
    <ModalOverlay
      className="ui-modal-overlay"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      isDismissable
    >
      <Modal className="ui-modal">
        <Dialog className="ui-dialog">
          <Heading slot="title" className="ui-dialog__title">
            {title}
          </Heading>
          <p className="ui-dialog__body">{description}</p>
          {options.length === 0 ? (
            <p className="ui-list-dialog__empty">{emptyText}</p>
          ) : (
            <ul className="ui-list-dialog__list">
              {options.map((option) => (
                <li key={option.key}>
                  <button
                    type="button"
                    className="ui-list-dialog__option"
                    onClick={() => onSelect(option.key)}
                    data-testid={`list-option-${option.key}`}
                  >
                    <span className="ui-list-dialog__label">{option.label}</span>
                    {option.meta && <span className="ui-list-dialog__meta">{option.meta}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="ui-dialog__actions">
            <Button variant="ghost" size="sm" onPress={onCancel} testId="list-cancel">
              그만두기
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
```

Create `apps/desktop/src/renderer/src/ui/list-dialog.css`:

```css
.ui-list-dialog__list {
  list-style: none;
  margin: 0 0 var(--space-4);
  padding: 0;
  max-height: 260px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ui-list-dialog__option {
  width: 100%;
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
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
.ui-list-dialog__option:hover {
  background: var(--color-surface-sunken);
}
.ui-list-dialog__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ui-list-dialog__meta {
  flex: none;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
.ui-list-dialog__empty {
  margin: 0 0 var(--space-4);
  padding: var(--space-4) 0;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  text-align: center;
}
```

- [ ] **Step 2: ConflictPanel**

Create `apps/desktop/src/renderer/src/components/ConflictPanel.tsx`:

```tsx
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, Download, User } from 'lucide-react'
import { useRef, useState } from 'react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Panel } from '../ui/Panel'
import { hasConflictMarkers, parseConflictContent } from './conflict-markers'
import './conflict-panel.css'
import './virtual.css'

interface ConflictPanelProps {
  path: string
  content: string
  busy: boolean
  /** 한쪽 확정 — ours=내 것 유지, theirs=가져온 것 사용 */
  onResolve(choice: 'ours' | 'theirs'): void
  /** 직접 수정을 마쳤다고 표시 — 마커가 남아 있으면 확인창을 거친다 */
  onMarkResolved(): void
  /** 최신 파일 내용 재조회 — 외부 편집 후의 stale 마커 검사(거짓 경고)를 막는다. 실패 시 null */
  onReload(): Promise<string | null>
}

/**
 * 충돌 해결 화면 (스펙 A안+B) — 파일 단위로 한쪽을 고르거나, 외부에서 직접 수정한 뒤 해결 표시.
 * 초록 구간 = 내 것(HEAD), 보라 구간 = 가져온 것.
 */
export function ConflictPanel({
  path,
  content,
  busy,
  onResolve,
  onMarkResolved,
  onReload,
}: ConflictPanelProps) {
  const [confirmingMark, setConfirmingMark] = useState(false)
  const rows = parseConflictContent(content)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 21,
    overscan: 20,
  })
  const markResolved = () => {
    void (async () => {
      // 외부 편집기에서 마커를 지웠을 수 있다 — 열 때 읽은 내용이 아니라 최신 내용으로 검사한다 (거짓 경고 방지)
      const fresh = await onReload()
      if (fresh === null) return
      if (hasConflictMarkers(fresh)) setConfirmingMark(true)
      else onMarkResolved()
    })()
  }

  return (
    <Panel
      title={`${path} — 겹침 해결`}
      accessory={<Badge tone="git">conflict</Badge>}
      testId="conflict-panel"
    >
      <p className="conflict-panel__hint">
        초록 구간이 <strong>내 것</strong>, 보라 구간이 <strong>가져온 것</strong>이에요. 한쪽을
        고르면 파일 전체가 그쪽으로 정리돼요. 세밀하게 고치려면 편집기에서 직접 수정한 뒤 "직접
        수정했어요"를 눌러 주세요.
      </p>
      {/* 해결 버튼은 헤더가 아니라 전용 줄에 — 좁은 폭에서도 잘리지 않고 줄바꿈된다 (리뷰 실측) */}
      <div className="conflict-panel__actions">
        <Button
          variant="neutral"
          size="sm"
          isDisabled={busy}
          onPress={() => onResolve('ours')}
          testId="conflict-ours"
        >
          <User size={13} aria-hidden="true" /> 내 것 유지
        </Button>
        <Button
          variant="neutral"
          size="sm"
          isDisabled={busy}
          onPress={() => onResolve('theirs')}
          testId="conflict-theirs"
        >
          <Download size={13} aria-hidden="true" /> 가져온 것 사용
        </Button>
        <Button
          variant="ghost"
          size="sm"
          isDisabled={busy}
          onPress={markResolved}
          testId="conflict-mark"
        >
          <Check size={13} aria-hidden="true" /> 직접 수정했어요
        </Button>
      </div>
      <div ref={scrollRef} className="virtual-scroll" data-testid="conflict-view">
        <div
          className="conflict-panel__code"
          style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]!
            return (
              <div
                key={item.index}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="virtual-row"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <div className={`conflict-line conflict-line--${row.kind}`}>
                  <span className="conflict-line__text">{row.text || ' '}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <ConfirmDialog
        isOpen={confirmingMark}
        title="겹침 표시가 아직 남아 있어요"
        confirmLabel="그래도 표시"
        onConfirm={() => {
          setConfirmingMark(false)
          onMarkResolved()
        }}
        onCancel={() => setConfirmingMark(false)}
      >
        파일에 겹침 표시(&lt;&lt;&lt;&lt;&lt;&lt;&lt;)가 그대로 있어요. 이대로 해결 표시하면 표시
        줄까지 저장돼요. 편집기에서 정리한 뒤 다시 시도하는 것을 권해요.
      </ConfirmDialog>
    </Panel>
  )
}
```

Create `apps/desktop/src/renderer/src/components/conflict-panel.css`:

```css
.conflict-panel__hint {
  margin: 0;
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
  line-height: 1.7;
}
/* 좁은 폭에서 버튼이 잘리는 대신 줄바꿈된다 */
.conflict-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--color-border);
}
.conflict-panel__code {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.7;
}
.conflict-line {
  display: flex;
}
.conflict-line__text {
  flex: 1;
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: 0 var(--space-4);
}
/* 초록 = 내 것(mine), 보라 = 가져온 것(branch) — 앱 전체의 개념 색과 일치 (스펙 10장) */
.conflict-line--ours {
  background: var(--concept-mine-bg);
}
.conflict-line--theirs {
  background: var(--concept-branch-bg);
}
.conflict-line--marker-ours,
.conflict-line--marker-sep,
.conflict-line--marker-theirs {
  color: var(--color-text-faint);
  background: var(--color-surface-sunken);
}
```

- [ ] **Step 3: 게이트 + Commit**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build`
Expected: 217 tests + 5 Done + build

```bash
git add apps/desktop/src/renderer/src/ui apps/desktop/src/renderer/src/components
git commit -m "feat(desktop): ListDialog·ConflictPanel — 한쪽 고르기·직접 수정 표시·마커 경고

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: App 배선 — 합치기 버튼·머지 바·중앙 분기 + 이관 폴리시

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`, `apps/desktop/src/renderer/src/layout.css`, `apps/desktop/src/renderer/src/components/ShelfPopover.tsx`, `apps/desktop/src/renderer/src/components/commit-form.css`

- [ ] **Step 1: App.tsx**

(a) import 추가 — `import { CloudUpload, Moon, RefreshCw, Sun } from 'lucide-react'`를 `import { CloudUpload, GitMerge, Moon, RefreshCw, Sun } from 'lucide-react'`로 교체. `import { ChangesPanel } …` 행 **앞**에:

```tsx
import { ConflictPanel } from './components/ConflictPanel'
```

`import { PromptDialog } …` 행 **뒤**에:

```tsx
import { ConfirmDialog } from './ui/ConfirmDialog'
import { ListDialog } from './ui/ListDialog'
```

(b) `branchPrompt` 상태 **뒤**에 추가:

```tsx
  // 합치기 대상 선택·취소 확인
  const [mergePicker, setMergePicker] = useState(false)
  const [confirmingAbort, setConfirmingAbort] = useState(false)
```

(c) 헤더 `app__status` 안, BranchSwitcher **뒤**에 합치기 버튼 추가:

```tsx
            <Button
              variant="ghost"
              size="sm"
              isDisabled={store.busy || status.state === 'merging'}
              onPress={() => setMergePicker(true)}
              testId="merge-open"
            >
              <GitMerge size={13} aria-hidden="true" /> 합치기 <Badge tone="git">merge</Badge>
            </Button>
```

(d) notice 배너 블록 **뒤**에 머지 바 추가:

그리고 `const stagedCount = …` 행 **뒤**에 계산 추가:

```tsx
  const conflictCount = status?.changes.filter((c) => c.unstaged === 'conflicted').length ?? 0
```

```tsx
      {status?.state === 'merging' && (
        <div className="app__merge-bar" data-testid="merge-bar">
          <Pictogram kind="conflict" size={14} label="합치는 중" />
          {/* 문구는 상태 인지형 — 0개가 되는 전환점에서 다음 행동(저장하기)을 짚어 준다 (리뷰 반영) */}
          <span className="app__merge-text" data-testid="merge-remaining">
            {conflictCount > 0
              ? `실험 공간 합치는 중 — 겹침 ${conflictCount}개 남음. 붉은 ! 파일에서 한쪽을 고르고, 다 정리되면 저장하기로 마무리해요.`
              : '실험 공간 합치는 중 — 겹침 0개 남음. 이제 저장하기로 마무리해요.'}
          </span>
          <Button
            variant="danger"
            size="sm"
            isDisabled={store.busy}
            onPress={() => setConfirmingAbort(true)}
            testId="merge-abort"
          >
            합치기 취소
          </Button>
        </div>
      )}
```

(e) 중앙 분기 — `<DiffPanel` 블록을 감싸 충돌 뷰 우선으로 교체:

```tsx
          {store.conflictFile !== null ? (
            <ConflictPanel
              path={store.conflictFile.path}
              content={store.conflictFile.content}
              busy={store.busy}
              onResolve={(choice) => void store.resolveConflict(store.conflictFile!.path, choice)}
              onMarkResolved={() => void store.markConflictResolved(store.conflictFile!.path)}
              onReload={() => store.reloadConflict(store.conflictFile!.path)}
            />
          ) : (
            <DiffPanel
              path={
                store.commitFile !== null && store.commitDetail !== null
                  ? `${store.commitFile.path} — 저장 ${store.commitDetail.shortHash}`
                  : store.selected?.change.path ?? null
              }
              diff={store.diff}
              busy={store.busy}
              onClose={() =>
                store.commitFile !== null ? store.clearCommitFile() : store.clearSelection()
              }
            />
          )}
```

(f) PromptDialog **뒤**에 다이얼로그 2개 추가:

```tsx
      <ListDialog
        isOpen={mergePicker}
        title="어느 실험 공간을 합칠까요?"
        description="고른 공간의 저장 내용을 지금 공간으로 가져와 합쳐요. 저장 안 된 변경이 겹치면 보관함에 넣고 진행해요."
        options={store.branches
          .filter((branch) => !branch.isCurrent)
          .map((branch) => ({ key: branch.name, label: branch.name }))}
        emptyText="합칠 다른 실험 공간이 없어요."
        onSelect={(name) => {
          setMergePicker(false)
          void store.mergeBranch(name)
        }}
        onCancel={() => setMergePicker(false)}
      />
      <ConfirmDialog
        isOpen={confirmingAbort}
        title="합치기를 취소할까요?"
        confirmLabel="합치기 취소"
        onConfirm={() => {
          setConfirmingAbort(false)
          void store.abortMerge()
        }}
        onCancel={() => setConfirmingAbort(false)}
      >
        지금까지 고른 것을 되돌리고 합치기 전 상태로 돌아가요.
      </ConfirmDialog>
```

- [ ] **Step 2: layout.css — 머지 바**

`.app__notice` 블록 **뒤**에 추가:

```css
.app__merge-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: 0;
  padding: var(--space-2) var(--space-5);
  background: var(--concept-conflict-bg);
  color: var(--concept-conflict);
  font-size: var(--text-sm);
  font-weight: 600;
  flex: none;
}
/* 메시지 span만 — `> span`은 Pictogram 루트(span)까지 잡아 아이콘이 중앙으로 밀린다 (리뷰 실측) */
.app__merge-text {
  flex: 1;
  min-width: 0;
}
```

그리고 `.app__state` 블록에 `white-space: nowrap;` 행을 추가하고, `.app__actions .ui-button` 규칙 **뒤**에 추가 (960px에서 합치기 버튼·상태 라벨 세로 꺾임 방지 — 리뷰 실측):

```css
.app__status .ui-button {
  white-space: nowrap;
  flex: none;
}
```

- [ ] **Step 3: 이관 폴리시 — 보관함 접두사 배지·커밋 폼 줄바꿈**

(a) `apps/desktop/src/renderer/src/components/ShelfPopover.tsx`:
- import에 `import { parseShelfMessage } from './shelf-message'` 추가 (`import { formatRelativeTime } …` 행 뒤)
- 목록 row의 `.shelf-popover__meta` div 내부를 교체:

```tsx
                    <div className="shelf-popover__meta">
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
                    </div>
```

- `apps/desktop/src/renderer/src/components/shelf-popover.css`의 `.shelf-popover__time` 블록을 교체:

```css
.shelf-popover__time {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
.shelf-popover__branch {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
}
```

(b) `apps/desktop/src/renderer/src/components/commit-form.css` 끝에 추가 (960px 이관):

```css
/* 좁은 창에서 버튼 라벨이 줄바꿈되지 않게 (E1a 이관) — 제출 버튼은 공용 Button이라 type 셀렉터로 잡는다 */
.commit-form button[type='submit'] {
  white-space: nowrap;
}
```

- [ ] **Step 4: 게이트 + Commit**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: 217 tests + 5 Done + build + **E2E 14 passed** (기존 회귀 없음)

```bash
git add apps/desktop/src/renderer/src
git commit -m "feat(desktop): 합치기 버튼·머지 바·충돌 뷰 배선 + 보관함 접두사 배지·커밋 폼 줄바꿈

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: E2E — 합치기·충돌 해소·취소·스마트 병합 4종

**Files:**
- Test: `apps/desktop/e2e/smoke.spec.ts`

- [ ] **Step 1: E2E 4개 추가** (`smoke.spec.ts` 끝)

```ts
test('다른 실험 공간을 합친다 (빨리 감기)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'exp'], { cwd: repo })
  await writeFile(join(repo, 'exp.txt'), 'e\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'exp work'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-count')).toHaveText('1')
    await window.getByTestId('merge-open').click()
    await window.getByTestId('list-option-exp').click()
    await expect(window.getByTestId('notice')).toContainText('모두 가져왔어요')
    await expect(window.getByTestId('history-count')).toHaveText('2')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('겹치면 충돌 화면에서 한쪽을 고르고 저장하기로 마무리한다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'rival'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'rival\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'rival'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'mine\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'mine'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('merge-open').click()
    await window.getByTestId('list-option-rival').click()
    // 충돌 상태 — 머지 바와 ! 파일
    await expect(window.getByTestId('merge-bar')).toContainText('겹침 1개 남음')
    await window.getByTestId('file-unstaged-app.txt').click()
    await expect(window.getByTestId('conflict-view')).toContainText('rival')
    await window.getByTestId('conflict-theirs').click()
    // 해소 — 머지 바 0개, staged로 이동
    await expect(window.getByTestId('merge-bar')).toContainText('겹침 0개 남음')
    await expect(window.getByTestId('staged-count')).toHaveText('1')
    // 저장하기 = 병합 마무리
    await window.getByTestId('commit-message').fill('합치기 마무리')
    await window.getByTestId('commit-button').click()
    await expect(window.getByTestId('merge-bar')).toHaveCount(0)
    await expect(window.getByTestId('history-count')).toHaveText('4')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('합치기를 취소하면 이전 상태로 돌아온다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'rival'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'rival\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'rival'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'mine\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'mine'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('merge-open').click()
    await window.getByTestId('list-option-rival').click()
    await expect(window.getByTestId('merge-bar')).toBeVisible()
    await window.getByTestId('merge-abort').click()
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId('merge-bar')).toHaveCount(0)
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')
    await expect(window.getByTestId('notice')).toContainText('취소')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('저장 안 된 변경이 겹치면 보관함에 넣고 합친다 (스마트 병합)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'exp'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'from exp\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'exp change'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'uncommitted\n')
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('unstaged-count')).toHaveText('1')
    await window.getByTestId('merge-open').click()
    await window.getByTestId('list-option-exp').click()
    await expect(window.getByTestId('notice')).toContainText('보관함')
    await expect(window.getByTestId('shelf-count')).toHaveText('1')
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: 검출력 실증 → 전체 게이트**

검출력: `merge-open` testid 임시 오타 변이 → 첫 테스트 FAIL 확인 후 원복.

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: **217 tests + typecheck 5 + build + E2E 18 passed** — 전부 exit 0

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts
git commit -m "test(desktop): E2E — 합치기 ff·충돌 한쪽 고르기·취소·스마트 병합

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### E1b-보완: UI 품질 리뷰 반영 — 머지 바 CSS·해결 버튼 줄바꿈·거짓 경고·문구

품질 리뷰 실측 5건 반영. 정본 블록들이 갱신되었다: ConflictPanel(버튼을 헤더→전용 줄로 이동·onReload 최신 검사·확인창 제목 '겹침'), conflict-panel.css(`__actions`), App(conflictCount 계산·상태 인지형 머지 바 문구·`app__merge-text`·onReload 배선), layout.css(`__merge-text`·`.app__state` nowrap·`.app__status .ui-button`), store(conflict notice null — 머지 바가 담당·reloadConflict).

**Files:** 위 갱신 블록들의 해당 파일 (신규 파일·테스트 없음 — 게이트 수치 불변)

- [ ] **Step 1: 갱신 블록 전부 byte 재동기화**

ConflictPanel.tsx 전체, conflict-panel.css, App.tsx(merge 바·conflictCount·onReload), layout.css, repository-store.ts(인터페이스 reloadConflict·구현·notices.conflict null).

- [ ] **Step 2: 전체 게이트**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: **217 tests + typecheck 5 + build + E2E 18 passed** — 전부 exit 0 (기존 E2E의 '겹침 1개 남음'·'겹침 0개 남음' 단언은 새 문구에도 포함되어 유지된다)

- [ ] **Step 3: 실렌더 재확인**

(a) 머지 바 — 아이콘 왼쪽 고정·문구 좌측 정렬(› span 파손 해소), (b) 960px 충돌 뷰 — 버튼 3개 전부 보이고 클릭 가능(줄바꿈), (c) 960px 헤더 — 합치기 버튼·상태 라벨 한 줄, (d) 외부에서 마커 지우고 "직접 수정했어요" → 경고 없이 해소, (e) 겹침 0개 문구 전환 — 스크린샷 확인.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src
git commit -m "fix(desktop): 머지 바 셀렉터·해결 버튼 줄바꿈·직접 수정 최신 검사·상태 인지 문구

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 최종 게이트 + 스크린샷 + README

- [ ] **Step 1: 전체 게이트**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: 217 tests + typecheck 5 + build + **E2E 18 passed** — 전부 exit 0

- [ ] **Step 2: 스크린샷 3장** (1440×900, `apps/desktop/test-results/` + scratchpad 사본. **생성 후 playwright/e2e 재실행 금지**)

- (a) `e1b-conflict.png` — 충돌 상태: 머지 바(겹침 N개 남음·합치기 취소) + 충돌 뷰(초록 내 것/보라 가져온 것 구간·버튼 3개)
- (b) `e1b-merge-picker.png` — 합치기 다이얼로그(브랜치 목록) 열림
- (c) `e1b-shelf-badge.png` — 보관함 팝오버: 접두사 파싱된 항목(브랜치 배지 + 본문) — 다크 모드

- [ ] **Step 3: README "현재 상태" 갱신**

나열에서 "보관함(stash) 넣기/꺼내기/버리기, " 뒤에 "실험 공간 합치기(merge — 충돌 시 한쪽 고르기/직접 수정/취소, 막히면 자동 보관), "를 추가한다.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README — E1b 합치기·충돌 해결 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 9-보완: 통합 리뷰 반영 — merging 상태 원어 에러 2건·상호배타 1줄·README

통합 리뷰 실측: (1) merging 중 브랜치 전환 → `cannot switch branch while merging` 원어 노출(E1a 매핑이 stash pop형 문구만 커버), (2) merging 중 보관하기 → `could not write index` 원어 노출, (3) 충돌 뷰 열린 채 커밋 클릭 → 중앙이 ConflictPanel에 점유된 채 상세 diff 불가(`selectCommit`이 conflictFile 미해제), (4) README 서두·"다음 단계"가 완료 항목을 미래로 나열.

**Files:**
- Modify: `packages/git-adapter/src/client.ts`, `packages/git-adapter/test/client.test.ts`, `apps/desktop/src/renderer/src/store/repository-store.ts`, `README.md`

- [ ] **Step 1: 실패하는 테스트 2개** (client.test.ts — merge 충돌 fixture 재사용, 'commit — 겹침이 남아 있으면…' 테스트 **뒤**)

```ts
  it('switch — 합치는 중(merging)에도 읽히는 메시지로 거부한다', async () => {
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

    await expect(client.branches.switch('rival')).rejects.toThrow(/충돌 정리/)
    await expect(client.shelf.save('합치는 중 보관')).rejects.toThrow(/정리해야 보관/)
  })
```

- [ ] **Step 2: 실패 확인** — merging에서 switch는 GitError 원문(`cannot switch branch while merging`), save는 `could not write index` 원문으로 FAIL

- [ ] **Step 3: 구현**

(a) client.ts switch의 `resolve your current index` 분기를 두 문구 겸용으로 교체:

```ts
        if (
          first.stderr.includes('resolve your current index') ||
          first.stderr.includes('cannot switch branch while merging')
        ) {
          throw new Error('충돌 정리(!)를 먼저 끝내야 다른 실험 공간으로 이동할 수 있어요.')
        }
```

(b) shelf.save를 에러 매핑 형태로 교체:

```ts
      async save(message) {
        const cwd = await topLevel()
        const result = await execGit(['stash', 'push', '-u', '-m', message], { cwd })
        if (result.exitCode !== 0) {
          // 충돌(unmerged) 중에는 stash가 index를 쓸 수 없다 — 원어 대신 다음 행동을 안내한다 (통합 리뷰 실측)
          if (result.stderr.includes('could not write index')) {
            throw new Error('겹침(!)을 먼저 정리해야 보관할 수 있어요.')
          }
          throw new GitError(['stash', 'push', '-u', '-m', message], result)
        }
        if (result.stdout.includes('No local changes to save')) {
          throw new Error('보관할 변경이 없어요.')
        }
      },
```

(c) store `selectCommit`의 set에 `conflictFile: null,`을 추가한다 (`commitFile: null,` 뒤) — 충돌 뷰·커밋 상세 상호배타 복원.

(d) README: 서두 "0단계(기반)와 E0(쉬운 모드 기초)가 동작합니다"를 "0단계(기반)와 E0·E1(쉬운 모드 — 실험 공간·보관함·합치기)이 동작합니다"로. "다음 단계" 목록에서 이미 완료된 항목(보관함·실험 공간 만들기·합치기, 보관함 UI·스마트 병합)을 제거하거나 완료 표시로 정리한다 — 실제 README를 읽고 반영, 최종 diff 보고.

- [ ] **Step 4: 게이트 + 실렌더 1건**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: **218 tests** + typecheck 5 + build + **E2E 18 passed**

실렌더: 충돌 뷰 열린 채 커밋 클릭 → 중앙이 상세 파일 diff로 정상 전환되는지 확인.

- [ ] **Step 5: Commit**

```bash
git add packages/git-adapter apps/desktop/src/renderer/src/store/repository-store.ts README.md
git commit -m "fix: merging 중 전환·보관 친절 에러, 충돌 뷰-커밋 상세 상호배타, README 정리

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 검증 게이트 요약

| 시점 | 기대치 |
| --- | --- |
| Task 1 후 | 202 tests (197 + merge 5) |
| Task 2 후 | +5 → 207, 보완 +3(가드) → **210 tests** |
| Task 4 후 | +7 (markers 4·shelf-message 3) → 217 tests |
| Task 7 후 | E2E 14 (기존 회귀 없음) |
| Task 8 후 | **E2E 18** |
| Task 9-보완 후 | +1 (merging 매핑) → 218 |
| 최종 | 218 tests + typecheck 5 + build + E2E 18 — 전부 exit 0 |

(수치가 어긋나면 이 표를 갱신한다 — 본질은 "전부 PASS + 신규 테스트 실존".)

## 후속 노트 (E1c 이관 후보)

- 블록 단위 충돌 선택·앱 내 편집기, pull/fetch(가져오기), 브랜치 삭제·이름 바꾸기, 우클릭 revert(되돌리기 엔진)
- stash pop 충돌(비-merge unmerged) 상태는 머지 바가 뜨지 않는다(MERGE_HEAD 부재) — 충돌 뷰 진입은 가능, 마무리 안내는 merge 전용
- E1a 후속 노트 잔여: 팝오버 ESC 불응, PromptDialog 인라인 에러
