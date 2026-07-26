# E7i 히스토리 전체 검색 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 히스토리 ⌘F가 "이미 불러온 커밋"이 아니라 **저장소 전체**를 검색하고, 안 불러온 매치로도 자동 로드 후 점프한다.

**Architecture:** 검색을 git에 위임한다 — 엔진 `history.search`가 순서 스캔(`--format=%H`)으로 만든 해시→인덱스 맵에 `-i -F --grep` 매치를 얹어 `{indices, hashes, truncated}`를 돌려준다(스코프 인자는 `history.list`와 동일 복제). store는 스코프 주입·점프용 로드(`ensureHistoryLoaded`)를 맡고, HistoryPanel은 로컬 `matchIndices` 매칭을 버리고 엔진 결과를 디바운스·seq로 받아 렌더한다.

**Tech Stack:** 기존과 동일(Electron·React·zustand·@tanstack/react-virtual·vitest·Playwright). 신규 의존성 없음.

**Branch:** `feature/e7i-history-search` (main ba3dd21 이후에서 생성)

**게이트 기준선:** 루트 테스트 **478**, desktop e2e **85**(smoke 79 + hosting 6). 태스크마다 "+N(실측 정정)"으로 누적하고, 실측이 다르면 구현자가 편차 보고·컨트롤러가 표를 정정한다(E7g·E7h 관례).

**사전 실측(플랜 작성 시 확인 — 재확인 불요):**
- `git log --date-order -i -F --grep=<q> --format=%H`: 대소문자 무시·고정 문자열 매치 정상, 정규식 메타(`a*b`)도 리터럴로 매치, **본문(-m 두 번째 문단)도 매치**(제목만 보는 현행 UI의 상위 호환).
- `history.list`의 스코프 인자 원문(client.ts 962-988행): `--no-show-signature` / `--decorate-refs-exclude=refs/remotes/*/HEAD` / `--decorate-refs-exclude=refs/replace/*` / (ref 없으면) `--exclude=refs/stash --exclude=refs/notes/* --exclude=refs/replace/* --all` / `--date-order` / (ref 있으면 맨 끝) `--end-of-options <ref>`.
- store `loadMoreHistory`(1287-1300행)의 재조회 규약: `historyRef ?? undefined`를 3번째 인자로, catch에서 ref가 있으면 `historyRef: null`로 조용히 전체 그래프 복귀.
- HistoryPanel 현행 검색 블록(181-193행)·FindBar 렌더 블록(309-329행)·App 배선(819-832행) 위치 확인됨.
- FindBar props: `query·position·count·placeholder·mode?·focusSignal·onQuery·onNext·onPrev·onClose`. 카운트 렌더는 `mode === 'filter' ? '${count}개' : count === 0 ? '0/0' : '${position+1}/${count}'`.

**플랜 명시 미확정(실독·같은 취지·편차 보고):** git-adapter 테스트 파일의 픽스처 헬퍼 실명(E7h Task 1에서 `createFixtureRepo()`·`createGitClient(repo)`로 확인됨 — 재확인), main 핸들러의 `assertString`·`assertAllowedRepo` 위치, smoke.spec.ts의 커밋 픽스처 관례(`createRepoWithChange()` 무인자·`GIT_GUI_E2E_REPO` env·`GIT_GUI_USER_DATA` 격리·`hoverAndCmdF` 헬퍼 재사용).

---

### Task 1: 엔진 `history.search`

**Files:**
- Modify: `packages/domain/src/repository.ts` (HistorySearchResult 신설 — CommitSummary 근처)
- Modify: `packages/git-adapter/src/client.ts` (history 네임스페이스 — 961-998행)
- Test: `packages/git-adapter/test/client.test.ts`

- [x] **Step 1: 도메인 타입 추가.** `packages/domain/src/repository.ts`에서 `CommitSummary` 선언 블록 바로 뒤(실독)에 추가:

```ts
/** 히스토리 전체 검색 결과 (E7i) — 목록에 아직 안 불러온 커밋까지 git이 찾는다.
 *  indices는 history.list와 같은 정렬(--date-order·같은 스코프) 기준 위치다 */
export interface HistorySearchResult {
  /** 매치 커밋의 목록 순서 위치(오름차순) */
  indices: number[]
  /** indices와 같은 순서의 커밋 해시 */
  hashes: string[]
  /** 순서 스캔 상한에 걸려 뒤쪽을 못 본 경우 true */
  truncated: boolean
}
```

`packages/domain/src/index.ts`(또는 배럴 파일 — 실독)에서 `CommitSummary`가 export되는 방식과 동일하게 `HistorySearchResult`도 export한다.

- [x] **Step 2: Red — 엔진 테스트 8건.** `packages/git-adapter/test/client.test.ts`의 기존 `history.list` describe 블록 뒤(실독)에 추가. 헬퍼 실명은 실독으로 맞춘다(E7h 실측: `createFixtureRepo()` + `createGitClient(repo)` + `execGitOrThrow`):

```ts
  describe('history.search (E7i)', () => {
    /** 제목·본문이 다른 커밋 4개 — 검색 대상 픽스처 */
    const seedSearchRepo = async (repo: string) => {
      const commits: Array<[string, string]> = [
        ['Alpha feature', '첫 저장'],
        ['beta FIX urgent', '두 번째 — magicword 포함'],
        ['gamma a*b literal', '세 번째'],
        ['delta last', '네 번째'],
      ]
      for (const [subject, body] of commits) {
        await writeFile(join(repo, 'f.txt'), `${subject}\n`)
        await execGitOrThrow(['add', 'f.txt'], { cwd: repo })
        await execGitOrThrow(
          ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', subject, '-m', body],
          { cwd: repo },
        )
      }
    }

    it('제목 매치를 목록 순서 인덱스로 돌려준다', async () => {
      const repo = await createFixtureRepo()
      await seedSearchRepo(repo)
      const client = createGitClient(repo)
      const result = await client.history.search('alpha')
      const list = await client.history.list(50)
      expect(result.indices).toHaveLength(1)
      expect(list[result.indices[0]!]!.subject).toBe('Alpha feature')
      expect(result.hashes[0]).toBe(list[result.indices[0]!]!.hash)
      expect(result.truncated).toBe(false)
    })

    it('대소문자를 무시한다', async () => {
      const repo = await createFixtureRepo()
      await seedSearchRepo(repo)
      const result = await createGitClient(repo).history.search('FIX')
      const lower = await createGitClient(repo).history.search('fix')
      expect(result.indices).toEqual(lower.indices)
      expect(result.indices).toHaveLength(1)
    })

    it('정규식 메타문자는 고정 문자열로 찾는다', async () => {
      const repo = await createFixtureRepo()
      await seedSearchRepo(repo)
      const client = createGitClient(repo)
      const literal = await client.history.search('a*b')
      expect(literal.indices).toHaveLength(1)
      // 정규식이었다면 'ab'·'aab' 등에도 걸린다 — 'a*' 자체로는 아무것도 안 걸려야 한다
      const notRegex = await client.history.search('gamma a*b literalX')
      expect(notRegex.indices).toEqual([])
    })

    it('본문도 매치한다', async () => {
      const repo = await createFixtureRepo()
      await seedSearchRepo(repo)
      const result = await createGitClient(repo).history.search('magicword')
      expect(result.indices).toHaveLength(1)
    })

    it('해시 접두로도 찾는다', async () => {
      const repo = await createFixtureRepo()
      await seedSearchRepo(repo)
      const client = createGitClient(repo)
      const list = await client.history.list(50)
      const target = list[2]!
      const result = await client.history.search(target.hash.slice(0, 7))
      expect(result.hashes).toContain(target.hash)
      expect(result.indices).toContain(2)
    })

    it('인덱스는 오름차순이고 중복이 없다', async () => {
      const repo = await createFixtureRepo()
      await seedSearchRepo(repo)
      // 모든 커밋 본문에 '저장'이 없으므로 공통 매치는 만든 뒤 확인한다 — 'a'는 여러 제목에 있다
      const result = await createGitClient(repo).history.search('a')
      expect(result.indices.length).toBeGreaterThan(1)
      expect([...result.indices].sort((x, y) => x - y)).toEqual(result.indices)
      expect(new Set(result.indices).size).toBe(result.indices.length)
    })

    it('ref 스코프면 그 계보만 본다', async () => {
      const repo = await createFixtureRepo()
      await seedSearchRepo(repo)
      const client = createGitClient(repo)
      await execGitOrThrow(['checkout', '-q', '-b', 'side'], { cwd: repo })
      await writeFile(join(repo, 'f.txt'), 'side only\n')
      await execGitOrThrow(['add', 'f.txt'], { cwd: repo })
      await execGitOrThrow(
        ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'sideonly commit'],
        { cwd: repo },
      )
      await execGitOrThrow(['checkout', '-q', 'main'], { cwd: repo })
      expect((await client.history.search('sideonly')).indices).toHaveLength(1)
      expect((await client.history.search('sideonly', 'main')).indices).toEqual([])
      expect((await client.history.search('sideonly', 'side')).indices).toHaveLength(1)
    })

    it('빈 검색어는 git을 부르지 않고 빈 결과다', async () => {
      const repo = await createFixtureRepo()
      await seedSearchRepo(repo)
      const result = await createGitClient(repo).history.search('')
      expect(result).toEqual({ indices: [], hashes: [], truncated: false })
    })
  })
```

(픽스처 기본 브랜치가 `main`이 아니면 checkout 대상 이름을 실독으로 맞춘다 — 편차 보고. `writeFile`·`join` import가 없으면 파일 상단에 추가.)

- [x] **Step 3: Red 확인** — `pnpm --filter @git-gui/git-adapter test` 실행. 새 8건이 "search is not a function" 계열로 실패하는 것을 확인한다.

- [x] **Step 4: 인터페이스 선언 추가.** client.ts의 기존:

```ts
    list(limit: number, ref?: string): Promise<CommitSummary[]>
  }
```

교체:

```ts
    list(limit: number, ref?: string): Promise<CommitSummary[]>
    /**
     * 저장소 전체에서 커밋을 찾는다 (E7i) — 목록이 아직 안 불러온 뒤쪽 커밋까지 git이 검색한다.
     * 메시지(제목+본문) 고정 문자열·대소문자 무시 매치 + 해시 접두. indices는 list와 같은 정렬 기준 위치
     */
    search(query: string, ref?: string): Promise<HistorySearchResult>
  }
```

`HistorySearchResult`를 `@git-gui/domain` import 목록에 추가한다(파일 상단 실독).

- [x] **Step 5: 구현.** client.ts의 history 네임스페이스에서 기존:

```ts
        return parseLog(result.stdout)
      },
    },
    sync: {
```

교체:

```ts
        return parseLog(result.stdout)
      },
      async search(query, ref) {
        if (query === '') return { indices: [], hashes: [], truncated: false }
        const cwd = await topLevel()
        // 스코프는 list와 동일해야 인덱스가 목록과 맞는다 — 같은 옵션 조합을 공유한다
        const scope = [
          '--no-show-signature',
          ...(ref === undefined
            ? ['--exclude=refs/stash', '--exclude=refs/notes/*', '--exclude=refs/replace/*', '--all']
            : []),
          '--date-order',
        ]
        const tail = ref === undefined ? [] : ['--end-of-options', ref]
        // 1) 순서 스캔 — 해시→인덱스. 상한을 넘으면 뒤쪽은 못 본다(truncated)
        const orderArgs = ['log', ...scope, `--max-count=${SEARCH_SCAN_MAX}`, '--format=%H', ...tail]
        const order = await execGit(orderArgs, { cwd })
        if (order.exitCode !== 0) {
          // 아직 커밋이 없는 저장소는 빈 결과다 (list와 같은 방어)
          if (order.stderr.includes('does not have any commits')) {
            return { indices: [], hashes: [], truncated: false }
          }
          throw new GitError(orderArgs, order)
        }
        const ordered = order.stdout.split('\n').filter((line) => line !== '')
        const indexOf = new Map(ordered.map((hash, index) => [hash, index]))
        // 2) 메시지 매치 — -F(고정 문자열)라 정규식 메타문자가 들어와도 오류·오작동이 없다
        const grepArgs = ['log', ...scope, '-i', '-F', `--grep=${query}`, '--format=%H', ...tail]
        const grep = await execGit(grepArgs, { cwd })
        if (grep.exitCode !== 0) throw new GitError(grepArgs, grep)
        const matched = new Set(grep.stdout.split('\n').filter((line) => line !== ''))
        // 3) 해시 접두 — 현행 UI가 해시로도 찾으므로 동등 유지
        if (/^[0-9a-fA-F]{4,40}$/.test(query)) {
          const prefix = query.toLowerCase()
          for (const hash of ordered) if (hash.startsWith(prefix)) matched.add(hash)
        }
        const indices: number[] = []
        const hashes: string[] = []
        for (const hash of matched) {
          const index = indexOf.get(hash)
          // 스캔 상한 밖 매치는 위치를 모른다 — truncated로 알리고 버린다
          if (index !== undefined) indices.push(index)
        }
        indices.sort((a, b) => a - b)
        for (const index of indices) hashes.push(ordered[index]!)
        return { indices, hashes, truncated: ordered.length >= SEARCH_SCAN_MAX }
      },
    },
    sync: {
```

파일 상단 상수 선언부(실독 — `HISTORY_MAX` 등 다른 상수 근처, 없으면 import 아래)에 추가:

```ts
/** 검색 순서 스캔 상한 (E7i) — 이보다 깊은 매치는 위치를 모른다(truncated로 알린다) */
const SEARCH_SCAN_MAX = 50000
```

- [x] **Step 6: Green 확인** — `pnpm --filter @git-gui/git-adapter test` 전건 통과.

- [x] **Step 7: 게이트** — 루트 `pnpm test` → **478+8(실측 정정)**, `pnpm typecheck` 전부 Done.

- [x] **Step 8: Commit**

```bash
git add packages/domain/src packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(git-adapter): E7i history.search — 저장소 전체 커밋 검색(순서 스캔+고정 문자열 grep+해시 접두)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Task 1 실행 편차 (소급 기록 — 리뷰 검증 완료):** ① `pnpm --filter @git-gui/git-adapter test`는 no-op(패키지에 test 스크립트 없음 — 루트 vitest projects 구조) → `npx vitest run packages/git-adapter/test/client.test.ts`로 대체. 이후 태스크도 같은 방식. ② 테스트는 별도 history.list describe가 없어 E7g ref 테스트 뒤에 삽입. ③ `writeFile` import 추가, domain은 `export *`라 배럴 수정 불요, 상수는 COMPARE_LIMIT 뒤. **리뷰 실측 확정:** list/search 인자 차이(decorate-refs-exclude·--max-count 위치·-z)는 순서·집합에 무영향 — 441커밋 전수 대조 `ORDER IDENTICAL`. `--grep=-foo`는 `=`결합 단일 argv라 옵션 오인 없음(git 2.50.1 실측) — 구현자 concern 종결. **리뷰 Minor(기록만):** grep 호출에 `--max-count`가 없어 초대형 저장소에서는 Task 5의 200ms 디바운스가 성능 안전망 — 반드시 유지할 것.

---

### Task 2: IPC 배선 (contract·preload·main)

**Files:**
- Modify: `packages/ipc-contract/src/index.ts` (GitApi.history — 148-151행, CHANNELS — 222행 부근)
- Modify: `apps/desktop/src/preload/index.ts` (history — 121-123행)
- Modify: `apps/desktop/src/main/git-handlers.ts` (historyList 핸들러 뒤 — 443-448행)

- [x] **Step 1: contract.** 기존:

```ts
  history: {
    /** 최신순 커밋 요약. limit은 1~10000 정수 — 범위 밖은 IPC에서 거부된다 (adapter의 clamp는 심층 방어). ref는 조회 모드(E7g) */
    list(repoPath: string, limit: number, ref?: string): Promise<CommitSummary[]>
  }
```

교체:

```ts
  history: {
    /** 최신순 커밋 요약. limit은 1~10000 정수 — 범위 밖은 IPC에서 거부된다 (adapter의 clamp는 심층 방어). ref는 조회 모드(E7g) */
    list(repoPath: string, limit: number, ref?: string): Promise<CommitSummary[]>
    /** 저장소 전체 커밋 검색 (E7i) — 로드 범위 밖 커밋도 찾는다. indices는 list 정렬 기준 위치 */
    search(repoPath: string, query: string, ref?: string): Promise<HistorySearchResult>
  }
```

`HistorySearchResult`를 이 파일의 `@git-gui/domain` re-export 목록(16행 부근 `RemoveBranchResult` 등과 같은 블록 — 실독)에 추가한다.

기존 채널 상수:

```ts
  historyList: 'history:list',
```

교체:

```ts
  historyList: 'history:list',
  historySearch: 'history:search',
```

- [x] **Step 2: preload.** 기존:

```ts
  history: {
    list: (repoPath, limit, ref) => ipcRenderer.invoke(CHANNELS.historyList, repoPath, limit, ref),
  },
```

교체:

```ts
  history: {
    list: (repoPath, limit, ref) => ipcRenderer.invoke(CHANNELS.historyList, repoPath, limit, ref),
    search: (repoPath, query, ref) =>
      ipcRenderer.invoke(CHANNELS.historySearch, repoPath, query, ref),
  },
```

- [x] **Step 3: main 핸들러.** git-handlers.ts의 기존 historyList 핸들러 블록:

```ts
  ipcMain.handle(CHANNELS.historyList, (_event, repoPath: unknown, limit: unknown, ref: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).history.list(
      assertLimit(limit),
      ref === undefined ? undefined : assertString(ref),
    ),
  )
```

교체:

```ts
  ipcMain.handle(CHANNELS.historyList, (_event, repoPath: unknown, limit: unknown, ref: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).history.list(
      assertLimit(limit),
      ref === undefined ? undefined : assertString(ref),
    ),
  )

  ipcMain.handle(
    CHANNELS.historySearch,
    (_event, repoPath: unknown, query: unknown, ref: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).history.search(
        assertString(query),
        ref === undefined ? undefined : assertString(ref),
      ),
  )
```

- [x] **Step 4: 게이트** — `pnpm typecheck` 전부 Done(계약·preload·핸들러 3면 일치 여부를 타입이 잡는다), 루트 `pnpm test` 유지(카운트 변화 없음), `cd apps/desktop && npx electron-vite build` 성공.

- [x] **Step 5: Commit**

```bash
git add packages/ipc-contract/src/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/main/git-handlers.ts
git commit -m "feat(desktop): E7i history.search IPC 배선 — contract·preload·main 핸들러

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Task 2 실행 편차 (소급 기록 — 리뷰 검증 완료):** `HistorySearchResult` re-export는 ipc-contract의 domain import 블록에 알파벳 순(FileDiff↔MergeResult 사이) 삽입 — 기존 관례 그대로. 그 외 편차 없음.

---

### Task 3: store — `searchHistory` + `ensureHistoryLoaded`

**Files:**
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts` (상수·인터페이스·loadMoreHistory 뒤)

- [x] **Step 1: 상수.** 기존:

```ts
const HISTORY_MAX = 10000
```

교체:

```ts
const HISTORY_MAX = 10000
/** 검색 점프 전용 로드 상한 (E7i) — 스크롤 페이지네이션(HISTORY_MAX)보다 깊은 매치로도 이동할 수 있게 */
const SEARCH_JUMP_MAX = 50000
```

- [x] **Step 2: 인터페이스 선언.** 인터페이스의 `loadMoreHistory(): Promise<void>` 선언 줄(실독) 바로 뒤에 추가:

```ts
  /** 저장소 전체 커밋 검색 (E7i) — 스코프(조회 중 ref)는 store가 넣는다. 실패는 조용히 빈 결과 */
  searchHistory(query: string): Promise<HistorySearchResult>
  /** 검색 점프용 — 그 인덱스가 목록에 들어오도록 필요한 만큼 더 불러온다 (E7i) */
  ensureHistoryLoaded(index: number): Promise<void>
```

`HistorySearchResult`를 이 파일의 `@git-gui/domain`(또는 ipc-contract) import 목록에 추가한다(기존 CommitSummary import 위치 실독).

- [x] **Step 3: 구현.** `loadMoreHistory` 구현 블록이 끝나는 지점의 기존:

```ts
  async revealHead() {
```

교체:

```ts
  async searchHistory(query) {
    const { repoPath } = get()
    if (!repoPath) return { indices: [], hashes: [], truncated: false }
    // 검색은 조회성 — guard(busy 잠금·에러 배너)를 쓰지 않고, 실패해도 조용히 빈 결과를 준다
    try {
      return await git().history.search(repoPath, query, get().historyRef ?? undefined)
    } catch {
      return { indices: [], hashes: [], truncated: false }
    }
  },

  async ensureHistoryLoaded(index) {
    const { repoPath, history, historyLimit } = get()
    if (!repoPath || index < history.length) return
    const next = Math.min(Math.max(index + 1, historyLimit + HISTORY_PAGE), SEARCH_JUMP_MAX)
    if (next <= historyLimit) return
    await guard(set, get, async () => {
      const ref = get().historyRef ?? undefined
      try {
        set({ history: await git().history.list(repoPath, next, ref), historyLimit: next })
      } catch (error) {
        // 조회 브랜치가 사라졌으면 조용히 전체 그래프로 복귀 (loadMoreHistory와 같은 원칙)
        if (ref === undefined) throw error
        set({ historyRef: null, history: await git().history.list(repoPath, next), historyLimit: next })
      }
    })
  },

  async revealHead() {
```

**주의**: `history.list`의 어댑터 clamp는 10000이고 IPC `assertLimit`도 1~10000을 강제한다(Task 2 Step 3 인용 주석 참조). `SEARCH_JUMP_MAX`(50000)로 부르면 IPC에서 거부된다 — Step 4에서 상한을 함께 올린다.

- [x] **Step 4: 상한 3곳 정합.** 검색 점프가 10000보다 깊은 매치로도 가려면 세 곳의 상한을 같이 올려야 한다(실독 후 교체):
  1. `packages/ipc-contract`의 limit 문서 주석과 `apps/desktop/src/main/git-handlers.ts`의 `assertLimit` 상한(현행 10000 — 실독)을 `50000`으로.
  2. `packages/git-adapter/src/client.ts`의 `history.list` clamp `Math.min(Math.max(Math.trunc(limit), 1), 10000)`을 `50000`으로.
  3. 관련 주석("1~10000")을 "1~50000"으로 갱신.
  스크롤 페이지네이션의 `HISTORY_MAX = 10000`은 **그대로 둔다**(일반 스크롤 상한은 유지, 검색 점프만 더 깊이 간다).

- [x] **Step 5: 게이트** — `pnpm typecheck` 전부 Done, 루트 `pnpm test` 유지(assertLimit 상한을 단언하는 기존 테스트가 있으면 같은 취지로 갱신 — 편차 보고), build 성공.

- [x] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/store/repository-store.ts packages/ipc-contract/src/index.ts apps/desktop/src/main/git-handlers.ts packages/git-adapter/src/client.ts
git commit -m "feat(desktop): E7i store 검색·점프 로드 — searchHistory·ensureHistoryLoaded(상한 50000 정합)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Task 3 실행 편차 (소급 기록 — 리뷰 검증 완료):** ① store의 `HistorySearchResult`는 ipc-contract가 아닌 `@git-gui/domain`에서 직접 import(CommitSummary 등 기존 관례). ② 플랜이 우려한 "`assertLimit` 상한 단언 테스트"는 전 저장소 grep 결과 **부재** — 갱신 대상 없음.

**Task 3 리뷰 실측(기록):** 60,000커밋 합성 저장소에서 limit=50000 실측 — `git log` 0.22s·stdout 9.35MB·parseLog 21ms·직렬화 44ms·buildGraph 12ms·heap ~86MB. 권한 상승 경로 없음(인자는 전부 main 조립), `assertLimit` 소비처는 historyList 1곳. 상한 값 6곳(assertLimit·contract 주석·client 주석·client clamp·SEARCH_JUMP_MAX·SEARCH_SCAN_MAX) 전부 50000 정합 — 엔진 index < 50000이라 `next = index+1 ≤ 50000`이 상한과 정확히 맞물림(off-by-one 없음). guard 미사용 검색의 동시성: `git log`는 인덱스 무접촉 + `GIT_OPTIONAL_LOCKS=0`, checkout 80회 × log 200회 동시 실행 실패 0건.

**Task 3 리뷰 Minor 후속 노트:** ① `HISTORY_MAX` 위 주석("IPC assertLimit와 동일한 상한")이 거짓이 됨 → Task 4에서 함께 정정. ② **historyLimit 끈적임**: 깊은 점프 뒤 historyLimit이 최대 50000으로 남아 `fetchSnapshot` 호출부 40곳이 매 갱신마다 그 규모를 재조회(회당 9.35MB·~77ms) — 1만 커밋 초과 저장소에서만 발생. 후속안: FindBar 닫힘 시 되돌리기 또는 스냅샷 갱신 인자를 `min(historyLimit, HISTORY_MAX)`로. ③ `revealHead`의 `limit += 2000` × 10회에 상한 체크 없음(기존 결함 — 50000 이후 요청이 거부될 수 있으나 조기 반환이 사실상 차단). ④ `ensureHistoryLoaded`에 "끝까지 다 봤음" 조기 반환 없음(실질 도달 불가). ⑤ index는 git 실시간 기준·history는 스냅샷이라 사이에 커밋이 생기면 한 줄 어긋남 — Task 5의 `history.length` 변화 재검색이 완화책.

---

### Task 4: FindBar — 전체 기준 카운터(`+` 표기)

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/FindBar.tsx`

- [x] **Step 1: prop 추가.** 기존:

```ts
  /** 필터형(E7h ⑥ 편차) — 위치 개념이 없는 목록 필터(CommitDetailPanel·ChangesPanel)에서 카운트만 렌더 */
  mode?: 'filter'
```

교체:

```ts
  /** 필터형(E7h ⑥ 편차) — 위치 개념이 없는 목록 필터(CommitDetailPanel·ChangesPanel)에서 카운트만 렌더 */
  mode?: 'filter'
  /** 검색 범위가 상한에 걸려 총계가 더 클 수 있음 (E7i) — 카운트 뒤에 + 를 붙인다 */
  countTruncated?: boolean
```

- [x] **Step 2: 구조 분해에 추가.** 기존:

```ts
  mode,
  focusSignal,
```

교체:

```ts
  mode,
  countTruncated,
  focusSignal,
```

- [x] **Step 3: 카운트 렌더.** 기존:

```tsx
        {mode === 'filter' ? `${count}개` : count === 0 ? '0/0' : `${position + 1}/${count}`}
```

교체:

```tsx
        {mode === 'filter'
          ? `${count}개`
          : count === 0
            ? '0/0'
            : `${position + 1}/${count}${countTruncated === true ? '+' : ''}`}
```

- [x] **Step 4: 게이트** — `pnpm typecheck` Done(선택 prop이라 기존 4개 호출부 무변), 루트 `pnpm test` 유지, build 성공.

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/FindBar.tsx
git commit -m "feat(desktop): E7i FindBar countTruncated — 검색 상한 초과 시 총계에 + 표기

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Task 4 실행 편차 (리뷰 발 정정 반영):** `repository-store.ts`의 `HISTORY_MAX` 위 주석이 "IPC assertLimit와 동일한 상한"이라 되어 있었으나 Task 3에서 `assertLimit` 상한이 50000으로 올라가면서 거짓이 됨 — "스크롤 페이지네이션 상한(IPC 상한과 별개) — IPC `assertLimit`는 50000까지 허용(검색 점프용, SEARCH_JUMP_MAX 참조)" 취지로 정정. 같은 커밋에 포함.

**Task 4 실행 편차 (소급 기록):** 리뷰 발 정정으로 store의 `HISTORY_MAX` 주석("IPC assertLimit와 동일한 상한" — Task 3에서 거짓이 됨)을 같은 커밋에서 정정.

---

### Task 5: HistoryPanel — 엔진 검색으로 교체(디바운스·seq·점프)

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/HistoryPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx` (HistoryPanel 배선 — 819-832행)

- [x] **Step 1: props 추가.** HistoryPanelProps에서 기존 `onLoadMore(): void` 선언 줄(실독) 뒤에 추가:

```ts
  /** 저장소 전체 검색 (E7i) — 스코프는 store가 넣는다 */
  onSearch(query: string): Promise<HistorySearchResult>
  /** 검색 점프 — 그 인덱스가 목록에 들어오도록 더 불러온다 (E7i) */
  onEnsureLoaded(index: number): Promise<void>
```

컴포넌트 구조 분해 목록(155-164행 부근 — `onLoadMore,` 줄)에도 `onSearch,`·`onEnsureLoaded,`를 같은 자리에 추가한다. `HistorySearchResult`를 `@git-gui/domain` import에 추가.

- [x] **Step 2: 검색 상태·이펙트 교체.** 기존 블록(181-193행):

```tsx
  // E7h ⑥ — ⌘F 점프 검색: 메시지·해시 매치 인덱스와 현재 위치(순환). 이른 반환이 없는
  // 컴포넌트지만(전부 삼항 렌더) 다른 훅과 나란히 최상단에 둔다(Rules of Hooks 관례 — E7d 교훈)
  const [findQuery, setFindQuery] = useState('')
  const [findPos, setFindPos] = useState(0)
  const findTexts = () => history.map((commit) => `${commit.subject} ${commit.hash}`)
  const findHits = findOpen ? matchIndices(findTexts(), findQuery) : []
  const currentHit = findHits.length === 0 ? -1 : findHits[Math.min(findPos, findHits.length - 1)]!
  const moveFind = (delta: number) => {
    if (findHits.length === 0) return
    const nextPos = cycleIndex(Math.min(findPos, findHits.length - 1), delta, findHits.length)
    setFindPos(nextPos)
    virtualizer.scrollToIndex(findHits[nextPos]!, { align: 'center' })
  }
```

교체:

```tsx
  // E7i — ⌘F 전체 검색: 매칭은 git이 한다(로컬 배열 매칭 폐기 — 안 불러온 커밋이 안 걸리던 문제).
  // 200ms 디바운스 + 요청 순번(seq)으로 늦게 온 응답을 버려 타이핑 중 카운터 역전을 막는다.
  // 이른 반환이 없는 컴포넌트지만 다른 훅과 나란히 최상단에 둔다(Rules of Hooks 관례 — E7d 교훈)
  const [findQuery, setFindQuery] = useState('')
  const [findPos, setFindPos] = useState(0)
  const [findHits, setFindHits] = useState<number[]>([])
  const [findTruncated, setFindTruncated] = useState(false)
  const findSeqRef = useRef(0)
  const currentHit = findHits.length === 0 ? -1 : findHits[Math.min(findPos, findHits.length - 1)]!

  // 검색 실행 — 쿼리·스코프(historyRef)·목록 갱신에 반응한다. 닫히면 결과를 비운다
  useEffect(() => {
    if (!findOpen || findQuery === '') {
      setFindHits([])
      setFindTruncated(false)
      return
    }
    const seq = findSeqRef.current + 1
    findSeqRef.current = seq
    const timer = setTimeout(() => {
      void onSearch(findQuery).then((result) => {
        // 늦게 온 응답 폐기 — 마지막 요청만 화면에 반영한다
        if (findSeqRef.current !== seq) return
        setFindHits(result.indices)
        setFindTruncated(result.truncated)
        if (result.indices.length > 0) {
          void jumpTo(result.indices[Math.min(findPos, result.indices.length - 1)]!)
        }
      })
    }, 200)
    return () => clearTimeout(timer)
    // findPos는 이동 핸들러가 직접 점프하므로 의존성에서 뺀다(재검색 유발 방지)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findOpen, findQuery, historyRef, history.length])

  /** 그 인덱스로 이동 — 로드 범위 밖이면 먼저 더 불러온다 (E7i) */
  const jumpTo = async (index: number) => {
    if (index >= history.length) await onEnsureLoaded(index)
    virtualizer.scrollToIndex(index, { align: 'center' })
  }

  const moveFind = (delta: number) => {
    if (findHits.length === 0) return
    const nextPos = cycleIndex(Math.min(findPos, findHits.length - 1), delta, findHits.length)
    setFindPos(nextPos)
    void jumpTo(findHits[nextPos]!)
  }
```

`useRef`가 이미 import돼 있는지 확인하고(실독 — 이 파일은 `scrollRef`로 이미 쓴다), `matchIndices` import가 이 파일에서 더 이상 안 쓰이면 import에서 제거한다(`cycleIndex`는 계속 쓴다 — 실독 후 정리).

- [x] **Step 3: FindBar 렌더 교체.** 기존(309-329행):

```tsx
      {findOpen && (
        <FindBar
          query={findQuery}
          position={findHits.length === 0 ? -1 : Math.min(findPos, findHits.length - 1)}
          count={findHits.length}
          focusSignal={findNonce}
          placeholder="메시지·해시 찾기"
          onQuery={(q) => {
            setFindQuery(q)
            setFindPos(0)
            const hits = matchIndices(findTexts(), q)
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

교체:

```tsx
      {findOpen && (
        <FindBar
          query={findQuery}
          position={findHits.length === 0 ? -1 : Math.min(findPos, findHits.length - 1)}
          count={findHits.length}
          countTruncated={findTruncated}
          focusSignal={findNonce}
          placeholder="메시지·해시 찾기 (전체)"
          onQuery={(q) => {
            // 매칭은 이펙트(디바운스 검색)가 한다 — 여기서는 쿼리·위치만 초기화
            setFindQuery(q)
            setFindPos(0)
          }}
          onNext={() => moveFind(1)}
          onPrev={() => moveFind(-1)}
          onClose={() => {
            setFindQuery('')
            setFindHits([])
            setFindTruncated(false)
            onFindClose()
          }}
        />
      )}
```

- [x] **Step 4: App 배선.** App.tsx의 HistoryPanel 렌더에서 기존:

```tsx
                onLoadMore={() => void store.loadMoreHistory()}
```

교체:

```tsx
                onLoadMore={() => void store.loadMoreHistory()}
                onSearch={(query) => store.searchHistory(query)}
                onEnsureLoaded={(index) => store.ensureHistoryLoaded(index)}
```

- [x] **Step 5: 게이트** — `pnpm typecheck` Done, 루트 `pnpm test` 유지, `cd apps/desktop && npx electron-vite build && npx playwright test e2e/smoke.spec.ts` → **79 유지**(기존 ⌘F 5건 무회귀 — 히스토리 검색 테스트가 디바운스 때문에 깨지면 `toHaveText` 자동 재시도가 흡수하는지 확인하고, 안 되면 그 테스트의 단언을 같은 취지로 조정·편차 보고). E2E는 포그라운드 동기(timeout 600000).

- [x] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/components/HistoryPanel.tsx apps/desktop/src/renderer/src/App.tsx
git commit -m "feat(desktop): E7i 히스토리 ⌘F 전체 검색 — 엔진 위임·디바운스/seq·범위 밖 자동 로드 점프

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Task 5 실행 편차 (리뷰 요구 반영):** ① `jumpTo`에 플랜에 없던 재확인 가드를 추가했다 — `onEnsureLoaded`는 busy(guard)면 조용히 아무것도 안 하고 끝나므로, 로드 후에도 `index`가 범위 밖이면 `scrollToIndex`를 건너뛴다(안 그러면 가상 목록이 바닥으로 튄다). `history`는 렌더 시점 prop이라 await 이후 최신값이 아닐 수 있어, 렌더마다(함수 본문에서 직접, `useEffect` 아님) 갱신하는 `historyLenRef`로 최신 길이를 읽는다 — 렌더 본문 대입은 React에서 "최신 값을 async 콜백에 전달"하는 표준 관용구(부수효과 없는 순수 대입)이며, `useEffect` 방식보다 커밋 타이밍에 더 가깝다. 늦게 도착하는 `set()`(zustand)→리렌더 사이의 근본적 경합(마이크로태스크 순서)은 완전히 없앨 수 없지만, 원래 플랜(가드 없음)보다 엄격히 안전한 방향이며 실무적으로 스토어의 `history.list` IPC 왕복(수 ms~수십 ms)이 리렌더보다 훨씬 느려 사실상 충분하다. ② 기존 ⌘F 5건(E7h) 포함 smoke 79건 전부 재시도 없이 1회 통과 — 히스토리 검색 테스트(`E7h ⌘F — 히스토리에서 커밋을 찾아 점프한다`, 2.1s)도 `toHaveText` web-first assertion이 200ms 디바운스를 흡수해 단언 조정 불필요.

**Task 5 실행 편차 (소급 기록 — 리뷰 검증 완료):** ① **jumpTo 가드 추가**(플랜에 없던 코드, 컨트롤러 지시): `onEnsureLoaded`가 busy면 조용히 no-op이므로 로드 후에도 범위 밖이면 `scrollToIndex`를 건너뛴다(가상 목록 바닥 튐 방지). 최신 길이는 렌더 본문에서 매번 대입하는 `historyLenRef`로 읽음 — 리뷰 판정: 값이 zustand 스냅샷 파생이라 오염 불가, React SyncLane flush가 await 재개보다 먼저 큐잉되어 실사용 안전(결정론적 대안은 보완 후속 노트 ④). ② 기존 ⌘F E2E 5건은 web-first assertion 재시도로 흡수 — 단언 조정 불요. ③ 플랜 파일이 T4·T5 기능 커밋에 딸려 들어감(bookkeeping 이탈 — 내용 손실 없음).

### Task 5-보완: 검색 상태 동기화 구멍 3건 (품질 리뷰 Important — 전부 실측 재현)

파생값(E7h `findHits = findOpen ? matchIndices(...) : []`)을 캐시 상태로 옮기면서 생긴 동기화 구멍. 리뷰가 커밋 상태에서 각각 재현했다.

- **I-1 ESC로 닫아도 in-flight 응답이 되살아난다**(재현 8/8): 이펙트 조기 반환 분기가 `findSeqRef`를 올리지 않아, 마지막 키 입력 후 200~240ms 구간에 ESC를 누르면 닫힌 뒤에도 하이라이트가 남고 목록이 스크롤된다. E7h 대비 회귀.
- **I-2 `history.length`는 스냅샷 변화를 감지하지 못한다**: 로드 창이 가득 찬 저장소(정확히 이 기능의 대상)에서는 길이가 `historyLimit`에 고정돼, 새 커밋이 생겨 인덱스가 밀려도 재검색이 안 돈다 — 하이라이트가 **엉뚱한 커밋**을 가리킨다(실측: 2칸 밀림, 카운터는 `1/1` 그대로). 저장소 전환(50→50·ref null→null)도 같은 이유로 옛 결과가 남는다.
- **I-3 재검색이 매번 재점프해 사용자 스크롤을 빼앗는다**: FindBar를 연 채 스크롤 → `onLoadMore` → 길이 변화 → 재검색 → `jumpTo`로 되감김(실측: scrollTop 1981 → 0). 스펙 ③은 스냅샷 갱신 시 "재검색"만 요구하고 재점프는 요구하지 않는다. 이걸 고치면 Minor(`findPos` stale 클로저로 옛 위치 점프)도 함께 사라진다.

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/HistoryPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx` (저장소 전환 시 검색 닫기)

- [x] **Step 1: 점프 키 ref 추가.** `findSeqRef` 선언 줄 뒤에:

```tsx
  /** 마지막으로 점프한 검색(쿼리+스코프) — 스냅샷발 재검색은 재점프하지 않는다 (E7i 보완 I-3) */
  const lastJumpKeyRef = useRef('')
```

- [x] **Step 2: 이펙트 교체.** 기존 검색 이펙트의 조기 반환 분기와 `.then` 콜백을 다음 취지로 교체(주변 코드는 유지):

```tsx
    if (!findOpen || findQuery === '') {
      // 진행 중 응답을 폐기한다 — 안 그러면 닫은 뒤에 하이라이트·스크롤이 되살아난다 (보완 I-1)
      findSeqRef.current += 1
      lastJumpKeyRef.current = ''
      // 닫힌 상태에서 매 스냅샷마다 새 배열을 넣어 헛렌더하지 않는다
      if (findHits.length > 0) {
        setFindHits([])
        setFindTruncated(false)
      }
      return
    }
```

`.then` 콜백:

```tsx
        if (findSeqRef.current !== seq) return
        setFindHits(result.indices)
        setFindTruncated(result.truncated)
        // 쿼리·스코프가 바뀐 검색에서만 점프한다 — 스냅샷발 재검색은 결과만 갱신(보완 I-3:
        // 안 그러면 사용자가 스크롤할 때마다 화면이 매치로 되감긴다)
        const jumpKey = `${findQuery}\u0000${historyRef ?? ''}`
        if (lastJumpKeyRef.current !== jumpKey && result.indices.length > 0) {
          lastJumpKeyRef.current = jumpKey
          void jumpTo(result.indices[Math.min(findPos, result.indices.length - 1)]!)
        }
```

- [x] **Step 3: deps에 스냅샷 세대 추가.** 기존 `}, [findOpen, findQuery, historyRef, history.length])` → `}, [findOpen, findQuery, historyRef, history.length, history[0]?.hash])` (보완 I-2 — 길이가 상한에 고정돼도 맨 앞 커밋이 바뀌면 재검색).

- [x] **Step 4: 저장소 전환 시 검색 닫기.** App.tsx에 `store.repoPath` 변화에 반응해 `setFindScope(null)`하는 이펙트를 추가한다(실독 — 기존 이펙트들과 나란히, 이른 반환보다 앞). 스펙 에러표 "검색 도중 저장소·워크트리 전환" 행 충족.

- [x] **Step 5: 게이트** — typecheck, 루트 `pnpm test` **486 유지**, build, `npx playwright test e2e/smoke.spec.ts` → **79 유지**(포그라운드 동기, timeout 600000).

- [x] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/components/HistoryPanel.tsx apps/desktop/src/renderer/src/App.tsx
git commit -m "fix(desktop): E7i 보완 — 닫기 시 응답 폐기·스냅샷 세대 재검색·재점프 억제(스크롤 뺏김 해소)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Task 4·5 리뷰 Minor 후속 노트(기록만):** ① `ensureHistoryLoaded`가 busy면 점프가 조용히 유실(가드는 의도대로 동작 — 재시도·피드백 없음). ② 깊은 점프 1회당 git log 최대 6 spawn(보완 I-3로 라운드 감소). ③ `count === 0`이면 truncated여도 `+` 미표기(5만 초과 저장소에서만 관측). ④ **더 나은 대안(후속)**: `ensureHistoryLoaded`가 로드 후 길이를 반환하면 `historyLenRef`가 통째로 사라지고 결정론적이 된다 — 리뷰 판정은 현행도 채택 가능(zustand SyncLane flush가 await 재개보다 먼저 큐잉).

**Task 5-보완 실행 편차 (소급 기록 — 리뷰 재검 통과):** ① `\u0000` 구분자를 편집하다 파일에 **raw NUL 바이트**가 박혀 바이너리가 되는 사고 → `perl -i -pe`로 복구. 재검 실측: raw NUL 0개·UTF-8 왕복 통과·diff는 의도한 4헝크(22+/4-)뿐·다른 라인 바이트 동일·소스에 6자 리터럴 1회·런타임 코드포인트 [97,98,99,0] 확인. ② App 이펙트 위치는 기존 관례(이른 반환 앞·마지막 기존 이펙트 뒤). **재검 재현 결과:** I-1 13구간 전부 잔존 0개(과잉 폐기 회귀 없음) · I-2 하이라이트 정합 유지 · I-3 scrollTop 1981 유지 · 헤드라인 기능(로드 밖 커밋 검색→자동 로드→scrollTop 3092·뷰포트 내 가시) 무회귀.

---

### Task 6: E2E 2건 + 최종 게이트 + README

**Files:**
- Modify: `apps/desktop/e2e/smoke.spec.ts`
- Modify: `README.md`

- [x] **Step 1: E2E 신규 2건.** smoke.spec.ts 파일 끝(E7h 마지막 테스트 뒤)에 추가. 픽스처·헬퍼는 기존 관례 실독(무인자 `createRepoWithChange()`·`GIT_GUI_E2E_REPO` env 인라인·`hoverAndCmdF` 헬퍼 재사용):

```ts
test('E7i ⌘F — 아직 안 불러온 커밋도 검색해 점프한다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  // 초기 로드(50개)보다 깊은 곳에 표적을 심는다 — 표적 → 그 위로 60개
  await writeFile(join(repo, 'deep.txt'), 'deep\n')
  await execGitOrThrow(['add', 'deep.txt'], { cwd: repo })
  await execGitOrThrow(
    ['-c', 'user.email=e2e@test', '-c', 'user.name=E2E', 'commit', '-m', 'e7i-needle 깊은 저장'],
    { cwd: repo },
  )
  for (let i = 0; i < 60; i += 1) {
    await writeFile(join(repo, 'filler.txt'), `${i}\n`)
    await execGitOrThrow(['add', 'filler.txt'], { cwd: repo })
    await execGitOrThrow(
      ['-c', 'user.email=e2e@test', '-c', 'user.name=E2E', 'commit', '-m', `filler ${i}`],
      { cwd: repo },
    )
  }
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E: '1', GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-panel')).toBeVisible()
    // 초기 로드 범위(50)에는 표적이 없다
    await expect(window.getByText('e7i-needle 깊은 저장')).toHaveCount(0)
    await hoverAndCmdF(window, '[data-testid="history-panel"]')
    await window.getByTestId('find-bar-input').fill('e7i-needle')
    // 전체 검색이 찾아 그 커밋까지 불러오고 점프한다
    await expect(window.getByTestId('find-bar-count')).toHaveText('1/1')
    await expect(window.locator('.history-item--find-hit')).toContainText('e7i-needle 깊은 저장')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E7i ⌘F — 카운터가 로드된 범위가 아니라 저장소 전체 기준이다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  // 같은 낱말을 60개 커밋에 심는다 — 초기 로드(50)보다 많아야 전체 기준임이 드러난다
  for (let i = 0; i < 60; i += 1) {
    await writeFile(join(repo, 'filler.txt'), `${i}\n`)
    await execGitOrThrow(['add', 'filler.txt'], { cwd: repo })
    await execGitOrThrow(
      ['-c', 'user.email=e2e@test', '-c', 'user.name=E2E', 'commit', '-m', `e7i-mark ${i}`],
      { cwd: repo },
    )
  }
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E: '1', GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-panel')).toBeVisible()
    await hoverAndCmdF(window, '[data-testid="history-panel"]')
    await window.getByTestId('find-bar-input').fill('e7i-mark')
    // 로드된 목록은 50개지만 총계는 60 — 전체 기준
    await expect(window.getByTestId('find-bar-count')).toHaveText('1/60')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

(`hoverAndCmdF`·`APP_ROOT`·`createRepoWithChange`·`writeFile`/`join`/`rm` import는 파일에 이미 있다 — 실독 확인. 초기 로드 상수가 50이 아니면 커밋 수를 그에 맞게 늘리고 편차 보고. 두 번째 테스트에서 `1/60`이 실측과 다르면(예: 초기 커밋 메시지가 매치되면) 실측값으로 맞추고 편차 보고.)

- [x] **Step 2: 게이트** — `cd apps/desktop && npx electron-vite build && npx playwright test e2e/smoke.spec.ts` → **81 passed**(79+2), 신규 2건 각각 단독 `-g`로 1회 non-flaky, 루트 `pnpm test` 유지, typecheck Done. E2E 포그라운드 동기(timeout 600000).

- [x] **Step 3: 전체 게이트** — 루트 `pnpm test` **486 내외(478+8 — 실측 정정)** · typecheck 전부 Done · desktop build · `pnpm --filter @git-gui/desktop e2e` → **87**(smoke 81 + hosting 6) · last-screen 아티팩트 0건.

- [x] **Step 4: README.** 기존 E7h 문단 끝(실독) 뒤에 추가:

```markdown
E7i: 히스토리 ⌘F는 화면에 불러온 커밋만이 아니라 저장소 전체를 git으로 검색합니다 — 총 매치 수가 전체 기준으로 표시되고, 아직 안 불러온 커밋이 걸리면 거기까지 자동으로 불러와 이동합니다.
```

- [x] **Step 5: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts README.md
git commit -m "test(desktop): E7i E2E 2건 — 범위 밖 커밋 검색·전체 기준 카운터 + README

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 게이트 표 (누적 — 실측 정정 대상)

| 시점 | 루트 테스트 | smoke |
| --- | --- | --- |
| 시작 | 478 | 79 |
| Task 1 후 | +8 → 486 | 79 |
| Task 2 후 | 486 | 79 |
| Task 3 후 | 486 | 79 |
| Task 4 후 | 486 | 79 |
| Task 5 후 | 486 | 79 유지 |
| Task 6 후 | 486 · e2e **87**(81+6) | +2 → 81 |

## Self-Review (플랜 자체 점검)

1. **스펙 커버리지**: ①엔진=T1(순서 스캔·`-i -F --grep`·해시 접두·스코프 복제·SEARCH_SCAN_MAX·빈 쿼리 no-op) · ②IPC·store=T2·T3(`searchHistory`는 guard 미사용·조용한 실패, `ensureHistoryLoaded`는 loadMoreHistory 규약 복제 + 상한 정합) · ③UI=T4(카운터 `+`)·T5(디바운스 200ms·seq·전체 기준 카운터·범위 밖 점프·스냅샷/조회 전환 재검색은 이펙트 deps `history.length`·`historyRef`로 충족) · 테스트=T1 단위 8건·T6 E2E 2건·무회귀. 에러표 각 행: git 실패(T3 catch→빈 결과)·truncated(T1 반환→T4 `+`)·점프 상한(T3 `SEARCH_JUMP_MAX` clamp)·조회 스코프(T3 주입)·저장소 전환(seq 폐기 + 기존 FindBar 닫힘 규약)·대소문자(T1 `-i`)·특수문자(T1 `-F`) 전부 매핑됨.
2. **플레이스홀더**: 없음. "실독·같은 취지·편차 보고"는 프로젝트 관례로 항목화됨.
3. **타입 일관성**: `HistorySearchResult{indices,hashes,truncated}`가 domain(T1)→contract(T2)→store(T3)→panel props(T5)에서 동명. `searchHistory`/`ensureHistoryLoaded`(T3)↔`onSearch`/`onEnsureLoaded`(T5)↔App 배선(T5) 일치. `countTruncated`(T4)↔`findTruncated`(T5) 전달 일치. `SEARCH_SCAN_MAX`(엔진)·`SEARCH_JUMP_MAX`(store)는 이름이 다른 별개 상수로 의도됨.
4. **알려진 위험 1건**: T3 Step 4의 limit 상한 10000→50000 변경은 IPC 계약·어댑터 clamp·기존 단언 테스트에 걸칠 수 있다 — 구현자는 `assertLimit` 관련 테스트를 실독해 같은 취지로 갱신하고 편차 보고할 것.

---

## 통합 검토 (컨트롤러 직접 수행 — opus 리뷰어 3회 연속 API 529로 불가)

**게이트 실측**: 루트 `pnpm test` **486 passed**(41 files) · `pnpm typecheck` 전 패키지 Done · `electron-vite build` 성공 · desktop e2e **87 passed**(smoke 81 + hosting 6, 2.6m — E7i 신규 2건 #86·#87 포함) · last-screen 아티팩트 **0건** · 워킹트리는 플랜 파일만 수정.

**이음매 점검**
1. **end-to-end 스코프 정합**: `searchHistory`·`ensureHistoryLoaded` 둘 다 `get().historyRef ?? undefined`로 같은 스코프를 주입하고, 엔진은 `history.list`와 동일한 인자 조합(T1 리뷰가 441커밋 전수 대조로 `ORDER IDENTICAL` 확정)을 쓴다. `historyRef`가 HistoryPanel 이펙트 deps에 있어 조회 전환·해제 시 재검색이 돈다. **ref 소멸 폴백**(`ensureHistoryLoaded` catch → `historyRef: null`)이 발생하면 prop 변화 → 재검색이 새 스코프로 즉시 이어지므로, 결과가 스코프와 어긋나는 창은 한 디바운스(200ms) 이내로 닫힌다 — E7g가 봉인한 "알약≠목록" 계열 모순은 재개통되지 않음.
2. **상한 4계층**: 엔진 index < `SEARCH_SCAN_MAX`(50000) → store `next = min(max(index+1, limit+200), SEARCH_JUMP_MAX=50000)` → `assertLimit` ≤ 50000 → 어댑터 clamp 50000. 경계에서 거부·off-by-one 없음(T3 리뷰 확인). `HISTORY_MAX`(10000)는 스크롤 페이지네이션 전용으로 유지 — 다만 1만 초과 깊이로 점프하면 `loadMoreHistory`가 이후 no-op이 된다(기록된 알려진 성질).
3. **E7h ⌘F 생태계 공존**: `data-find-scope` 4종 전부 잔존(changes·diff·history(pullDetail null 조건부)·commit-files), diff 해제 3곳 유지, `findNonce`/`focusSignal` 규약 무변. App의 새 repoPath 이펙트는 기존 이펙트들 뒤·이른 반환 앞에 배치돼 훅 순서 불변.
4. **성능**: 보완 I-3로 스냅샷발 재검색의 재점프가 사라져 스크롤 싸움·라운드 증폭 해소. `historyLimit` 끈적임(T3 노트 ②)은 그대로 — 1만 커밋 초과 저장소에서 깊은 점프 후에만 발생하는 성질로 후속 유지.
5. **스펙 커버리지**: ①엔진=`8ad2480` · ②IPC·store=`60a4a57`+`363b034` · ③UI=`98a5555`+`cbc5e8d`+`fdde613` · 테스트=T1 단위 8건 + E2E 2건(`825f609`) · 에러표 각 행(git 실패 조용한 빈 결과·truncated `+`·점프 상한·조회 스코프·저장소 전환 닫기·대소문자·특수문자) 전부 코드에 존재.
6. **README**: 추가 문장이 구현과 일치(전체 기준 카운터·자동 로드 점프).

**Verdict: Ready to merge** — Important 잔여 없음. 태스크별 리뷰(T1·T2·T3·T4·T5+보완 재검)는 전부 opus 리뷰어가 수행·Approve했고, 마지막 통합 단계만 컨트롤러가 직접 검증했다.

---

## 실행 기록 (부록)

- 실행 방식: 서브에이전트(구현 sonnet, 리뷰 opus) + 태스크별 스펙·품질 통합 리뷰, Important는 보완 커밋으로 즉시 폐쇄(플랜 선(先)미러링), 편차 전건 소급 미러링.
- 태스크 → 커밋: T1 `8ad2480`(엔진 history.search — 순서 스캔+`-i -F --grep`+해시 접두, 단위 8건) · T2 `60a4a57`(IPC 3면) · T3 `363b034`(store searchHistory·ensureHistoryLoaded + limit 상한 50000 정합) · T4 `98a5555`(FindBar countTruncated + 거짓 주석 정정) · T5 `cbc5e8d`(HistoryPanel 엔진 위임·디바운스·seq·jumpTo 가드) + 보완 `fdde613`(동기화 구멍 3건) · T6 `825f609`(E2E 2건 + README).
- 리뷰가 잡은 Important 3건(전부 T5, 리뷰어가 **실측 재현**): ESC 닫기 후 in-flight 응답 부활(200~240ms 창, 재현 8/8) · `history.length` 고정으로 스냅샷 변화 미감지 → 하이라이트가 엉뚱한 커밋(2칸 밀림) · 재검색 재점프가 사용자 스크롤 되감김(scrollTop 1981→0). 보완 후 재검에서 3건 모두 닫힘 확인 + 헤드라인 기능 무회귀(로드 밖 커밋 검색→자동 로드→뷰포트 내 가시).
- 실측으로 확정한 것들: `--grep=-foo`는 `=`결합 단일 argv라 옵션 오인 없음(구현자 concern 종결) · list/search 인자 차이는 순서 무영향(441커밋 `ORDER IDENTICAL`) · limit 50000의 비용(60,000커밋 저장소에서 0.22s·9.35MB·parseLog 21ms) · guard 없는 검색의 동시성 안전(checkout 80 × log 200 동시, 실패 0).
- 사고 1건: 보완 편집 중 `\u0000` 이스케이프가 raw NUL 바이트로 파일에 박혀 바이너리화 → `perl`로 복구, 재검에서 잔여 손상 0 확인.
- 최종 게이트: 루트 486 · typecheck 전부 Done · desktop e2e **87**(smoke 81 + hosting 6) · last-screen 0건.
