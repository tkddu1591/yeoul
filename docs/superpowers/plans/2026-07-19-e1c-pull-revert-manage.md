# E1c 받아오기(pull)·되돌리기(revert)·실험 공간 관리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원격의 최신 저장을 받아오고(pull — 겹치면 기존 충돌 흐름 재사용), 히스토리 우클릭으로 특정 저장을 되돌리고(revert), 실험 공간을 지우거나 이름을 바꾸며, 충돌 뷰를 다듬는다(다음 겹침 점프·개념색 버튼·다이얼로그 인라인 에러).

**Architecture:** pull은 merge와 동일 골격(선시도 → `would be overwritten`이면 자동 보관 → 재시도, 충돌이면 MERGE_HEAD가 남아 **기존 머지 바·충돌 뷰가 그대로 동작**). revert는 충돌 시 REVERT_HEAD → 기존 `reverting` 상태 감지에 얹어 상태 바를 merging/reverting 겸용으로 일반화한다(취소는 각각 merge --abort / revert --abort, 마무리는 둘 다 저장하기=commit). 브랜치 관리(지우기·이름 바꾸기)는 스위처의 "관리…" 항목 → ManageBranchesDialog. merge commit revert는 재시도 로직으로 `-m 1`(첫 부모 기준 — 앱 전체 원칙과 일치).

**Tech Stack:** 기존과 동일 (신규 의존성 없음).

**실측으로 확정한 git 명령 (probe — bare remote·revert·branch 관리):**
- `git pull --no-rebase --no-edit`: up-to-date `Already up to date.` / behind ff `Updating …`+`Fast-forward` / diverged 충돌 exit 1 + `CONFLICT` + **MERGE_HEAD 생성**(→ 기존 merging 흐름 그대로) / dirty 차단 `would be overwritten by merge` / upstream 없음 `There is no tracking information for the current branch.`
- `git revert --no-edit <hash>`: 성공 시 `Revert "<subject>"` 커밋 생성 / 충돌 시 exit 1 + **REVERT_HEAD 생성**(detectState `reverting` 기존 지원) + `git revert --abort` 복귀 / merge commit이면 `is a merge but no -m option was given` → `-m 1` 재시도로 성공.
- `git branch -d <name>`: unmerged면 exit 1 `the branch '<name>' is not fully merged` → `-D`로 강제 성공. 현재 브랜치는 `cannot delete branch … used by worktree`. rename은 `git branch -m old new`, 중복이면 `a branch named '<name>' already exists`.

**알려진 한계(의도적):** pull은 merge 방식(--no-rebase) 고정 — rebase형은 다루지 않는다. fetch 단독 버튼은 두지 않는다(받아오기 = fetch+merge 통합, ahead/behind는 백업·받아오기 후 갱신). revert 대상이 이미 되돌려진 경우의 중복 revert는 git 결과 그대로(빈 revert는 git이 안내). 원격 인증(HTTPS 토큰 등) 실패는 GIT_TERMINAL_PROMPT=0으로 즉시 실패하며 원문이 노출될 수 있다 — 인증 UX는 협업 단계(E2).

---

## 파일 구조

```
packages/domain/src/repository.ts                  # PullResult·RevertResult·RemoveBranchResult (수정)
packages/git-adapter/src/client.ts                 # sync.pull·commits.revert/revertAbort·branches.remove/rename (수정)
packages/ipc-contract/src/index.ts                 # 채널 5개 (수정)
apps/desktop/src/main/git-handlers.ts              # 핸들러 5개 (수정)
apps/desktop/src/preload/index.ts                  # 브리지 (수정)
apps/desktop/src/renderer/src/store/repository-store.ts # 액션 5개 (수정)
apps/desktop/src/renderer/src/App.tsx              # 받아오기 버튼·상태 바 일반화·관리 다이얼로그 배선 (수정)
apps/desktop/src/renderer/src/components/HistoryPanel.tsx # 우클릭 '되돌리기' (수정)
apps/desktop/src/renderer/src/components/ManageBranchesDialog.tsx # 관리 다이얼로그 (신규)
apps/desktop/src/renderer/src/components/manage-branches.css      # (신규)
apps/desktop/src/renderer/src/components/ConflictPanel.tsx # 다음 겹침 점프·개념색 버튼 (수정)
apps/desktop/src/renderer/src/ui/Button.tsx        # className 병합 허용 (수정)
apps/desktop/src/renderer/src/ui/PromptDialog.tsx  # initialValue·errorText (수정)
```

---

### Task 1: 엔진 — sync.pull (스마트 받아오기)

**Files:**
- Modify: `packages/domain/src/repository.ts`, `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts`

- [ ] **Step 1: domain 타입** — `MergeResult` 블록 **뒤**에 추가:

```ts
/** 받아오기(pull) 결과 — conflict면 MERGE_HEAD가 남아 기존 합치기 충돌 흐름을 그대로 쓴다 */
export interface PullResult {
  outcome: 'fast-forward' | 'merged' | 'conflict' | 'up-to-date'
  autoShelved: boolean
}
```

- [ ] **Step 2: 실패하는 통합 테스트** — client.test.ts의 `'push — detached HEAD에서는 읽히는 에러를 던진다'` 테스트 **뒤**에 추가:

```ts
  it('pull — 원격의 새 저장을 받아온다(ff)와 이미 최신을 구분한다', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    expect(await client.sync.pull()).toEqual({ outcome: 'up-to-date', autoShelved: false })

    // 다른 클론이 원격에 새 저장을 올린다
    const other = await mkdtemp(join(tmpdir(), 'git-gui-other-'))
    await execGitOrThrow(['clone', remote, other], { cwd: tmpdir() })
    await writeFixtureFile(other, 'from-other.txt', 'o\n')
    await execGitOrThrow(['add', '-A'], { cwd: other })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'other work'], { cwd: other })
    await execGitOrThrow(['push'], { cwd: other })

    expect(await client.sync.pull()).toEqual({ outcome: 'fast-forward', autoShelved: false })
    const history = await client.history.list(10)
    expect(history[0]!.subject).toBe('other work')
  })

  it('pull — 서로 갈라진 같은 줄 변경은 conflict 상태(merging)로 남는다', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    const other = await mkdtemp(join(tmpdir(), 'git-gui-other-'))
    await execGitOrThrow(['clone', remote, other], { cwd: tmpdir() })
    await writeFixtureFile(other, 'README.md', '# remote\n')
    await execGitOrThrow(['add', '-A'], { cwd: other })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'remote change'], { cwd: other })
    await execGitOrThrow(['push'], { cwd: other })
    await writeFixtureFile(repo, 'README.md', '# local\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'local change'], { cwd: repo })

    expect(await client.sync.pull()).toEqual({ outcome: 'conflict', autoShelved: false })
    const status = await client.repo.status()
    expect(status.state).toBe('merging')
    expect(status.changes.find((c) => c.path === 'README.md')?.unstaged).toBe('conflicted')
  })

  it('pull — 막힌 변경은 보관함에 자동 저장하고 받아온다', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    const other = await mkdtemp(join(tmpdir(), 'git-gui-other-'))
    await execGitOrThrow(['clone', remote, other], { cwd: tmpdir() })
    await writeFixtureFile(other, 'README.md', '# remote\n')
    await execGitOrThrow(['add', '-A'], { cwd: other })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'remote change'], { cwd: other })
    await execGitOrThrow(['push'], { cwd: other })
    await writeFixtureFile(repo, 'README.md', '# uncommitted\n')

    const result = await client.sync.pull()
    expect(result).toEqual({ outcome: 'fast-forward', autoShelved: true })
    const shelf = await client.shelf.list()
    expect(shelf[0]!.message).toContain('받아오기 자동 보관')
  })

  it('pull — 원격/upstream이 없으면 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.sync.pull()).rejects.toThrow(/원격 저장소가 없어요/)

    const withRemote = await createFixtureRepoWithRemote()
    const client2 = createGitClient(withRemote.repo)
    // push(업스트림 연결) 없이 pull — tracking 정보 없음
    await expect(client2.sync.pull()).rejects.toThrow(/백업.*연결/)
  })
```

- [ ] **Step 3: 실패 확인** — `--testNamePattern "pull"` → `client.sync.pull is not a function`

- [ ] **Step 4: 구현** — client.ts:

(a) import 타입에 `type PullResult,` 추가(알파벳 순서).

(b) `GitClient` sync 블록의 `push(): …` 행 **뒤**에:

```ts
    /**
     * 원격의 최신 저장을 받아온다(fetch+merge). 막히면 자동 보관 후 재시도.
     * conflict면 MERGE_HEAD가 남아 기존 합치기 충돌 흐름(머지 바·충돌 뷰·저장하기 마무리)을 그대로 쓴다.
     */
    pull(): Promise<PullResult>
```

(c) `MERGE_SHELF_MESSAGE` 상수 **뒤**에:

```ts
/** 받아오기가 막혀 자동 보관할 때의 보관함 메시지 */
const PULL_SHELF_MESSAGE = '받아오기 자동 보관'
```

(d) sync 구현부 `push` **뒤**에 추가:

```ts
      async pull() {
        const cwd = await topLevel()
        const remotes = await execGitOrThrow(['remote'], { cwd })
        if (remotes.stdout.trim() === '') {
          throw new Error('받아올 원격 저장소가 없어요. 먼저 원격 저장소를 연결해 주세요.')
        }
        const classify = (output: string): PullResult['outcome'] => {
          if (output.includes('Already up to date')) return 'up-to-date'
          if (output.includes('Fast-forward')) return 'fast-forward'
          return 'merged'
        }
        const run = () => execGit(['pull', '--no-rebase', '--no-edit'], { cwd })
        const first = await run()
        const firstOut = first.stdout + first.stderr
        if (first.exitCode === 0) return { outcome: classify(firstOut), autoShelved: false }
        if (firstOut.includes('no tracking information')) {
          throw new Error('이 실험 공간은 아직 원격과 연결되지 않았어요. 먼저 백업(push)으로 연결해 주세요.')
        }
        if (firstOut.includes('CONFLICT') || firstOut.includes('Automatic merge failed')) {
          return { outcome: 'conflict', autoShelved: false }
        }
        if (!firstOut.includes('would be overwritten')) {
          throw new GitError(['pull', '--no-rebase', '--no-edit'], first)
        }
        // 막혔다 — 스펙 원칙: 변경을 보관함에 자동 저장하고 진행한다 (merge·switch와 동일 패턴)
        await execGitOrThrow(['stash', 'push', '-u', '-m', PULL_SHELF_MESSAGE], { cwd })
        const second = await run()
        const secondOut = second.stdout + second.stderr
        if (second.exitCode === 0) return { outcome: classify(secondOut), autoShelved: true }
        if (secondOut.includes('CONFLICT') || secondOut.includes('Automatic merge failed')) {
          return { outcome: 'conflict', autoShelved: true }
        }
        throw new GitError(['pull', '--no-rebase', '--no-edit'], second)
      },
```

- [ ] **Step 5: 게이트** — `pnpm test && pnpm typecheck` → **222 tests** (218+4) + 5 Done

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/repository.ts packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(adapter): sync.pull — 스마트 받아오기(막히면 자동 보관, 충돌은 기존 합치기 흐름)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 엔진 — commits.revert(+abort)·branches.remove/rename

**Files:**
- Modify: `packages/domain/src/repository.ts`, `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts`

- [ ] **Step 1: domain 타입** — `PullResult` 블록 **뒤**에:

```ts
/** 되돌리기(revert) 결과 — conflict면 REVERT_HEAD가 남는다(상태 바 reverting) */
export interface RevertResult {
  outcome: 'reverted' | 'conflict'
}

/** 실험 공간 지우기 결과 — 합쳐지지 않은 저장이 있으면 지우지 않고 needsForce로 알린다 */
export interface RemoveBranchResult {
  removed: boolean
  needsForce: boolean
}
```

- [ ] **Step 2: 실패하는 테스트** — pull 테스트들 **뒤**에:

```ts
  it('revert — 저장을 반대로 적용하는 새 저장을 만들고, merge commit은 첫 부모 기준으로 되돌린다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# changed\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'change'], { cwd: repo })
    const head = (await client.history.list(1))[0]!
    expect(await client.commits.revert(head.hash)).toEqual({ outcome: 'reverted' })
    expect(await client.files.readText('README.md')).toBe('# fixture\n')
    expect((await client.history.list(1))[0]!.subject).toContain('Revert')

    // merge commit — -m 1 재시도로 성공해야 한다
    await client.branches.create('side', null)
    await client.branches.switch('side')
    await writeFixtureFile(repo, 'side.txt', 's\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'side'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'main.txt', 'm\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'main'], { cwd: repo })
    await client.branches.merge('side')
    const mergeHead = (await client.history.list(1))[0]!
    expect(mergeHead.parents).toHaveLength(2)
    expect(await client.commits.revert(mergeHead.hash)).toEqual({ outcome: 'reverted' })
    const status = await client.repo.status()
    expect(status.changes).toEqual([])
  })

  it('revert — 이후 저장과 겹치면 conflict 상태(reverting)로 남고, 취소로 돌아온다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# v2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v2'], { cwd: repo })
    const target = (await client.history.list(1))[0]!
    await writeFixtureFile(repo, 'README.md', '# v3\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v3'], { cwd: repo })

    expect(await client.commits.revert(target.hash)).toEqual({ outcome: 'conflict' })
    let status = await client.repo.status()
    expect(status.state).toBe('reverting')
    expect(status.changes.some((c) => c.unstaged === 'conflicted')).toBe(true)

    await client.commits.revertAbort()
    status = await client.repo.status()
    expect(status.state).toBe('normal')
    expect(status.changes).toEqual([])
  })

  it('revertAbort — 되돌리는 중이 아니면 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.commits.revertAbort()).rejects.toThrow(/되돌리는 중이 아니에요/)
  })

  it('branches.remove — 합쳐진 공간은 지우고, 안 합쳐진 공간은 needsForce로 알리고, force로 지운다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('merged-one', null)
    expect(await client.branches.remove('merged-one', false)).toEqual({
      removed: true,
      needsForce: false,
    })

    await client.branches.create('doomed', null)
    await client.branches.switch('doomed')
    await writeFixtureFile(repo, 'd.txt', 'd\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'doomed work'], { cwd: repo })
    await client.branches.switch('main')
    expect(await client.branches.remove('doomed', false)).toEqual({
      removed: false,
      needsForce: true,
    })
    expect(await client.branches.remove('doomed', true)).toEqual({
      removed: true,
      needsForce: false,
    })
    expect((await client.branches.list()).map((b) => b.name)).toEqual(['main'])
  })

  it('branches.remove — 지금 있는 공간은 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.branches.remove('main', false)).rejects.toThrow(/다른 공간으로 이동/)
  })

  it('branches.rename — 이름을 바꾸고, 중복·잘못된 이름은 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('before', null)
    await client.branches.rename('before', 'after')
    expect((await client.branches.list()).map((b) => b.name).sort()).toEqual(['after', 'main'])
    await expect(client.branches.rename('after', 'main')).rejects.toThrow(/이미 있는 이름/)
    await expect(client.branches.rename('after', 'bad name')).rejects.toThrow(/만들 수 없어요/)
    await expect(client.branches.rename('no-such', 'x')).rejects.toThrow()
  })
```

- [ ] **Step 3: 실패 확인** — `--testNamePattern "revert|remove|rename"` → 미존재 함수들

- [ ] **Step 4: 구현** — client.ts:

(a) import 타입에 `type RemoveBranchResult,`·`type RevertResult,` 추가(알파벳 순서).

(b) 인터페이스 — branches 블록 `merge(...)` 행 **뒤**에:

```ts
    /** 실험 공간 지우기 — 합쳐지지 않은 저장이 있으면 needsForce로 알린다(확인창은 UI). 현재 공간은 거부 */
    remove(name: string, force: boolean): Promise<RemoveBranchResult>
    /** 이름 바꾸기 */
    rename(oldName: string, newName: string): Promise<void>
```

commits 블록 `diffFile(...)` 행 **뒤**에:

```ts
    /** 이 저장이 바꾼 내용을 반대로 적용하는 새 저장을 만든다. merge commit은 첫 부모 기준(-m 1) */
    revert(hash: string): Promise<RevertResult>
    /** 되돌리기 취소 — 충돌 상태를 버리고 이전으로 */
    revertAbort(): Promise<void>
```

(c) branches 구현부 `merge` **뒤**에:

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
      async rename(oldName, newName) {
        const cwd = await topLevel()
        const valid = await execGit(['check-ref-format', '--branch', newName], { cwd })
        if (valid.exitCode !== 0) {
          throw new Error(`"${newName}"라는 이름으로는 만들 수 없어요. 공백 없이 지어 주세요.`)
        }
        const args = ['branch', '-m', '--end-of-options', oldName, newName]
        const result = await execGit(args, { cwd })
        if (result.exitCode !== 0) {
          if (result.stderr.includes('already exists')) {
            throw new Error(`"${newName}"는 이미 있는 이름이에요. 다른 이름을 지어 주세요.`)
          }
          throw new GitError(args, result)
        }
      },
```

(d) commits 구현부 `diffFile` **뒤**에:

```ts
      async revert(hash) {
        const cwd = await topLevel()
        assertFullHash(hash)
        const run = (extra: string[]) =>
          execGit(['revert', '--no-edit', ...extra, '--end-of-options', hash], { cwd })
        let result = await run([])
        // merge commit은 -m 없이는 거부된다(실측) — 앱 원칙대로 첫 부모 기준으로 재시도
        if (result.exitCode !== 0 && result.stderr.includes('is a merge but no -m option')) {
          result = await run(['-m', '1'])
        }
        if (result.exitCode === 0) return { outcome: 'reverted' }
        const output = result.stdout + result.stderr
        if (output.includes('CONFLICT') || output.includes('after resolving the conflicts')) {
          return { outcome: 'conflict' }
        }
        if (output.includes('bad object')) {
          throw new Error(MISSING_COMMIT_MESSAGE)
        }
        throw new GitError(['revert', '--no-edit', '--end-of-options', hash], result)
      },
      async revertAbort() {
        const cwd = await topLevel()
        const result = await execGit(['revert', '--abort'], { cwd })
        if (result.exitCode !== 0) {
          // 실측 stderr: "error: no cherry-pick or revert in progress" — 부분 문구로 잡는다
          if (result.stderr.includes('revert in progress')) {
            throw new Error('지금은 되돌리는 중이 아니에요.')
          }
          throw new GitError(['revert', '--abort'], result)
        }
      },
```

- [ ] **Step 5: 게이트** — `pnpm test && pnpm typecheck` → **228 tests** (222+6) + 5 Done

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/repository.ts packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(adapter): revert(첫 부모 기준·취소)·실험 공간 지우기(needsForce)·이름 바꾸기

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: IPC — pull·revert·remove·rename 채널

**Files:**
- Modify: `packages/ipc-contract/src/index.ts`, `apps/desktop/src/main/git-handlers.ts`, `apps/desktop/src/preload/index.ts`

- [ ] **Step 1: contract** — import 타입에 `PullResult,`·`RemoveBranchResult,`·`RevertResult,` 추가(알파벳 순서). GitApi:

sync 블록 `push(...)` 행 **뒤**:

```ts
    /** 원격의 최신 저장을 받아온다 — conflict면 기존 합치기 충돌 흐름이 이어진다 */
    pull(repoPath: string): Promise<PullResult>
```

branches 블록 `merge(...)` 행 **뒤**:

```ts
    remove(repoPath: string, name: string, force: boolean): Promise<RemoveBranchResult>
    rename(repoPath: string, oldName: string, newName: string): Promise<void>
```

commits 블록 `diffFile(...)` 행 **뒤**:

```ts
    revert(repoPath: string, hash: string): Promise<RevertResult>
    revertAbort(repoPath: string): Promise<void>
```

CHANNELS — `syncPush` 행 뒤 `syncPull: 'sync:pull',`, `branchesMerge` 행 뒤:

```ts
  branchesRemove: 'branches:remove',
  branchesRename: 'branches:rename',
```

`commitsDiffFile` 행 뒤:

```ts
  commitsRevert: 'commits:revert',
  commitsRevertAbort: 'commits:revert-abort',
```

- [ ] **Step 2: 핸들러** — `syncPush` 핸들러 뒤:

```ts
  ipcMain.handle(CHANNELS.syncPull, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).sync.pull(),
  )
```

`branchesMerge` 핸들러 뒤:

```ts
  ipcMain.handle(
    CHANNELS.branchesRemove,
    (_event, repoPath: unknown, name: unknown, force: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).branches.remove(
        assertString(name),
        assertBoolean(force),
      ),
  )

  ipcMain.handle(
    CHANNELS.branchesRename,
    (_event, repoPath: unknown, oldName: unknown, newName: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).branches.rename(
        assertString(oldName),
        assertString(newName),
      ),
  )
```

`conflictsMarkResolved` 핸들러 뒤:

```ts
  ipcMain.handle(CHANNELS.commitsRevert, (_event, repoPath: unknown, hash: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).commits.revert(assertHash(hash)),
  )

  ipcMain.handle(CHANNELS.commitsRevertAbort, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).commits.revertAbort(),
  )
```

그리고 `assertConflictChoice` **뒤**에:

```ts
function assertBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('잘못된 요청 형식이에요.')
  return value
}
```

- [ ] **Step 3: preload** — sync 블록에 `pull: (repoPath) => ipcRenderer.invoke(CHANNELS.syncPull, repoPath),`, branches 블록에:

```ts
    remove: (repoPath, name, force) =>
      ipcRenderer.invoke(CHANNELS.branchesRemove, repoPath, name, force),
    rename: (repoPath, oldName, newName) =>
      ipcRenderer.invoke(CHANNELS.branchesRename, repoPath, oldName, newName),
```

commits 블록에:

```ts
    revert: (repoPath, hash) => ipcRenderer.invoke(CHANNELS.commitsRevert, repoPath, hash),
    revertAbort: (repoPath) => ipcRenderer.invoke(CHANNELS.commitsRevertAbort, repoPath),
```

- [ ] **Step 4: 게이트 + Commit** — 228 tests + 5 Done + build

```bash
git add packages/ipc-contract/src/index.ts apps/desktop/src/main/git-handlers.ts apps/desktop/src/preload/index.ts
git commit -m "feat(ipc): pull·revert·remove·rename 채널

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: store — pull·revert·관리 액션 + 상태 바 일반화 배선 준비

**Files:**
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`

- [ ] **Step 1: store 수정 (부분 삽입)**

(a) 인터페이스 액션 — `abortMerge(): Promise<void>` 행 **뒤**에:

```ts
  /** 원격의 최신 저장을 받아온다 — 결과를 notice로, 충돌은 머지 바가 안내 */
  pullLatest(): Promise<void>
  /** 이 저장을 반대로 적용하는 새 저장 — 충돌이면 reverting 상태 바가 안내 */
  revertCommit(hash: string): Promise<void>
  /** 되돌리기 취소 — 확인창(UI 책임) 경유 */
  abortRevert(): Promise<void>
  /** 실험 공간 지우기. 반환 true면 합쳐지지 않은 저장이 있어 강제 확인이 필요하다 */
  removeBranch(name: string, force: boolean): Promise<boolean>
  /** 이름 바꾸기 — 성공 여부 반환(실패 시 다이얼로그 유지·입력 보존) */
  renameBranch(oldName: string, newName: string): Promise<boolean>
```

(b) 구현 — `abortMerge` 블록 **뒤**에:

```ts
  async pullLatest() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      const result = await git().sync.pull(repoPath)
      const notices: Record<typeof result.outcome, string | null> = {
        'fast-forward': '원격의 최신 저장을 받아왔어요.',
        merged: '원격과 합쳐 새 병합 저장을 만들었어요.',
        // 충돌 안내는 머지 바가 상주하며 담당한다
        conflict: null,
        'up-to-date': '이미 최신이에요.',
      }
      const shelfNotice = result.autoShelved ? ' 저장 안 된 변경은 보관함에 넣어뒀어요.' : ''
      set({
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: `${notices[result.outcome] ?? ''}${shelfNotice}` || null,
      })
    })
  },

  async revertCommit(hash) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      const result = await git().commits.revert(repoPath, hash)
      set({
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        // 충돌 안내는 reverting 상태 바가 담당한다
        notice: result.outcome === 'reverted' ? '되돌리는 새 저장을 만들었어요.' : null,
      })
    })
  },

  async abortRevert() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().commits.revertAbort(repoPath)
      set({
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: '되돌리기를 취소하고 이전 상태로 돌아왔어요.',
      })
    })
  },

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
  },

  async renameBranch(oldName, newName) {
    const { repoPath } = get()
    if (!repoPath) return false
    return guard(set, get, async () => {
      await git().branches.rename(repoPath, oldName, newName)
      set({ ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },
```

- [ ] **Step 2: 게이트 + Commit** — 228 tests + 5 Done + build

```bash
git add apps/desktop/src/renderer/src/store/repository-store.ts
git commit -m "feat(desktop): store — 받아오기·되돌리기(취소)·실험 공간 지우기/이름 바꾸기

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4-보완: 엔진 가드 2건 (스펙 리뷰 실측 반영)

리뷰 실측: (1) reverting 중 브랜치 전환 시 `cannot switch branch while reverting` 원어 노출 — E1b의 merging 매핑이 못 덮는다, (2) 충돌(unmerged) 중 받아오기 클릭 시 `Pulling is not possible because you have unmerged files` 원어 노출.

**Files:**
- Modify: `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts`

- [ ] **Step 1: 실패하는 테스트 2개** — 'revertAbort — 되돌리는 중이 아니면…' 테스트 **뒤**에:

```ts
  it('reverting 중에는 전환·받아오기도 읽히는 메시지로 거부한다', async () => {
    const { repo } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    await client.branches.create('elsewhere', null)
    await writeFixtureFile(repo, 'README.md', '# v2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v2'], { cwd: repo })
    const target = (await client.history.list(1))[0]!
    await writeFixtureFile(repo, 'README.md', '# v3\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v3'], { cwd: repo })
    await client.commits.revert(target.hash)

    await expect(client.branches.switch('elsewhere')).rejects.toThrow(/충돌 정리/)
    await expect(client.sync.pull()).rejects.toThrow(/정리해야 받아올/)
    await client.commits.revertAbort()
  })
```

- [ ] **Step 2: 실패 확인** — 두 단언 모두 원어 GitError로 FAIL

- [ ] **Step 3: 구현**

(a) client.ts switch 가드의 `'cannot switch branch while merging'`을 `'cannot switch branch while'`로 넓힌다 (merging·reverting 겸용 — 실측 stderr `cannot switch branch while reverting`).

(b) pull의 첫 시도 분기(`no tracking information` 앞)에 추가:

```ts
        if (firstOut.includes('you have unmerged files')) {
          throw new Error('겹침(!)을 모두 정리해야 받아올 수 있어요.')
        }
```

- [ ] **Step 4: 게이트** — `pnpm test && pnpm typecheck` → **229 tests** + 5 Done

- [ ] **Step 5: Commit**

```bash
git add packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "fix(adapter): reverting 중 전환·충돌 중 받아오기 친절 에러

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---


### Task 5: UI — 받아오기 버튼·우클릭 되돌리기·관리 다이얼로그·충돌 뷰 다듬기

**Files:**
- Modify: `apps/desktop/src/renderer/src/ui/Button.tsx`, `apps/desktop/src/renderer/src/ui/PromptDialog.tsx`, `apps/desktop/src/renderer/src/ui/prompt-dialog.css`, `apps/desktop/src/renderer/src/components/BranchSwitcher.tsx`, `apps/desktop/src/renderer/src/components/HistoryPanel.tsx`, `apps/desktop/src/renderer/src/components/ConflictPanel.tsx`, `apps/desktop/src/renderer/src/components/conflict-panel.css`, `apps/desktop/src/renderer/src/App.tsx`
- Create: `apps/desktop/src/renderer/src/components/ManageBranchesDialog.tsx`, `apps/desktop/src/renderer/src/components/manage-branches.css`

- [ ] **Step 1: Button className 허용**

`Button.tsx`의 interface에 `className?: string` 추가(`testId?: string` 행 뒤, doc `/** 추가 클래스 — 개념색 틴트 등 */`), 함수 시그니처 구조 분해에 `className,` 추가, `className={...}`을 다음으로 교체:

```tsx
      className={['ui-button', `ui-button--${variant}`, `ui-button--${size}`, className]
        .filter(Boolean)
        .join(' ')}
```

- [ ] **Step 2: PromptDialog — initialValue·errorText**

(a) props에 추가(`submitLabel: string` 행 뒤):

```tsx
  /** 열릴 때 채워 둘 값 — 이름 바꾸기 등. 기본은 빈 값 */
  initialValue?: string
  /** 인라인 에러 — 실패 시 다이얼로그 안에서 바로 보인다 (상단 배너와 병행) */
  errorText?: string | null
```

(b) 구조 분해에 `initialValue,`·`errorText,` 추가. 초기화 effect를 교체:

```tsx
  // 열릴 때 초기값으로 채우고, 닫힐 때 비운다 — 실패로 열려 있는 동안에는 입력이 보존된다
  useEffect(() => {
    setValue(isOpen ? (initialValue ?? '') : '')
  }, [isOpen, initialValue])
```

(c) `<div className="ui-dialog__actions">` **앞**에:

```tsx
          {errorText && (
            <p className="ui-prompt__error" role="alert" data-testid="prompt-error">
              {errorText}
            </p>
          )}
```

(d) `prompt-dialog.css` 끝에:

```css
.ui-prompt__error {
  margin: 0 0 var(--space-3);
  font-size: var(--text-xs);
  color: var(--color-danger);
}
```

- [ ] **Step 3: BranchSwitcher — 관리 항목**

(a) props에 `onManage(): void` 추가(`onCreate(): void` 행 뒤), 구조 분해에 `onManage,` 추가.

(b) `NEW_KEY` 상수 뒤에 `const MANAGE_KEY = '__manage__'` 추가, `onAction`을 교체:

```tsx
          onAction={(key) => {
            if (key === NEW_KEY) onCreate()
            else if (key === MANAGE_KEY) onManage()
            else if (key !== currentName) onSwitch(String(key))
          }}
```

(c) '새 실험 공간 만들기…' MenuItem **뒤**에:

```tsx
          <MenuItem
            id={MANAGE_KEY}
            className="branch-switcher__item branch-switcher__item--new"
            textValue="실험 공간 관리"
            data-testid="branch-manage"
          >
            <span className="branch-switcher__check" aria-hidden="true" />
            <span className="branch-switcher__name">실험 공간 관리…</span>
          </MenuItem>
```

- [ ] **Step 4: ManageBranchesDialog**

Create `apps/desktop/src/renderer/src/components/ManageBranchesDialog.tsx`:

```tsx
import { Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import type { BranchSummary } from '@git-gui/domain'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { PromptDialog } from '../ui/PromptDialog'
import './manage-branches.css'
import '../ui/confirm-dialog.css'

interface ManageBranchesDialogProps {
  isOpen: boolean
  branches: BranchSummary[]
  busy: boolean
  errorText: string | null
  /** 성공 여부 반환 — 실패 시 이름 다이얼로그를 유지한다 */
  onRename(oldName: string, newName: string): Promise<boolean>
  /** 반환 true면 합쳐지지 않은 저장이 있어 강제 확인이 필요하다 */
  onRemove(name: string, force: boolean): Promise<boolean>
  onCancel(): void
}

/** 실험 공간 관리 — 이름 바꾸기·지우기. 현재 공간은 지울 수 없다(이동 후 삭제 안내) */
export function ManageBranchesDialog({
  isOpen,
  branches,
  busy,
  errorText,
  onRename,
  onRemove,
  onCancel,
}: ManageBranchesDialogProps) {
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<string | null>(null)
  const [forceTarget, setForceTarget] = useState<string | null>(null)

  return (
    <>
      <ModalOverlay
        className="ui-modal-overlay"
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) onCancel()
        }}
        isDismissable
      >
        <Modal className="ui-modal">
          <Dialog className="ui-dialog manage-branches">
            <Heading slot="title" className="ui-dialog__title">
              실험 공간 관리
            </Heading>
            <p className="ui-dialog__body">
              이름을 바꾸거나 다 쓴 실험 공간을 지워요. 지금 있는 공간은 지울 수 없어요.
            </p>
            <ul className="manage-branches__list">
              {branches.map((branch) => (
                <li key={branch.name} className="manage-branches__row">
                  <span className="manage-branches__name" title={branch.name}>
                    {branch.name}
                    {branch.isCurrent && <span className="manage-branches__here">지금 여기</span>}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    isDisabled={busy}
                    onPress={() => setRenameTarget(branch.name)}
                    testId={`manage-rename-${branch.name}`}
                  >
                    <Pencil size={13} aria-hidden="true" /> 이름 바꾸기
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    isDisabled={busy || branch.isCurrent}
                    onPress={() => setRemoveTarget(branch.name)}
                    testId={`manage-remove-${branch.name}`}
                  >
                    <Trash2 size={13} aria-hidden="true" /> 지우기
                  </Button>
                </li>
              ))}
            </ul>
            <div className="ui-dialog__actions">
              <Button variant="ghost" size="sm" onPress={onCancel} testId="manage-close">
                닫기
              </Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
      <PromptDialog
        isOpen={renameTarget !== null}
        title="이름 바꾸기"
        description="이 실험 공간의 새 이름을 지어 주세요."
        label="새 이름"
        placeholder="예: better-name"
        submitLabel="바꾸기"
        initialValue={renameTarget ?? ''}
        errorText={errorText}
        onSubmit={(name) => {
          void (async () => {
            if (renameTarget !== null && (await onRename(renameTarget, name))) {
              setRenameTarget(null)
            }
          })()
        }}
        onCancel={() => setRenameTarget(null)}
      />
      <ConfirmDialog
        isOpen={removeTarget !== null}
        title="실험 공간을 지울까요?"
        confirmLabel="지우기"
        onConfirm={() => {
          void (async () => {
            const name = removeTarget
            setRemoveTarget(null)
            if (name !== null && (await onRemove(name, false))) {
              // 합쳐지지 않은 저장이 있다 — 강제 삭제는 별도 확인을 거친다
              setForceTarget(name)
            }
          })()
        }}
        onCancel={() => setRemoveTarget(null)}
      >
        "{removeTarget}" 실험 공간을 지워요. 다른 공간에 합쳐진 내용은 그대로 남아요.
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={forceTarget !== null}
        title="아직 합쳐지지 않은 저장이 있어요"
        confirmLabel="그래도 지우기"
        onConfirm={() => {
          const name = forceTarget
          setForceTarget(null)
          if (name !== null) void onRemove(name, true)
        }}
        onCancel={() => setForceTarget(null)}
      >
        "{forceTarget}"에는 다른 곳에 합쳐지지 않은 저장이 있어요. 지우면 그 저장들은 사라지고
        되돌릴 수 없어요.
      </ConfirmDialog>
    </>
  )
}
```

Create `apps/desktop/src/renderer/src/components/manage-branches.css`:

```css
.manage-branches {
  width: 420px;
}
.manage-branches__list {
  list-style: none;
  margin: 0 0 var(--space-4);
  padding: 0;
  max-height: 300px;
  overflow-y: auto;
}
.manage-branches__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--color-border);
}
.manage-branches__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.manage-branches__here {
  flex: none;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--color-accent);
  color: var(--color-accent-text);
}
```

- [ ] **Step 5: HistoryPanel — 우클릭 '되돌리기'**

(a) props에 `onRevert(hash: string): void` 추가(`onCreateBranchAt(...)` 행 뒤, doc `/** 우클릭 → "이 저장 되돌리기" (revert) */`), 구조 분해에 `onRevert,` 추가.

(b) ContextMenu items의 'copy-hash' 항목 **앞**에:

```tsx
            {
              key: 'revert',
              label: '이 저장 되돌리기 (revert)',
              onSelect: () => onRevert(menu.commit.hash),
            },
```

- [ ] **Step 6: ConflictPanel — 다음 겹침·개념색 버튼**

(a) import에 `useState` 이미 있음 — `ArrowDown` lucide 추가(`Check, Download, User` → `ArrowDown, Check, Download, User`).

(b) `const markResolved = …` **앞**에 추가:

```tsx
  // 겹침 블록 시작 인덱스 — "다음 겹침"으로 순환 점프한다
  const markerIndexes = rows.reduce<number[]>((acc, row, index) => {
    if (row.kind === 'marker-ours') acc.push(index)
    return acc
  }, [])
  const [jumpCursor, setJumpCursor] = useState(0)
  const jumpNext = () => {
    if (markerIndexes.length === 0) return
    virtualizer.scrollToIndex(markerIndexes[jumpCursor % markerIndexes.length]!, { align: 'center' })
    setJumpCursor(jumpCursor + 1)
  }
```

(c) `conflict-panel__actions`의 ours 버튼에 `className="conflict-panel__btn--mine"`, theirs 버튼에 `className="conflict-panel__btn--branch"` prop 추가(variant 행 뒤). '직접 수정했어요' 버튼 **뒤**에:

```tsx
        <Button
          variant="ghost"
          size="sm"
          isDisabled={busy || markerIndexes.length === 0}
          onPress={jumpNext}
          testId="conflict-next"
        >
          <ArrowDown size={13} aria-hidden="true" /> 다음 겹침 ({markerIndexes.length})
        </Button>
```

(d) `conflict-panel.css` 끝에:

```css
/* 버튼과 구간 색을 연결한다 — 초록=내 것, 보라=가져온 것 (스펙 개념색) */
.conflict-panel__btn--mine {
  border-color: var(--concept-mine);
  color: var(--concept-mine);
}
.conflict-panel__btn--branch {
  border-color: var(--concept-branch);
  color: var(--concept-branch);
}
```

- [ ] **Step 7: App 배선**

(a) import: `GitMerge` 옆에 `DownloadCloud` 추가(알파벳 순서 — `CloudUpload, DownloadCloud, GitMerge, Moon, RefreshCw, Sun`), `import { ManageBranchesDialog } from './components/ManageBranchesDialog'` 추가(`import { HistoryPanel } …` 행 뒤).

(b) 상태 추가(`mergePicker` 행 뒤):

```tsx
  const [manageOpen, setManageOpen] = useState(false)
```

(c) 헤더 `app__actions`의 보관함(ShelfPopover) **앞**에 받아오기 버튼:

```tsx
          <Button
            variant="neutral"
            size="sm"
            isDisabled={store.busy || status?.state !== 'normal'}
            onPress={() => void store.pullLatest()}
            testId="pull"
          >
            <DownloadCloud size={14} aria-hidden="true" /> 받아오기 <Badge tone="git">pull</Badge>
          </Button>
```

(d) 상태 바 블록을 merging/reverting 겸용으로 교체:

```tsx
      {(status?.state === 'merging' || status?.state === 'reverting') && (
        <div className="app__merge-bar" data-testid="merge-bar">
          <Pictogram
            kind="conflict"
            size={14}
            label={status.state === 'merging' ? '합치는 중' : '되돌리는 중'}
          />
          <span className="app__merge-text" data-testid="merge-remaining">
            {`${status.state === 'merging' ? '실험 공간 합치는 중' : '저장 되돌리는 중'} — ${
              conflictCount > 0
                ? `겹침 ${conflictCount}개 남음. 붉은 ! 파일에서 한쪽을 고르고, 다 정리되면 저장하기로 마무리해요.`
                : '겹침 0개 남음. 이제 저장하기로 마무리해요.'
            }`}
          </span>
          <Button
            variant="danger"
            size="sm"
            isDisabled={store.busy}
            onPress={() => setConfirmingAbort(true)}
            testId="merge-abort"
          >
            {status.state === 'merging' ? '합치기 취소' : '되돌리기 취소'}
          </Button>
        </div>
      )}
```

(e) 합치기 버튼 비활성 조건을 `status.state !== 'normal'` 겸용으로 교체(`isDisabled={store.busy || status.state !== 'normal'}`).

(f) 취소 ConfirmDialog를 겸용으로 교체:

```tsx
      <ConfirmDialog
        isOpen={confirmingAbort}
        title={status?.state === 'reverting' ? '되돌리기를 취소할까요?' : '합치기를 취소할까요?'}
        confirmLabel={status?.state === 'reverting' ? '되돌리기 취소' : '합치기 취소'}
        onConfirm={() => {
          setConfirmingAbort(false)
          if (status?.state === 'reverting') void store.abortRevert()
          else void store.abortMerge()
        }}
        onCancel={() => setConfirmingAbort(false)}
      >
        지금까지 고른 것을 되돌리고 이전 상태로 돌아가요.
      </ConfirmDialog>
```

(g) BranchSwitcher에 `onManage={() => setManageOpen(true)}` prop 추가, HistoryPanel에 `onRevert={(hash) => void store.revertCommit(hash)}` prop 추가, PromptDialog(새 실험 공간)에 `errorText={branchPrompt !== null ? store.error : null}` prop 추가, ManageBranchesDialog를 ListDialog **뒤**에 추가:

```tsx
      <ManageBranchesDialog
        isOpen={manageOpen}
        branches={store.branches}
        busy={store.busy}
        errorText={store.error}
        onRename={(oldName, newName) => store.renameBranch(oldName, newName)}
        onRemove={(name, force) => store.removeBranch(name, force)}
        onCancel={() => setManageOpen(false)}
      />
```

- [ ] **Step 8: 게이트 + Commit** — 229 tests + 5 Done + build + **E2E 23은 아직 아님, 기존 E2E 18 회귀 없음**

```bash
git add apps/desktop/src/renderer/src
git commit -m "feat(desktop): 받아오기 버튼·우클릭 되돌리기·실험 공간 관리·충돌 뷰 다듬기

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: E2E 5종

**Files:**
- Test: `apps/desktop/e2e/smoke.spec.ts`

- [ ] **Step 1: 추가** (`smoke.spec.ts` 끝)

```ts
test('원격의 새 저장을 받아온다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const remote = await addBareRemote(repo)
  await execGitOrThrow(['push', '-u', 'origin', 'main'], { cwd: repo })
  const other = await mkdtemp(join(tmpdir(), 'git-gui-e2e-other-'))
  await execGitOrThrow(['clone', remote, other], { cwd: tmpdir() })
  await execGitOrThrow(['config', 'user.name', 'Other'], { cwd: other })
  await execGitOrThrow(['config', 'user.email', 'o@test.local'], { cwd: other })
  await writeFile(join(other, 'from-other.txt'), 'o\n')
  await execGitOrThrow(['add', '-A'], { cwd: other })
  await execGitOrThrow(['commit', '-m', '원격 저장'], { cwd: other })
  await execGitOrThrow(['push'], { cwd: other })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-count')).toHaveText('1')
    await window.getByTestId('pull').click()
    await expect(window.getByTestId('notice')).toContainText('받아왔어요')
    await expect(window.getByTestId('history-count')).toHaveText('2')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(other, { recursive: true, force: true })
    await rm(remote, { recursive: true, force: true })
  }
})

test('저장을 되돌리는 새 저장을 만든다 (revert)', async () => {
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
    await window.locator('[data-testid^="history-item-"]').first().click({ button: 'right' })
    await window.getByTestId('context-revert').click()
    await expect(window.getByTestId('notice')).toContainText('되돌리는 새 저장')
    await expect(window.getByTestId('history-count')).toHaveText('3')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('되돌리기가 겹치면 상태 바에서 취소할 수 있다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'v2'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'v3\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'v3'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    // v2(가운데 저장)를 되돌리면 v3와 겹친다
    await window.locator('[data-testid^="history-item-"]').nth(1).click({ button: 'right' })
    await window.getByTestId('context-revert').click()
    await expect(window.getByTestId('merge-bar')).toContainText('저장 되돌리는 중')
    await window.getByTestId('merge-abort').click()
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId('merge-bar')).toHaveCount(0)
    await expect(window.getByTestId('notice')).toContainText('되돌리기를 취소')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('실험 공간 이름을 바꾼다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['branch', 'old-name'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('header-branch').click()
    await window.getByTestId('branch-manage').click()
    await window.getByTestId('manage-rename-old-name').click()
    await window.getByTestId('prompt-input').fill('new-name')
    await window.getByTestId('prompt-submit').click()
    await expect(window.getByTestId('manage-rename-new-name')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('합쳐지지 않은 실험 공간은 두 번 확인 후에만 지워진다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'doomed'], { cwd: repo })
  await writeFile(join(repo, 'd.txt'), 'd\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'doomed work'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('header-branch').click()
    await window.getByTestId('branch-manage').click()
    await window.getByTestId('manage-remove-doomed').click()
    await window.getByTestId('confirm-accept').click()
    // 합쳐지지 않은 저장 — 강제 확인창이 이어진다
    await expect(window.getByTestId('confirm-accept')).toBeVisible()
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId('manage-remove-doomed')).toHaveCount(0)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: 검출력 실증 → 전체 게이트** — `pull` testid 오타 변이로 첫 테스트 FAIL 확인 후 원복.

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: **229 tests + typecheck 5 + build + E2E 23 passed** — 전부 exit 0

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts
git commit -m "test(desktop): E2E — 받아오기·되돌리기(충돌 취소)·이름 바꾸기·강제 삭제 2중 확인

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5-보완: 품질 리뷰 4건 (실렌더 실측 반영)

품질 리뷰(실렌더)가 잡은 결함을 반영한다. 실측 근거:

- **(Critical) 전량 '내 것 유지' 데드엔드** — 충돌을 전부 ours로 해소하면 index가 HEAD와 같아져 staged 0. 상태 바는 "이제 저장하기로 마무리해요"를 지시하지만 저장하기 버튼은 `stagedCount === 0`으로 영구 비활성. **실측**: merging에서는 staged 0이어도 `git commit -F -`가 성공하며 부모 2개의 병합 커밋을 만든다(합침 사실의 기록 — 다음 합치기가 재충돌하지 않게 하는 의미 있는 저장). reverting에서는 `nothing to commit`으로 실패한다(빈 revert 커밋은 무의미 — 전량 내 것 유지는 곧 "되돌리지 않겠다"와 동치). 따라서 **merging은 저장하기를 활성화**하고, **reverting은 상태 바 문구를 '되돌리기 취소로 마무리'로 분기**한다.
- **(Important) 스테일 인라인 에러** — 전역 `store.error`를 그대로 `errorText`로 물려줘, 이전 작업의 에러가 무관한 다이얼로그(다른 브랜치 이름 바꾸기·새 실험 공간 프롬프트)에 인라인으로 새어든다. **다이얼로그를 여는 시점에 error를 지운다.**
- **(Minor) 점프 커서 미리셋** — ConflictPanel이 conditional 재사용이라 파일 A에서 점프한 커서가 파일 B에 남는다 → `key={path}`로 파일마다 리마운트.
- **(Minor) revert 맥락의 merge 어휘** — "가져온 것"이 revert에서는 "되돌린 결과물"이다 → `mode` prop으로 문구 분기.
- **(Minor) 강제 삭제 E2E 단언 느슨** — 2차 확인을 제목 텍스트로 단언한다.

**Files:**
- Test: `packages/git-adapter/test/client.test.ts` (전량 ours 병합 마무리 고정 테스트)
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts` (clearError)
- Modify: `apps/desktop/src/renderer/src/components/CommitForm.tsx` (allowEmpty)
- Modify: `apps/desktop/src/renderer/src/components/ConflictPanel.tsx` (mode 어휘 분기)
- Modify: `apps/desktop/src/renderer/src/components/ManageBranchesDialog.tsx` (onClearError)
- Modify: `apps/desktop/src/renderer/src/App.tsx` (배선·상태 바 문구 분기·key)
- Test: `apps/desktop/e2e/smoke.spec.ts` (전량 ours 신규 1건 + 단언 보강 2건)

- [ ] **Step 1: 엔진 고정 테스트** — `client.test.ts`의 `'commit — 겹침이 남아 있으면 읽히는 메시지로 거부한다'` 테스트 **앞**에 추가. 엔진은 이미 지원하므로 즉시 PASS가 기대치다(회귀 고정 — UI가 기대는 전제를 못박는다):

```ts
  it('conflicts — 전량 ours 해소(변경 0)여도 commit이 병합을 마무리한다 (부모 2개)', async () => {
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

    await client.conflicts.resolve('README.md', 'ours')
    // index == HEAD — porcelain 변경 0이지만, 병합 커밋 자체가 의미 있는 저장이다
    const status = await client.repo.status()
    expect(status.state).toBe('merging')
    expect(status.changes).toEqual([])
    await client.commits.create('합치기 마무리 — 내 것 유지')
    const head = (await client.history.list(1))[0]!
    expect(head.parents).toHaveLength(2)
    expect((await client.repo.status()).state).toBe('normal')
  })
```

Run: `pnpm --filter @git-gui/git-adapter test` → PASS (**230 tests 총계**)

- [ ] **Step 2: E2E Red 실증** — `smoke.spec.ts`의 `'겹치면 충돌 화면에서 한쪽을 고르고 저장하기로 마무리한다'` 테스트 **바로 뒤**에 신규 추가:

```ts
test('겹침을 전부 내 것으로 정리해도 저장하기로 합치기를 마무리할 수 있다', async () => {
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
    await expect(window.getByTestId('merge-bar')).toContainText('겹침 1개 남음')
    await window.getByTestId('file-unstaged-app.txt').click()
    await window.getByTestId('conflict-ours').click()
    // 전량 내 것 — 변경 0개지만 병합 커밋으로 마무리할 수 있어야 한다 (데드엔드 방지)
    await expect(window.getByTestId('merge-bar')).toContainText('겹침 0개 남음')
    await expect(window.getByTestId('commit-button')).toContainText('합치기 마무리')
    await expect(window.getByTestId('commit-button')).toBeEnabled()
    await window.getByTestId('commit-button').click()
    await expect(window.getByTestId('merge-bar')).toHaveCount(0)
    await expect(window.getByTestId('history-count')).toHaveText('4')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

Run: `pnpm --filter desktop build && pnpm --filter desktop exec playwright test --grep "전부 내 것으로 정리해도"` → **FAIL 기대**(commit-button 비활성·'0개 파일'). Red 실증 후 진행.

- [ ] **Step 3: store — clearError** (`repository-store.ts`)

인터페이스의 `clearCommitFile(): void` 줄 뒤에:

```ts
  /** 전역 에러를 지운다 — 다이얼로그를 새로 열 때 이전 작업 에러가 인라인으로 새어들지 않게. 동기라 guard 불필요 */
  clearError(): void
```

구현의 `clearCommitFile() { ... },` 블록 뒤에:

```ts
  clearError() {
    set({ error: null })
  },
```

- [ ] **Step 4: CommitForm — allowEmpty** (`CommitForm.tsx` 전체 교체)

```tsx
import { useState } from 'react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import './commit-form.css'

interface CommitFormProps {
  stagedCount: number
  busy: boolean
  /** 빈 메시지로 저장하면 대신 들어갈 규칙 기반 제안 (스펙 8장). 없으면 빈 문자열 */
  suggestion: string
  /** 합치는 중에는 변경 0개여도 저장(병합 커밋)이 의미 있다 — 전량 ours 데드엔드 방지 (품질 리뷰) */
  allowEmpty: boolean
  onCommit(message: string): Promise<boolean>
}

export function CommitForm({ stagedCount, busy, suggestion, allowEmpty, onCommit }: CommitFormProps) {
  const [message, setMessage] = useState('')
  const effectiveMessage = message.trim().length > 0 ? message : suggestion
  const disabled = busy || (stagedCount === 0 && !allowEmpty) || effectiveMessage.trim().length === 0

  return (
    <form
      className="commit-form"
      onSubmit={(event) => {
        event.preventDefault()
        // 커밋이 실패하면(훅 거부, 충돌 상태 등) 입력한 메시지를 보존한다
        void onCommit(effectiveMessage).then((committed) => {
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
        placeholder={suggestion || '무엇을 바꿨는지 적어 주세요'}
        rows={3}
      />
      {message.trim().length === 0 && suggestion.length > 0 && (
        // 스펙 10장 "선택의 결과는 말로 설명한다" — placeholder가 힌트가 아니라 실제 저장 문구임을 알린다
        <p className="commit-form__hint" data-testid="commit-hint">
          비워 두고 저장하면 위 제안 문구로 저장돼요
        </p>
      )}
      <Button variant="primary" type="submit" isDisabled={disabled} testId="commit-button">
        저장하기 — {allowEmpty && stagedCount === 0 ? '합치기 마무리' : `${stagedCount}개 파일`}
      </Button>
    </form>
  )
}
```

- [ ] **Step 5: ConflictPanel — mode 어휘 분기** (`ConflictPanel.tsx`)

(a) props에 추가(`busy: boolean` 줄 뒤):

```ts
  /** 어느 흐름의 충돌인가 — merge는 "가져온 것", revert는 "되돌린 결과물"로 문구를 분기한다 (품질 리뷰) */
  mode: 'merging' | 'reverting'
```

(b) 함수 시그니처의 구조 분해에 `mode` 추가, 본문 첫 줄(`const [confirmingMark, ...]` 앞)에:

```ts
  const takenLabel = mode === 'reverting' ? '되돌린 결과물' : '가져온 것'
```

(c) 힌트 문단 교체:

```tsx
      <p className="conflict-panel__hint">
        초록 구간이 <strong>내 것</strong>, 보라 구간이 <strong>{takenLabel}</strong>이에요. 한쪽을
        고르면 파일 전체가 그쪽으로 정리돼요. 세밀하게 고치려면 편집기에서 직접 수정한 뒤 "직접
        수정했어요"를 눌러 주세요.
      </p>
```

(d) theirs 버튼 라벨 교체:

```tsx
          <Download size={13} aria-hidden="true" /> {takenLabel} 사용
```

(e) 주석(파일 상단 doc comment)의 `보라 구간 = 가져온 것.`을 `보라 구간 = 가져온 것(revert에서는 되돌린 결과물).`으로 갱신.

- [ ] **Step 6: ManageBranchesDialog — onClearError** (`ManageBranchesDialog.tsx`)

(a) props에 추가(`onCancel(): void` 줄 앞):

```ts
  /** 이름 바꾸기 프롬프트를 열 때 이전 에러를 지운다 — 스테일 인라인 에러 방지 (품질 리뷰) */
  onClearError(): void
```

(b) 구조 분해에 `onClearError` 추가, 이름 바꾸기 버튼의 onPress 교체:

```tsx
                    onPress={() => {
                      onClearError()
                      setRenameTarget(branch.name)
                    }}
```

- [ ] **Step 7: App.tsx 배선**

(a) suggestion 계산 교체 — 합치는 중 변경 0개면 기본 제안을 준다(버튼이 곧바로 활성):

```tsx
  const stagedCount = status?.changes.filter((c) => c.staged !== null).length ?? 0
  const conflictCount = status?.changes.filter((c) => c.unstaged === 'conflicted').length ?? 0
  // 전량 ours 병합 마무리 — 변경 0개면 규칙 제안이 비므로 기본 문구를 준다 (품질 리뷰)
  const suggestion =
    status?.state === 'merging' && stagedCount === 0
      ? '실험 공간 합치기'
      : suggestCommitMessage(status?.changes ?? [])
```

(b) 상태 바 문구 분기 교체:

```tsx
            {`${status.state === 'merging' ? '실험 공간 합치는 중' : '저장 되돌리는 중'} — ${
              conflictCount > 0
                ? `겹침 ${conflictCount}개 남음. 붉은 ! 파일에서 한쪽을 고르고, 다 정리되면 저장하기로 마무리해요.`
                : status.state === 'reverting' && stagedCount === 0
                  ? '겹침 0개 남음. 전부 내 것을 유지해서 바뀌는 내용이 없어요 — 되돌리기 취소를 눌러 마무리해요.'
                  : '겹침 0개 남음. 이제 저장하기로 마무리해요.'
            }`}
```

(c) ConflictPanel에 `key`·`mode` 추가:

```tsx
            <ConflictPanel
              key={store.conflictFile.path}
              path={store.conflictFile.path}
              content={store.conflictFile.content}
              busy={store.busy}
              mode={status?.state === 'reverting' ? 'reverting' : 'merging'}
              onResolve={(choice) => void store.resolveConflict(store.conflictFile!.path, choice)}
              onMarkResolved={() => void store.markConflictResolved(store.conflictFile!.path)}
              onReload={() => store.reloadConflict(store.conflictFile!.path)}
            />
```

(d) CommitForm에 `allowEmpty` 추가:

```tsx
          <CommitForm
            stagedCount={stagedCount}
            busy={store.busy}
            suggestion={suggestion}
            allowEmpty={status?.state === 'merging'}
            onCommit={(message) => store.commit(message)}
          />
```

(e) 다이얼로그 열기 시점 clearError 배선 — BranchSwitcher·HistoryPanel·ManageBranchesDialog:

```tsx
              onCreate={() => {
                store.clearError()
                setBranchPrompt({ fromHash: null })
              }}
              onManage={() => {
                store.clearError()
                setManageOpen(true)
              }}
```

```tsx
            onCreateBranchAt={(hash) => {
              store.clearError()
              setBranchPrompt({ fromHash: hash })
            }}
```

```tsx
      <ManageBranchesDialog
        isOpen={manageOpen}
        branches={store.branches}
        busy={store.busy}
        errorText={store.error}
        onRename={(oldName, newName) => store.renameBranch(oldName, newName)}
        onRemove={(name, force) => store.removeBranch(name, force)}
        onClearError={() => store.clearError()}
        onCancel={() => setManageOpen(false)}
      />
```

- [ ] **Step 8: E2E 단언 보강 2건** (`smoke.spec.ts`)

(a) `'되돌리기가 겹치면 상태 바에서 취소할 수 있다'` — 상태 바 확인과 취소 클릭 사이에 전량 ours 안내 문구 검증을 끼운다:

```ts
    await expect(window.getByTestId('merge-bar')).toContainText('저장 되돌리는 중')
    // 전부 내 것을 유지하면 바뀌는 내용이 없다 — 저장하기 대신 취소로 마무리하도록 안내한다
    await window.getByTestId('file-unstaged-app.txt').click()
    await window.getByTestId('conflict-ours').click()
    await expect(window.getByTestId('merge-bar')).toContainText('되돌리기 취소를 눌러 마무리해요')
    await window.getByTestId('merge-abort').click()
```

(b) `'합쳐지지 않은 실험 공간은 두 번 확인 후에만 지워진다'` — 느슨한 2차 확인 단언을 제목 텍스트로 교체하고, 2차 클릭을 강제 확인창으로 스코프한다. 오버레이 퇴장 애니메이션(120ms) 동안 1차(퇴장 중)·2차 다이얼로그가 DOM에 공존해, 전역 `confirm-accept` 클릭은 strict mode 2개 매치로 결정적으로 실패한다(실측):

```ts
    // 합쳐지지 않은 저장 — 1차와 구분되는 강제 확인창(제목)이 이어진다
    await expect(window.getByText('아직 합쳐지지 않은 저장이 있어요')).toBeVisible()
    // 1차 다이얼로그가 퇴장 애니메이션 동안 공존한다 — 강제 확인창으로 스코프해 클릭
    await window
      .getByRole('alertdialog', { name: '아직 합쳐지지 않은 저장이 있어요' })
      .getByTestId('confirm-accept')
      .click()
```

(기존의 두 번째 `await window.getByTestId('confirm-accept').click()` 줄은 위 스코프 클릭으로 대체한다.)

- [ ] **Step 9: 게이트** — `pnpm -r test`(**230 tests**) + `pnpm -r typecheck`(5 Done) + `pnpm --filter desktop build` + E2E 전체(**24 passed**) 전부 exit 0

- [ ] **Step 10: Commit**

```bash
git add packages/git-adapter/test apps/desktop/src/renderer/src apps/desktop/e2e
git commit -m "fix(desktop): 품질 리뷰 — 전량 ours 데드엔드·스테일 인라인 에러·점프 커서·revert 어휘

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 최종 게이트 + 스크린샷 + README

- [ ] **Step 1: 전체 게이트** — 230 tests + typecheck 5 + build + **E2E 24 passed**

- [ ] **Step 2: 스크린샷 3장** (1440×900, test-results/ + scratchpad 사본, **생성 후 e2e 재실행 금지**)

- (a) `e1c-manage.png` — 실험 공간 관리 다이얼로그(지금 여기 표시·이름 바꾸기/지우기)
- (b) `e1c-revert-bar.png` — "저장 되돌리는 중 — 겹침 1개 남음" 상태 바 + 충돌 뷰(다음 겹침 버튼·개념색 버튼)
- (c) `e1c-pull.png` — 받아오기 직후 notice("원격의 최신 저장을 받아왔어요") + 히스토리 갱신, 다크 모드

- [ ] **Step 3: README** — 나열의 "실험 공간 합치기(…), " 뒤에 "최신 받아오기(pull — 겹치면 같은 충돌 흐름), 저장 되돌리기(revert), 실험 공간 관리(이름 바꾸기·지우기), "를 추가하고, "다음 단계"의 `최신 받아오기(pull/fetch)·되돌리기(revert)` 항목을 제거하고 남은 항목 번호를 정리한다.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README — E1c 받아오기·되돌리기·실험 공간 관리 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6-보완: 최종 통합 리뷰 2건 (크로스 기능 실측 반영)

통합 리뷰(실기동·CLI 재현)가 잡은 결함을 반영한다:

- **(Important 1) merging/reverting 중 revert 무가드** — 우클릭 되돌리기에 상태 가드가 전혀 없다. 실측: (a) 충돌 미해결 중이면 원어 에러(`Reverting is not possible because you have unmerged files…`) 노출, (b) 전량 해소 후 MERGE_HEAD가 남은 상태면 **revert가 실제로 실행되어 MERGE_HEAD를 소비, 병합이 "Revert …" 제목의 거짓 메시지로 조용히 완결**되거나 병합 중간에 revert 커밋이 삽입된다, (c) 해소 직후 재충돌하면 에러도 notice도 없이 해소가 재오염된다. → **이중 방어**: 어댑터 `commits.revert` 선두 상태 가드(친절 에러) + 우클릭 메뉴 항목 비활성.
- **(Important 2) dirty 겹침 revert 원어 에러** — 저장 안 된 수정이 revert 대상과 겹치면 `Your local changes … would be overwritten by merge` 원문 노출. switch·merge·pull은 같은 상황에서 자동 보관 후 재시도하는 것이 앱 원칙 — revert만 예외라 일관성이 깨진다. → **스마트 되돌리기**(자동 보관 후 재시도, `autoShelved` 반환·notice 안내).
- **(Minor 4) pullLatest·mergeBranch·revertCommit 스냅샷 미보장** — 자동 보관까지 간 뒤 2차 시도가 GitError로 던져지면 보관함 카운트가 낡는다. → discard와 같은 try/finally 스냅샷 패턴으로 통일.

**Files:**
- Modify: `packages/domain/src/repository.ts` (RevertResult.autoShelved)
- Modify: `packages/git-adapter/src/client.ts` (REVERT_SHELF_MESSAGE·revert 가드+자동 보관)
- Test: `packages/git-adapter/test/client.test.ts` (신규 3건 + 기존 단언 2곳 갱신)
- Modify: `apps/desktop/src/renderer/src/ui/ContextMenu.tsx` (+`context-menu.css`) (disabled 지원)
- Modify: `apps/desktop/src/renderer/src/components/HistoryPanel.tsx` (revertDisabled prop)
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts` (try/finally 3곳·shelfNotice)
- Modify: `apps/desktop/src/renderer/src/App.tsx` (revertDisabled 배선)
- Test: `apps/desktop/e2e/smoke.spec.ts` (되돌리는 중 메뉴 비활성 단언)

- [ ] **Step 1: 어댑터 Red** — `client.test.ts`의 `'revertAbort — 되돌리는 중이 아니면 읽히는 메시지로 거부한다'` 테스트 **앞**에 3건 추가:

```ts
  it('revert — 합치는 중(merging)에는 읽히는 메시지로 거부한다 (거짓 병합 완결 차단)', async () => {
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

    const head = (await client.history.list(1))[0]!
    await expect(client.commits.revert(head.hash)).rejects.toThrow(/먼저 마무리하거나 취소/)
    // 병합 상태가 소비되지 않고 그대로 남아 있어야 한다
    expect((await client.repo.status()).state).toBe('merging')
  })

  it('revert — 되돌리는 중(reverting)에도 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', 'v2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v2'], { cwd: repo })
    await writeFixtureFile(repo, 'README.md', 'v3\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v3'], { cwd: repo })
    const middle = (await client.history.list(2))[1]!
    expect((await client.commits.revert(middle.hash)).outcome).toBe('conflict')
    const head = (await client.history.list(1))[0]!
    await expect(client.commits.revert(head.hash)).rejects.toThrow(/먼저 마무리하거나 취소/)
  })

  it('revert — 저장 안 된 변경이 겹치면 보관함에 넣고 되돌린다 (스마트 되돌리기)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', 'v2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v2'], { cwd: repo })
    await writeFixtureFile(repo, 'README.md', 'editing\n')

    const head = (await client.history.list(1))[0]!
    const result = await client.commits.revert(head.hash)
    expect(result).toEqual({ outcome: 'reverted', autoShelved: true })
    const shelf = await client.shelf.list()
    expect(shelf[0]?.message).toContain('저장 되돌리기 자동 보관')
    // 되돌린 결과가 워킹 트리에 반영됐다
    expect(await client.files.readText('README.md')).toBe('# fixture\n')
  })
```

Run: `pnpm --filter @git-gui/git-adapter test` → **3건 FAIL 확인**(가드 없음·autoShelved 없음). Red 실증 후 진행.

- [ ] **Step 2: domain — RevertResult** (`packages/domain/src/repository.ts`)

```ts
/** 되돌리기(revert) 결과 — conflict면 REVERT_HEAD가 남는다(상태 바 reverting) */
export interface RevertResult {
  outcome: 'reverted' | 'conflict'
  /** 막혀서 변경을 보관함에 자동 저장했는가 (스펙: 덮기 전 자동 보관) */
  autoShelved: boolean
}
```

- [ ] **Step 3: 어댑터 — 가드 + 스마트 되돌리기** (`packages/git-adapter/src/client.ts`)

(a) 상수(`PULL_SHELF_MESSAGE` 선언 뒤):

```ts
/** 되돌리기가 막혀 자동 보관할 때의 보관함 메시지 */
const REVERT_SHELF_MESSAGE = '저장 되돌리기 자동 보관'
```

(b) `async revert(hash)` 전체 교체 (import에 `type GitResult`를 `@git-gui/git-process`에서 추가):

```ts
      async revert(hash) {
        const cwd = await topLevel()
        assertFullHash(hash)
        // merging·reverting 도중의 revert는 MERGE_HEAD를 소비해 병합을 거짓 메시지로
        // 완결시키거나, 해소된 충돌을 무통보로 재오염시킨다(통합 리뷰 실측) — 먼저 마무리를 안내한다
        const gitDir = (await execGitOrThrow(['rev-parse', '--absolute-git-dir'], { cwd })).stdout.trim()
        if (detectState(await readGitDirMarkers(gitDir)) !== 'normal') {
          throw new Error('지금 진행 중인 작업을 먼저 마무리하거나 취소해야 되돌릴 수 있어요.')
        }
        const runOnce = async (): Promise<GitResult> => {
          const run = (extra: string[]) =>
            execGit(['revert', '--no-edit', ...extra, '--end-of-options', hash], { cwd })
          let result = await run([])
          // merge commit은 -m 없이는 거부된다(실측) — 앱 원칙대로 첫 부모 기준으로 재시도
          if (result.exitCode !== 0 && result.stderr.includes('is a merge but no -m option')) {
            result = await run(['-m', '1'])
          }
          return result
        }
        const classify = (result: GitResult, autoShelved: boolean): RevertResult | null => {
          if (result.exitCode === 0) return { outcome: 'reverted', autoShelved }
          const output = result.stdout + result.stderr
          if (output.includes('CONFLICT') || output.includes('after resolving the conflicts')) {
            return { outcome: 'conflict', autoShelved }
          }
          if (output.includes('bad object')) {
            throw new Error(MISSING_COMMIT_MESSAGE)
          }
          return null
        }
        const first = await runOnce()
        const classified = classify(first, false)
        if (classified !== null) return classified
        if (!(first.stdout + first.stderr).includes('would be overwritten')) {
          throw new GitError(['revert', '--no-edit', '--end-of-options', hash], first)
        }
        // 막혔다 — 스펙 원칙: 변경을 보관함에 자동 저장하고 진행한다 (switch·merge·pull과 동일 패턴)
        await execGitOrThrow(['stash', 'push', '-u', '-m', REVERT_SHELF_MESSAGE], { cwd })
        const second = await runOnce()
        const secondClassified = classify(second, true)
        if (secondClassified !== null) return secondClassified
        throw new GitError(['revert', '--no-edit', '--end-of-options', hash], second)
      },
```

(c) 기존 테스트 단언 2곳 갱신 — `'revert — 저장을 반대로 적용하는…'`의 `toEqual({ outcome: 'reverted' })` 2곳을 `toEqual({ outcome: 'reverted', autoShelved: false })`로, `'revert — 이후 저장과 겹치면 conflict…'`의 `toEqual({ outcome: 'conflict' })`를 `toEqual({ outcome: 'conflict', autoShelved: false })`로.

- [ ] **Step 4: 어댑터 Green** — `pnpm --filter @git-gui/git-adapter test` → **114 passed** (모노레포 총 233)

- [ ] **Step 5: ContextMenu — disabled 지원** (`ContextMenu.tsx`)

(a) 아이템 타입:

```ts
export interface ContextMenuItem {
  key: string
  label: string
  /** 지금 상태에서 실행할 수 없는 항목 — 숨기지 않고 비활성으로 보여준다 (상태를 숨기지 않는다) */
  disabled?: boolean
  onSelect(): void
}
```

(b) 버튼 렌더 교체:

```tsx
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className="ui-context-menu__item"
          disabled={item.disabled === true}
          onClick={() => {
            item.onSelect()
            onClose()
          }}
          data-testid={`context-${item.key}`}
        >
          {item.label}
        </button>
```

(c) `context-menu.css`의 `.ui-context-menu__item:hover` 블록 **앞**에:

```css
.ui-context-menu__item:disabled {
  opacity: 0.45;
  cursor: default;
}
```

(hover 블록은 `.ui-context-menu__item:hover:not(:disabled)`로 셀렉터를 교체해 비활성 항목에 hover 배경이 들지 않게 한다.)

- [ ] **Step 6: HistoryPanel — revertDisabled** (`HistoryPanel.tsx`)

(a) props에 추가(`onRevert(hash: string): void` 줄 앞):

```ts
  /** merging/reverting 중에는 되돌리기를 비활성 — 진행 중 작업을 먼저 마무리해야 한다 (통합 리뷰) */
  revertDisabled: boolean
```

(b) 구조 분해에 `revertDisabled` 추가, revert 메뉴 항목 교체:

```ts
            {
              key: 'revert',
              label: '이 저장 되돌리기 (revert)',
              disabled: revertDisabled,
              onSelect: () => onRevert(menu.commit.hash),
            },
```

- [ ] **Step 7: store — shelfNotice·try/finally 3곳** (`repository-store.ts`)

(a) `mergeBranch` 전체 교체:

```ts
  async mergeBranch(name) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      // 자동 보관까지 간 뒤 2차 시도가 실패해도 보관함 카운트가 낡지 않게 — 스냅샷은 finally로 보장 (통합 리뷰)
      let notice: string | null = null
      try {
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
        notice = `${notices[result.outcome] ?? ''}${shelfNotice}` || null
      } finally {
        set({
          ...CLEAR_SELECTIONS,
          ...(await fetchSnapshot(repoPath, get().historyLimit)),
          notice,
        })
      }
    })
  },
```

(b) `pullLatest` 전체 교체:

```ts
  async pullLatest() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      // 자동 보관까지 간 뒤 2차 시도가 실패해도 보관함 카운트가 낡지 않게 — 스냅샷은 finally로 보장 (통합 리뷰)
      let notice: string | null = null
      try {
        const result = await git().sync.pull(repoPath)
        const notices: Record<typeof result.outcome, string | null> = {
          'fast-forward': '원격의 최신 저장을 받아왔어요.',
          merged: '원격과 합쳐 새 병합 저장을 만들었어요.',
          // 충돌 안내는 머지 바가 상주하며 담당한다
          conflict: null,
          'up-to-date': '이미 최신이에요.',
        }
        const shelfNotice = result.autoShelved ? ' 저장 안 된 변경은 보관함에 넣어뒀어요.' : ''
        notice = `${notices[result.outcome] ?? ''}${shelfNotice}` || null
      } finally {
        set({
          ...CLEAR_SELECTIONS,
          ...(await fetchSnapshot(repoPath, get().historyLimit)),
          notice,
        })
      }
    })
  },
```

(c) `revertCommit` 전체 교체:

```ts
  async revertCommit(hash) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      // 자동 보관까지 간 뒤 2차 시도가 실패해도 보관함 카운트가 낡지 않게 — 스냅샷은 finally로 보장 (통합 리뷰)
      let notice: string | null = null
      try {
        const result = await git().commits.revert(repoPath, hash)
        const shelfNotice = result.autoShelved ? ' 저장 안 된 변경은 보관함에 넣어뒀어요.' : ''
        // 충돌 안내는 reverting 상태 바가 담당한다 — 보관 안내만 남긴다
        notice =
          `${result.outcome === 'reverted' ? '되돌리는 새 저장을 만들었어요.' : ''}${shelfNotice}` ||
          null
      } finally {
        set({
          ...CLEAR_SELECTIONS,
          ...(await fetchSnapshot(repoPath, get().historyLimit)),
          notice,
        })
      }
    })
  },
```

- [ ] **Step 8: App 배선** (`App.tsx`) — HistoryPanel에 추가:

```tsx
            revertDisabled={status?.state !== 'normal'}
```

(`onCreateBranchAt` prop 줄 바로 앞에.)

- [ ] **Step 9: E2E 보강** (`smoke.spec.ts`) — `'되돌리기가 겹치면 상태 바에서 취소할 수 있다'`의 `되돌리기 취소를 눌러 마무리해요` 단언 **뒤**, `merge-abort` 클릭 **앞**에:

```ts
    // 되돌리는 중에는 우클릭 되돌리기가 비활성 — 이중 실행을 막는다 (통합 리뷰)
    await window.locator('[data-testid^="history-item-"]').first().click({ button: 'right' })
    await expect(window.getByTestId('context-revert')).toBeDisabled()
    await window.keyboard.press('Escape')
```

- [ ] **Step 10: 게이트** — 루트 `pnpm test`(**233 passed**) + `pnpm typecheck`(5 Done) + `pnpm --filter @git-gui/desktop build` + E2E 전체(**24 passed**) 전부 exit 0

- [ ] **Step 11: 공식 스크린샷 복원** — Step 10의 e2e 실행이 test-results/를 비운다. scratchpad 사본에서 3장을 되돌린다:

```bash
cp <temporary-scratchpad>/e1c-manage.png \
   <temporary-scratchpad>/e1c-revert-bar.png \
   <temporary-scratchpad>/e1c-pull.png \
   "<repo-root>/apps/desktop/test-results/"
```

(참고: e1c-revert-bar.png는 가드 추가 후에도 유효하다 — 화면은 reverting 상태 바·충돌 뷰로, 이번 변경은 우클릭 메뉴 항목만 비활성화한다.)

- [ ] **Step 12: Commit**

```bash
git add packages/domain/src packages/git-adapter/src packages/git-adapter/test apps/desktop/src/renderer/src apps/desktop/e2e
git commit -m "fix: 통합 리뷰 — 진행 중 revert 이중 방어·스마트 되돌리기(자동 보관)·스냅샷 finally 보장

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 검증 게이트 요약

| 시점 | 기대치 |
| --- | --- |
| Task 1 후 | 222 tests (218 + pull 4) |
| Task 2 후 | +6 → **228 tests**, 4-보완 +1 → 229 |
| Task 5 후 | E2E 18 (기존 회귀 없음) |
| Task 6 후 | **E2E 23** |
| Task 5-보완 후 | +1 → **230 tests**, E2E +1 → **24** |
| Task 6-보완 후 | +3 → **233 tests** (E2E 24 유지) |
| 최종 | 233 tests + typecheck 5 + build + E2E 24 — 전부 exit 0 |

(수치가 어긋나면 이 표를 갱신한다.)

## 후속 노트 (E2 이관 후보)

- 원격 인증(HTTPS 토큰·SSH 키) 실패 UX — GIT_TERMINAL_PROMPT=0으로 즉시 실패, 원문 노출 가능(협업 단계에서)
- rebase형 pull, upstream 자동 연결 제안(받아오기 시 no-tracking이면 "백업으로 연결" 버튼)
- 팝오버 ESC 불응(E1a 잔여), 블록 단위 충돌 선택·앱 내 편집기
- revert의 revert·빈 revert 안내, 관리 다이얼로그에서 원격 브랜치 표시
- 현재 브랜치 이름 바꾸기 후 백업(push)이 upstream 불일치 원어 에러로 실패한다(리뷰 실측) — rename 시 upstream 갱신 또는 push 에러 매핑
- 관리 다이얼로그에서 needsForce 외 사유의 삭제 실패는 상단 배너로만 보인다(오버레이 위로 보이긴 함 — 품질 리뷰 Minor) — 다이얼로그 내 인라인 표시 검토
- pull 유래 충돌의 머지 바·기본 커밋 메시지가 "실험 공간 합치는 중/합치기"로 표기된다(통합 리뷰 Minor — MERGE_HEAD만으로는 출처 구분 불가) — "가져온 내용과 합치는 중" 같은 중립 문구 검토
