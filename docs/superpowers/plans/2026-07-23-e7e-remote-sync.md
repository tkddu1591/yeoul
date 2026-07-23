# E7e — 원격/동기화 개선 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) 구문으로 추적한다.

**Goal:** ①자동+수동 원격 새로고침(fetch --all --prune, 감시가 갱신 담당) ②받아오기 방식 설정(pull --rebase, 기존 rebasing 흐름 재사용) ③백업 시 upstream 연결 사실 안내(linked). 스펙 `docs/superpowers/specs/2026-07-23-e7e-remote-sync-design.md` 확정안.

**Architecture:** fetch의 화면 갱신은 **기존 fs 감시(refs/remotes 변화)**가 담당 — 신규 갱신 배선 없음(수동 fetch만 guard 안에서 직접 스냅샷: 자기 억제 창(800ms)이 감시 이벤트를 삼키기 때문 — 실측 6). 무변화 fetch의 헛갱신은 FETCH_HEAD 필터 제외로 차단(실측 1). upstream 자동 연결(-u)은 **엔진에 이미 있다**(E3a·E7a — 실측 7) — 이번 일은 `linked` 반환 동봉과 안내뿐. pullMode는 store 상태(설정 영속) — syncAfterMerge 등 내부 호출자가 시그니처 변경 없이 읽는다.

**Tech Stack:** 기존 그대로 (신규 의존성 없음).

**기준 커밋:** main = `4e746fe`. 기준선: 단위 **440 tests**(38 files), E2E **66**(smoke 60 + hosting 6). 작업 브랜치: **`feature/e7e-remote-sync`** (Task 1 Step 0에서 생성).

## 사전 실측 기록 (2026-07-23, macOS · git 2.50.1 — 로컬 bare 원격 실기동)

1. **fetch 1회 이벤트(fs.watch)**: 신규 원격 브랜치 fetch 시 `FETCH_HEAD`·`refs/remotes/origin/<이름>`(+.lock)·`logs/refs/remotes/...` 발생. **무변화 fetch는 `FETCH_HEAD`(수용됨)·`refs/remotes/origin/HEAD.lock`(필터됨)·`objects/maintenance.lock`(필터됨)만** — FETCH_HEAD를 필터에서 제외하면 무변화 fetch의 헛갱신이 0이 되고, 실제 변화는 refs/remotes/가 잡는다.
2. **원격 0개 저장소의 `fetch --all --prune`**: exit 0 no-op — 가드 불필요.
3. **`pull --rebase` 충돌**: `.git/rebase-merge/`(msgnum=1·end=1)가 생겨 **status.state='rebasing'** — E7a 상태 바(M/N·계속하기·취소)·충돌 카드가 그대로 동작. 성공 문구 3형: 무변화 `Already up to date.` / 뒤처짐만 `Fast-forward` / 진짜 재배치 `Successfully rebased and updated ...`. 충돌 문구: `CONFLICT`+`Could not apply <hash>...`. **dirty 거부**: `error: cannot pull with rebase: You have unstaged changes.` — merge 모드의 `would be overwritten`과 다른 트리거.
4. **연결 없는 브랜치 push 원문**: `fatal: The current branch <이름> has no upstream branch.` — 단, 현행 엔진은 이 원문에 도달하기 전에 upstream 부재를 감지해 스스로 `-u` 연결한다(실측 7).
5. **`push -u` 후**: `branch '<이름>' set up to track 'origin/<이름>'` — upstream 정상 등록.
6. **수동 fetch와 억제 창의 함정**: guard 안에서 fetch만 하면 guard 종료 직후 800ms 억제 창(WATCH_SUPPRESS_MS)이 fetch발 감시 이벤트를 삼켜 **화면이 갱신되지 않는다**. 수동 fetch는 guard 안에서 직접 스냅샷(+revive)을 뜬다. 자동 fetch(비guard)는 억제 창이 안 열리므로 감시가 정상 갱신.
7. **upstream 자동 연결은 기구현**: `sync.push`(client.ts:1017-1025)와 `branches.backup` 모두 upstream 부재 시 `push -u --end-of-options <remote> ...`로 연결한다(origin 우선). 이번 에픽은 그 사실을 **반환값(linked)으로 드러내고 notice**를 붙이는 일이다.

## 파일 구조 (책임 지도)

| 파일 | 책임 |
| --- | --- |
| `packages/domain/src/repository.ts` (수정) | PullResult outcome +'rebased'·BackupResult |
| `packages/git-adapter/src/client.ts` (수정) + `test/client.test.ts` | remotes.fetch·pull(mode)·push/backup linked |
| `packages/ipc-contract/src/index.ts` (수정) + `test/settings.test.ts` | 채널·시그니처·AppSettings(autoFetch·pullMode) |
| `apps/desktop/src/main/git-handlers.ts`·`preload/index.ts` (수정) | 배선 |
| `apps/desktop/src/main/watch-filter.ts` (수정) + `test/watch-filter.test.ts` | FETCH_HEAD 제외 |
| `apps/desktop/src/renderer/src/components/relative-time.ts` (기존 E0-3b — 재사용, 무변) | 상대 시간(formatRelativeTime) |
| `apps/desktop/src/renderer/src/ui/settings/sync-settings.ts` (신규) | autoFetch·pullMode load/save 순수 |
| `apps/desktop/src/renderer/src/store/repository-store.ts` (수정) | lastFetchAt·pullMode 상태·fetchRemotes/autoFetchRemotes·notice 확장 |
| `apps/desktop/src/renderer/src/ui/settings/SettingsDialog.tsx` (수정) | [일반]에 받아오기 방식·자동 새로고침 |
| `apps/desktop/src/renderer/src/components/BranchesPanel.tsx`·`branches-panel.css` (수정) | 원격 새로고침 버튼+시각 |
| `apps/desktop/src/renderer/src/App.tsx` (수정) | autoFetch 타이머 effect·프롭 배선 |
| `apps/desktop/e2e/smoke.spec.ts` (수정) | E2E +4 |

## 검증 게이트 요약

| 시점 | 기대치 |
| --- | --- |
| 기준선 (4e746fe) | 440 tests + E2E 66 (smoke 60 + hosting 6) |
| Task 1 후 | +3 → **443** (remotes.fetch) |
| Task 2 후 | +3 → **446** (pull rebase) |
| Task 3 후 | +2 → **448** (linked) |
| Task 4 후 | 448 유지 + typecheck (배선) |
| Task 5 후 | +1 → **449** (필터 — 상대시간은 기존 유틸 재사용으로 플랜 정정) |
| Task 6 후 | +1 → **450** (sanitize) + build + smoke 60 무회귀 |
| Task 7 후 | smoke **64** (신규 4) |
| 최종 (Task 8) | **450 tests** + typecheck + build + E2E **70**(smoke 64 + hosting 6) + last-screen 0건 + 스크린샷 2장 + README |

---

### Task 1: ① 엔진 — remotes.fetch (--all --prune)

**Files:**
- Modify: `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts` (+3)

- [x] **Step 0: 브랜치 생성** — main(4e746fe)에서 `git checkout -b feature/e7e-remote-sync`. `git branch --show-current` 확인.

- [x] **Step 1: Red.** `packages/git-adapter/test/client.test.ts`의 기존(E7d 마지막 worktrees 테스트 — createBranch 거부):

```ts
  it('worktrees.add — 새 이름이 중복·규칙 위반이면 읽히는 메시지로 거부한다 (E7d 실측 1)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('taken', null)
    // 함정: "a branch named ... already exists"가 기존 경로 매핑(already exists)에 먼저 걸리면 안 된다
    await expect(client.worktrees.add(`${repo}-dup`, 'taken', { createBranch: true })).rejects.toThrow(
      /이미 있는 실험 공간 이름이에요/,
    )
    await expect(
      client.worktrees.add(`${repo}-bad`, 'bad..name', { createBranch: true }),
    ).rejects.toThrow(/실험 공간 이름으로 쓸 수 없어요/)
  })
```

바로 뒤에 추가:

```ts

  it('remotes.fetch — 원격의 새 브랜치가 refs/remotes에 나타난다 (E7e)', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    // 갓 init된 bare는 HEAD가 unborn이라 --git-dir로 직접 브랜치를 못 만든다 — 먼저 push로 씨앗 커밋을 심는다 (E7e 편차)
    await client.sync.push()
    // 원격(bare)에 직접 브랜치를 만든다 — 이 클론은 fetch 전까지 모른다
    await execGitOrThrow(['--git-dir', remote, 'branch', 'fresh-on-remote', 'HEAD'], { cwd: repo })
    await client.remotes.fetch()
    const remoteRefs = (await execGitOrThrow(['branch', '-r'], { cwd: repo })).stdout
    expect(remoteRefs).toContain('origin/fresh-on-remote')
  })

  it('remotes.fetch — 사라진 원격 브랜치 등록을 prune으로 정리한다 (E7e)', async () => {
    const { repo, remote } = await execFixtureWithRemoteBranch()
    const client = createGitClient(repo)
    await execGitOrThrow(['--git-dir', remote, 'branch', '-D', 'to-vanish'], { cwd: repo })
    await client.remotes.fetch()
    const remoteRefs = (await execGitOrThrow(['branch', '-r'], { cwd: repo })).stdout
    expect(remoteRefs).not.toContain('origin/to-vanish')
  })

  it('remotes.fetch — 원격이 없으면 조용히 성공한다 (E7e 실측 2)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.remotes.fetch()).resolves.toBeUndefined()
  })
```

그리고 두 번째 it이 쓰는 헬퍼를 테스트 삽입 블록 **바로 앞**에 추가:

```ts
  /** 원격에 to-vanish 브랜치가 있고 이 클론이 그것을 아는 상태 — prune 재현용 (E7e) */
  async function execFixtureWithRemoteBranch(): Promise<{ repo: string; remote: string }> {
    const { repo, remote } = await createFixtureRepoWithRemote()
    // 갓 init된 bare는 HEAD가 unborn이라 --git-dir로 직접 브랜치를 못 만든다 — 먼저 push로 씨앗 커밋을 심는다 (E7e 편차)
    await createGitClient(repo).sync.push()
    await execGitOrThrow(['--git-dir', remote, 'branch', 'to-vanish', 'HEAD'], { cwd: repo })
    await execGitOrThrow(['fetch', 'origin'], { cwd: repo })
    return { repo, remote }
  }
```

주의(구현자): `createFixtureRepoWithRemote`의 반환 형태(remote 경로 필드 이름)를 fixture.ts에서 실독해 위 구조 분해를 실제 형태에 맞추고 편차를 보고하라(예: 필드가 `remotePath`면 그 이름으로).

- [x] **Step 2: Red 확인** — `pnpm vitest run --project @git-gui/git-adapter -t 'remotes.fetch'` → 네임스페이스 부재로 실패 확인.

- [x] **Step 3: 구현.** `packages/git-adapter/src/client.ts` 편집 2곳.

(a) 인터페이스 — 기존(sync 블록 꼬리):

```ts
    /** 백업 대상 remote(origin 우선 — push와 동일 규칙)의 URL. remote가 없으면 null */
    remoteUrl(): Promise<string | null>
  }
```

교체:

```ts
    /** 백업 대상 remote(origin 우선 — push와 동일 규칙)의 URL. remote가 없으면 null */
    remoteUrl(): Promise<string | null>
  }
  remotes: {
    /**
     * 원격 최신을 조용히 가져온다 — fetch --all --prune(사라진 원격 등록 정리 포함).
     * 원격 0개면 no-op 성공(실측 2). 화면 갱신은 감시(refs/remotes 변화)가 담당한다 (E7e)
     */
    fetch(): Promise<void>
  }
```

(b) 런타임 — sync 런타임 블록의 끝을 찾아(`remoteUrl` 구현의 닫는 `},` 뒤, sync 블록 닫는 `},` 직후) `remotes` 블록을 추가한다. 기존 앵커는 구현 시 실독(remoteUrl 구현 전문을 grep) — 추가할 블록:

```ts
    remotes: {
      async fetch() {
        const cwd = await topLevel()
        await execGitOrThrow(['fetch', '--all', '--prune'], { cwd })
      },
    },
```

- [x] **Step 4: Green + 게이트** — remotes.fetch 3건 통과. 루트 `pnpm test` → **443 passed**. `pnpm typecheck` Done.

- [x] **Step 5: Commit**

```bash
git add packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(git-adapter): E7e ① remotes.fetch — --all --prune·원격 0개 no-op

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: ② 엔진 — sync.pull(mode) 재배치 분기

**Files:**
- Modify: `packages/domain/src/repository.ts`
- Modify: `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts` (+3)

- [x] **Step 1: 도메인.** 기존:

```ts
export interface PullResult {
  outcome: 'fast-forward' | 'merged' | 'conflict' | 'up-to-date'
  autoShelved: boolean
}
```

교체:

```ts
export interface PullResult {
  /** rebased: 재배치로 받기(pull --rebase)가 내 저장을 원격 위로 다시 쌓았다 (E7e) */
  outcome: 'fast-forward' | 'merged' | 'conflict' | 'up-to-date' | 'rebased'
  autoShelved: boolean
}
```

- [x] **Step 2: Red.** Task 1이 추가한 `remotes.fetch — 원격이 없으면 조용히 성공한다` it 바로 뒤에 추가:

```ts

  it('sync.pull rebase 모드 — 발산해도 병합 저장 없이 일직선이 된다 (E7e 실측 3)', async () => {
    const { repo } = await createDivergedFromRemote()
    const client = createGitClient(repo)
    const result = await client.sync.pull('rebase')
    expect(result).toEqual({ outcome: 'rebased', autoShelved: false })
    // 병합 커밋(부모 2개)이 없다 — 역사가 일직선
    const merges = (await execGitOrThrow(['log', '--merges', '--oneline'], { cwd: repo })).stdout
    expect(merges.trim()).toBe('')
  })

  it('sync.pull rebase 모드 — 미저장 변경은 자동 보관 후 진행한다 (E7e 실측 3 dirty)', async () => {
    const { repo } = await createDivergedFromRemote()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'tracked.txt', 'dirty\n')
    const result = await client.sync.pull('rebase')
    expect(result.outcome).toBe('rebased')
    expect(result.autoShelved).toBe(true)
    const shelf = await client.shelf.list()
    expect(shelf.length).toBe(1)
  })

  it('sync.pull rebase 모드 — 충돌이면 rebasing 상태가 되어 기존 흐름을 잇는다 (E7e 실측 3)', async () => {
    const { repo } = await createDivergedFromRemote({ conflicting: true })
    const client = createGitClient(repo)
    const result = await client.sync.pull('rebase')
    expect(result.outcome).toBe('conflict')
    expect((await client.repo.status()).state).toBe('rebasing')
    expect(await client.rebase.progress()).toEqual({ current: 1, total: 1 })
  })
```

그리고 세 it이 쓰는 헬퍼를 삽입 블록 바로 앞에 추가:

```ts
  /**
   * 원격과 발산한 클론 (E7e) — 원격에 저장 1개(tracked.txt 또는 충돌용 같은 파일), 로컬에 다른 저장 1개.
   * conflicting이면 같은 파일을 양쪽이 다르게 저장해 재배치가 충돌한다
   */
  async function createDivergedFromRemote(options?: { conflicting?: boolean }): Promise<{
    repo: string
    remote: string
  }> {
    const { repo, remote } = await createFixtureRepoWithRemote()
    // 공통 조상·upstream이 없으면 pull --rebase가 tracking 에러로 죽는다 — push로 씨앗을 심는다 (E7e 편차, Task 1과 동일 패턴)
    await createGitClient(repo).sync.push()
    // 원격 쪽 저장 — 별도 클론에서 만들어 push (bare에는 직접 커밋할 수 없다)
    const sibling = await mkdtemp(join(tmpdir(), 'git-gui-fixture-sibling-'))
    await execGitOrThrow(['clone', remote, sibling], { cwd: repo })
    await writeFixtureFile(sibling, options?.conflicting === true ? 'clash.txt' : 'remote.txt', 'remote-side\n')
    await execGitOrThrow(['add', '-A'], { cwd: sibling })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'remote-side'], { cwd: sibling })
    await execGitOrThrow(['push', 'origin', 'HEAD'], { cwd: sibling })
    // 로컬 쪽 저장 — 발산
    await writeFixtureFile(repo, options?.conflicting === true ? 'clash.txt' : 'local.txt', 'local-side\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'local-side'], { cwd: repo })
    // dirty 테스트가 덮어쓸 tracked 파일
    if (options?.conflicting !== true) {
      await writeFixtureFile(repo, 'tracked.txt', 'clean\n')
      await execGitOrThrow(['add', '-A'], { cwd: repo })
      await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'tracked'], { cwd: repo })
    }
    return { repo, remote }
  }
```

주의(구현자): `mkdtemp`·`tmpdir`·`join`·`FIXTURE_IDENT`의 import 유무를 client.test.ts 상단에서 실독 — 없으면 기존 import 줄에 추가하고 편차 보고. dirty 테스트의 자동 보관은 **tracked 파일의 미저장 변경**이어야 rebase가 거부한다(실측 3: unstaged changes).

- [x] **Step 3: Red 확인** — `-t 'sync.pull rebase'` → 인자 미지원/분류 부재로 실패 확인.

- [x] **Step 4: 구현.** `packages/git-adapter/src/client.ts` 편집 2곳.

(a) 인터페이스 기존:

```ts
    /**
     * 원격의 최신 저장을 받아온다(fetch+merge). 막히면 자동 보관 후 재시도.
     * conflict면 MERGE_HEAD가 남아 기존 합치기 충돌 흐름(머지 바·충돌 뷰·저장하기 마무리)을 그대로 쓴다.
     */
    pull(): Promise<PullResult>
```

교체:

```ts
    /**
     * 원격의 최신 저장을 받아온다. 막히면 자동 보관 후 재시도.
     * merge 모드(기본): conflict면 MERGE_HEAD가 남아 기존 합치기 충돌 흐름을 그대로 쓴다.
     * rebase 모드(E7e): 내 저장을 원격 위로 다시 쌓는다 — conflict면 rebasing 상태(E7a 흐름 재사용)
     */
    pull(mode?: 'merge' | 'rebase'): Promise<PullResult>
```

(b) 런타임 기존:

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
        if (firstOut.includes('you have unmerged files')) {
          throw new Error('겹침(!)을 모두 정리해야 받아올 수 있어요.')
        }
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

교체:

```ts
      async pull(mode = 'merge') {
        const cwd = await topLevel()
        const remotes = await execGitOrThrow(['remote'], { cwd })
        if (remotes.stdout.trim() === '') {
          throw new Error('받아올 원격 저장소가 없어요. 먼저 원격 저장소를 연결해 주세요.')
        }
        // rebase 모드는 사용자 전역 rebase.autostash가 앱의 보관함 흐름을 가로채지 않게 고정한다 (E7a 관례)
        const args =
          mode === 'rebase'
            ? ['-c', 'rebase.autostash=false', 'pull', '--rebase']
            : ['pull', '--no-rebase', '--no-edit']
        const classify = (output: string): PullResult['outcome'] => {
          if (output.includes('Already up to date')) return 'up-to-date'
          if (output.includes('Fast-forward')) return 'fast-forward'
          // 실측 3: 진짜 재배치 성공은 "Successfully rebased and updated"
          if (output.includes('Successfully rebased')) return 'rebased'
          return mode === 'rebase' ? 'rebased' : 'merged'
        }
        // 실측 3: rebase 충돌은 "Could not apply"가 병기된다 (CONFLICT는 양쪽 공통)
        const isConflict = (output: string): boolean =>
          output.includes('CONFLICT') ||
          output.includes('Automatic merge failed') ||
          output.includes('Could not apply')
        // 실측 3: rebase의 미저장 거부 문구는 merge의 would be overwritten과 다르다
        const isBlockedByLocal = (output: string): boolean =>
          output.includes('would be overwritten') || output.includes('cannot pull with rebase')
        const run = () => execGit(args, { cwd })
        const first = await run()
        const firstOut = first.stdout + first.stderr
        if (first.exitCode === 0) return { outcome: classify(firstOut), autoShelved: false }
        if (firstOut.includes('you have unmerged files')) {
          throw new Error('겹침(!)을 모두 정리해야 받아올 수 있어요.')
        }
        if (firstOut.includes('no tracking information')) {
          throw new Error('이 실험 공간은 아직 원격과 연결되지 않았어요. 먼저 백업(push)으로 연결해 주세요.')
        }
        if (isConflict(firstOut)) {
          return { outcome: 'conflict', autoShelved: false }
        }
        if (!isBlockedByLocal(firstOut)) {
          throw new GitError(args, first)
        }
        // 막혔다 — 스펙 원칙: 변경을 보관함에 자동 저장하고 진행한다 (merge·switch와 동일 패턴)
        await execGitOrThrow(['stash', 'push', '-u', '-m', PULL_SHELF_MESSAGE], { cwd })
        const second = await run()
        const secondOut = second.stdout + second.stderr
        if (second.exitCode === 0) return { outcome: classify(secondOut), autoShelved: true }
        if (isConflict(secondOut)) {
          return { outcome: 'conflict', autoShelved: true }
        }
        throw new GitError(args, second)
      },
```

- [x] **Step 5: Green + 게이트** — 신규 3건 + 기존 pull 테스트 무회귀. 루트 `pnpm test` → **446 passed**. `pnpm typecheck`: domain·git-adapter·ipc-contract Done — **apps/desktop은 의도된 적색**(outcome 확장으로 pullLatest의 Record에 rebased 키가 없다 — Task 4 (f)가 닫는다. E7d Task 6의 '설계된 임시 실패' 관례).

- [x] **Step 6: Commit**

```bash
git add packages/domain/src/repository.ts packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(git-adapter): E7e ② pull(mode) — rebase 분기·rebased 분류·dirty 트리거(실측 3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: ③ 엔진 — 백업 linked 반환 (연결 사실 드러내기)

**Files:**
- Modify: `packages/domain/src/repository.ts`
- Modify: `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts` (+2)

- [x] **Step 1: 도메인.** Task 2가 만든 PullResult 교체본 바로 뒤(기존 `/** 되돌리기(revert) 결과 — conflict면 REVERT_HEAD가 남는다(상태 바 reverting) */` 주석 앞)에 추가 — 기존:

```ts
/** 되돌리기(revert) 결과 — conflict면 REVERT_HEAD가 남는다(상태 바 reverting) */
export interface RevertResult {
```

교체:

```ts
/** 백업(push) 결과 (E7e) — linked면 이번 백업이 upstream을 처음 연결했다(-u) */
export interface BackupResult {
  linked: boolean
}

/** 되돌리기(revert) 결과 — conflict면 REVERT_HEAD가 남는다(상태 바 reverting) */
export interface RevertResult {
```

- [x] **Step 2: Red.** Task 2가 추가한 `sync.pull rebase 모드 — 충돌이면...` it 바로 뒤에 추가:

```ts

  it('sync.push — 첫 백업은 linked, 두 번째는 아니다 (E7e 실측 7)', async () => {
    const { repo } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await execGitOrThrow(['checkout', '-b', 'fresh-branch'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '--allow-empty', '-m', 'x'], { cwd: repo })
    expect(await client.sync.push()).toEqual({ linked: true })
    expect(
      (await execGitOrThrow(['rev-parse', '--abbrev-ref', '@{upstream}'], { cwd: repo })).stdout.trim(),
    ).toBe('origin/fresh-branch')
    expect(await client.sync.push()).toEqual({ linked: false })
  })

  it('branches.backup — 첫 연결은 linked, 기존 연결은 아니다 (E7e 실측 7)', async () => {
    const { repo } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.branches.create('side-branch', null)
    expect(await client.branches.backup('side-branch')).toEqual({ linked: true })
    expect(await client.branches.backup('side-branch')).toEqual({ linked: false })
  })
```

- [x] **Step 3: Red 확인** — `-t 'linked'` → void 반환(toEqual undefined 불일치)으로 실패 확인.

- [x] **Step 4: 구현.** `packages/git-adapter/src/client.ts` 편집 — 4곳.

(a) 인터페이스 sync.push 기존:

```ts
    /** 현재 브랜치를 원격으로 백업한다. upstream이 없으면 첫 remote에 연결하며 올린다 */
    push(): Promise<void>
```

교체:

```ts
    /** 현재 브랜치를 원격으로 백업한다. upstream이 없으면 첫 remote에 연결하며 올린다 — linked로 알린다 (E7e) */
    push(): Promise<BackupResult>
```

(b) 인터페이스 branches.backup — 구현 시 grep으로 현행 선언(`backup(name: string): Promise<void>` 형태)을 찾아 `Promise<BackupResult>`로 교체하고 JSDoc에 "첫 연결이면 linked (E7e)"를 병기(실제 줄 실독·편차 보고).

(c) sync.push 런타임 — 평범 push 경로의 기존:

```ts
          // push.default=matching 같은 사용자 전역 설정이 다른 브랜치까지 올리지 않게 고정한다
          const plain = await execGit(['-c', 'push.default=simple', 'push'], { cwd })
          if (plain.exitCode !== 0) {
            rejectIfRemoteAhead(plain)
            throw new GitError(['-c', 'push.default=simple', 'push'], plain)
          }
          return
        }
```

교체:

```ts
          // push.default=matching 같은 사용자 전역 설정이 다른 브랜치까지 올리지 않게 고정한다
          const plain = await execGit(['-c', 'push.default=simple', 'push'], { cwd })
          if (plain.exitCode !== 0) {
            rejectIfRemoteAhead(plain)
            throw new GitError(['-c', 'push.default=simple', 'push'], plain)
          }
          return { linked: false }
        }
```

그리고 -u 경로의 기존:

```ts
        const linked = await execGit(['push', '-u', '--end-of-options', targetRemote, 'HEAD'], {
          cwd,
        })
        if (linked.exitCode !== 0) {
          rejectIfRemoteAhead(linked)
          throw new GitError(['push', '-u', '--end-of-options', targetRemote, 'HEAD'], linked)
        }
      },
```

교체:

```ts
        const linked = await execGit(['push', '-u', '--end-of-options', targetRemote, 'HEAD'], {
          cwd,
        })
        if (linked.exitCode !== 0) {
          rejectIfRemoteAhead(linked)
          throw new GitError(['push', '-u', '--end-of-options', targetRemote, 'HEAD'], linked)
        }
        return { linked: true }
      },
```

(d) branches.backup 런타임 — -u 경로의 기존:

```ts
          const args = ['push', '-u', '--end-of-options', target, name]
          const linked = await execGit(args, { cwd })
          if (linked.exitCode !== 0) {
            rejectIfRemoteAhead(linked)
            throw new GitError(args, linked)
          }
          return
        }
```

교체:

```ts
          const args = ['push', '-u', '--end-of-options', target, name]
          const linked = await execGit(args, { cwd })
          if (linked.exitCode !== 0) {
            rejectIfRemoteAhead(linked)
            throw new GitError(args, linked)
          }
          return { linked: true }
        }
```

그리고 기존 연결 경로의 기존:

```ts
        const args = ['push', '--end-of-options', remoteName, `${name}:${dstBranch}`]
        const result = await execGit(args, { cwd })
        if (result.exitCode !== 0) {
          rejectIfRemoteAhead(result)
          throw new GitError(args, result)
        }
      },
```

교체:

```ts
        const args = ['push', '--end-of-options', remoteName, `${name}:${dstBranch}`]
        const result = await execGit(args, { cwd })
        if (result.exitCode !== 0) {
          rejectIfRemoteAhead(result)
          throw new GitError(args, result)
        }
        return { linked: false }
      },
```

(e) client.ts의 domain import 목록에 `BackupResult`를 알파벳 자리(예: `type BranchCompare` 앞)에 추가.

- [x] **Step 5: Green + 게이트** — 신규 2건 + 기존 push/backup 테스트 무회귀(void 반환을 단언하던 기존 테스트가 있으면 반환값 무시 형태 확인 — 깨지면 실측 보고). 루트 `pnpm test` → **448 passed**. `pnpm typecheck`: 패키지 3종 Done — apps/desktop 적색은 Task 4가 닫는다(Task 2 게이트와 동일).

- [x] **Step 6: Commit**

```bash
git add packages/domain/src/repository.ts packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(git-adapter): E7e ③ 백업 linked 반환 — 기구현 -u 연결 사실을 결과로 동봉

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 배선 — IPC·store (fetchRemotes/autoFetchRemotes·pullMode 상태·notice)

**Files:**
- Modify: `packages/ipc-contract/src/index.ts`
- Modify: `apps/desktop/src/main/git-handlers.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/src/renderer/src/ui/settings/sync-settings.ts`
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`

- [x] **Step 1: 계약.** `packages/ipc-contract/src/index.ts` 편집 3곳.

(a) 기존:

```ts
  sync: {
    /** 현재 브랜치를 원격으로 백업(push). 원격이 없으면 에러 */
    push(repoPath: string): Promise<void>
    /** 원격의 최신 저장을 받아온다 — conflict면 기존 합치기 충돌 흐름이 이어진다 */
    pull(repoPath: string): Promise<PullResult>
  }
}
```

교체:

```ts
  sync: {
    /** 현재 브랜치를 원격으로 백업(push) — 첫 연결이면 linked (E7e). 원격이 없으면 에러 */
    push(repoPath: string): Promise<BackupResult>
    /** 원격의 최신 저장을 받아온다 — merge는 기존 충돌 흐름, rebase는 rebasing 흐름 (E7e) */
    pull(repoPath: string, mode: 'merge' | 'rebase'): Promise<PullResult>
  }
  remotes: {
    /** 원격 최신 가져오기(fetch --all --prune) — 갱신은 감시가 담당 (E7e) */
    fetch(repoPath: string): Promise<void>
  }
}
```

(b) branches.backup 선언(`backup(repoPath: string, name: string): Promise<void>`)을 grep으로 찾아 `Promise<BackupResult>`로 교체(실제 줄 실독·JSDoc 병기·편차 보고). domain import 목록에 `BackupResult` 추가.

(c) CHANNELS — 기존:

```ts
  repoOpenPath: 'repo:open-path',
```

교체:

```ts
  repoOpenPath: 'repo:open-path',
  remotesFetch: 'remotes:fetch',
```

- [x] **Step 2: 핸들러·preload.** `apps/desktop/src/main/git-handlers.ts` — worktreesReveal 핸들러 뒤(구현 시 grep — E7c에서 추가된 `ipcMain.handle(CHANNELS.worktreesReveal, ...)` 블록의 닫는 `})` 뒤)에 추가:

```ts

  ipcMain.handle(CHANNELS.remotesFetch, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).remotes.fetch(),
  )
```

sync.pull 핸들러 — 현행(`CHANNELS.syncPull` 유사 이름을 grep)에 mode 인자를 추가한다(같은 취지 — `assertString`이 아닌 리터럴 검증):

```ts
  // 교체 형태 (현행 핸들러를 grep해 같은 취지로 — 채널 상수·주변은 유지)
  ipcMain.handle(CHANNELS.syncPull, (_event, repoPath: unknown, mode: unknown) => {
    if (mode !== 'merge' && mode !== 'rebase') throw new Error('잘못된 요청 형식이에요.')
    return createGitClient(assertAllowedRepo(repoPath)).sync.pull(mode)
  })
```

`apps/desktop/src/preload/index.ts` — sync 블록의 pull을 `pull: (repoPath, mode) => ipcRenderer.invoke(CHANNELS.syncPull, repoPath, mode)`로 교체(현행 실독), 그리고 gitApi에 remotes 블록 추가:

```ts
  remotes: {
    fetch: (repoPath) => ipcRenderer.invoke(CHANNELS.remotesFetch, repoPath),
  },
```

(push/backup은 invoke 반환이 그대로 전달되므로 preload 무변 — 타입만 계약이 이끈다.)

- [x] **Step 3: 설정 순수.** `apps/desktop/src/renderer/src/ui/settings/sync-settings.ts` 신규:

```ts
export type PullMode = 'merge' | 'rebase'

/** 받아오기 방식 — 미설정·깨진 값은 기존 방식(merge) (E7e 스펙 기본값) */
export function loadPullMode(): PullMode {
  return window.settingsApi.initial.pullMode === 'rebase' ? 'rebase' : 'merge'
}

export function savePullMode(mode: PullMode): void {
  void window.settingsApi.set({ pullMode: mode })
}

/** 자동 원격 새로고침 — 기본 켬 (E7e). 명시적으로 false일 때만 꺼진다 */
export function loadAutoFetch(): boolean {
  return window.settingsApi.initial.autoFetch !== false
}

export function saveAutoFetch(enabled: boolean): void {
  void window.settingsApi.set({ autoFetch: enabled })
}
```

(AppSettings 필드 자체는 Task 6에서 sanitize와 함께 추가한다 — 이 파일은 Task 6 전까지 typecheck에서 `pullMode`/`autoFetch` 필드 부재로 실패하므로, **이 Step은 파일 생성만 하고 커밋은 Task 4에서 함께 하되 Task 4 게이트의 typecheck는 AppSettings 필드 추가(아래 Step 3b)까지 마친 뒤 확인한다**.)

(3b) `packages/ipc-contract/src/index.ts`의 AppSettings — 기존:

```ts
  /** 워크트리 선택 시 동작 — 클릭의 기본 동작만 결정한다(우클릭엔 항상 둘 다) (E7c) */
  worktreeSelectAction?: 'terminal' | 'switch-app'
}
```

교체:

```ts
  /** 워크트리 선택 시 동작 — 클릭의 기본 동작만 결정한다(우클릭엔 항상 둘 다) (E7c) */
  worktreeSelectAction?: 'terminal' | 'switch-app'
  /** 받아오기 방식 — merge(기본)/rebase (E7e) */
  pullMode?: 'merge' | 'rebase'
  /** 주기적 원격 새로고침(10분) — 기본 켬 (E7e) */
  autoFetch?: boolean
}
```

sanitize의 기존:

```ts
  if (candidate.worktreeSelectAction === 'terminal' || candidate.worktreeSelectAction === 'switch-app') {
    settings.worktreeSelectAction = candidate.worktreeSelectAction
  }
  return settings
}
```

교체:

```ts
  if (candidate.worktreeSelectAction === 'terminal' || candidate.worktreeSelectAction === 'switch-app') {
    settings.worktreeSelectAction = candidate.worktreeSelectAction
  }
  if (candidate.pullMode === 'merge' || candidate.pullMode === 'rebase') {
    settings.pullMode = candidate.pullMode
  }
  if (typeof candidate.autoFetch === 'boolean') settings.autoFetch = candidate.autoFetch
  return settings
}
```

(sanitize 단위 테스트는 Task 6에서 추가 — TDD 위반이 아니라 배선 태스크의 컴파일 요건이라 필드를 먼저 둔다.)

- [x] **Step 4: store.** `apps/desktop/src/renderer/src/store/repository-store.ts` 편집 6곳.

(a) import — 기존:

```ts
import { findRevivableChange } from './selection-revive'
```

교체:

```ts
import { findRevivableChange } from './selection-revive'
import { loadPullMode, savePullMode, type PullMode } from '../ui/settings/sync-settings'
```

(b) 상태 필드 — 기존:

```ts
  /** 워크트리 목록 — 스냅샷마다 함께 갱신된다. 첫 항목이 본체 (E7c) */
  worktrees: WorktreeInfo[]
```

교체:

```ts
  /** 워크트리 목록 — 스냅샷마다 함께 갱신된다. 첫 항목이 본체 (E7c) */
  worktrees: WorktreeInfo[]
  /** 마지막 원격 새로고침(fetch) 성공 시각 — 자동·수동 공통, 영속 안 함 (E7e) */
  lastFetchAt: number | null
  /** 받아오기 방식 — 설정 영속. syncAfterMerge 등 내부 호출자도 이 값을 읽는다 (E7e) */
  pullMode: PullMode
```

(c) 액션 선언 — 기존:

```ts
  /** Finder에서 보기 (E7c) */
  revealWorktree(path: string): Promise<void>
```

교체:

```ts
  /** Finder에서 보기 (E7c) */
  revealWorktree(path: string): Promise<void>
  /** 수동 원격 새로고침 — guard 경유(에러 배너). 억제 창이 감시 이벤트를 삼키므로 직접 스냅샷 (E7e 실측 6) */
  fetchRemotes(): Promise<void>
  /** 자동 원격 새로고침 — 조용히(배너·busy 없음), 실패 무시. 갱신은 감시가 담당 (E7e) */
  autoFetchRemotes(): Promise<void>
  /** 받아오기 방식 변경 — 즉시 영속 (E7e) */
  setPullMode(mode: PullMode): void
```

(d) 초기 상태 — 기존:

```ts
  rebaseProgress: null,
  worktrees: [],
```

교체:

```ts
  rebaseProgress: null,
  worktrees: [],
  lastFetchAt: null,
  pullMode: loadPullMode(),
```

(e) 액션 구현 — revealWorktree 구현(E7d ⑥에서 guard 없는 try/catch 형태) 바로 뒤에 추가. 기존:

```ts
  async revealWorktree(path) {
    const { repoPath } = get()
    if (!repoPath) return
    // 읽기 전용·즉발 — busy 직렬화(guard) 없이 언제나 동작한다. 실패만 배너로 (E7d ⑥)
    try {
      await git().worktrees.reveal(repoPath, path)
    } catch (cause) {
      set({ error: toErrorMessage(cause) })
    }
  },
```

교체:

```ts
  async revealWorktree(path) {
    const { repoPath } = get()
    if (!repoPath) return
    // 읽기 전용·즉발 — busy 직렬화(guard) 없이 언제나 동작한다. 실패만 배너로 (E7d ⑥)
    try {
      await git().worktrees.reveal(repoPath, path)
    } catch (cause) {
      set({ error: toErrorMessage(cause) })
    }
  },

  async fetchRemotes() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().remotes.fetch(repoPath)
      // guard 종료 직후 억제 창(800ms)이 fetch발 감시 이벤트를 삼킨다(실측 6) —
      // 감시에 맡기지 않고 여기서 직접 스냅샷을 뜬다. 보던 화면은 유지(E7d ⑤ 관례)
      const snapshot = await fetchSnapshot(repoPath, get().historyLimit)
      set({
        lastFetchAt: Date.now(),
        ...CLEAR_SELECTIONS,
        conflictFile: get().conflictFile,
        ...(await reviveSelections(repoPath, get(), snapshot.status)),
        ...snapshot,
      })
    })
  },

  async autoFetchRemotes() {
    const { repoPath } = get()
    if (!repoPath) return
    // 주기 작업 — busy 잠금·에러 배너 없이 조용히. 화면 갱신은 감시(refs/remotes 변화)가 담당하고,
    // 무변화면 FETCH_HEAD 필터 제외 덕에 아무 일도 없다 (E7e ① — 실패는 다음 주기 재시도)
    try {
      await git().remotes.fetch(repoPath)
      set({ lastFetchAt: Date.now() })
    } catch {
      // 오프라인·인증 실패 등 — 배너 도배 금지
    }
  },

  setPullMode(mode) {
    savePullMode(mode)
    set({ pullMode: mode })
  },
```

(f) pullLatest — 기존:

```ts
      try {
        const result = await git().sync.pull(repoPath)
        const notices: Record<typeof result.outcome, string | null> = {
          'fast-forward': '원격의 최신 저장을 받아왔어요.',
          merged: '원격과 합쳐 새 병합 저장을 만들었어요.',
          // 충돌 안내는 머지 바가 상주하며 담당한다
          conflict: null,
          'up-to-date': '이미 최신이에요.',
        }
```

교체:

```ts
      try {
        const result = await git().sync.pull(repoPath, get().pullMode)
        const notices: Record<typeof result.outcome, string | null> = {
          'fast-forward': '원격의 최신 저장을 받아왔어요.',
          merged: '원격과 합쳐 새 병합 저장을 만들었어요.',
          rebased: '원격 최신 위로 내 저장을 다시 쌓았어요 — 역사가 일직선이에요.',
          // 충돌 안내는 머지 바·rebasing 바가 상주하며 담당한다 (모드별)
          conflict: null,
          'up-to-date': '이미 최신이에요.',
        }
```

(g) backup — 기존:

```ts
  async backup() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().sync.push(repoPath)
      // 백업 후 upstream/ahead/behind가 바뀐다 — 스냅샷 갱신
      set({ ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },
```

교체:

```ts
  async backup() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      const result = await git().sync.push(repoPath)
      // 백업 후 upstream/ahead/behind가 바뀐다 — 스냅샷 갱신. 첫 연결이면 알린다 (E7e ③)
      set({
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        // linked는 첫 연결뿐 아니라 rename 재연결·반쪽 수리에서도 참 — "만들어"를 피한 중립 문구 (Task 3 리뷰)
        notice: result.linked
          ? '이 실험 공간을 원격과 연결하며 백업했어요 — 이제 ↑↓로 차이가 보여요.'
          : null,
      })
    })
  },
```

(h) backupBranch — 기존:

```ts
  async backupBranch(name) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().branches.backup(repoPath, name)
      // push는 ref를 움직이지 않는다 — 비교 뷰 무효화 불필요 (update와의 비대칭은 의도 — 품질 리뷰)
      set({
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: `"${name}"을 백업(push)했어요.`,
      })
    })
  },
```

교체:

```ts
  async backupBranch(name) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      const result = await git().branches.backup(repoPath, name)
      // push는 ref를 움직이지 않는다 — 비교 뷰 무효화 불필요 (update와의 비대칭은 의도 — 품질 리뷰)
      set({
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: result.linked
          ? `"${name}"을 원격과 연결하며 백업했어요 — 이제 ↑↓로 차이가 보여요.`
          : `"${name}"을 백업(push)했어요.`,
      })
    })
  },
```

- [x] **Step 5: 게이트** — `pnpm typecheck` Done. 루트 `pnpm test` → **448 passed**(무변). `pnpm --filter @git-gui/desktop build` 성공.

- [x] **Step 6: Commit**

```bash
git add packages/ipc-contract/src/index.ts apps/desktop/src/main/git-handlers.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/src/ui/settings/sync-settings.ts apps/desktop/src/renderer/src/store/repository-store.ts
git commit -m "feat(desktop): E7e 배선 — remotes.fetch IPC·pullMode store 상태·fetchRemotes(억제 창 우회)·linked notice

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 필터 FETCH_HEAD 제외

**(플랜 정정 — 컨트롤러 발견):** 상대 시간 유틸은 **E0-3b부터 `apps/desktop/src/renderer/src/components/relative-time.ts`의 `formatRelativeTime(epochSeconds, nowMs)`로 존재**한다(한국어 "방금 전/N분 전/N시간 전", 테스트 기보유). 최초안의 신규 `relativeTimeLabel` 생성은 DRY 위반이라 폐기 — Task 6이 기존 함수를 재사용한다(lastFetchAt은 ms라 `Math.floor(lastFetchAt / 1000)` 변환). 이 태스크는 필터 제외만 남는다.

**Files:**
- Modify: `apps/desktop/src/main/watch-filter.ts`
- Test: `apps/desktop/test/watch-filter.test.ts` (+1)

- [x] **Step 1: 필터 Red.** `apps/desktop/test/watch-filter.test.ts`의 기존(E7c 마지막 필터 테스트):

```ts
  it('워크트리 등록 메타 파일(worktrees/<이름>/gitdir 등 소문자)은 무시한다', () => {
    expect(isRelevantGitEvent('worktrees/wt-feat/gitdir')).toBe(false)
    expect(isRelevantGitEvent('worktrees/wt-feat')).toBe(false)
  })
```

바로 뒤에 추가:

```ts

  it('FETCH_HEAD는 무시한다 — 무변화 fetch의 헛갱신 차단, 변화는 refs/remotes/가 잡는다 (E7e 실측 1)', () => {
    expect(isRelevantGitEvent('FETCH_HEAD')).toBe(false)
    expect(isRelevantGitEvent('refs/remotes/origin/main')).toBe(true)
    // 다른 대문자 상태 마커는 그대로 수용
    expect(isRelevantGitEvent('MERGE_HEAD')).toBe(true)
  })
```

- [x] **Step 2: Red 확인 후 구현.** `-t 'FETCH_HEAD'` 실패 확인 → `apps/desktop/src/main/watch-filter.ts` 기존:

```ts
  // MERGE_HEAD·CHERRY_PICK_HEAD·REVERT_HEAD·FETCH_HEAD·ORIG_HEAD 등 top-level 상태 마커
  return /^[A-Z_]+$/.test(normalized)
```

교체:

```ts
  // fetch는 변화가 없어도 FETCH_HEAD를 매번 touch한다(E7e 실측 1) — 자동 fetch가 10분마다
  // 헛갱신을 만들지 않게 제외한다. 실제 변화는 refs/remotes/가 위의 refs/ 수용으로 잡힌다
  if (normalized === 'FETCH_HEAD') return false
  // MERGE_HEAD·CHERRY_PICK_HEAD·REVERT_HEAD·ORIG_HEAD 등 top-level 상태 마커
  return /^[A-Z_]+$/.test(normalized)
```

Green 확인.

- [x] **Step 3: 게이트** — 루트 `pnpm test` → **449 passed**. `pnpm typecheck` Done.

- [x] **Step 4: Commit**

```bash
git add apps/desktop/src/main/watch-filter.ts apps/desktop/test/watch-filter.test.ts
git commit -m "feat(desktop): E7e — FETCH_HEAD 필터 제외(무변화 fetch 헛갱신 차단)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: UI — 설정 [일반] 확장·자동 fetch 타이머·원격 새로고침 버튼

**Files:**
- Modify: `packages/ipc-contract/test/settings.test.ts` (+1)
- Modify: `apps/desktop/src/renderer/src/ui/settings/SettingsDialog.tsx`
- Modify: `apps/desktop/src/renderer/src/components/BranchesPanel.tsx` + `branches-panel.css`(해당 파일명 실독 — BranchesPanel이 import하는 css)
- Modify: `apps/desktop/src/renderer/src/App.tsx`

- [x] **Step 1: sanitize Red→Green.** `packages/ipc-contract/test/settings.test.ts`의 기존(E7d worktreeSelectAction 테스트):

```ts
  it('워크트리 선택 동작(worktreeSelectAction)은 두 값만 통과시킨다 (E7c)', () => {
    expect(sanitizeSettings({ worktreeSelectAction: 'terminal' })).toEqual({
      worktreeSelectAction: 'terminal',
    })
    expect(sanitizeSettings({ worktreeSelectAction: 'switch-app' })).toEqual({
      worktreeSelectAction: 'switch-app',
    })
    expect(sanitizeSettings({ worktreeSelectAction: 'always-ask' })).toEqual({})
  })
```

바로 뒤에 추가:

```ts

  it('받아오기 방식(pullMode)·자동 새로고침(autoFetch)을 검증해 통과시킨다 (E7e)', () => {
    expect(sanitizeSettings({ pullMode: 'rebase', autoFetch: false })).toEqual({
      pullMode: 'rebase',
      autoFetch: false,
    })
    expect(sanitizeSettings({ pullMode: 'squash', autoFetch: 'no' })).toEqual({})
  })
```

Red 확인(sanitize는 Task 4에서 이미 구현 — **바로 Green이어야 정상**. 실패하면 Task 4 구현 확인) → 통과 확인. (이 테스트는 사후 고정 — Task 4 배선의 컴파일 요건으로 필드가 먼저 갔다.)

- [x] **Step 2: SettingsDialog [일반] 확장.** `apps/desktop/src/renderer/src/ui/settings/SettingsDialog.tsx` 편집 3곳.

(a) import 기존:

```tsx
import type { WorktreeSelectAction } from './worktree-select-action'
```

교체:

```tsx
import type { WorktreeSelectAction } from './worktree-select-action'
import type { PullMode } from './sync-settings'
```

(b) props 기존:

```tsx
interface SettingsDialogProps {
  isOpen: boolean
  theme: Theme
  onChangeTheme(theme: Theme): void
  worktreeSelectAction: WorktreeSelectAction
  onChangeWorktreeSelectAction(action: WorktreeSelectAction): void
  onClose(): void
}
```

교체:

```tsx
interface SettingsDialogProps {
  isOpen: boolean
  theme: Theme
  onChangeTheme(theme: Theme): void
  worktreeSelectAction: WorktreeSelectAction
  onChangeWorktreeSelectAction(action: WorktreeSelectAction): void
  pullMode: PullMode
  onChangePullMode(mode: PullMode): void
  autoFetch: boolean
  onChangeAutoFetch(enabled: boolean): void
  onClose(): void
}
```

시그니처 구조 분해에도 `pullMode, onChangePullMode, autoFetch, onChangeAutoFetch,`를 같은 자리(worktree 쌍 뒤)에 추가(구현 시 실독 — 현행 구조 분해 블록에 삽입).

(c) [일반] 내용 — 기존(워크트리 fieldset 꼬리):

```tsx
                  <p className="settings-dialog__desc">
                    우클릭 메뉴에서는 설정과 무관하게 두 동작을 언제든 고를 수 있어요.
                  </p>
                </fieldset>
              ) : (
```

교체:

```tsx
                  <p className="settings-dialog__desc">
                    우클릭 메뉴에서는 설정과 무관하게 두 동작을 언제든 고를 수 있어요.
                  </p>
                </fieldset>
                <fieldset className="settings-dialog__field">
                  <legend className="settings-dialog__label">받아오기(pull) 방식</legend>
                  <label className="settings-dialog__radio">
                    <input
                      type="radio"
                      name="pull-mode"
                      checked={pullMode === 'merge'}
                      onChange={() => onChangePullMode('merge')}
                      data-testid="settings-pull-merge"
                    />
                    합치며 받기 — 원격과 내 저장을 합쳐요. 지금까지의 방식
                  </label>
                  <label className="settings-dialog__radio">
                    <input
                      type="radio"
                      name="pull-mode"
                      checked={pullMode === 'rebase'}
                      onChange={() => onChangePullMode('rebase')}
                      data-testid="settings-pull-rebase"
                    />
                    재배치로 받기 — 내 저장을 원격 최신 위로 다시 쌓아 역사가 일직선이 돼요
                  </label>
                </fieldset>
                <fieldset className="settings-dialog__field">
                  <legend className="settings-dialog__label">원격 새로고침</legend>
                  <label className="settings-dialog__radio">
                    <input
                      type="checkbox"
                      checked={autoFetch}
                      onChange={(event) => onChangeAutoFetch(event.target.checked)}
                      data-testid="settings-auto-fetch"
                    />
                    주기적으로 원격 새로고침 (10분)
                  </label>
                  <p className="settings-dialog__desc">
                    원격의 새 실험 공간·↑↓ 차이가 저절로 최신으로 유지돼요.
                  </p>
                </fieldset>
              ) : (
```

주의: [일반] 분기가 fieldset 하나를 감싸는 현행 구조에서 형제 fieldset 3개가 되므로, 분기 JSX가 단일 자식을 요구하면(현행은 `<fieldset>...</fieldset>` 하나) **fragment(`<>...</>`)로 감싼다** — 구현 시 현행 구조 실독 후 같은 취지로 조정·편차 보고.

- [x] **Step 3: BranchesPanel — 새로고침 버튼+시각.** 편집 3곳.

(a) import — 현행 상단(실독)에 추가: `import { RefreshCw } from 'lucide-react'`(lucide 미사용이면 신규 줄), `import { formatRelativeTime } from './relative-time'`(기존 E0-3b 유틸 재사용 — 플랜 정정). Button은 기존 import 확인(비교 뷰가 사용 — 있음).

(b) props — 현행 interface(실독)에 추가(onAction 위 근처, 같은 취지·편차 보고):

```ts
  /** 마지막 원격 새로고침 시각 — null이면 아직 없음 (E7e) */
  lastFetchAt: number | null
  /** 수동 원격 새로고침 (E7e) */
  onFetchRemotes(): void
```

(c) 렌더 — 기존:

```tsx
  return (
    <Panel title="실험 공간" accessory={<Badge tone="git">branch</Badge>} testId="branches-panel">
      <div className="branches-panel">
        <input
          className="branches-panel__search"
```

교체:

```tsx
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
```

(d) CSS — BranchesPanel이 import하는 css 파일(실독)에 추가:

```css
/* E7e 원격 새로고침 줄 — 버튼 + 마지막 시각(흐리게) */
.branches-panel__fetch {
  display: flex;
  align-items: center;
  gap: 8px;
}
.branches-panel__fetch-at {
  font-size: 10px;
  color: var(--color-text-faint);
}
```

- [x] **Step 4: App — 상태·타이머·프롭.** 편집 3곳.

(a) import — 기존:

```ts
import {
  loadWorktreeSelectAction,
  saveWorktreeSelectAction,
  type WorktreeSelectAction,
} from './ui/settings/worktree-select-action'
```

교체:

```ts
import {
  loadWorktreeSelectAction,
  saveWorktreeSelectAction,
  type WorktreeSelectAction,
} from './ui/settings/worktree-select-action'
import { loadAutoFetch, saveAutoFetch } from './ui/settings/sync-settings'
```

(b) 상태+타이머 — 기존(E7d ① effect — 이른 반환 앞에 있다):

```ts
  const prevConflictsRef = useRef(0)
  useEffect(() => {
    if (conflictCount > 0 && prevConflictsRef.current === 0) setLeftTab('changes')
    prevConflictsRef.current = conflictCount
  }, [conflictCount])
```

교체:

```ts
  const prevConflictsRef = useRef(0)
  useEffect(() => {
    if (conflictCount > 0 && prevConflictsRef.current === 0) setLeftTab('changes')
    prevConflictsRef.current = conflictCount
  }, [conflictCount])

  // E7e ① 자동 원격 새로고침 — 시작 직후 1회 + 10분 주기. fetch만 던지고 갱신은 감시가 담당.
  // 훅 순서 불변 — 이른 반환보다 앞 (E7d ① 교훈)
  const [autoFetch, setAutoFetch] = useState<boolean>(() => loadAutoFetch())
  const changeAutoFetch = (enabled: boolean) => {
    saveAutoFetch(enabled)
    setAutoFetch(enabled)
  }
  const repoPathForFetch = store.repoPath
  useEffect(() => {
    if (!autoFetch || repoPathForFetch === null) return
    void store.autoFetchRemotes()
    const timer = window.setInterval(() => void store.autoFetchRemotes(), 600_000)
    return () => window.clearInterval(timer)
    // store 액션은 zustand에서 안정 참조 — repoPath·autoFetch 전이에만 재구독
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch, repoPathForFetch])
```

(c) SettingsDialog 렌더 — 기존:

```tsx
      <SettingsDialog
        isOpen={settingsOpen}
        theme={theme}
        onChangeTheme={changeTheme}
        worktreeSelectAction={worktreeSelectAction}
        onChangeWorktreeSelectAction={changeWorktreeSelectAction}
        onClose={() => setSettingsOpen(false)}
      />
```

교체:

```tsx
      <SettingsDialog
        isOpen={settingsOpen}
        theme={theme}
        onChangeTheme={changeTheme}
        worktreeSelectAction={worktreeSelectAction}
        onChangeWorktreeSelectAction={changeWorktreeSelectAction}
        pullMode={store.pullMode}
        onChangePullMode={(mode) => store.setPullMode(mode)}
        autoFetch={autoFetch}
        onChangeAutoFetch={changeAutoFetch}
        onClose={() => setSettingsOpen(false)}
      />
```

(d) BranchesPanel 렌더 — 현행 `<BranchesPanel`의 props(실독 — `overview=...` 줄 앞)에 추가:

```tsx
              lastFetchAt={store.lastFetchAt}
              onFetchRemotes={() => void store.fetchRemotes()}
```

- [x] **Step 5: 게이트** — 루트 `pnpm test` → **450 passed**. `pnpm typecheck` Done. `cd apps/desktop && npx electron-vite build && npx playwright test e2e/smoke.spec.ts` → **60 passed**(무회귀 — 자동 fetch는 원격 없는 픽스처에서 no-op).

- [x] **Step 6: Commit**

```bash
git add packages/ipc-contract/test/settings.test.ts apps/desktop/src/renderer/src/ui/settings/SettingsDialog.tsx apps/desktop/src/renderer/src/components/BranchesPanel.tsx apps/desktop/src/renderer/src/components/branches-panel.css apps/desktop/src/renderer/src/App.tsx
git commit -m "feat(desktop): E7e UI — 설정 받아오기 방식·자동 새로고침·실험 공간 탭 원격 새로고침 버튼+시각

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(css 파일명이 다르면 실제 이름으로 — 편차 보고.)

---

### Task 7: E2E — 신규 4건

**Files:**
- Modify: `apps/desktop/e2e/smoke.spec.ts` (+4)

원격이 필요한 테스트는 로컬 bare 원격을 mkdtemp로 만들어 clone·push로 구성한다(네트워크 무접촉). **자동 fetch 경합 차단(Task 6 리뷰 advisory)**: autoFetch 기본 켬이라 앱 시작 즉시 fetch가 돌아 원격 픽스처 테스트와 경합(감시발 externalRefresh 플레이크)할 수 있다 — 원격 픽스처 테스트 ①②③은 userData에 `settings.json`을 미리 시드해 끈다(`await writeFile(join(userData, 'settings.json'), JSON.stringify({ autoFetch: false }))` — launch 전). ④는 기본 켬 상태 검증이 목적이라 시드하지 않는다. 파일 끝(E7d 마지막 테스트 `'터미널(외부) 커밋 후에도 보던 커밋 상세가 유지된다 (E7d ⑤)'`의 닫는 `})` 뒤)에 추가:

- [x] **Step 1: 테스트 4건 추가.**

```ts

test('원격 새로고침 — 원격의 새 실험 공간이 목록에 나타난다 (E7e ①)', async () => {
  const base = await mkdtemp(join(tmpdir(), 'git-gui-e2e-remote-'))
  const remote = join(base, 'remote.git')
  const repo = join(base, 'repo')
  await execGitOrThrow(['init', '--bare', remote], { cwd: base })
  await execGitOrThrow(['clone', remote, repo], { cwd: base })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: repo })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'v1\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'init'], { cwd: repo })
  await execGitOrThrow(['push', 'origin', 'HEAD'], { cwd: repo })
  // 원격에만 있는 새 브랜치 — 이 클론은 fetch 전까지 모른다
  await execGitOrThrow(['--git-dir', remote, 'branch', 'remote-only', 'HEAD'], { cwd: repo })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  // 자동 fetch가 테스트 흐름과 경합하지 않게 끈다 — 이 테스트는 수동 버튼/흐름만 검증 (Task 6 리뷰 advisory)
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ autoFetch: false }))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-branches').click()
    await expect(window.getByTestId('branch-row-origin/remote-only')).toHaveCount(0)
    await window.getByTestId('fetch-remotes').click()
    await expect(window.getByTestId('branch-row-origin/remote-only')).toBeVisible({ timeout: 10_000 })
    await expect(window.getByTestId('fetch-at')).toContainText('방금 전')
  } finally {
    await app.close()
    await rm(base, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('재배치로 받기 — 병합 저장 없이 일직선으로 받아온다 (E7e ②)', async () => {
  const base = await mkdtemp(join(tmpdir(), 'git-gui-e2e-remote-'))
  const remote = join(base, 'remote.git')
  const repo = join(base, 'repo')
  const sibling = join(base, 'sibling')
  await execGitOrThrow(['init', '--bare', remote], { cwd: base })
  await execGitOrThrow(['clone', remote, repo], { cwd: base })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: repo })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'v1\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'init'], { cwd: repo })
  await execGitOrThrow(['push', 'origin', 'HEAD'], { cwd: repo })
  // 원격 쪽 저장(다른 클론 경유) + 로컬 쪽 저장 — 발산
  await execGitOrThrow(['clone', remote, sibling], { cwd: base })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: sibling })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: sibling })
  await writeFile(join(sibling, 'remote.txt'), 'r\n')
  await execGitOrThrow(['add', '-A'], { cwd: sibling })
  await execGitOrThrow(['commit', '-m', '원격 쪽 저장'], { cwd: sibling })
  await execGitOrThrow(['push', 'origin', 'HEAD'], { cwd: sibling })
  await writeFile(join(repo, 'local.txt'), 'l\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '내 쪽 저장'], { cwd: repo })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  // 자동 fetch가 테스트 흐름과 경합하지 않게 끈다 — 이 테스트는 수동 버튼/흐름만 검증 (Task 6 리뷰 advisory)
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ autoFetch: false }))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    // 설정 → 재배치로 받기
    await window.getByTestId('settings-open').click()
    await window.getByTestId('settings-pull-rebase').click()
    await window.getByTestId('settings-close').click()
    await window.getByTestId('pull').click()
    await expect(window.getByTestId('notice')).toContainText('일직선', { timeout: 10_000 })
    // 병합 커밋 없음 — 역사 3개(초기·원격·재배치된 내 저장)
    await expect(window.getByTestId('history-count')).toHaveText('3')
    const merges = await execGitOrThrow(['log', '--merges', '--oneline'], { cwd: repo })
    expect(merges.stdout.trim()).toBe('')
  } finally {
    await app.close()
    await rm(base, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('백업 — 연결 없는 실험 공간은 자동 연결하며 알린다 (E7e ③)', async () => {
  const base = await mkdtemp(join(tmpdir(), 'git-gui-e2e-remote-'))
  const remote = join(base, 'remote.git')
  const repo = join(base, 'repo')
  await execGitOrThrow(['init', '--bare', remote], { cwd: base })
  await execGitOrThrow(['clone', remote, repo], { cwd: base })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: repo })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'v1\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'init'], { cwd: repo })
  await execGitOrThrow(['push', 'origin', 'HEAD'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'fresh-space'], { cwd: repo })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  // 자동 fetch가 테스트 흐름과 경합하지 않게 끈다 — 이 테스트는 수동 버튼/흐름만 검증 (Task 6 리뷰 advisory)
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ autoFetch: false }))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('backup').click()
    await expect(window.getByTestId('notice')).toContainText('연결하며 백업했어요', { timeout: 10_000 })
    await window.getByTestId('left-tab-branches').click()
    await expect(window.getByTestId('branch-row-fresh-space')).toContainText('동기화됨')
  } finally {
    await app.close()
    await rm(base, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('설정 — 받아오기 방식·자동 새로고침이 재시작 후에도 기억된다 (E7e)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const env = { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData }
  const app = await electron.launch({ args: [APP_ROOT], env })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('settings-open').click()
    await window.getByTestId('settings-pull-rebase').click()
    await window.getByTestId('settings-auto-fetch').click()
    await expect(window.getByTestId('settings-auto-fetch')).not.toBeChecked()
  } finally {
    await app.close()
  }
  const second = await electron.launch({ args: [APP_ROOT], env })
  try {
    const window = await second.firstWindow()
    await window.getByTestId('settings-open').click()
    await expect(window.getByTestId('settings-pull-rebase')).toBeChecked()
    await expect(window.getByTestId('settings-auto-fetch')).not.toBeChecked()
  } finally {
    await second.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
```

testId 실명은 구현 시 grep으로 확정됨: 받아오기 `pull`·백업 `backup`(플랜 원문 'push'는 오기)·`notice` — 나머지는 플랜 원문 그대로. ②의 history-count 기대치(3)는 초기·원격·재배치된 내 저장 — createRepoWithChange 대신 직접 만든 픽스처라 정확히 3이다.

- [x] **Step 2: 게이트** — `cd apps/desktop && npx electron-vite build && npx playwright test e2e/smoke.spec.ts` → **64 passed**. 신규 4건 각각 단독(-g) non-flaky 확인. 루트 `pnpm test` 450, typecheck Done.

- [x] **Step 3: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts
git commit -m "test(desktop): E7e E2E — 원격 새로고침·재배치 받기 일직선·백업 자동 연결·설정 영속

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 최종 게이트 + 공식 스크린샷 2장 + README

- [x] **Step 1: 전체 게이트** — 순서대로 전부 exit 0:
  - 루트 `pnpm test` → **450 passed**
  - 루트 `pnpm typecheck` → 전 프로젝트 Done
  - `pnpm --filter @git-gui/desktop build`
  - `pnpm --filter @git-gui/desktop e2e` → **70 passed** (smoke 64 + hosting 6, 창 미노출)
  - `find apps/desktop/test-results -name 'last-screen-*.png'` → 0건

- [x] **Step 2: README 반영.** `README.md` 기존(E7d 문단 끝):

```
깨진 쉘($SHELL)은 원인 안내를 띄우고, 테마 전환은 설정 모달 [테마] 카테고리로 이관됐습니다(헤더 단순화).
```

교체:

```
깨진 쉘($SHELL)은 원인 안내를 띄우고, 테마 전환은 설정 모달 [테마] 카테고리로 이관됐습니다(헤더 단순화). E7e로 원격/동기화가 좋아졌습니다 — 10분 주기 자동 원격 새로고침(설정에서 끄기 가능)과 실험 공간 탭의 수동 새로고침 버튼(마지막 시각 표시)으로 원격 목록·↑↓가 늘 최신이고, 받아오기(pull)를 "재배치로 받기"로 바꾸면 병합 커밋 없이 역사가 일직선이 되며(충돌은 기존 재배치 흐름 그대로), 연결(upstream) 없는 실험 공간을 백업하면 자동으로 원격에 만들어 연결하고 알려줍니다.
```

- [x] **Step 3: 공식 스크린샷 2장** — 임시 spec `apps/desktop/e2e/tmp-shots-e7e.spec.ts`(E7d 관례 — harness electron·1440×900·GIT_GUI_E2E_REPO/USER_DATA·finally 정리·scratchpad 사본·촬영 후 삭제·e2e 재실행 금지). 구성: **(1) e7e-fetch-branches.png** — 로컬 bare 원격 픽스처로 실험 공간 탭을 열고 수동 새로고침 실행 후(원격 새 브랜치 목록 반영·"방금 전 새로고침" 표시) 촬영. **(2) e7e-settings-sync.png** — 설정 [일반] 카테고리(워크트리·받아오기 방식·원격 새로고침 3개 fieldset이 겹침·잘림 없이) 촬영. **육안 검수는 컨트롤러가 한다** — 파일 경로만 보고.

- [x] **Step 4: Commit** (README만 — 플랜 실행 기록은 컨트롤러가 별도 docs 커밋)

```bash
git add README.md
git commit -m "docs: README — E7e 원격/동기화(자동+수동 fetch·재배치 받기·백업 자동 연결) 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

## Self-review 수정 기록 (인라인 반영)

1. **스펙 커버리지**: ①T1·T4·T5·T6(+E2E T7) ②T2·T4·T6 ③T3·T4 — 3건 전부 매핑. 스펙의 "upstream 자동 연결" 엔진 동작은 기구현(실측 7)이라 **linked 반환+notice로 축소** — 스펙 취지(사용자에게 연결 사실 안내) 그대로.
2. **억제 창 함정(실측 6)**: 수동 fetch를 guard+감시에 맡기면 화면이 안 바뀐다 — 설계 단계에서 발견해 fetchRemotes가 직접 스냅샷(+revive)을 뜨는 구조로 확정.
3. **pullMode를 store 상태로**: syncAfterMerge 등 내부 호출자가 시그니처 변경 없이 읽는다(App 상태로 두면 store 내부 호출자가 mode를 모르는 문제 — 타입 일관성 검토에서 발견).
4. **rebase classify의 폴백**: ff-only pull --rebase 출력에 "Fast-forward"가 있고(실측 3), 진짜 재배치는 "Successfully rebased" — 둘 다 없으면 mode 기준 폴백(rebased/merged).
5. **테스트 수 재검산(정정 반영)**: T1 +3, T2 +3, T3 +2, T5 +1, T6 +1 = +10 → 440+10=**450**. smoke 60+4=**64**, 전체 70. (최초안의 상대시간 +3은 기존 유틸 재사용으로 폐기 — E0-3b `formatRelativeTime` 발견.)
6. **Task 4 게이트의 sanitize 선행**: sync-settings.ts가 AppSettings 필드를 요구해 필드+sanitize 구현을 Task 4로 당기고 테스트 고정은 Task 6에 — 게이트 순서 명시.

## 인용 앵커 검증 기록

**스크립트 실검증(2026-07-23, main=4e746fe):** "기존:" 블록 전수 — 기준선 파일 정확 1회 매칭 **34개**, 나머지 1개는 신규 삽입 블록(remotes 런타임 — 앵커 아님, 정규식 오검출). 실 불일치 **0**.

작성 시점(main=4e746fe) 실측 원문 발췌 앵커: client.test.ts(E7d createBranch 거부 it 전문), client.ts(sync 인터페이스 꼬리·pull 선언·pull 런타임 전문·push 평범/-u 경로·branches.backup -u/기존 경로), domain(PullResult·RevertResult 주석), ipc-contract(sync 블록·repoOpenPath 채널 줄·AppSettings worktreeSelectAction 꼬리·sanitize worktreeSelectAction 블록), settings.test(worktreeSelectAction it 전문), watch-filter(E7c 마지막 테스트·대문자 마커 반환부 — E7d FETCH 주석 포함 현행), store(revealWorktree E7d 형태·pullLatest try 선두·backup·backupBranch 전문·worktrees 필드·초기 상태·selection-revive import), SettingsDialog(import·props·워크트리 fieldset 꼬리), BranchesPanel(Panel 선두+search), App(worktree-select-action import 블록·E7d ① effect 전문·SettingsDialog 렌더). **미확정(구현 시 grep·같은 취지 편집·편차 보고): createFixtureRepoWithRemote 반환 필드명, client.test.ts의 mkdtemp/tmpdir/join/FIXTURE_IDENT import 유무, sync 런타임 remoteUrl 꼬리(remotes 블록 삽입 위치), branches.backup 인터페이스 선언 줄, syncPull 채널 상수명·핸들러·preload 현행, worktreesReveal 핸들러 꼬리, SettingsDialog 구조 분해·[일반] 분기 단일 자식 구조(fragment 필요 여부), BranchesPanel import·interface·BranchesPanel 렌더 프롭 삽입점, branches-panel css 파일명, E2E의 pull/push/notice testId 실명.** Task 2→3(테스트 삽입 체인)·Task 4→6(sanitize 선행)·Task 6의 SettingsDialog 앵커는 E7d 산출 — 순서 엄수.

## 후속 노트 (이관 후보)

- **fetch 간격 커스텀·원격별 새로고침·다중 원격 선택 UI** — 스펙 범위 밖 재확인.
- **자동 fetch와 절전/네트워크 인지** — 오프라인 감지로 주기 건너뛰기(지금은 조용한 실패로 충분).
- **rebase 받기 중 강제 종료 복원** — rebasing 상태는 재시작 시 기존 상태 바가 복원하지만 pull 유래임은 표시되지 않음(어휘 중립 — 기존 이관 항목과 동일 계열).
- **lastFetchAt 영속** — 재시작 시 "N분 전" 이어가기(지금은 세션 로컬).

## 실행 기록 (2026-07-23, subagent-driven — 태스크별 스펙 byte-match+품질 결합 리뷰 + 최종 통합 리뷰 전부 통과)

- 커밋 8건: 96d2834(T1) · 868f3ba(T2) · 9c0dc4c(T3) · 197aec0(T4) · 743a1f5(T5) · adaa3c9(T6) · f5269a1(T7) · 7494378(T8 README).
- 최종 게이트(통합 리뷰어 재실측): 단위 **450** · typecheck 전부 Done · E2E **70**(smoke 64 + hosting 6) · last-screen 0건 · 공식 스크린샷 2장 컨트롤러 육안 검수 통과.
- 구현 편차(전부 본문 레트로 반영): T1·T2 픽스처 push 씨앗(갓 init된 bare의 unborn HEAD·공통 조상 부재 — 실기동 발견), **의도된 typecheck 적색 창**(T2의 outcome 확장 → T4가 닫음 — E7d '설계된 임시 실패' 관례로 게이트 명문화), **플랜 정정: 상대시간 유틸은 E0-3b `formatRelativeTime` 재사용**(신규 생성안은 DRY 위반 — 컨트롤러 발견, T5 축소·총계 453→450), T3 리뷰발 notice 중립화("만들어"→"연결하며" — rename 재연결·반쪽 수리도 linked라서), T6 리뷰 advisory로 원격 픽스처 E2E에 autoFetch:false 시드, T7 testId 실명(backup — 플랜 'push'는 오기).
- 프로세스 사고 1건: T6 구현자가 전역 prettier를 실행해 무설정 재포맷 발생 — 커밋 전 자체 복구, 리뷰어가 잔재 0 독립 검증.

## 후속 노트 추가분 (리뷰 이관)

- **staging 배치 테스트 부하성 플레이크** — E7d 관찰 지속(이번엔 미발생·기록 유지).
- **E2E 원격 픽스처 헬퍼 중복** — ①②③이 같은 bare+clone 구성을 반복 — 공용 헬퍼 추출 검토.
