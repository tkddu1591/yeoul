# E7c — 워크트리 1급 관리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) 구문으로 추적한다.

**Goal:** 좌측 3번째 [워크트리] 탭(목록·생성·제거·활성 지정), 헤더 ⚙ 설정 모달("워크트리 선택 시 동작"), 터미널 cwd 워크트리 연동, 링크드 워크트리 감시 호환 — 스펙 `docs/superpowers/specs/2026-07-23-e7c-worktrees-design.md` 확정안. 3에픽(E7a 브랜치→E7b 터미널→E7c 워크트리)의 마지막 조각.

**Architecture:** 엔진은 `worktrees` 네임스페이스(porcelain -z 파서 + add/remove — needsForce는 branches.remove 관례), 보안 가드는 main의 워크트리 목록 대조(`assertWorktreePath` — 임의 경로 열기·쉘 스폰·reveal 차단), 감시는 **git-common-dir 재귀 감시로 교체**(실측 H1: 링크드 워크트리의 .git은 파일이라 현행 감시가 죽는다 — 실버그 수정), 설정은 이 앱 최초의 모달 설정 UI(즉시 저장). 활성 워크트리(터미널 대상)는 App 로컬 상태.

**Tech Stack:** 기존 그대로 (신규 의존성 없음 — shell.showItemInFolder는 Electron 내장).

**기준 커밋:** main = `6469669`. 기준선 실측: 단위 **410 tests**(32 files), E2E **57**(smoke 51 + hosting 6). 작업 브랜치: **`feature/e7c-worktrees`** (Task 1 Step 0에서 생성).

## 사전 실측 기록 (2026-07-23, macOS Darwin 25.5.0 · git 2.50.1 · Electron 35.7.5 — 스크래치 저장소 실기동)

### 실측 A·B. `git worktree list --porcelain -z` 출력

- 레코드 = NUL 종결 필드들 + **빈 필드(연속 NUL)로 레코드 구분**. 첫 레코드가 본체.
- 필드 변형: `worktree <절대경로>` · `HEAD <hash>` · `branch refs/heads/<이름>` **또는** `detached` · `prunable <사유>`(예: `prunable gitdir file points to non-existent location`) · `locked[ <사유>]` · `bare`.

### 실측 C·D·E·F. add/remove stderr·prunable

- 이미 체크아웃된 브랜치 add: `fatal: '<branch>' is already used by worktree at '<path>'` exit 128.
- 비어있지 않은 기존 경로 add: `fatal: '<path>' already exists` exit 128.
- 미저장 변경 remove: `fatal: '<path>' contains modified or untracked files, use --force to delete it` → `--force`로 성공.
- **prunable 항목도 `worktree remove`가 exit 0으로 그대로 정리**한다(실측 F) — 별도 prune 경로 불필요(스펙의 prune 언급 대비 단순화).

### 실측 G·H. 링크드 워크트리의 .git 구조와 감시 (E7b 감시의 실버그)

- 링크드 워크트리의 `.git`은 **파일**(`gitdir: <본체>/.git/worktrees/<이름>`). `--absolute-git-dir` = 그 디렉터리, `--git-common-dir` = 본체 `.git`.
- **H1(실패 재현):** 현행 감시(`join(repoPath, '.git')`)를 링크드 워크트리에 쓰면 파일을 감시하게 되어 커밋·체크아웃 이벤트 **0** — 감시가 조용히 죽는다.
- **H2(해법 확정):** **git-common-dir을 재귀 감시**하면 본체·모든 워크트리의 변경이 다 잡힌다. 워크트리별 파일은 `worktrees/<이름>/HEAD`·`worktrees/<이름>/index(.lock)`·`worktrees/<이름>/logs/…` 경로로 온다(커밋 18·checkout 11 이벤트 — E7b 실측 1과 동일 패턴). → 필터는 `worktrees/<이름>/` 접두를 벗긴 뒤 기존 규칙을 적용한다.
- `rev-parse --path-format=absolute --git-common-dir`로 절대 경로 해석(본체에서 실행해도 `.git` 상대값이 나오는 문제 방지).

## 파일 구조 (책임 지도)

| 파일 | 책임 |
| --- | --- |
| `packages/domain/src/repository.ts` (수정) | `WorktreeInfo` 타입 |
| `packages/git-adapter/src/worktree-parser.ts` (신규) + `test/worktree-parser.test.ts` | porcelain -z 순수 파서 |
| `packages/git-adapter/src/client.ts` (수정) + `test/client.test.ts` | `worktrees.list/add/remove` |
| `packages/ipc-contract/src/index.ts` (수정) | worktrees 채널·repo.openPath·AppSettings.worktreeSelectAction·TerminalApi cwd |
| `apps/desktop/src/main/git-handlers.ts` (수정) | worktrees 핸들러·`assertWorktreePath` 보안 가드·repoOpenPath·reveal·repoWatch common-dir 해석 |
| `apps/desktop/src/main/repo-watcher.ts`·`watch-filter.ts` (수정) + `test/watch-filter.test.ts` | 감시 대상 gitDir 인자화·worktrees/ 접두 정규화 |
| `apps/desktop/src/main/terminal-handlers.ts` (수정) | create cwd 검증 |
| `apps/desktop/src/preload/index.ts` (수정) | 신규 브리징 |
| `apps/desktop/src/renderer/src/store/repository-store.ts` (수정) | worktrees 스냅샷·액션 5종 |
| `apps/desktop/src/renderer/src/ui/settings/worktree-select-action.ts` (신규) | 설정 load/save 순수 |
| `apps/desktop/src/renderer/src/ui/settings/SettingsDialog.tsx` + `settings-dialog.css` (신규) | 설정 모달(카테고리+즉시 저장) |
| `apps/desktop/src/renderer/src/components/worktree-path.ts` (신규) + `test/worktree-path.test.ts` | 경로 제안 순수 함수 |
| `apps/desktop/src/renderer/src/components/WorktreesPanel.tsx` + `worktrees-panel.css` (신규) | 워크트리 탭 본체 |
| `apps/desktop/src/renderer/src/components/AddWorktreeDialog.tsx` (신규) | 생성 다이얼로그(브랜치 선택+경로) |
| `apps/desktop/src/renderer/src/ui/terminal/use-terminal-sessions.ts`·`TerminalDock.tsx` (수정) | create cwd/label 인자·탭 라벨 병기 |
| `apps/desktop/src/renderer/src/App.tsx` (수정) | 3번째 탭·⚙·활성 워크트리 상태·클릭 라우팅·다이얼로그 |
| `apps/desktop/e2e/smoke.spec.ts` (수정) | E2E +5 |

## 검증 게이트 요약

| 시점 | 기대치 |
| --- | --- |
| 기준선 (6469669, 실측) | **410 tests**(32 files) + E2E 57 (smoke 51 + hosting 6) |
| Task 1 후 | +10 → **420** (parser 6 + client 4) |
| Task 2 후 | 420 유지 + typecheck Done (IPC·store 배선) |
| Task 3 후 | +3 → **423** (filter worktrees/ 정규화) + smoke 51 유지(전 스위트 무회귀) |
| Task 4 후 | +1 → **424** (settings sanitize) + build Done |
| Task 5 후 | 424 유지 + typecheck Done (터미널 cwd) |
| Task 6 후 | +3 → **427** (worktree-path) + build Done |
| Task 7 후 | smoke **56** (워크트리 E2E 5건) |
| 최종 (Task 8) | **427 tests** + typecheck + build + E2E **62**(smoke 56 + hosting 6) + last-screen 0건 + 스크린샷 2장 + README |

---

### Task 1: 엔진 — WorktreeInfo·porcelain 파서·worktrees 네임스페이스

**Files:**
- Modify: `packages/domain/src/repository.ts`
- Create: `packages/git-adapter/src/worktree-parser.ts`
- Test: `packages/git-adapter/test/worktree-parser.test.ts` (신규, +6)
- Modify: `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts` (+4)

- [x] **Step 0: 브랜치 생성** — main(6469669)에서 `git checkout -b feature/e7c-worktrees`. `git branch --show-current` 확인.

- [x] **Step 1: 도메인 타입.** `packages/domain/src/repository.ts` 기존:

```ts
/** 재배치 진행 위치 — .git/rebase-merge/msgnum·end (실측 2) */
export interface RebaseProgress {
  current: number
  total: number
}
```

교체:

```ts
/** 재배치 진행 위치 — .git/rebase-merge/msgnum·end (실측 2) */
export interface RebaseProgress {
  current: number
  total: number
}

/** 워크트리 하나 — `git worktree list --porcelain` 항목 (E7c) */
export interface WorktreeInfo {
  /** 절대 경로 */
  path: string
  /** 첫 항목 = 본체(저장소 자체) */
  isMain: boolean
  /** 체크아웃 브랜치(refs/heads/ 제거). detached면 null */
  branch: string | null
  headHash: string | null
  /** 폴더가 사라진 등록 — remove로 그대로 정리된다 (실측 F) */
  prunable: boolean
  locked: boolean
}
```

- [x] **Step 2: 파서 Red.** `packages/git-adapter/test/worktree-parser.test.ts` 신규:

```ts
import { describe, expect, it } from 'vitest'
import { parseWorktrees } from '../src/worktree-parser'

const NUL = '\0'
const HASH = 'a'.repeat(40)

/** 실측 A·B 형식 — 필드는 NUL 종결, 레코드 구분은 빈 필드(연속 NUL) */
function record(...fields: string[]): string {
  return fields.map((field) => field + NUL).join('') + NUL
}

describe('parseWorktrees', () => {
  it('본체(첫 항목)와 링크드를 담고 branch 접두를 벗긴다', () => {
    const raw =
      record('worktree /repo', `HEAD ${HASH}`, 'branch refs/heads/main') +
      record('worktree /repo-feat', `HEAD ${HASH}`, 'branch refs/heads/feature/login')
    expect(parseWorktrees(raw)).toEqual([
      { path: '/repo', isMain: true, branch: 'main', headHash: HASH, prunable: false, locked: false },
      {
        path: '/repo-feat',
        isMain: false,
        branch: 'feature/login',
        headHash: HASH,
        prunable: false,
        locked: false,
      },
    ])
  })

  it('detached는 branch가 null이다', () => {
    const raw = record('worktree /repo-d', `HEAD ${HASH}`, 'detached')
    expect(parseWorktrees(raw)[0]).toMatchObject({ branch: null, headHash: HASH })
  })

  it('prunable(사유 병기 형식 — 실측 B)을 표시한다', () => {
    const raw = record(
      'worktree /repo-gone',
      `HEAD ${HASH}`,
      'branch refs/heads/gone-branch',
      'prunable gitdir file points to non-existent location',
    )
    expect(parseWorktrees(raw)[0]).toMatchObject({ prunable: true, branch: 'gone-branch' })
  })

  it('locked(사유 유무 모두)을 표시한다', () => {
    const raw =
      record('worktree /a', `HEAD ${HASH}`, 'branch refs/heads/x', 'locked') +
      record('worktree /b', `HEAD ${HASH}`, 'branch refs/heads/y', 'locked 이유가 있음')
    const parsed = parseWorktrees(raw)
    expect(parsed[0]?.locked).toBe(true)
    expect(parsed[1]?.locked).toBe(true)
  })

  it('빈 입력이면 빈 배열이다', () => {
    expect(parseWorktrees('')).toEqual([])
  })

  it('worktree 필드가 없는 기형 레코드는 추측하지 않고 건너뛴다', () => {
    const raw = record(`HEAD ${HASH}`, 'branch refs/heads/x') + record('worktree /ok', `HEAD ${HASH}`, 'detached')
    expect(parseWorktrees(raw).map((worktree) => worktree.path)).toEqual(['/ok'])
  })
})
```

- [x] **Step 3: Red 확인** — `pnpm vitest run --project @git-gui/git-adapter -t 'parseWorktrees'` → 모듈 부재로 실패 확인.

- [x] **Step 4: 파서 구현.** `packages/git-adapter/src/worktree-parser.ts` 신규:

```ts
import type { WorktreeInfo } from '@git-gui/domain'

/**
 * `git worktree list --porcelain -z` 출력을 파싱한다 (E7c 실측 A·B).
 * 필드는 NUL 종결, 레코드 구분은 빈 필드(연속 NUL). 첫 레코드가 본체.
 * 필드 변형: worktree·HEAD·branch|detached·prunable[ 사유]·locked[ 사유]·bare.
 * 기형 레코드(worktree 필드 부재)는 추측하지 않고 건너뛴다 (log-parser 관례)
 */
export function parseWorktrees(rawOutput: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = []
  let current: { path?: string; branch: string | null; headHash: string | null; prunable: boolean; locked: boolean } | null =
    null
  const flush = () => {
    if (current !== null && current.path !== undefined) {
      worktrees.push({
        path: current.path,
        isMain: worktrees.length === 0,
        branch: current.branch,
        headHash: current.headHash,
        prunable: current.prunable,
        locked: current.locked,
      })
    }
    current = null
  }
  for (const field of rawOutput.split('\0')) {
    if (field === '') {
      flush()
      continue
    }
    current ??= { branch: null, headHash: null, prunable: false, locked: false }
    if (field.startsWith('worktree ')) current.path = field.slice('worktree '.length)
    else if (field.startsWith('HEAD ')) current.headHash = field.slice('HEAD '.length)
    else if (field.startsWith('branch ')) {
      current.branch = field.slice('branch '.length).replace(/^refs\/heads\//, '')
    }
    // detached·bare는 branch가 null인 초기값 그대로 — prunable·locked만 표시로 바꾼다
    else if (field === 'prunable' || field.startsWith('prunable ')) current.prunable = true
    else if (field === 'locked' || field.startsWith('locked ')) current.locked = true
  }
  flush()
  return worktrees
}
```

- [x] **Step 5: 파서 Green** — 같은 명령 → **6 passed**.

- [x] **Step 6: client Red.** `packages/git-adapter/test/client.test.ts`의 기존(rebase.abort 테스트 꼬리 — E7b까지의 마지막 rebase 테스트):

```ts
    const before = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await client.rebase.start('main')
    await client.rebase.abort()
    expect((await client.repo.status()).state).toBe('normal')
    expect((await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()).toBe(before)
    expect(await client.rebase.progress()).toBeNull()
  })
```

바로 뒤에 추가:

```ts

  it('worktrees.list — 본체·링크드·detached·prunable을 담는다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('feat', null)
    await execGitOrThrow(['worktree', 'add', `${repo}-feat`, 'feat'], { cwd: repo })
    await execGitOrThrow(['worktree', 'add', '--detach', `${repo}-detached`], { cwd: repo })
    await client.branches.create('gone-branch', null)
    await execGitOrThrow(['worktree', 'add', `${repo}-gone`, 'gone-branch'], { cwd: repo })
    await rmDir(`${repo}-gone`)
    const list = await client.worktrees.list()
    // macOS: os.tmpdir()는 /var/... 미해석 경로지만 git은 워크트리를 실경로(/private/var/...)로
    // 정규화해 담는다(실측) — rev-parse로 실경로를 구해 비교한다 (구현 편차: 테스트 한정)
    const resolvedRepo = (
      await execGitOrThrow(['rev-parse', '--show-toplevel'], { cwd: repo })
    ).stdout.trim()
    expect(list[0]).toMatchObject({ path: resolvedRepo, isMain: true, branch: 'main' })
    expect(list.find((worktree) => worktree.path === `${resolvedRepo}-feat`)).toMatchObject({
      isMain: false,
      branch: 'feat',
      prunable: false,
    })
    expect(list.find((worktree) => worktree.path === `${resolvedRepo}-detached`)).toMatchObject({
      branch: null,
    })
    expect(list.find((worktree) => worktree.path === `${resolvedRepo}-gone`)).toMatchObject({
      prunable: true,
    })
  })

  it('worktrees.add — 만들고, 사용 중 브랜치·기존 경로는 읽히는 메시지로 거부한다 (실측 C·D)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('feat', null)
    await client.worktrees.add(`${repo}-feat`, 'feat')
    const current = (
      await execGitOrThrow(['branch', '--show-current'], { cwd: `${repo}-feat` })
    ).stdout.trim()
    expect(current).toBe('feat')
    await expect(client.worktrees.add(`${repo}-dup`, 'feat')).rejects.toThrow(
      /이미 다른 워크트리가 쓰고 있어요/,
    )
    await expect(client.worktrees.add(`${repo}-feat`, 'main')).rejects.toThrow(/이미 폴더가 있어요/)
  })

  it('worktrees.remove — 미저장 변경은 needsForce, force로 지운다 (실측 E)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('feat', null)
    await client.worktrees.add(`${repo}-feat`, 'feat')
    await writeFixtureFile(`${repo}-feat`, 'dirty.txt', 'd\n')
    expect(await client.worktrees.remove(`${repo}-feat`, false)).toEqual({
      removed: false,
      needsForce: true,
    })
    expect(await client.worktrees.remove(`${repo}-feat`, true)).toEqual({
      removed: true,
      needsForce: false,
    })
    expect((await client.worktrees.list()).length).toBe(1)
  })

  it('worktrees.remove — 사라진 폴더(prunable)도 그대로 정리한다 (실측 F)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('feat', null)
    await client.worktrees.add(`${repo}-feat`, 'feat')
    await rmDir(`${repo}-feat`)
    expect(await client.worktrees.remove(`${repo}-feat`, false)).toEqual({
      removed: true,
      needsForce: false,
    })
    expect((await client.worktrees.list()).length).toBe(1)
  })
```

주의: `rmDir` 헬퍼가 없으면 파일 상단 import에 이미 있는 `node:fs/promises`의 `rm`을 쓰는 지역 헬퍼를 테스트 삽입 블록 바로 앞에 추가한다(기존 import 목록 실독 후 — `rm`이 import에 없으면 `import { ... , rm } from 'node:fs/promises'`로 확장하고 편차 보고):

```ts
/** 워크트리 폴더를 통째로 지운다 — prunable 재현용 (E7c) */
async function rmDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}
```

- [x] **Step 7: Red 확인** — `pnpm vitest run --project @git-gui/git-adapter -t 'worktrees'` → **네임스페이스 부재(컴파일/런타임 에러)**로 실패 확인.

- [x] **Step 8: client 구현.** `packages/git-adapter/src/client.ts` — 편집 4곳.

(a) import 기존:

```ts
import { parseOverview } from './overview-parser'
import { parseBranches, parseShelf } from './refs-parser'
```

교체:

```ts
import { parseOverview } from './overview-parser'
import { parseBranches, parseShelf } from './refs-parser'
import { parseWorktrees } from './worktree-parser'
```

(b) domain 타입 import 기존:

```ts
  type SwitchResult,
  type SyncBranchStatus,
```

교체:

```ts
  type SwitchResult,
  type SyncBranchStatus,
  type WorktreeInfo,
```

(c) 인터페이스 기존(rebase 블록 끝 — merge 시작):

```ts
    /** 진행 위치(.git/rebase-merge/msgnum·end — 실측 2). rebasing이 아니면 null */
    progress(): Promise<RebaseProgress | null>
  }
  merge: {
```

교체:

```ts
    /** 진행 위치(.git/rebase-merge/msgnum·end — 실측 2). rebasing이 아니면 null */
    progress(): Promise<RebaseProgress | null>
  }
  worktrees: {
    /** 워크트리 목록 — 첫 항목이 본체. prunable(사라진 폴더)·locked·detached 포함 (E7c) */
    list(): Promise<WorktreeInfo[]>
    /** 새 워크트리 — path에 branch를 체크아웃해 만든다. 사용 중 브랜치·기존 경로는 친절 거부 */
    add(path: string, branch: string): Promise<void>
    /** 지우기 — 미저장 변경이 있으면 needsForce로 알린다(확인창은 UI). prunable도 그대로 정리된다(실측 F) */
    remove(path: string, force: boolean): Promise<RemoveBranchResult>
  }
  merge: {
```

(d) 런타임 기존(rebase.progress 구현 끝):

```ts
          const parsed = { current: Number(current.trim()), total: Number(total.trim()) }
          if (!Number.isFinite(parsed.current) || !Number.isFinite(parsed.total)) return null
          return parsed
        } catch {
          return null
        }
      },
    },
```

교체:

```ts
          const parsed = { current: Number(current.trim()), total: Number(total.trim()) }
          if (!Number.isFinite(parsed.current) || !Number.isFinite(parsed.total)) return null
          return parsed
        } catch {
          return null
        }
      },
    },
    worktrees: {
      async list() {
        const cwd = await topLevel()
        const raw = await execGitOrThrow(['worktree', 'list', '--porcelain', '-z'], { cwd })
        return parseWorktrees(raw.stdout)
      },
      async add(path, branch) {
        const cwd = await topLevel()
        const args = ['worktree', 'add', '--end-of-options', path, branch]
        const result = await execGit(args, { cwd })
        if (result.exitCode !== 0) {
          // 실측 C: 같은 브랜치는 두 워크트리가 체크아웃할 수 없다 (UI 비활성의 심층 방어)
          if (result.stderr.includes('already used by worktree')) {
            throw new Error(`"${branch}"는 이미 다른 워크트리가 쓰고 있어요. 다른 실험 공간을 골라 주세요.`)
          }
          // 실측 D: 비어있지 않은 기존 경로
          if (result.stderr.includes('already exists')) {
            throw new Error('그 위치에 이미 폴더가 있어요. 다른 경로를 입력해 주세요.')
          }
          throw new GitError(args, result)
        }
      },
      async remove(path, force) {
        const cwd = await topLevel()
        const args = force
          ? ['worktree', 'remove', '--force', '--end-of-options', path]
          : ['worktree', 'remove', '--end-of-options', path]
        const result = await execGit(args, { cwd })
        if (result.exitCode === 0) return { removed: true, needsForce: false }
        // 실측 E: 미저장 변경 거부 — 강제 확인은 UI 책임 (branches.remove 관례)
        if (result.stderr.includes('contains modified or untracked files')) {
          return { removed: false, needsForce: true }
        }
        throw new GitError(args, result)
      },
    },
```

- [x] **Step 9: Green + 게이트** — `pnpm vitest run --project @git-gui/git-adapter` 전체 통과. 루트 `pnpm test` → **420 passed**. `pnpm typecheck` Done.

- [x] **Step 10: Commit**

```bash
git add packages/domain/src/repository.ts packages/git-adapter/src/worktree-parser.ts packages/git-adapter/test/worktree-parser.test.ts packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(git-adapter): E7c worktrees — porcelain -z 파서·add/remove(needsForce·prunable 정리 실측)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: IPC·store 배선 — worktrees 채널·보안 가드·openWorktree

**Files:**
- Modify: `packages/ipc-contract/src/index.ts`
- Modify: `apps/desktop/src/main/git-handlers.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`

store 단위 테스트 없음(관례 — E2E 검증). 게이트: typecheck + 420 유지.

- [x] **Step 1: 계약 — repo.openPath.** `packages/ipc-contract/src/index.ts` 기존:

```ts
    /** repo:changed 구독 — 해제 함수를 반환한다. 이 앱 최초의 push 채널 (E7b) */
    onChanged(listener: (repoPath: string) => void): () => void
  }
```

교체:

```ts
    /** repo:changed 구독 — 해제 함수를 반환한다. 이 앱 최초의 push 채널 (E7b) */
    onChanged(listener: (repoPath: string) => void): () => void
    /**
     * 워크트리를 앱에서 연다(전체 전환) — worktreePath가 이 저장소의 워크트리인지 main이
     * 검증한 뒤 allowlist에 등록하고 정규화 경로를 돌려준다 (E7c 보안 가드: select 없는 경로 열기)
     */
    openPath(repoPath: string, worktreePath: string): Promise<string>
  }
  worktrees: {
    /** 워크트리 목록 — 첫 항목이 본체 (E7c) */
    list(repoPath: string): Promise<WorktreeInfo[]>
    /** 새 워크트리 — path에 branch 체크아웃 */
    add(repoPath: string, path: string, branch: string): Promise<void>
    /** 지우기 — 미저장 변경이면 needsForce (branches.remove 관례) */
    remove(repoPath: string, path: string, force: boolean): Promise<RemoveBranchResult>
    /** Finder에서 보기 — 경로는 워크트리 목록 검증 경유 (E7c) */
    reveal(repoPath: string, path: string): Promise<void>
  }
```

- [x] **Step 2: 채널.** 같은 파일 기존:

```ts
  repoWatch: 'repo:watch',
  /** push(main→renderer) — invoke가 아니라 webContents.send 채널 (E7b) */
  repoChanged: 'repo:changed',
```

교체:

```ts
  repoWatch: 'repo:watch',
  /** push(main→renderer) — invoke가 아니라 webContents.send 채널 (E7b) */
  repoChanged: 'repo:changed',
  repoOpenPath: 'repo:open-path',
  worktreesList: 'worktrees:list',
  worktreesAdd: 'worktrees:add',
  worktreesRemove: 'worktrees:remove',
  worktreesReveal: 'worktrees:reveal',
```

그리고 상단 `import type { … } from '@git-gui/domain'` 목록에 `WorktreeInfo`를 알파벳 순서 자리에 추가한다(typecheck 게이트).

- [x] **Step 3: 핸들러 — 보안 가드 + 5채널.** `apps/desktop/src/main/git-handlers.ts` 편집 3곳.

(a) electron import 실독 — `import { dialog, ipcMain } from 'electron'` 형태의 줄에 `shell`을 추가(`import { dialog, ipcMain, shell } from 'electron'` — 실제 줄을 grep으로 확인해 같은 취지로 편집, 편차 보고).

(b) 기존:

```ts
export function assertString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('잘못된 요청 형식이에요.')
  return value
}
```

교체:

```ts
export function assertString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('잘못된 요청 형식이에요.')
  return value
}

/**
 * 경로가 이 저장소의 워크트리인지 검증한다 (E7c 보안 가드) — renderer가 임의 경로를
 * 열거나(openPath) 쉘을 스폰하거나(terminal cwd) 노출(reveal)시키지 못하게 목록과 대조한다
 */
export async function assertWorktreePath(repoPath: string, candidate: unknown): Promise<string> {
  const path = assertString(candidate)
  const list = await createGitClient(repoPath).worktrees.list()
  if (!list.some((worktree) => worktree.path === path)) {
    throw new Error('이 저장소의 워크트리가 아니에요. 새로고침해 주세요.')
  }
  return path
}
```

(c) repoWatch 핸들러 블록 뒤(기존 블록 전문은 Task 3에서 교체하므로, 이 단계에서는 그 **뒤**에 추가) — 기존:

```ts
    if (!watchCleanupHooked.has(sender)) {
      watchCleanupHooked.add(sender)
      sender.once('destroyed', () => {
        stopWatching?.()
        stopWatching = null
      })
    }
  })
```

교체:

```ts
    if (!watchCleanupHooked.has(sender)) {
      watchCleanupHooked.add(sender)
      sender.once('destroyed', () => {
        stopWatching?.()
        stopWatching = null
      })
    }
  })

  ipcMain.handle(CHANNELS.repoOpenPath, async (_event, repoPath: unknown, worktreePath: unknown) => {
    const root = assertAllowedRepo(repoPath)
    const target = await assertWorktreePath(root, worktreePath)
    return registerRepoPath(target)
  })

  ipcMain.handle(CHANNELS.worktreesList, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).worktrees.list(),
  )

  ipcMain.handle(
    CHANNELS.worktreesAdd,
    (_event, repoPath: unknown, path: unknown, branch: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).worktrees.add(
        assertString(path),
        assertString(branch),
      ),
  )

  ipcMain.handle(
    CHANNELS.worktreesRemove,
    (_event, repoPath: unknown, path: unknown, force: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).worktrees.remove(
        assertString(path),
        assertBoolean(force),
      ),
  )

  ipcMain.handle(CHANNELS.worktreesReveal, async (_event, repoPath: unknown, path: unknown) => {
    const root = assertAllowedRepo(repoPath)
    const target = await assertWorktreePath(root, path)
    shell.showItemInFolder(target)
  })
```

(`assertBoolean`은 branches.remove 핸들러가 이미 쓰는 기존 헬퍼다 — grep으로 존재 확인만.)

- [x] **Step 4: preload.** `apps/desktop/src/preload/index.ts` 기존:

```ts
    // 이 앱 최초의 push 구독 브리지 — 콜백을 감싸 등록하고 해제 함수를 돌려준다 (E7b)
    onChanged: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, repoPath: string) => listener(repoPath)
      ipcRenderer.on(CHANNELS.repoChanged, wrapped)
      return () => ipcRenderer.removeListener(CHANNELS.repoChanged, wrapped)
    },
  },
```

교체:

```ts
    // 이 앱 최초의 push 구독 브리지 — 콜백을 감싸 등록하고 해제 함수를 돌려준다 (E7b)
    onChanged: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, repoPath: string) => listener(repoPath)
      ipcRenderer.on(CHANNELS.repoChanged, wrapped)
      return () => ipcRenderer.removeListener(CHANNELS.repoChanged, wrapped)
    },
    openPath: (repoPath, worktreePath) =>
      ipcRenderer.invoke(CHANNELS.repoOpenPath, repoPath, worktreePath),
  },
  worktrees: {
    list: (repoPath) => ipcRenderer.invoke(CHANNELS.worktreesList, repoPath),
    add: (repoPath, path, branch) =>
      ipcRenderer.invoke(CHANNELS.worktreesAdd, repoPath, path, branch),
    remove: (repoPath, path, force) =>
      ipcRenderer.invoke(CHANNELS.worktreesRemove, repoPath, path, force),
    reveal: (repoPath, path) => ipcRenderer.invoke(CHANNELS.worktreesReveal, repoPath, path),
  },
```

- [x] **Step 5: store.** `apps/desktop/src/renderer/src/store/repository-store.ts` 편집 5곳.

(a) 상태 필드 기존:

```ts
  /** 재배치 진행 위치 — rebasing 상태에서만 non-null (상태 바 "M/N번째") */
  rebaseProgress: RebaseProgress | null
```

교체:

```ts
  /** 재배치 진행 위치 — rebasing 상태에서만 non-null (상태 바 "M/N번째") */
  rebaseProgress: RebaseProgress | null
  /** 워크트리 목록 — 스냅샷마다 함께 갱신된다. 첫 항목이 본체 (E7c) */
  worktrees: WorktreeInfo[]
```

(b) 액션 선언 기존:

```ts
  /** 재배치 취소 — 확인창(UI 책임) 경유 (E7a) */
  abortRebase(): Promise<void>
```

교체:

```ts
  /** 재배치 취소 — 확인창(UI 책임) 경유 (E7a) */
  abortRebase(): Promise<void>
  /** 새 워크트리 — 성공 여부 반환(실패 시 다이얼로그 유지·입력 보존) (E7c) */
  addWorktree(path: string, branch: string): Promise<boolean>
  /** 워크트리 지우기 — 반환 true면 미저장 변경이 있어 강제 확인 필요 (removeBranch 관례) (E7c) */
  removeWorktree(path: string, force: boolean): Promise<boolean>
  /** 워크트리를 앱에서 연다(전체 전환) — 경로 검증·allowlist 등록은 main (E7c) */
  openWorktree(path: string): Promise<void>
  /** Finder에서 보기 (E7c) */
  revealWorktree(path: string): Promise<void>
```

(c) fetchSnapshot 기존:

```ts
async function fetchSnapshot(
  repoPath: string,
  limit: number,
): Promise<
  Pick<RepositoryStore, 'status' | 'history' | 'branches' | 'shelf' | 'branchOverview' | 'rebaseProgress'>
> {
  const [status, history, branches, shelf, branchOverview] = await Promise.all([
    git().repo.status(repoPath),
    git().history.list(repoPath, limit),
    git().branches.list(repoPath),
    git().shelf.list(repoPath),
    git().branches.overview(repoPath),
  ])
```

교체:

```ts
async function fetchSnapshot(
  repoPath: string,
  limit: number,
): Promise<
  Pick<
    RepositoryStore,
    'status' | 'history' | 'branches' | 'shelf' | 'branchOverview' | 'rebaseProgress' | 'worktrees'
  >
> {
  const [status, history, branches, shelf, branchOverview, worktrees] = await Promise.all([
    git().repo.status(repoPath),
    git().history.list(repoPath, limit),
    git().branches.list(repoPath),
    git().shelf.list(repoPath),
    git().branches.overview(repoPath),
    git().worktrees.list(repoPath),
  ])
```

그리고 같은 함수의 기존 `return { status, history, branches, shelf, branchOverview, rebaseProgress }`를 `return { status, history, branches, shelf, branchOverview, rebaseProgress, worktrees }`로 교체.

(d) 초기 상태 기존:

```ts
  rebaseProgress: null,
```

교체:

```ts
  rebaseProgress: null,
  worktrees: [],
```

(e) 액션 구현 — 기존(abortRebase 구현 전문):

```ts
  async abortRebase() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().rebase.abort(repoPath)
      set({
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: '재배치를 취소하고 이전 상태로 돌아왔어요.',
      })
    })
  },
```

교체:

```ts
  async abortRebase() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().rebase.abort(repoPath)
      set({
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: '재배치를 취소하고 이전 상태로 돌아왔어요.',
      })
    })
  },

  async addWorktree(path, branch) {
    const { repoPath } = get()
    if (!repoPath) return false
    return guard(set, get, async () => {
      await git().worktrees.add(repoPath, path, branch)
      set({
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: `"${branch}" 워크트리를 만들었어요.`,
      })
    })
  },

  async removeWorktree(path, force) {
    const { repoPath } = get()
    if (!repoPath) return false
    let needsForce = false
    await guard(set, get, async () => {
      const result = await git().worktrees.remove(repoPath, path, force)
      needsForce = result.needsForce
      if (result.removed) {
        set({
          ...(await fetchSnapshot(repoPath, get().historyLimit)),
          notice: '워크트리를 지웠어요.',
        })
      }
    })
    return needsForce
  },

  async openWorktree(path) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      // 검증·allowlist 등록은 main — 통과하면 정규화 경로가 돌아온다 (E7c 보안 가드)
      const opened = await git().repo.openPath(repoPath, path)
      // 다른 워크트리다 — 저장소 전환과 같은 초기화 (openRepository 관례)
      set({
        repoPath: opened,
        historyLimit: HISTORY_LIMIT,
        hostingStatus: await hosting().status(opened),
        pulls: [],
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(opened, HISTORY_LIMIT)),
      })
      void git().repo.watch(opened)
    })
  },

  async revealWorktree(path) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().worktrees.reveal(repoPath, path)
    })
  },
```

(f) store 상단의 `import type { … } from '@git-gui/domain'` 목록에 `WorktreeInfo`를 알파벳 순서 자리에 추가.

- [x] **Step 6: 게이트** — `pnpm typecheck` 전부 Done. 루트 `pnpm test` → **420 passed**(무변). `pnpm --filter @git-gui/desktop build` 성공.

- [x] **Step 7: Commit**

```bash
git add packages/ipc-contract/src/index.ts apps/desktop/src/main/git-handlers.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/src/store/repository-store.ts
git commit -m "feat(desktop): E7c 워크트리 IPC·store — assertWorktreePath 보안 가드·openPath 전체 전환·스냅샷 동반

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 감시 워크트리 호환 — common-dir 감시·worktrees/ 접두 정규화 (실측 H 실버그 수정)

**Files:**
- Modify: `apps/desktop/src/main/watch-filter.ts`
- Test: `apps/desktop/test/watch-filter.test.ts` (+3)
- Modify: `apps/desktop/src/main/repo-watcher.ts`
- Modify: `apps/desktop/src/main/git-handlers.ts` (repoWatch)

- [x] **Step 1: Red — 필터 테스트 3건.** `apps/desktop/test/watch-filter.test.ts`의 기존(마지막 필터 테스트):

```ts
  it('상태 마커(MERGE_HEAD 등 대문자)와 rebase 디렉터리를 수용한다', () => {
    expect(isRelevantGitEvent('MERGE_HEAD')).toBe(true)
    expect(isRelevantGitEvent('CHERRY_PICK_HEAD')).toBe(true)
    expect(isRelevantGitEvent('rebase-merge/msgnum')).toBe(true)
    expect(isRelevantGitEvent('rebase-apply/next')).toBe(true)
    // 소문자 임의 파일은 아니다
    expect(isRelevantGitEvent('config')).toBe(false)
  })
```

바로 뒤에 추가:

```ts

  it('링크드 워크트리 경로(worktrees/<이름>/)는 접두를 벗겨 같은 규칙을 적용한다 (E7c 실측 H2)', () => {
    expect(isRelevantGitEvent('worktrees/wt-feat/HEAD')).toBe(true)
    expect(isRelevantGitEvent('worktrees/wt-feat/index')).toBe(true)
    expect(isRelevantGitEvent('worktrees/wt-feat/rebase-merge/msgnum')).toBe(true)
  })

  it('worktrees/ 아래 lock·logs도 걸러진다', () => {
    expect(isRelevantGitEvent('worktrees/wt-feat/index.lock')).toBe(false)
    expect(isRelevantGitEvent('worktrees/wt-feat/logs/HEAD')).toBe(false)
  })

  it('워크트리 등록 메타 파일(worktrees/<이름>/gitdir 등 소문자)은 무시한다', () => {
    expect(isRelevantGitEvent('worktrees/wt-feat/gitdir')).toBe(false)
    expect(isRelevantGitEvent('worktrees/wt-feat')).toBe(false)
  })
```

- [x] **Step 2: Red 확인** — `pnpm vitest run --project @git-gui/desktop -t '링크드 워크트리'` → 실패 확인(현행 필터는 worktrees/ 경로를 전부 거부).

- [x] **Step 3: 필터 구현.** `apps/desktop/src/main/watch-filter.ts` 기존:

```ts
export function isRelevantGitEvent(relativePath: string): boolean {
  if (relativePath.endsWith('.lock')) return false
  if (relativePath.startsWith('objects/') || relativePath.startsWith('logs/')) return false
  if (relativePath === 'HEAD' || relativePath === 'index' || relativePath === 'packed-refs') {
    return true
  }
  if (relativePath.startsWith('refs/')) return true
  if (relativePath.startsWith('rebase-merge/') || relativePath.startsWith('rebase-apply/')) {
    return true
  }
  // MERGE_HEAD·CHERRY_PICK_HEAD·REVERT_HEAD·FETCH_HEAD·ORIG_HEAD 등 top-level 상태 마커
  return /^[A-Z_]+$/.test(relativePath)
}
```

교체:

```ts
export function isRelevantGitEvent(relativePath: string): boolean {
  // 링크드 워크트리의 per-worktree 파일은 common dir 아래 worktrees/<이름>/에 있다 (E7c 실측 H2)
  // — 접두를 벗기고 같은 규칙을 적용한다. 접두만 있는 경로(등록 디렉터리 자체)는 빈 문자열이 되어 거부된다
  const normalized = relativePath.replace(/^worktrees\/[^/]+\//, '')
  if (normalized.endsWith('.lock')) return false
  if (normalized.startsWith('objects/') || normalized.startsWith('logs/')) return false
  if (normalized === 'HEAD' || normalized === 'index' || normalized === 'packed-refs') {
    return true
  }
  if (normalized.startsWith('refs/')) return true
  if (normalized.startsWith('rebase-merge/') || normalized.startsWith('rebase-apply/')) {
    return true
  }
  // MERGE_HEAD·CHERRY_PICK_HEAD·REVERT_HEAD·FETCH_HEAD·ORIG_HEAD 등 top-level 상태 마커
  return /^[A-Z_]+$/.test(normalized)
}
```

- [x] **Step 4: Green** — 필터 테스트 전체(-t 'isRelevantGitEvent' 포함 기존 4건 + 신규 3건) 통과.

- [x] **Step 5: 감시자 — gitDir 인자화.** `apps/desktop/src/main/repo-watcher.ts` 기존:

```ts
import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { createTrailingDebounce, isRelevantGitEvent } from './watch-filter'

/** 이벤트 폭주 묶음 창 (실측 1: 커밋 1회 = 18이벤트) */
const DEBOUNCE_MS = 300

/**
 * 저장소 하나의 .git을 감시한다 (E7b) — 관련 이벤트가 잦아들면 onChanged를 1회 부른다.
 * 반환값은 정리 함수. 감시 실패는 기능 저하로만(수동 새로고침은 그대로 동작) — 던지지 않는다
 */
export function watchRepository(repoPath: string, onChanged: () => void): () => void {
  const debounce = createTrailingDebounce(DEBOUNCE_MS, onChanged)
  let watcher: FSWatcher | null = null
  try {
    // {recursive: true}는 macOS/Windows 전용 — Linux에선 생성이 throw해 fail-soft(수동 새로고침만)가 된다
    watcher = watch(join(repoPath, '.git'), { recursive: true }, (_type, file) => {
```

교체:

```ts
import { watch, type FSWatcher } from 'node:fs'
import { createTrailingDebounce, isRelevantGitEvent } from './watch-filter'

/** 이벤트 폭주 묶음 창 (실측 1: 커밋 1회 = 18이벤트) */
const DEBOUNCE_MS = 300

/**
 * 해석된 git dir(공용)을 감시한다 (E7b·E7c) — 관련 이벤트가 잦아들면 onChanged를 1회 부른다.
 * 호출자(repoWatch 핸들러)가 --git-common-dir로 해석해 넘긴다: 링크드 워크트리의 .git은
 * 파일(gitdir 포인터)이라 그대로 감시하면 이벤트가 오지 않는다(E7c 실측 H1). 공용 dir을
 * 감시하면 본체·모든 워크트리의 변경(worktrees/<이름>/*)이 다 잡힌다(실측 H2).
 * 반환값은 정리 함수. 감시 실패는 기능 저하로만(수동 새로고침은 그대로 동작) — 던지지 않는다
 */
export function watchRepository(gitDir: string, onChanged: () => void): () => void {
  const debounce = createTrailingDebounce(DEBOUNCE_MS, onChanged)
  let watcher: FSWatcher | null = null
  try {
    // {recursive: true}는 macOS/Windows 전용 — Linux에선 생성이 throw해 fail-soft(수동 새로고침만)가 된다
    watcher = watch(gitDir, { recursive: true }, (_type, file) => {
```

- [x] **Step 6: repoWatch 핸들러 — common-dir 해석.** `apps/desktop/src/main/git-handlers.ts` 기존:

```ts
  ipcMain.handle(CHANNELS.repoWatch, (event, repoPath: unknown) => {
    const path = assertAllowedRepo(repoPath)
    stopWatching?.()
    const sender = event.sender
    stopWatching = watchRepository(path, () => {
      if (!sender.isDestroyed()) sender.send(CHANNELS.repoChanged, path)
    })
```

교체:

```ts
  ipcMain.handle(CHANNELS.repoWatch, async (event, repoPath: unknown) => {
    const path = assertAllowedRepo(repoPath)
    // 링크드 워크트리의 .git은 파일이라 그대로 감시하면 죽는다(실측 H1) — 공용 git dir을 해석해 감시한다
    const gitDir = (
      await execGitOrThrow(['rev-parse', '--path-format=absolute', '--git-common-dir'], {
        cwd: path,
      })
    ).stdout.trim()
    stopWatching?.()
    const sender = event.sender
    stopWatching = watchRepository(gitDir, () => {
      if (!sender.isDestroyed()) sender.send(CHANNELS.repoChanged, path)
    })
```

- [x] **Step 7: 게이트** — 루트 `pnpm test` → **423 passed**. `pnpm typecheck` Done. `cd apps/desktop && npx electron-vite build && npx playwright test e2e/smoke.spec.ts` → **51 passed**(감시 E2E 포함 전 스위트 무회귀 — common-dir 전환이 본체 감시를 깨지 않는 게이트).

- [x] **Step 8: Commit**

```bash
git add apps/desktop/src/main/watch-filter.ts apps/desktop/test/watch-filter.test.ts apps/desktop/src/main/repo-watcher.ts apps/desktop/src/main/git-handlers.ts
git commit -m "fix(desktop): E7c 감시 워크트리 호환 — common-dir 감시(링크드 .git 파일 실버그)·worktrees/ 접두 정규화

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 설정 — worktreeSelectAction·SettingsDialog·헤더 ⚙

**Files:**
- Modify: `packages/ipc-contract/src/index.ts` + Test: `packages/ipc-contract/test/settings.test.ts` (+1)
- Create: `apps/desktop/src/renderer/src/ui/settings/worktree-select-action.ts`
- Create: `apps/desktop/src/renderer/src/ui/settings/SettingsDialog.tsx` + `settings-dialog.css`
- Modify: `apps/desktop/src/renderer/src/App.tsx`

- [x] **Step 1: 설정 Red.** `packages/ipc-contract/test/settings.test.ts` 기존:

```ts
  it('터미널 도크 필드(terminalOpen·terminalHeight)를 통과시키고 잘못된 타입은 버린다 (E7b)', () => {
    expect(sanitizeSettings({ terminalOpen: true, terminalHeight: 240 })).toEqual({
      terminalOpen: true,
      terminalHeight: 240,
    })
    expect(sanitizeSettings({ terminalOpen: 'yes', terminalHeight: NaN })).toEqual({})
  })
```

교체:

```ts
  it('터미널 도크 필드(terminalOpen·terminalHeight)를 통과시키고 잘못된 타입은 버린다 (E7b)', () => {
    expect(sanitizeSettings({ terminalOpen: true, terminalHeight: 240 })).toEqual({
      terminalOpen: true,
      terminalHeight: 240,
    })
    expect(sanitizeSettings({ terminalOpen: 'yes', terminalHeight: NaN })).toEqual({})
  })

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

- [x] **Step 2: Red 확인 후 계약 구현.** `pnpm vitest run --project @git-gui/ipc-contract -t '워크트리 선택 동작'` 실패 확인 → `packages/ipc-contract/src/index.ts` 기존:

```ts
  /** 터미널 도크 높이(px) (E7b) */
  terminalHeight?: number
}
```

교체:

```ts
  /** 터미널 도크 높이(px) (E7b) */
  terminalHeight?: number
  /** 워크트리 선택 시 동작 — 클릭의 기본 동작만 결정한다(우클릭엔 항상 둘 다) (E7c) */
  worktreeSelectAction?: 'terminal' | 'switch-app'
}
```

그리고 기존:

```ts
  if (typeof candidate.terminalHeight === 'number' && Number.isFinite(candidate.terminalHeight)) {
    settings.terminalHeight = candidate.terminalHeight
  }
  return settings
}
```

교체:

```ts
  if (typeof candidate.terminalHeight === 'number' && Number.isFinite(candidate.terminalHeight)) {
    settings.terminalHeight = candidate.terminalHeight
  }
  if (candidate.worktreeSelectAction === 'terminal' || candidate.worktreeSelectAction === 'switch-app') {
    settings.worktreeSelectAction = candidate.worktreeSelectAction
  }
  return settings
}
```

Green: settings 테스트 전체 통과.

- [x] **Step 3: load/save 순수.** `apps/desktop/src/renderer/src/ui/settings/worktree-select-action.ts` 신규:

```ts
export type WorktreeSelectAction = 'terminal' | 'switch-app'

/** 저장값 → 동작. 미설정·깨진 값은 가벼운 기본(터미널만)으로 (스펙 확정 기본값) */
export function loadWorktreeSelectAction(): WorktreeSelectAction {
  return window.settingsApi.initial.worktreeSelectAction === 'switch-app' ? 'switch-app' : 'terminal'
}

export function saveWorktreeSelectAction(action: WorktreeSelectAction): void {
  void window.settingsApi.set({ worktreeSelectAction: action })
}
```

- [x] **Step 4: SettingsDialog.** `apps/desktop/src/renderer/src/ui/settings/SettingsDialog.tsx` 신규:

```tsx
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { Button } from '../Button'
import '../confirm-dialog.css'
import './settings-dialog.css'
import type { WorktreeSelectAction } from './worktree-select-action'

interface SettingsDialogProps {
  isOpen: boolean
  worktreeSelectAction: WorktreeSelectAction
  onChangeWorktreeSelectAction(action: WorktreeSelectAction): void
  onClose(): void
}

/**
 * 설정 모달 (E7c) — 이 앱 최초의 범용 설정 표면. 카테고리 사이드바 + 즉시 저장(확인 버튼 없음 —
 * rightWidth·테마 관례). v1 카테고리는 "일반" 하나 — 후속 카테고리는 미리 그리지 않는다(죽은 UI 금지, 스펙)
 */
export function SettingsDialog({
  isOpen,
  worktreeSelectAction,
  onChangeWorktreeSelectAction,
  onClose,
}: SettingsDialogProps) {
  return (
    <ModalOverlay
      className="ui-modal-overlay"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      isDismissable
    >
      <Modal className="ui-modal settings-dialog__modal">
        <Dialog className="ui-dialog">
          <Heading slot="title" className="ui-dialog__title">
            설정
          </Heading>
          <div className="settings-dialog__body" data-testid="settings-dialog">
            <nav className="settings-dialog__cats" aria-label="설정 분류">
              <button
                type="button"
                className="settings-dialog__cat settings-dialog__cat--on"
                data-testid="settings-cat-general"
              >
                일반
              </button>
            </nav>
            <div className="settings-dialog__content">
              <fieldset className="settings-dialog__field">
                <legend className="settings-dialog__label">워크트리 선택 시 동작</legend>
                <label className="settings-dialog__radio">
                  <input
                    type="radio"
                    name="worktree-select-action"
                    checked={worktreeSelectAction === 'terminal'}
                    onChange={() => onChangeWorktreeSelectAction('terminal')}
                    data-testid="settings-worktree-terminal"
                  />
                  터미널만 따라가기 — 새 터미널이 그 폴더에서 열려요
                </label>
                <label className="settings-dialog__radio">
                  <input
                    type="radio"
                    name="worktree-select-action"
                    checked={worktreeSelectAction === 'switch-app'}
                    onChange={() => onChangeWorktreeSelectAction('switch-app')}
                    data-testid="settings-worktree-switch"
                  />
                  앱 전체 전환 — 변경·역사·실험 공간도 그 워크트리 기준으로 바뀌어요
                </label>
                <p className="settings-dialog__desc">
                  우클릭 메뉴에서는 설정과 무관하게 두 동작을 언제든 고를 수 있어요.
                </p>
              </fieldset>
            </div>
          </div>
          <div className="ui-dialog__actions">
            <Button variant="ghost" size="sm" onPress={onClose} testId="settings-close">
              닫기
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
```

- [x] **Step 5: CSS.** `apps/desktop/src/renderer/src/ui/settings/settings-dialog.css` 신규:

```css
/* E7c 설정 모달 — 카테고리 사이드바 구조. 기본 ui-modal보다 넓게 */
.settings-dialog__modal {
  width: 560px;
  max-width: 90vw;
}
.settings-dialog__body {
  display: flex;
  gap: var(--space-4);
  min-height: 200px;
}
.settings-dialog__cats {
  width: 130px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-right: 1px solid var(--color-border-strong);
  padding-right: var(--space-4);
}
.settings-dialog__cat {
  appearance: none;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 5px 10px;
  font-size: var(--text-sm);
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.settings-dialog__cat--on {
  background: var(--color-surface);
  border-color: var(--color-border-strong);
  font-weight: 600;
}
.settings-dialog__content {
  flex: 1;
  min-width: 0;
}
.settings-dialog__field {
  border: none;
  margin: 0;
  padding: 0;
}
.settings-dialog__label {
  font-weight: 600;
  font-size: var(--text-sm);
  margin-bottom: 6px;
}
.settings-dialog__radio {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 0;
  font-size: var(--text-sm);
  cursor: pointer;
}
.settings-dialog__desc {
  margin: 6px 0 0;
  font-size: var(--text-sm);
  color: var(--color-text-faint);
}
```

- [x] **Step 6: App 배선.** `apps/desktop/src/renderer/src/App.tsx` — 편집 3곳.

(a) lucide import 기존:

```ts
import { CloudUpload, DownloadCloud, GitMerge, Moon, RefreshCw, Sun, Terminal } from 'lucide-react'
```

교체:

```ts
import { CloudUpload, DownloadCloud, GitMerge, Moon, RefreshCw, Settings, Sun, Terminal } from 'lucide-react'
```

그리고 기존:

```ts
import { TerminalDock } from './ui/terminal/TerminalDock'
```

교체:

```ts
import { TerminalDock } from './ui/terminal/TerminalDock'
import { SettingsDialog } from './ui/settings/SettingsDialog'
import {
  loadWorktreeSelectAction,
  saveWorktreeSelectAction,
  type WorktreeSelectAction,
} from './ui/settings/worktree-select-action'
```

(b) 상태 — 도크 상태 블록의 기존 첫 줄 앞(주석 포함 앵커):

```ts
  // E7b 터미널 도크 — 중앙+우측 하단. 열림·높이는 설정 영속(rightWidth 관례).
```

교체:

```ts
  // E7c 설정 모달 + 워크트리 선택 동작(클릭의 기본 동작만 결정 — 우클릭엔 항상 둘 다)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [worktreeSelectAction, setWorktreeSelectAction] = useState<WorktreeSelectAction>(() =>
    loadWorktreeSelectAction(),
  )
  const changeWorktreeSelectAction = (action: WorktreeSelectAction) => {
    setWorktreeSelectAction(action)
    saveWorktreeSelectAction(action)
  }

  // E7b 터미널 도크 — 중앙+우측 하단. 열림·높이는 설정 영속(rightWidth 관례).
```

(c) 헤더 ⚙ 버튼 + 다이얼로그 렌더 — 기존:

```tsx
          <Button variant="ghost" size="sm" onPress={toggleDock} testId="terminal-toggle">
            <Terminal size={13} aria-hidden="true" /> 터미널
          </Button>
        </div>
      </header>
```

교체:

```tsx
          <Button variant="ghost" size="sm" onPress={toggleDock} testId="terminal-toggle">
            <Terminal size={13} aria-hidden="true" /> 터미널
          </Button>
          <Button variant="ghost" size="sm" onPress={() => setSettingsOpen(true)} testId="settings-open">
            <Settings size={13} aria-hidden="true" />
          </Button>
        </div>
      </header>
      <SettingsDialog
        isOpen={settingsOpen}
        worktreeSelectAction={worktreeSelectAction}
        onChangeWorktreeSelectAction={changeWorktreeSelectAction}
        onClose={() => setSettingsOpen(false)}
      />
```

- [x] **Step 7: 게이트** — 루트 `pnpm test` → **424 passed**. `pnpm typecheck` Done. `pnpm --filter @git-gui/desktop build` 성공.

- [x] **Step 8: Commit**

```bash
git add packages/ipc-contract/src/index.ts packages/ipc-contract/test/settings.test.ts apps/desktop/src/renderer/src/ui/settings/worktree-select-action.ts apps/desktop/src/renderer/src/ui/settings/SettingsDialog.tsx apps/desktop/src/renderer/src/ui/settings/settings-dialog.css apps/desktop/src/renderer/src/App.tsx
git commit -m "feat(desktop): E7c 설정 모달 — 카테고리 사이드바·즉시 저장·워크트리 선택 동작(worktreeSelectAction)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 터미널 cwd — create(repoPath, cwd?)·검증·탭 라벨

**Files:**
- Modify: `packages/ipc-contract/src/index.ts`
- Modify: `apps/desktop/src/main/terminal-handlers.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/src/ui/terminal/use-terminal-sessions.ts`
- Modify: `apps/desktop/src/renderer/src/ui/terminal/TerminalDock.tsx`

- [x] **Step 1: 계약.** `packages/ipc-contract/src/index.ts` 기존:

```ts
  /** 세션 생성 — cwd는 allowlist된 저장소 루트로 고정된다 (E7c에서 워크트리 인자 확장) */
  create(repoPath: string): Promise<{ sessionId: string }>
```

교체:

```ts
  /** 세션 생성 — cwd 생략 시 저장소 루트. cwd는 그 저장소의 워크트리 경로만 허용(main 검증 — E7c) */
  create(repoPath: string, cwd?: string): Promise<{ sessionId: string }>
```

- [x] **Step 2: 핸들러.** `apps/desktop/src/main/terminal-handlers.ts` 기존:

```ts
import { assertAllowedRepo, assertString } from './git-handlers'
```

교체:

```ts
import { assertAllowedRepo, assertString, assertWorktreePath } from './git-handlers'
```

그리고 기존:

```ts
  ipcMain.handle(TERMINAL_CHANNELS.create, (event, repoPath: unknown) => {
    const cwd = assertAllowedRepo(repoPath)
    const created = manager.create(cwd)
```

교체:

```ts
  ipcMain.handle(TERMINAL_CHANNELS.create, async (event, repoPath: unknown, cwd: unknown) => {
    const root = assertAllowedRepo(repoPath)
    // cwd가 오면 이 저장소의 워크트리 경로인지 검증한다 — 임의 경로 쉘 스폰 차단 (E7c 보안 가드)
    const target = cwd === undefined ? root : await assertWorktreePath(root, cwd)
    const created = manager.create(target)
```

- [x] **Step 3: preload.** `apps/desktop/src/preload/index.ts` 기존:

```ts
const terminalApi: TerminalApi = {
  create: (repoPath) => ipcRenderer.invoke(TERMINAL_CHANNELS.create, repoPath),
```

교체:

```ts
const terminalApi: TerminalApi = {
  create: (repoPath, cwd) => ipcRenderer.invoke(TERMINAL_CHANNELS.create, repoPath, cwd),
```

- [x] **Step 4: 훅 — cwd·라벨.** `apps/desktop/src/renderer/src/ui/terminal/use-terminal-sessions.ts` 기존:

```ts
  const create = async () => {
    if (repoPath === null) return
    try {
      const { sessionId } = await window.terminalApi.create(repoPath)
```

교체:

```ts
  /** 세션 생성 — cwd·label이 오면 그 워크트리 폴더에서 열고 탭 라벨에 병기한다 (E7c) */
  const create = async (options?: { cwd?: string; label?: string }) => {
    if (repoPath === null) return
    try {
      const { sessionId } = await window.terminalApi.create(repoPath, options?.cwd)
```

그리고 기존:

```ts
      setTabs((prev) => [...prev, { sessionId, title: `${counterRef.current}: 쉘`, exited: false }])
```

교체:

```ts
      setTabs((prev) => [
        ...prev,
        {
          sessionId,
          title: `${counterRef.current}: ${options?.label ?? '쉘'}`,
          exited: false,
        },
      ])
```

- [x] **Step 5: TerminalDock — 활성 워크트리 인자.** `apps/desktop/src/renderer/src/ui/terminal/TerminalDock.tsx` — 편집 3곳(props에 `activeWorktree` 추가, 생성 2곳이 전달).

(a) props 기존:

```tsx
interface TerminalDockProps {
  repoPath: string | null
  /** 도크가 보이는가 — 접힘은 숨김일 뿐 언마운트가 아니다(세션 유지 — 스펙) */
  open: boolean
```

교체:

```tsx
interface TerminalDockProps {
  repoPath: string | null
  /** 활성 워크트리(터미널 대상) — 새 세션이 이 폴더에서 열리고 탭 라벨에 이름이 병기된다 (E7c) */
  activeWorktree: { cwd: string; label: string } | null
  /** 도크가 보이는가 — 접힘은 숨김일 뿐 언마운트가 아니다(세션 유지 — 스펙) */
  open: boolean
```

(b) 컴포넌트 시그니처·첫 열림 생성 기존:

```tsx
export function TerminalDock({ repoPath, open, height, onResizeStart, onClose }: TerminalDockProps) {
  const sessions = useTerminalSessions(repoPath)

  // 처음 "열릴 때" 세션을 만든다 — 앱 시작만으로 쉘을 스폰하지 않는다. 열릴 때마다 크기를 다시 맞춘다
  useEffect(() => {
    if (!open) return
    if (sessions.tabs.length === 0) void sessions.create()
    else sessions.refitActive()
```

교체:

```tsx
export function TerminalDock({
  repoPath,
  activeWorktree,
  open,
  height,
  onResizeStart,
  onClose,
}: TerminalDockProps) {
  const sessions = useTerminalSessions(repoPath)

  // 처음 "열릴 때" 세션을 만든다 — 앱 시작만으로 쉘을 스폰하지 않는다. 열릴 때마다 크기를 다시 맞춘다
  useEffect(() => {
    if (!open) return
    if (sessions.tabs.length === 0) void sessions.create(activeWorktree ?? undefined)
    else sessions.refitActive()
```

(c) + 버튼 기존:

```tsx
          <Button variant="ghost" size="sm" onPress={() => void sessions.create()} testId="terminal-new-tab">
```

교체:

```tsx
          <Button
            variant="ghost"
            size="sm"
            onPress={() => void sessions.create(activeWorktree ?? undefined)}
            testId="terminal-new-tab"
          >
```

- [x] **Step 6: App — 임시 null 전달.** Task 6에서 활성 워크트리 상태가 생기기 전까지 컴파일을 지키기 위해, `apps/desktop/src/renderer/src/App.tsx`의 TerminalDock 렌더 기존:

```tsx
            <TerminalDock
              repoPath={store.repoPath}
              open={dockOpen}
```

교체:

```tsx
            <TerminalDock
              repoPath={store.repoPath}
              activeWorktree={null}
              open={dockOpen}
```

(Task 6에서 실제 값으로 바뀐다 — 이 줄이 그 앵커가 된다.)

- [x] **Step 7: 게이트** — `pnpm typecheck` Done. 루트 `pnpm test` → **424 passed**(무변). `cd apps/desktop && npx electron-vite build && npx playwright test e2e/smoke.spec.ts` → **51 passed**(터미널 E2E 4건 무회귀 — cwd 생략 경로).

- [x] **Step 8: Commit**

```bash
git add packages/ipc-contract/src/index.ts apps/desktop/src/main/terminal-handlers.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/src/ui/terminal/use-terminal-sessions.ts apps/desktop/src/renderer/src/ui/terminal/TerminalDock.tsx apps/desktop/src/renderer/src/App.tsx
git commit -m "feat(desktop): E7c 터미널 cwd — create(repoPath, cwd?)·워크트리 검증·탭 라벨 병기

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: UI — WorktreesPanel·AddWorktreeDialog·3번째 탭·활성 워크트리

**Files:**
- Create: `apps/desktop/src/renderer/src/components/worktree-path.ts`
- Test: `apps/desktop/test/worktree-path.test.ts` (신규, +3)
- Create: `apps/desktop/src/renderer/src/components/WorktreesPanel.tsx` + `worktrees-panel.css`
- Create: `apps/desktop/src/renderer/src/components/AddWorktreeDialog.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx`

- [x] **Step 1: 경로 제안 Red.** `apps/desktop/test/worktree-path.test.ts` 신규:

```ts
import { describe, expect, it } from 'vitest'
import { suggestWorktreePath } from '../src/renderer/src/components/worktree-path'

describe('suggestWorktreePath', () => {
  it('본체 옆에 "<저장소>-<브랜치슬러그>" 형태를 제안한다', () => {
    expect(suggestWorktreePath('/home/me/my-repo', 'feature/login')).toBe(
      '/home/me/my-repo-feature-login',
    )
  })

  it('슬래시·공백을 하이픈으로 바꾼다', () => {
    expect(suggestWorktreePath('/a/b/proj', 'fix/A B')).toBe('/a/b/proj-fix-A-B')
  })

  it('끝의 슬래시가 있어도 부모 기준으로 붙인다', () => {
    expect(suggestWorktreePath('/a/proj/', 'main')).toBe('/a/proj-main')
  })
})
```

- [x] **Step 2: Red 확인 후 구현.** `pnpm vitest run --project @git-gui/desktop -t 'suggestWorktreePath'` 실패 확인 → `apps/desktop/src/renderer/src/components/worktree-path.ts` 신규:

```ts
/**
 * 새 워크트리 경로 제안 (E7c) — 본체 폴더 옆에 "<저장소 이름>-<브랜치 슬러그>".
 * 슬러그: 슬래시·공백을 하이픈으로. 사용자가 다이얼로그에서 수정할 수 있다
 */
export function suggestWorktreePath(mainPath: string, branch: string): string {
  const trimmed = mainPath.replace(/\/+$/, '')
  const slug = branch.replace(/[/\s]+/g, '-')
  return `${trimmed}-${slug}`
}
```

Green: 3 passed.

- [x] **Step 3: WorktreesPanel.** `apps/desktop/src/renderer/src/components/WorktreesPanel.tsx` 신규:

```tsx
import { useState, type MouseEvent } from 'react'
import type { WorktreeInfo } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu'
import { Panel } from '../ui/Panel'
import './worktrees-panel.css'

export type WorktreeAction =
  // 행 클릭 = 활성 지정 + 설정된 동작 (App이 worktreeSelectAction으로 분기)
  | { kind: 'select'; path: string; label: string }
  // 우클릭 "여기서 터미널 열기" = 설정 무관 항상 터미널
  | { kind: 'terminal'; path: string; label: string }
  | { kind: 'open'; path: string }
  | { kind: 'reveal'; path: string }
  | { kind: 'remove'; path: string }
  | { kind: 'add' }

interface WorktreesPanelProps {
  worktrees: WorktreeInfo[]
  /** 앱이 지금 열고 있는 워크트리 경로 */
  currentPath: string | null
  /** 활성(터미널 대상) 워크트리 경로 */
  activePath: string | null
  busy: boolean
  onAction(action: WorktreeAction): void
}

/** 워크트리 탭 (E7c) — 목록·활성 지정(클릭)·우클릭 관리. 폴더 이름으로 표시, 경로는 흐리게 */
export function WorktreesPanel({
  worktrees,
  currentPath,
  activePath,
  busy,
  onAction,
}: WorktreesPanelProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; worktree: WorktreeInfo } | null>(null)

  const folderName = (path: string) => path.split('/').filter(Boolean).pop() ?? path

  const buildMenu = (worktree: WorktreeInfo): ContextMenuEntry[] => {
    const isCurrent = worktree.path === currentPath
    const name = folderName(worktree.path)
    return [
      {
        key: 'terminal',
        label: '여기서 터미널 열기',
        disabled: busy || worktree.prunable,
        onSelect: () => onAction({ kind: 'terminal', path: worktree.path, label: name }),
      },
      {
        key: 'open',
        label: isCurrent ? '앱에서 열기 — 지금 여기예요' : '앱에서 열기 (전체 전환)',
        disabled: busy || isCurrent || worktree.prunable,
        onSelect: () => onAction({ kind: 'open', path: worktree.path }),
      },
      { key: 'sep-1', separator: true },
      {
        key: 'reveal',
        label: 'Finder에서 보기',
        disabled: busy || worktree.prunable,
        onSelect: () => onAction({ kind: 'reveal', path: worktree.path }),
      },
      {
        key: 'remove',
        label: worktree.isMain
          ? '지우기 — 본체는 지울 수 없어요'
          : isCurrent
            ? '지우기 — 지금 열고 있는 워크트리예요'
            : '지우기… (worktree remove)',
        disabled: busy || worktree.isMain || isCurrent,
        onSelect: () => onAction({ kind: 'remove', path: worktree.path }),
      },
    ]
  }

  const openMenu = (event: MouseEvent, worktree: WorktreeInfo) => {
    event.preventDefault()
    if (event.clientX === 0 && event.clientY === 0) {
      const rect = event.currentTarget.getBoundingClientRect()
      setMenu({ x: rect.left + 8, y: rect.bottom, worktree })
      return
    }
    setMenu({ x: event.clientX, y: event.clientY, worktree })
  }

  const branchLabel = (worktree: WorktreeInfo) =>
    worktree.prunable ? '없어진 폴더' : worktree.branch ?? '분리됨'

  return (
    <Panel title="워크트리" accessory={<Badge tone="git">worktree</Badge>} testId="worktrees-panel">
      <div className="worktrees-panel">
        <div className="worktrees-panel__scroll" data-testid="worktrees-list">
          {worktrees.map((worktree) => (
            <button
              key={worktree.path}
              type="button"
              className={`worktree-row${worktree.prunable ? ' worktree-row--gone' : ''}`}
              title={worktree.path}
              onClick={(event) =>
                worktree.prunable
                  ? openMenu(event, worktree)
                  : onAction({
                      kind: 'select',
                      path: worktree.path,
                      label: folderName(worktree.path),
                    })
              }
              onContextMenu={(event) => openMenu(event, worktree)}
              data-testid={`worktree-row-${folderName(worktree.path)}`}
            >
              <span className="worktree-row__top">
                <span className="worktree-row__name">
                  {worktree.isMain ? '🏠' : '🌳'} {folderName(worktree.path)}
                </span>
                {worktree.path === currentPath && <Badge tone="git">지금 여기</Badge>}
                {worktree.path === activePath && <Badge tone="git">터미널 대상</Badge>}
                <span className="worktree-row__branch">{branchLabel(worktree)}</span>
              </span>
              <span className="worktree-row__path">{worktree.path}</span>
            </button>
          ))}
          <button
            type="button"
            className="worktree-row worktree-row--add"
            onClick={() => onAction({ kind: 'add' })}
            data-testid="worktree-add"
          >
            ＋ 새 워크트리…
          </button>
        </div>
      </div>
      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenu(menu.worktree)}
          onClose={() => setMenu(null)}
        />
      )}
    </Panel>
  )
}
```

- [x] **Step 4: CSS.** `apps/desktop/src/renderer/src/components/worktrees-panel.css` 신규:

```css
.worktrees-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.worktrees-panel__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.worktrees-panel__empty {
  padding: var(--space-4);
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-faint);
}
.worktree-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 5px 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.worktree-row:hover {
  background: var(--color-surface);
}
.worktree-row--gone {
  opacity: 0.55;
}
.worktree-row--add {
  color: var(--color-text-faint);
  font-size: var(--text-sm);
}
.worktree-row__top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.worktree-row__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.worktree-row__branch {
  margin-left: auto;
  font-size: 10px;
  color: var(--color-text-faint);
}
.worktree-row__path {
  font-size: 10px;
  color: var(--color-text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.add-worktree__label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
  font-size: var(--text-sm);
}
.add-worktree__select,
.add-worktree__input {
  padding: 5px 8px;
  font-size: var(--text-sm);
  color: inherit;
  background: transparent;
  border: 1px solid var(--color-border-strong);
  border-radius: 6px;
}
.add-worktree__error {
  margin: 0 0 8px;
  font-size: var(--text-sm);
  color: #ff9191;
}
```

- [x] **Step 5: AddWorktreeDialog.** `apps/desktop/src/renderer/src/components/AddWorktreeDialog.tsx` 신규:

```tsx
import { useEffect, useState } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import type { LocalBranchStatus } from '@git-gui/domain'
import { Button } from '../ui/Button'
import '../ui/confirm-dialog.css'
import './worktrees-panel.css'
import { suggestWorktreePath } from './worktree-path'

interface AddWorktreeDialogProps {
  isOpen: boolean
  mainPath: string
  /** 로컬 브랜치 — 이미 워크트리가 쓰는 브랜치는 checkedOut으로 걸러진다 */
  branches: LocalBranchStatus[]
  /** 이미 어떤 워크트리가 체크아웃한 브랜치 이름들 (git 제약: 같은 브랜치 중복 불가) */
  checkedOut: Set<string>
  errorText: string | null
  onSubmit(path: string, branch: string): void
  onCancel(): void
}

/** 새 워크트리 만들기 (E7c) — 체크아웃 안 된 브랜치 선택 + 경로(자동 제안·수정 가능) */
export function AddWorktreeDialog({
  isOpen,
  mainPath,
  branches,
  checkedOut,
  errorText,
  onSubmit,
  onCancel,
}: AddWorktreeDialogProps) {
  const available = branches.filter((branch) => !checkedOut.has(branch.name))
  const [branch, setBranch] = useState('')
  const [path, setPath] = useState('')
  const [pathEdited, setPathEdited] = useState(false)
  useEffect(() => {
    if (!isOpen) return
    const first = available[0]?.name ?? ''
    setBranch(first)
    setPath(first === '' ? '' : suggestWorktreePath(mainPath, first))
    setPathEdited(false)
    // 열림 전이에만 초기화 — available은 렌더마다 새 배열
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const chooseBranch = (name: string) => {
    setBranch(name)
    if (!pathEdited) setPath(suggestWorktreePath(mainPath, name))
  }

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
            새 워크트리 만들기
          </Heading>
          <p className="ui-dialog__body">
            체크아웃되지 않은 실험 공간을 새 폴더에 함께 펼쳐요. 같은 실험 공간은 한 폴더에서만 열 수
            있어요.
          </p>
          {available.length === 0 ? (
            <p className="worktrees-panel__empty">
              펼칠 수 있는 실험 공간이 없어요. 실험 공간 탭에서 먼저 만들어 주세요.
            </p>
          ) : (
            <>
              <label className="add-worktree__label">
                실험 공간
                <select
                  className="add-worktree__select"
                  value={branch}
                  onChange={(event) => chooseBranch(event.target.value)}
                  data-testid="add-worktree-branch"
                >
                  {available.map((option) => (
                    <option key={option.name} value={option.name}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="add-worktree__label">
                폴더 경로
                <input
                  className="add-worktree__input"
                  value={path}
                  onChange={(event) => {
                    setPath(event.target.value)
                    setPathEdited(true)
                  }}
                  data-testid="add-worktree-path"
                />
              </label>
              {errorText !== null && (
                <p className="add-worktree__error" role="alert" data-testid="add-worktree-error">
                  {errorText}
                </p>
              )}
            </>
          )}
          <div className="ui-dialog__actions">
            <Button variant="ghost" size="sm" onPress={onCancel} testId="add-worktree-cancel">
              그만두기
            </Button>
            <Button
              variant="primary"
              size="sm"
              isDisabled={branch === '' || path === ''}
              onPress={() => onSubmit(path, branch)}
              testId="add-worktree-submit"
            >
              만들기
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
```

- [x] **Step 6: App 배선 (1) — import.** `apps/desktop/src/renderer/src/App.tsx` 기존:

```ts
import { BranchesPanel } from './components/BranchesPanel'
import { BranchSwitcher } from './components/BranchSwitcher'
```

교체:

```ts
import { AddWorktreeDialog } from './components/AddWorktreeDialog'
import { BranchesPanel } from './components/BranchesPanel'
import { BranchSwitcher } from './components/BranchSwitcher'
import { WorktreesPanel } from './components/WorktreesPanel'
```

- [x] **Step 7: App 배선 (2) — leftTab 타입·상태.** 기존:

```ts
  const [leftTab, setLeftTab] = useState<'changes' | 'branches'>('changes')
```

교체:

```ts
  const [leftTab, setLeftTab] = useState<'changes' | 'branches' | 'worktrees'>('changes')
  // E7c 활성 워크트리(터미널 대상) — renderer 로컬(재시작 시 앱이 연 곳으로 초기화, 영속 안 함)
  const [activeWorktree, setActiveWorktree] = useState<{ cwd: string; label: string } | null>(null)
  const [addWorktreeOpen, setAddWorktreeOpen] = useState(false)
  const [confirmingRemoveWorktree, setConfirmingRemoveWorktree] = useState<{
    path: string
    force: boolean
  } | null>(null)
```

- [x] **Step 8: App 배선 (3) — 3번째 탭 버튼.** 기존:

```tsx
            <button
              type="button"
              role="tab"
              aria-selected={leftTab === 'branches'}
              className="app__left-tab"
              onClick={() => setLeftTab('branches')}
              data-testid="left-tab-branches"
            >
              실험 공간
            </button>
          </div>
```

교체:

```tsx
            <button
              type="button"
              role="tab"
              aria-selected={leftTab === 'branches'}
              className="app__left-tab"
              onClick={() => setLeftTab('branches')}
              data-testid="left-tab-branches"
            >
              실험 공간
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={leftTab === 'worktrees'}
              className="app__left-tab"
              onClick={() => setLeftTab('worktrees')}
              data-testid="left-tab-worktrees"
            >
              워크트리
            </button>
          </div>
```

- [x] **Step 9: App 배선 (4) — 패널 분기.** BranchesPanel 닫힘 뒤의 삼항 종료 기존:

```tsx
            />
          )}
        </div>
        <div className="app__center">
```

교체(중첩 삼항으로 worktrees 분기 추가):

```tsx
            />
          ) : leftTab === 'worktrees' ? (
            <WorktreesPanel
              worktrees={store.worktrees}
              currentPath={store.repoPath}
              activePath={activeWorktree?.cwd ?? null}
              busy={store.busy}
              onAction={(action) => {
                switch (action.kind) {
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
                  case 'terminal':
                    // 우클릭 "여기서 터미널 열기" — 설정 무관 항상 터미널
                    setActiveWorktree({ cwd: action.path, label: action.label })
                    setDockOpen(() => {
                      saveDockOpen(true)
                      return true
                    })
                    break
                  case 'open':
                    void store.openWorktree(action.path)
                    break
                  case 'reveal':
                    void store.revealWorktree(action.path)
                    break
                  case 'remove':
                    setConfirmingRemoveWorktree({ path: action.path, force: false })
                    break
                  case 'add':
                    store.clearError()
                    setAddWorktreeOpen(true)
                    break
                }
              }}
            />
          ) : null}
        </div>
        <div className="app__center">
```

- [x] **Step 10: App 배선 (5) — TerminalDock 활성 전달.** Task 5에서 `activeWorktree={null}`로 둔 줄 기존:

```tsx
            <TerminalDock
              repoPath={store.repoPath}
              activeWorktree={null}
              open={dockOpen}
```

교체:

```tsx
            <TerminalDock
              repoPath={store.repoPath}
              activeWorktree={activeWorktree}
              open={dockOpen}
```

- [x] **Step 11: App 배선 (6) — 다이얼로그 2종.** SettingsDialog 렌더(Task 4) 기존:

```tsx
      <SettingsDialog
        isOpen={settingsOpen}
        worktreeSelectAction={worktreeSelectAction}
        onChangeWorktreeSelectAction={changeWorktreeSelectAction}
        onClose={() => setSettingsOpen(false)}
      />
```

교체:

```tsx
      <SettingsDialog
        isOpen={settingsOpen}
        worktreeSelectAction={worktreeSelectAction}
        onChangeWorktreeSelectAction={changeWorktreeSelectAction}
        onClose={() => setSettingsOpen(false)}
      />
      <AddWorktreeDialog
        isOpen={addWorktreeOpen}
        mainPath={store.worktrees.find((worktree) => worktree.isMain)?.path ?? store.repoPath ?? ''}
        branches={store.branchOverview?.locals ?? []}
        checkedOut={
          new Set(
            store.worktrees
              .map((worktree) => worktree.branch)
              .filter((branch): branch is string => branch !== null),
          )
        }
        errorText={addWorktreeOpen ? store.error : null}
        onSubmit={(path, branch) => {
          void (async () => {
            if (await store.addWorktree(path, branch)) setAddWorktreeOpen(false)
          })()
        }}
        onCancel={() => setAddWorktreeOpen(false)}
      />
      <ConfirmDialog
        isOpen={confirmingRemoveWorktree !== null}
        title={
          confirmingRemoveWorktree?.force === true
            ? '미저장 변경이 있어요 — 그래도 지울까요?'
            : '워크트리를 지울까요?'
        }
        confirmLabel={confirmingRemoveWorktree?.force === true ? '그래도 지우기' : '지우기'}
        onConfirm={() => {
          const target = confirmingRemoveWorktree
          setConfirmingRemoveWorktree(null)
          if (target === null) return
          void (async () => {
            // 미저장 변경이 있으면 엔진이 needsForce로 알린다 — 2단 확인 (removeBranch 관례)
            if (await store.removeWorktree(target.path, target.force)) {
              if (!target.force) setConfirmingRemoveWorktree({ path: target.path, force: true })
            }
          })()
        }}
        onCancel={() => setConfirmingRemoveWorktree(null)}
      >
        {confirmingRemoveWorktree?.force === true
          ? '그 폴더의 미저장 변경이 함께 사라져요. 되돌릴 수 없어요.'
          : '워크트리 폴더가 디스크에서 지워져요. 저장된 역사와 실험 공간은 그대로예요.'}
      </ConfirmDialog>
```

- [x] **Step 12: 게이트** — 루트 `pnpm test` → **427 passed**(worktree-path +3). `pnpm typecheck` Done. `cd apps/desktop && npx electron-vite build && npx playwright test e2e/smoke.spec.ts` → **51 passed**(무회귀).

- [x] **Step 13: Commit**

```bash
git add apps/desktop/src/renderer/src/components/worktree-path.ts apps/desktop/test/worktree-path.test.ts apps/desktop/src/renderer/src/components/WorktreesPanel.tsx apps/desktop/src/renderer/src/components/worktrees-panel.css apps/desktop/src/renderer/src/components/AddWorktreeDialog.tsx apps/desktop/src/renderer/src/App.tsx
git commit -m "feat(desktop): E7c 워크트리 탭 — 목록·활성 지정(설정 반영)·우클릭 관리·생성/제거 다이얼로그

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: E2E — 워크트리 5건

**Files:**
- Modify: `apps/desktop/e2e/smoke.spec.ts` (+5)

E2E는 워크트리 폴더를 디스크에 만든다 — 각 테스트는 `createRepoWithChange` 저장소 + 격리 userData(터미널 토글이 dockOpen을 영속하므로 — E7b 관례)를 쓰고, finally에서 워크트리 폴더까지 정리한다.

- [x] **Step 1: E2E 추가.** 파일 끝(마지막 테스트 `'터미널 — 접었다 펴도 세션이 유지된다 (E7b)'`의 닫는 `})` 뒤)에 추가:

```ts

test('워크트리 탭 — 목록에 본체가 보이고 새로 만든다 (E7c)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'feature/login'], { cwd: repo })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  const repoName = repo.split('/').filter(Boolean).pop()!
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-worktrees').click()
    await expect(window.getByTestId(`worktree-row-${repoName}`)).toContainText('🏠')
    await expect(window.getByTestId(`worktree-row-${repoName}`)).toContainText('지금 여기')
    // 새 워크트리 — feature/login 기본 선택·경로 자동 제안
    await window.getByTestId('worktree-add').click()
    // 앱의 본체 경로는 git 실경로(/private/var/...)라 repo(/var/...)와 접두가 다르다 — 꼬리로 검증 (구현 편차)
    await expect(window.getByTestId('add-worktree-path')).toHaveValue(
      new RegExp(`${repoName}-feature-login$`),
    )
    await window.getByTestId('add-worktree-submit').click()
    await expect(window.getByTestId(`worktree-row-${repoName}-feature-login`)).toContainText(
      'feature/login',
    )
    const wtList = await execGitOrThrow(['worktree', 'list'], { cwd: repo })
    expect(wtList.stdout).toContain(`${repo}-feature-login`)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(`${repo}-feature-login`, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('워크트리 탭 — 클릭하면 새 터미널이 그 폴더에서 열린다 (E7c 핵심)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'feature/login'], { cwd: repo })
  await execGitOrThrow(['worktree', 'add', `${repo}-feature-login`, 'feature/login'], { cwd: repo })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  const repoName = repo.split('/').filter(Boolean).pop()!
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-worktrees').click()
    // 링크드 워크트리 행 클릭 = 활성 지정 + (기본 설정) 터미널 열림
    await window.getByTestId(`worktree-row-${repoName}-feature-login`).click()
    await expect(window.getByTestId(`worktree-row-${repoName}-feature-login`)).toContainText(
      '터미널 대상',
    )
    await expect(window.getByTestId('terminal-dock')).toBeVisible()
    await window.locator('.terminal-dock__view').first().click()
    await window.keyboard.type('pwd')
    await window.keyboard.press('Enter')
    // 새 세션의 cwd가 워크트리 폴더 — 터미널 연동의 핵심 검증
    // (macOS: pwd는 실경로 /private/var/...를 찍지만 repo(/var/...)를 부분 문자열로 포함한다)
    await expect(window.getByTestId('terminal-body')).toContainText(`${repo}-feature-login`, {
      timeout: 10_000,
    })
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(`${repo}-feature-login`, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('설정 — 앱 전체 전환으로 바꾸면 클릭 시 헤더·역사가 그 워크트리로 바뀐다 (E7c)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'feature/login'], { cwd: repo })
  await execGitOrThrow(['worktree', 'add', `${repo}-feature-login`, 'feature/login'], { cwd: repo })
  // 워크트리에서 저장을 하나 더 만들어 역사가 달라지게 한다
  await writeFile(join(`${repo}-feature-login`, 'wt.txt'), 'w\n')
  await execGitOrThrow(['add', '-A'], { cwd: `${repo}-feature-login` })
  await execGitOrThrow(['commit', '-m', '워크트리 전용 저장'], { cwd: `${repo}-feature-login` })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  const repoName = repo.split('/').filter(Boolean).pop()!
  try {
    const window = await app.firstWindow()
    // 설정 → 앱 전체 전환
    await window.getByTestId('settings-open').click()
    await window.getByTestId('settings-worktree-switch').click()
    await window.getByTestId('settings-close').click()
    await window.getByTestId('left-tab-worktrees').click()
    await window.getByTestId(`worktree-row-${repoName}-feature-login`).click()
    // 헤더 브랜치가 feature/login으로, 역사에 워크트리 전용 저장이 보인다
    await expect(window.getByTestId('history-list')).toContainText('워크트리 전용 저장', {
      timeout: 5_000,
    })
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(`${repo}-feature-login`, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('워크트리 탭 — 미저장 변경이 있으면 지우기가 2단 확인이다 (E7c)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'feature/login'], { cwd: repo })
  await execGitOrThrow(['worktree', 'add', `${repo}-feature-login`, 'feature/login'], { cwd: repo })
  await writeFile(join(`${repo}-feature-login`, 'dirty.txt'), 'd\n')
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  const repoName = repo.split('/').filter(Boolean).pop()!
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-worktrees').click()
    await window.getByTestId(`worktree-row-${repoName}-feature-login`).click({ button: 'right' })
    await window.getByTestId('context-remove').click()
    // 1차 확인 → 엔진이 needsForce → 2차(강제) 확인
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByRole('alertdialog')).toContainText('미저장 변경이 있어요')
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId(`worktree-row-${repoName}-feature-login`)).toHaveCount(0)
    const wtList = await execGitOrThrow(['worktree', 'list'], { cwd: repo })
    expect(wtList.stdout).not.toContain(`${repo}-feature-login`)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(`${repo}-feature-login`, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('감시 — 링크드 워크트리를 앱에서 열면 그 안의 외부 저장도 따라온다 (E7c 실버그 수정)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'feature/login'], { cwd: repo })
  await execGitOrThrow(['worktree', 'add', `${repo}-feature-login`, 'feature/login'], { cwd: repo })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  const repoName = repo.split('/').filter(Boolean).pop()!
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-worktrees').click()
    // 링크드 워크트리를 앱에서 연다(전체 전환) — 감시가 common-dir로 교체된다
    await window.getByTestId(`worktree-row-${repoName}-feature-login`).click({ button: 'right' })
    await window.getByTestId('context-open').click()
    await expect(window.getByTestId('history-count')).toHaveText('1', { timeout: 5_000 })
    // 열기(guard) 종료 직후 800ms는 설계된 자기-이벤트 억제 창(WATCH_SUPPRESS_MS=800) —
    // 그 안에 도착한 외부 이벤트는 버려지므로 창이 지난 뒤 커밋한다 (renderer 모듈은 e2e에서
    // import하지 않는 관례라 상수를 리터럴로 둔다) (구현 편차)
    await window.waitForTimeout(900)
    // 그 워크트리에서 밖으로 커밋 — 현행 감시(.git 파일)면 이벤트가 안 온다(실측 H1). common-dir 감시면 따라온다
    await execGitOrThrow(['commit', '--allow-empty', '-m', '워크트리 외부 저장'], {
      cwd: `${repo}-feature-login`,
    })
    await expect(window.getByTestId('history-count')).toHaveText('2', { timeout: 5_000 })
    await expect(window.getByTestId('history-list')).toContainText('워크트리 외부 저장')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(`${repo}-feature-login`, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
```

- [x] **Step 2: 게이트** — `cd apps/desktop && npx electron-vite build && npx playwright test e2e/smoke.spec.ts` → **56 passed**. 신규 5건 각각 단독(-g) 1회 non-flaky 확인. 루트 `pnpm test` → 427, `pnpm typecheck` Done.

- [x] **Step 3: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts
git commit -m "test(desktop): E7c E2E — 워크트리 목록·생성·클릭 터미널 cwd·앱 전환·지우기 2단·링크드 감시

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 최종 게이트 + 공식 스크린샷 2장 + README

- [x] **Step 1: 전체 게이트** — 순서대로 전부 exit 0:
  - 루트 `pnpm test` → **427 passed**
  - 루트 `pnpm typecheck` → 전 프로젝트 Done
  - `pnpm --filter @git-gui/desktop build`
  - `pnpm --filter @git-gui/desktop e2e` → **62 passed** (smoke 56 + hosting 6, 실행 내내 창 미노출)
  - `find apps/desktop/test-results -name 'last-screen-*.png'` → 0건

- [x] **Step 2: README 반영.** `README.md` 기존(E7b 문단 끝 문장):

```
터미널이나 다른 도구로 저장소를 바꾸면 .git 감시가 화면(변경·역사·실험 공간)을 자동으로 따라 갱신합니다.
```

교체:

```
터미널이나 다른 도구로 저장소를 바꾸면 .git 감시가 화면(변경·역사·실험 공간)을 자동으로 따라 갱신합니다. E7c로 좌측에 [워크트리] 탭이 생겨 워크트리를 1급으로 관리합니다 — 목록(브랜치·경로·지금 여기/터미널 대상 표시), 새로 만들기(체크아웃 안 된 실험 공간 선택·경로 자동 제안)·지우기(2단 확인), 클릭하면 그 폴더에서 새 터미널이 열리고(헤더 ⚙ 설정에서 "앱 전체 전환"으로 바꾸면 변경·역사도 그 워크트리 기준으로), 우클릭으로 터미널·앱 열기·Finder 보기까지 됩니다.
```

- [x] **Step 3: 공식 스크린샷 2장** — `test-results/` + scratchpad(`mkdir -p '<temporary-scratchpad>'`) 사본. **생성 후 e2e 재실행 금지.** 임시 파일 `apps/desktop/e2e/tmp-shots-e7c.spec.ts`:

```ts
// 임시 파일 — 공식 스크린샷 생성 후 삭제한다 (커밋 금지)
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { execGitOrThrow } from '@git-gui/git-process'

const APP_ROOT = join(__dirname, '..')
const SCRATCH =
  '<temporary-scratchpad>'

test('공식 스크린샷 — E7c 워크트리 탭·설정 모달 2장', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'git-gui-shot-'))
  await execGitOrThrow(['init', '--initial-branch=main'], { cwd: repo })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: repo })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'v1\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '첫 화면 저장'], { cwd: repo })
  await execGitOrThrow(['branch', 'feature/login'], { cwd: repo })
  await execGitOrThrow(['worktree', 'add', `${repo}-feature-login`, 'feature/login'], { cwd: repo })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-shot-data-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  const repoName = repo.split('/').filter(Boolean).pop()!
  try {
    const window = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.setSize(1440, 900)
    })
    await expect.poll(() => window.evaluate(() => window.innerWidth)).toBe(1440)
    // (1) 워크트리 탭 — 본체(🏠)+링크드(🌳)·브랜치·경로
    await window.getByTestId('left-tab-worktrees').click()
    await expect(window.getByTestId(`worktree-row-${repoName}`)).toContainText('🏠')
    await expect(window.getByTestId(`worktree-row-${repoName}-feature-login`)).toContainText('🌳')
    await window.screenshot({ path: 'test-results/e7c-worktrees-panel.png' })
    // (2) 설정 모달 — 카테고리 + 워크트리 선택 동작
    await window.getByTestId('settings-open').click()
    await expect(window.getByTestId('settings-dialog')).toBeVisible()
    await window.screenshot({ path: 'test-results/e7c-settings-dialog.png' })
    await copyFile('test-results/e7c-worktrees-panel.png', join(SCRATCH, 'e7c-worktrees-panel.png'))
    await copyFile('test-results/e7c-settings-dialog.png', join(SCRATCH, 'e7c-settings-dialog.png'))
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(`${repo}-feature-login`, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
```

실행·정리(재빌드 없이): `cd apps/desktop && npx playwright test e2e/tmp-shots-e7c.spec.ts` → `rm apps/desktop/e2e/tmp-shots-e7c.spec.ts` + `rm -rf apps/desktop/test-results/tmp-shots-e7c-*`. **육안 검수(Read로 실제 열람)**: (a) e7c-worktrees-panel — 좌측 워크트리 탭 활성, `🏠 <저장소>`(지금 여기)와 `🌳 <저장소>-feature-login`(feature/login 배지·경로) 두 행이 구분되어 보이는지, 중앙·우측 무변. (b) e7c-settings-dialog — 모달에 "일반" 카테고리 + "워크트리 선택 시 동작" 라디오 2개가 겹침·잘림 없이. 이후 e2e 재실행 금지.

- [x] **Step 4: Commit** (README만)

```bash
git add README.md
git commit -m "docs: README — E7c 워크트리 탭(목록·생성/제거·클릭 터미널 cwd·설정 모달) 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(플랜 문서는 실행을 마친 컨트롤러가 실행 기록을 붙여 별도 `docs:` 커밋으로 남긴다 — E7a·E7b 관례.)

## Self-review 수정 기록 (인라인 반영)

1. **스펙의 prune 별도 경로 폐기 — 실측 F로 반증.** prunable 항목도 `worktree remove`가 exit 0으로 그대로 정리한다. remove 하나로 통일(엔진·UI 단순화).
2. **감시의 링크드 워크트리 실버그(실측 H1) 수정을 Task 3에 독립.** 현행 `.git` 파일 감시는 링크드 워크트리에서 죽는다 — common-dir 재귀 감시 + worktrees/ 접두 정규화로 교체. 본체 감시 무회귀는 전 스위트 게이트로.
3. **보안 가드 `assertWorktreePath`** — openPath·terminal cwd·reveal 세 경로 모두 renderer가 임의 경로를 넘기지 못하게 워크트리 목록 대조. select 다이얼로그 없는 경로 열기의 유일한 방어.
4. **클릭 vs 우클릭 터미널 구분** — 행 클릭은 설정을 따르고(select), 우클릭 "여기서 터미널 열기"는 설정 무관 항상 터미널(terminal). WorktreeAction을 두 kind로 분리해 App에서 라우팅.
5. **활성 워크트리는 store가 아닌 App 로컬** — 터미널 대상 표시·세션 생성 인자에만 쓰이고 재시작 시 초기화(영속 불필요 — YAGNI).
6. **테스트 수 재검산** — worktree-parser 6 + client 4 + filter 3 + settings 1 + worktree-path 3 = +17 → 410+17=**427**. smoke 51 + 워크트리 5 = **56**, 전체 62.

## 인용 앵커 검증 기록

**스크립트 실검증(2026-07-23, main=6469669):** "기존:" 블록 전수 — 기준선 파일 정확 1회 매칭 **42개**, 선행 태스크 교체 산출 미래 앵커 2개, 나머지 1개는 신규 삽입 헬퍼(rmDir — 앵커 아님, 정규식 오검출). 실 불일치 0. 오타 함정 없음.

작성 시점(main=6469669) 실측 원문에서 발췌한 앵커: domain(RebaseProgress 꼬리), client.ts(import 2곳·rebase 인터페이스/런타임 꼬리), client.test.ts(rebase.abort 테스트 꼬리), ipc-contract(repo 블록 꼬리·CHANNELS repoWatch/repoChanged·AppSettings/sanitizeSettings·TerminalApi.create·SETTINGS 꼬리), git-handlers(assertString·repoWatch 핸들러 전문·repoWatch 내부 watchRepository 줄), preload(repo onChanged 꼬리·terminalApi.create), store(상태 필드 rebaseProgress·액션 선언 abortRebase·fetchSnapshot 전문·초기 상태 rebaseProgress·abortRebase 구현), terminal-handlers(import·create 핸들러 선두), use-terminal-sessions(create 선두·setTabs 줄), watch-filter(isRelevantGitEvent 전문·마지막 필터 테스트), repo-watcher(import+watch 줄), App.tsx(lucide import·BranchesPanel import·TerminalDock import·leftTab useState·도크 상태 주석·헤더 터미널 버튼 꼬리·좌측 탭 실험 공간 버튼·BranchesPanel 삼항 종료·TerminalDock 렌더). **미확정 앵커(구현 시 grep 후 편차 보고 지정): git-handlers의 electron import 줄(shell 추가)·assertBoolean 존재·store import 목록·ipc-contract import 목록·BranchesPanel 삼항 종료의 정확한 `)}` 위치(Task 6 Step 9).** Task 4·5·6는 선행 태스크가 만든 앵커에 의존한다(순서 엄수 — 예: Task 6의 TerminalDock activeWorktree 줄은 Task 5가 넣은 `activeWorktree={null}`이다).

## 후속 노트 (이관 후보)

- **새 브랜치 동시 생성 워크트리** — 현재는 체크아웃 안 된 기존 브랜치만. `worktree add -b`로 새 브랜치까지 검토.
- **워크트리별 dirty 표시** — 행에 미저장 변경 배지(각 워크트리 status 조회 비용 — lazy).
- **활성 워크트리 영속** — 재시작 시 마지막 터미널 대상 복원 검토.
- **설정 카테고리 확장** — 테마·스타일(테마 토글 이관)·프로필. 설정 검색.
- **openPath의 감시 교체 후 이전 저장소 세션** — 전체 전환 시 기존 터미널 세션은 이전 cwd 그대로(E7b 후속과 동일). 탭 라벨에 저장소 병기 검토.
- **prunable 자동 정리 안내** — 없어진 폴더 배지에 "정리하기" 바로가기.
- **Finder 보기의 크로스 플랫폼** — showItemInFolder는 OS별 동작. Windows/Linux 확인.

## 실행 기록 (2026-07-23, 인라인 실행 — feature/e7c-worktrees)

**실행 방식 전환:** 서브에이전트 방식으로 Task 1·2를 완료(스펙 byte-match 리뷰·적대 품질 리뷰 모두 통과)했으나 사용자 지시("task1부터 다시해")로 **플랜 커밋(9abca99)으로 리셋 후 전 태스크를 인라인 재실행**했다. 재실행 산출물은 서브에이전트 산출물과 동일 설계(플랜 정본 byte-match).

| Task | 커밋 | 게이트 실측 |
| --- | --- | --- |
| 1 엔진 | (재실행) | git-adapter 210 · 루트 **420** · typecheck Done |
| 2 IPC·store | (재실행) | **420** 유지 · typecheck · build |
| 3 감시 호환 | — | **423** · smoke **51**(본체 감시 무회귀) |
| 4 설정 모달 | — | **424** · build |
| 5 터미널 cwd | 6a4665e | **424** 유지 · smoke **51** |
| 6 워크트리 탭 | 6c43567 | **427** · smoke **51** |
| 7 E2E 5건 | 40c7f6c | smoke **56** |
| 8 최종 | 4a12c51·fac40cf | **427** · typecheck 6 Done · E2E **62** · last-screen 0 · 스크린샷 2장 육안 검수 |

**구현 편차(전부 본문에 레트로 반영):**
1. **Task 1 (macOS 실경로):** `os.tmpdir()`는 `/var/...` 미해석 경로지만 git은 워크트리 경로를 실경로(`/private/var/...`)로 정규화한다 — worktrees.list 테스트는 `rev-parse --show-toplevel` 실경로로 비교(테스트 한정, 프로덕션 무편차). client.test.ts import에 `rm` 추가(플랜 예고 조건 분기).
2. **Task 6 (삼항 체인):** 플랜 Step 9 주의문대로 BranchesPanel 분기 앞 `) : (`를 `) : leftTab === 'branches' ? (`로 명시해야 3분기 체인이 성립 — 그렇게 구현.
3. **Task 7 (E2E 2건 보정):** ① 경로 자동 제안 검증은 실경로 차이로 `toHaveValue(RegExp 꼬리)`로, 무의미했던 `worktree-row-app.txt` 검증 제거. ⑤ openWorktree(guard) 직후 외부 커밋이 **설계된 800ms 자기-이벤트 억제 창**(WATCH_SUPPRESS_MS)에 걸려 결정적으로 실패 → 커밋 전 900ms 대기(감시 억제는 의도된 동작 — 테스트가 설계를 따라감).
4. **Task 8 (스크린샷 검수발 폴리시, 4a12c51):** "터미널 대상" 칩이 좁은 행에서 2줄로 꺾임 → `.worktree-row__top .ui-badge { nowrap }`. 설정 모달 폭 560px이 `.ui-modal`이 아닌 내부 `.ui-dialog`(기본 340px)에 걸려야 적용 → 셀렉터 수정. 공식 샷 1번에 `pwd` 실행을 추가해 워크트리 cwd를 화면으로 실증.
5. **E2E 안정성:** 최종 풀 스위트 첫 실행에서 1건 실패(원인 미상 플레이크 — 아티팩트가 다음 실행에 덮여 미보존), 이후 **3연속 62 클린**. 후속 노트에 플레이크 관찰 항목 추가.

**후속 노트 추가분:** 최종 E2E 1회성 플레이크 관찰(재현 시 아티팩트 보존 후 원인 추적).
