# E0-2 저장된 역사·백업·메시지 제안 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 저장된 역사(log) 패널을 실제 데이터로 채우고, 백업(push)을 추가하고, 저장 메시지를 규칙 기반으로 자동 제안한다 — 스펙 11장 E0 로드맵의 나머지.

**Architecture:** 기존 계층 그대로 확장한다. domain에 CommitSummary 타입과 suggestCommitMessage 순수 함수, git-adapter에 log 파서(`%x1f` 필드 구분 + `-z` 레코드 구분)와 history.list/sync.push, IPC 계약·핸들러(allowlist + unknown 검증 유지), renderer는 스토어가 status와 history를 함께 스냅샷으로 갱신하고 HistoryPanel·백업 버튼·제안 연동을 붙인다. push 테스트는 GIT_SCENARIOS fixture 원칙대로 로컬 bare remote를 사용한다.

**Tech Stack:** 기존과 동일 (신규 의존성 없음).

**참조:** docs/superpowers/specs/2026-07-15-easy-mode-design.md 8장(메시지 자동 제안 — 로컬 규칙 기반, 빈 메시지면 제안이 대신 들어감)·11장(E0), docs/GIT_SCENARIOS.md fixture 원칙(로컬 bare remote).

**이번 범위가 아닌 것 (E0-1 후속 노트에서 이관하지 않는 항목 포함):** 히스토리 점진 로딩("더 보기" — 지금은 최근 50개), push 진행률·취소(네트워크 원격은 1단계 취소 가능 프로세스와 함께), AI 메시지 제안(스펙상 선택 옵션 — 후속), 테마 토글, 충돌 마커 시각 처리. **백업 버튼의 위험 표시**: 이번 push는 force가 아니므로 위험 동작 구분 불필요.

**알려진 한계(의도적):** HistoryPanel의 상대 시간은 렌더 시점 기준이며 자동 갱신되지 않는다(새로고침·작업 시 갱신). 원격이 여러 개면 첫 번째 remote로 백업한다. non-fast-forward 거절 시 git 원문 에러가 노출된다 — 최신 받아오기(pull)와 구조화 에러가 생기는 1단계에서 친절한 안내로 교체한다.

---

## 파일 구조

```
packages/domain/src/
  repository.ts             # CommitSummary 타입 추가
  commit-message.ts         # suggestCommitMessage (신규, 순수)
packages/domain/test/commit-message.test.ts
packages/git-adapter/src/
  log-parser.ts             # parseLog (신규, 순수)
  client.ts                 # history.list / sync.push 추가
packages/git-adapter/test/log-parser.test.ts
packages/git-adapter/test/fixture.ts        # createFixtureRepoWithRemote 추가
packages/git-adapter/test/client.test.ts    # history/push 통합 테스트 추가
packages/ipc-contract/src/index.ts           # history/sync 계약 + 채널
apps/desktop/src/main/git-handlers.ts        # 핸들러 2개 + assertLimit
apps/desktop/src/preload/index.ts            # 브리지 2개
apps/desktop/src/renderer/src/
  components/relative-time.ts                # formatRelativeTime (신규, 순수)
  components/HistoryPanel.tsx + history-panel.css   # HistoryPlaceholder 대체
  components/CommitForm.tsx                  # suggestion 연동
  store/repository-store.ts                  # history 상태 + fetchSnapshot + backup
  App.tsx                                    # 백업 버튼 + HistoryPanel + suggestion
  layout.css                                 # app__actions flex
apps/desktop/test/relative-time.test.ts
apps/desktop/e2e/smoke.spec.ts               # 백업·역사·제안 검증 확장 (테스트 2개)
삭제: components/HistoryPlaceholder.tsx + history-placeholder.css
```

---

### Task 1: domain — CommitSummary 타입과 저장 메시지 제안

**Files:**
- Modify: `packages/domain/src/repository.ts` (CommitSummary 추가)
- Create: `packages/domain/src/commit-message.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/commit-message.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/domain/test/commit-message.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { FileChange } from '../src/repository'
import { suggestCommitMessage } from '../src/commit-message'

function staged(path: string, kind: FileChange['staged']): FileChange {
  return { path, origPath: null, staged: kind, unstaged: null }
}

function unstagedOnly(path: string): FileChange {
  return { path, origPath: null, staged: null, unstaged: 'modified' }
}

describe('suggestCommitMessage', () => {
  it('staged가 없으면 빈 문자열 — 제안 없음', () => {
    expect(suggestCommitMessage([])).toBe('')
    expect(suggestCommitMessage([unstagedOnly('a.ts')])).toBe('')
  })

  it('파일 1개: "파일명 동사" 형태', () => {
    expect(suggestCommitMessage([staged('app.txt', 'modified')])).toBe('app.txt 수정')
    expect(suggestCommitMessage([staged('login.css', 'added')])).toBe('login.css 추가')
    expect(suggestCommitMessage([staged('old.ts', 'deleted')])).toBe('old.ts 삭제')
  })

  it('이름 변경 1개는 원래 이름을 함께 보여준다', () => {
    expect(
      suggestCommitMessage([
        { path: 'src/new.ts', origPath: 'src/old.ts', staged: 'renamed', unstaged: null },
      ]),
    ).toBe('old.ts → new.ts 이름 변경')
    // 원래 이름을 알 수 없으면 새 이름만
    expect(suggestCommitMessage([staged('new.ts', 'renamed')])).toBe('new.ts 이름 변경')
  })

  it('부분 스테이징(staged+unstaged 동시)은 1개로 집계된다', () => {
    expect(
      suggestCommitMessage([
        { path: 'a.ts', origPath: null, staged: 'modified', unstaged: 'modified' },
      ]),
    ).toBe('a.ts 수정')
  })

  it('중첩 경로는 파일명(basename)만 쓴다', () => {
    expect(suggestCommitMessage([staged('src/ui/Button.tsx', 'modified')])).toBe('Button.tsx 수정')
  })

  it('여러 파일, 같은 종류: "첫 파일 외 N개 동사"', () => {
    expect(
      suggestCommitMessage([staged('a.ts', 'modified'), staged('b.ts', 'modified')]),
    ).toBe('a.ts 외 1개 수정')
  })

  it('여러 파일, 종류 혼합: 동사는 "변경"', () => {
    expect(
      suggestCommitMessage([
        staged('a.ts', 'modified'),
        staged('b.ts', 'added'),
        staged('c.ts', 'deleted'),
      ]),
    ).toBe('a.ts 외 2개 변경')
  })

  it('unstaged 항목은 제안에 포함되지 않는다', () => {
    expect(
      suggestCommitMessage([staged('a.ts', 'modified'), unstagedOnly('b.ts')]),
    ).toBe('a.ts 수정')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test`
Expected: FAIL — `Cannot find module '../src/commit-message'` (기존 77개 통과)

- [ ] **Step 3: 구현**

`packages/domain/src/repository.ts` 끝에 추가:
```ts
/** 저장된 역사 한 항목 — log의 요약 */
export interface CommitSummary {
  hash: string
  shortHash: string
  subject: string
  authorName: string
  /** epoch 초 */
  committedAt: number
}
```

`packages/domain/src/commit-message.ts`:
```ts
import type { ChangeKind, FileChange } from './repository'

const KIND_VERBS: Record<ChangeKind, string> = {
  modified: '수정',
  added: '추가',
  deleted: '삭제',
  renamed: '이름 변경',
  copied: '복사',
  typechange: '형식 변경',
  untracked: '추가',
  conflicted: '변경',
}

function basename(path: string): string {
  const index = path.lastIndexOf('/')
  return index >= 0 ? path.slice(index + 1) : path
}

/**
 * staged 변경으로 저장 메시지를 규칙 기반으로 제안한다 (스펙 8장).
 * staged가 없으면 빈 문자열 — 제안 없음. 빈 메시지로 저장하면 이 제안이 대신 들어간다.
 */
export function suggestCommitMessage(changes: FileChange[]): string {
  const stagedChanges = changes.filter((change) => change.staged !== null)
  if (stagedChanges.length === 0) return ''
  const first = stagedChanges[0]!
  const firstVerb = KIND_VERBS[first.staged!]
  if (stagedChanges.length === 1) {
    // 이름 변경은 "무엇이었는지"가 핵심 정보다 — 원래 이름을 함께 보여준다
    if (first.staged === 'renamed' && first.origPath !== null) {
      return `${basename(first.origPath)} → ${basename(first.path)} 이름 변경`
    }
    return `${basename(first.path)} ${firstVerb}`
  }
  const allSameKind = stagedChanges.every((change) => change.staged === first.staged)
  const verb = allSameKind ? firstVerb : '변경'
  return `${basename(first.path)} 외 ${stagedChanges.length - 1}개 ${verb}`
}
```

`packages/domain/src/index.ts` 전체 교체:
```ts
export * from './repository'
export * from './state'
export * from './commit-message'
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test && pnpm typecheck`
Expected: **85 tests** (77 + 8), typecheck 5개 — 전부 exit 0

- [ ] **Step 5: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): CommitSummary 타입과 규칙 기반 저장 메시지 제안

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: git-adapter — log 파서와 history.list

**Files:**
- Create: `packages/git-adapter/src/log-parser.ts`
- Modify: `packages/git-adapter/src/client.ts`, `packages/git-adapter/src/index.ts`
- Test: `packages/git-adapter/test/log-parser.test.ts`, `packages/git-adapter/test/client.test.ts`(추가)

- [ ] **Step 1: 실패하는 파서 테스트 작성**

`packages/git-adapter/test/log-parser.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseLog } from '../src/log-parser'

const US = '\x1f'

function record(hash: string, short: string, author: string, epoch: string, subject: string) {
  return [hash, short, author, epoch, subject].join(US)
}

describe('parseLog', () => {
  it('빈 출력이면 빈 배열', () => {
    expect(parseLog('')).toEqual([])
  })

  it('레코드를 CommitSummary로 변환한다', () => {
    const raw = record('a'.repeat(40), 'abc1234', '홍길동', '1752561600', 'feat: 첫 커밋') + '\0'
    expect(parseLog(raw)).toEqual([
      {
        hash: 'a'.repeat(40),
        shortHash: 'abc1234',
        authorName: '홍길동',
        committedAt: 1752561600,
        subject: 'feat: 첫 커밋',
      },
    ])
  })

  it('여러 레코드의 순서를 보존한다', () => {
    const raw =
      record('a'.repeat(40), 'aaaaaaa', 'A', '200', '두 번째') +
      '\0' +
      record('b'.repeat(40), 'bbbbbbb', 'B', '100', '첫 번째') +
      '\0'
    const commits = parseLog(raw)
    expect(commits.map((c) => c.subject)).toEqual(['두 번째', '첫 번째'])
  })

  it('subject에 필드 구분자가 섞여도 나머지를 subject로 합친다', () => {
    const raw = record('a'.repeat(40), 'abc1234', 'A', '100', `제목${US}에 구분자`) + '\0'
    expect(parseLog(raw)[0]?.subject).toBe(`제목${US}에 구분자`)
  })

  it('필드가 모자라거나 시간이 숫자가 아닌 기형 레코드는 건너뛴다', () => {
    const raw = ['broken', record('a'.repeat(40), 'abc1234', 'A', 'not-a-number', 'x')].join('\0') + '\0'
    expect(parseLog(raw)).toEqual([])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test`
Expected: FAIL — `Cannot find module '../src/log-parser'`

- [ ] **Step 3: 파서 구현**

`packages/git-adapter/src/log-parser.ts`:
```ts
import type { CommitSummary } from '@git-gui/domain'

const FIELD_SEPARATOR = '\x1f'

/**
 * `git log --format=%H%x1f%h%x1f%an%x1f%ct%x1f%s -z` 출력을 파싱한다.
 * 레코드는 NUL, 필드는 US(0x1f)로 구분된다. %s(subject)는 git이 한 줄로 정리해 준다.
 * 기형 레코드는 추측해 채우지 않고 건너뛴다.
 */
export function parseLog(rawOutput: string): CommitSummary[] {
  const records = rawOutput.split('\0')
  if (records.length > 0 && records[records.length - 1] === '') records.pop()

  const commits: CommitSummary[] = []
  for (const record of records) {
    const fields = record.split(FIELD_SEPARATOR)
    if (fields.length < 5) continue
    const committedAt = Number(fields[3])
    if (!Number.isFinite(committedAt)) continue
    commits.push({
      hash: fields[0]!,
      shortHash: fields[1]!,
      authorName: fields[2]!,
      committedAt,
      // subject에 구분자가 섞이는 일은 없지만 방어적으로 나머지를 합친다
      subject: fields.slice(4).join(FIELD_SEPARATOR),
    })
  }
  return commits
}
```

- [ ] **Step 4: 실패하는 history 통합 테스트 추가**

`packages/git-adapter/test/client.test.ts`의 describe('GitClient') 안에 추가:
```ts
  it('history — 최신순 목록을 반환하고 limit을 지킨다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'a.txt', '1\n')
    await client.changes.stage(['a.txt'])
    await client.commits.create('두 번째 저장')

    const all = await client.history.list(50)
    expect(all.map((c) => c.subject)).toEqual(['두 번째 저장', 'init'])
    expect(all[0]?.shortHash.length).toBeGreaterThanOrEqual(7)
    expect(all[0]?.committedAt).toBeGreaterThan(0)

    const limited = await client.history.list(1)
    expect(limited.map((c) => c.subject)).toEqual(['두 번째 저장'])

    // NaN 같은 비유한수는 기본값(50)으로 동작해야 한다 — --max-count=NaN 방지
    const withNaN = await client.history.list(Number.NaN)
    expect(withNaN.map((c) => c.subject)).toEqual(['두 번째 저장', 'init'])
  })

  it('history — 커밋이 없는 저장소(unborn)는 빈 목록이다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'git-gui-unborn-'))
    await execGitOrThrow(['init', '--initial-branch=main'], { cwd: dir })
    const commits = await createGitClient(dir).history.list(50)
    expect(commits).toEqual([])
  })
```
상단 import에 `tmpdir` 추가: `import { tmpdir } from 'node:os'`, 그리고 `mkdtemp`를 `node:fs/promises` import에 추가.

- [ ] **Step 5: client 구현**

`packages/git-adapter/src/client.ts`:

(a) import에 CommitSummary 추가:
```ts
import {
  detectState,
  type CommitSummary,
  type DiffOptions,
  type RepositoryStatus,
} from '@git-gui/domain'
```

(b) GitClient 인터페이스에 추가 (changes 다음):
```ts
  history: {
    /** 최신순 커밋 요약. limit은 1~500으로 잘린다 */
    list(limit: number): Promise<CommitSummary[]>
  }
```

(c) createGitClient 반환 객체의 changes 다음에 추가:
```ts
    history: {
      async list(limit) {
        const cwd = await topLevel()
        // NaN은 min/max를 그대로 통과한다 — 유한수가 아니면 기본값으로
        const safeLimit = Number.isFinite(limit)
          ? Math.min(Math.max(Math.trunc(limit), 1), 500)
          : 50
        const args = [
          'log',
          `--max-count=${safeLimit}`,
          '--no-show-signature',
          '--format=%H%x1f%h%x1f%an%x1f%ct%x1f%s',
          '-z',
        ]
        const result = await execGit(args, { cwd })
        if (result.exitCode !== 0) {
          // 아직 커밋이 없는 저장소(unborn HEAD)는 빈 역사다 — 에러로 위장하지 않는다
          if (result.stderr.includes('does not have any commits')) return []
          throw new GitError(args, result)
        }
        return parseLog(result.stdout)
      },
    },
```

(d) 파일 상단 import에 추가:
```ts
import { parseLog } from './log-parser'
```

`packages/git-adapter/src/index.ts` 전체 교체:
```ts
export * from './status-parser'
export * from './client'
export * from './markers'
export * from './log-parser'
```

- [ ] **Step 6: 통과 확인**

Run: `pnpm test && pnpm typecheck`
Expected: **92 tests** (85 + 파서 5 + history 2), typecheck 5개 — 전부 exit 0

- [ ] **Step 7: Commit**

```bash
git add packages/git-adapter
git commit -m "feat(git-adapter): log 파서와 history.list — unborn은 빈 목록

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 8 (리뷰 반영): git-process 로케일 고정**

unborn 감지가 stderr 문자열 매칭인데, 번역 카탈로그가 있는 git(Homebrew·Linux) + 한국어 로케일에서는 메시지가 번역되어 오판된다. `packages/git-process/src/exec.ts`의 env 주입에 한 줄 추가:
```ts
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_OPTIONAL_LOCKS = '0'
  env.GIT_EDITOR = 'true' // 에디터를 여는 명령이 GUI를 행시키지 않도록
  env.LC_ALL = 'C' // stderr 메시지를 영어로 고정 — unborn 감지 등 문자열 매칭의 로케일 의존 제거
```
커밋:
```bash
git add packages/git-process/src/exec.ts
git commit -m "fix(git-process): LC_ALL=C 고정 — stderr 문자열 매칭의 로케일 의존 제거

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: git-adapter — sync.push (로컬 bare remote fixture)

**Files:**
- Modify: `packages/git-adapter/src/client.ts`
- Modify: `packages/git-adapter/test/fixture.ts` (remote fixture 추가)
- Test: `packages/git-adapter/test/client.test.ts`(추가)

- [ ] **Step 1: fixture 확장**

`packages/git-adapter/test/fixture.ts` 끝에 추가 (상단 import에 `execGitOrThrow`는 이미 있음):
```ts
/** GIT_SCENARIOS fixture 원칙 — 네트워크 대신 로컬 bare remote로 push를 검증한다 */
export async function createFixtureRepoWithRemote(): Promise<{ repo: string; remote: string }> {
  const repo = await createFixtureRepo()
  const remote = await mkdtemp(join(tmpdir(), 'git-gui-remote-'))
  await execGitOrThrow(['init', '--bare', '--initial-branch=main'], { cwd: remote })
  await execGitOrThrow(['remote', 'add', 'origin', remote], { cwd: repo })
  return { repo, remote }
}
```
(fixture.ts 상단에는 `mkdtemp`/`tmpdir`/`join`이 이미 import되어 있다 — 추가 불필요)

- [ ] **Step 2: 실패하는 push 테스트 추가**

`packages/git-adapter/test/client.test.ts`의 describe('GitClient') 안에 추가 (import에 `createFixtureRepoWithRemote` 추가):
```ts
  it('push — 첫 백업은 upstream을 연결하며 올리고, 이후는 그대로 push한다', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)

    await client.sync.push()
    let remoteLog = await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: remote })
    expect(remoteLog.stdout.trim()).toBe('init')

    const status = await client.repo.status()
    expect(status.branch.upstream).toBe('origin/main')
    expect(status.branch.ahead).toBe(0)
    expect(status.branch.behind).toBe(0)

    await writeFixtureFile(repo, 'b.txt', '1\n')
    await client.changes.stage(['b.txt'])
    await client.commits.create('둘째')
    await client.sync.push()
    remoteLog = await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: remote })
    expect(remoteLog.stdout.trim()).toBe('둘째')
  })

  it('push — 원격이 없으면 친절한 에러를 던진다', async () => {
    const repo = await createFixtureRepo()
    await expect(createGitClient(repo).sync.push()).rejects.toThrow('원격 저장소가 없어요')
  })

  it('push — detached HEAD에서는 읽히는 에러를 던진다', async () => {
    const { repo } = await createFixtureRepoWithRemote()
    await execGitOrThrow(['checkout', '--detach'], { cwd: repo })
    await expect(createGitClient(repo).sync.push()).rejects.toThrow('브랜치가 아닌 시점')
  })
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm test`
Expected: FAIL — sync 미정의 (typecheck 에러 또는 런타임 undefined)

- [ ] **Step 4: 구현**

`packages/git-adapter/src/client.ts`:

(a) GitClient 인터페이스에 추가 (history 다음):
```ts
  sync: {
    /** 현재 브랜치를 원격으로 백업한다. upstream이 없으면 첫 remote에 연결하며 올린다 */
    push(): Promise<void>
  }
```

(b) createGitClient 반환 객체의 history 다음에 추가:
```ts
    sync: {
      async push() {
        const cwd = await topLevel()
        const remotes = await execGitOrThrow(['remote'], { cwd })
        const firstRemote = remotes.stdout.trim().split('\n')[0] ?? ''
        if (firstRemote === '') {
          throw new Error('백업할 원격 저장소가 없어요. 먼저 원격 저장소를 연결해 주세요.')
        }
        const upstream = await execGit(
          ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
          { cwd },
        )
        if (upstream.exitCode === 0) {
          await execGitOrThrow(['push'], { cwd })
          return
        }
        // detached HEAD에서는 올릴 브랜치가 없다 — 원문 git 에러 대신 읽히는 메시지로
        const branch = await execGit(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd })
        if (branch.exitCode !== 0) {
          throw new Error('지금은 브랜치가 아닌 시점에 있어요. 브랜치로 이동한 뒤 백업해 주세요.')
        }
        // 첫 백업 — 현재 브랜치를 remote에 연결하며 올린다 (이후 ahead/behind가 표시된다)
        await execGitOrThrow(['push', '-u', firstRemote, 'HEAD'], { cwd })
      },
    },
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm test && pnpm typecheck`
Expected: **95 tests**, typecheck 5개 — 전부 exit 0

- [ ] **Step 6: Commit**

```bash
git add packages/git-adapter
git commit -m "feat(git-adapter): sync.push — 첫 백업 시 upstream 연결, bare remote 테스트

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: IPC 계약·핸들러·preload — history/sync

**Files:**
- Modify: `packages/ipc-contract/src/index.ts`
- Modify: `apps/desktop/src/main/git-handlers.ts`
- Modify: `apps/desktop/src/preload/index.ts`

- [ ] **Step 1: 계약 확장**

`packages/ipc-contract/src/index.ts`:

(a) import를 다음으로 교체:
```ts
import type { CommitSummary, DiffOptions, RepositoryStatus } from '@git-gui/domain'
```

(b) GitApi의 commits 다음에 추가:
```ts
  history: {
    /** 최신순 커밋 요약 (limit 1~500) */
    list(repoPath: string, limit: number): Promise<CommitSummary[]>
  }
  sync: {
    /** 현재 브랜치를 원격으로 백업(push). 원격이 없으면 에러 */
    push(repoPath: string): Promise<void>
  }
```

(c) CHANNELS에 추가:
```ts
  historyList: 'history:list',
  syncPush: 'sync:push',
```

- [ ] **Step 2: main 핸들러**

`apps/desktop/src/main/git-handlers.ts`:

(a) 검증 헬퍼 추가 (assertDiffOptions 다음):
```ts
function assertLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 500) {
    throw new Error('잘못된 요청 형식이에요.')
  }
  return value
}
```

(b) registerGitHandlers 끝(commitsCreate 다음)에 추가:
```ts
  ipcMain.handle(CHANNELS.historyList, (_event, repoPath: unknown, limit: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).history.list(assertLimit(limit)),
  )

  ipcMain.handle(CHANNELS.syncPush, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).sync.push(),
  )
```

- [ ] **Step 3: preload 브리지**

`apps/desktop/src/preload/index.ts`의 api 객체 commits 다음에 추가:
```ts
  history: {
    list: (repoPath, limit) => ipcRenderer.invoke(CHANNELS.historyList, repoPath, limit),
  },
  sync: {
    push: (repoPath) => ipcRenderer.invoke(CHANNELS.syncPush, repoPath),
  },
```

- [ ] **Step 4: 검증**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build`
Expected: 95 tests, typecheck 5개, build — 전부 exit 0

- [ ] **Step 5: Commit**

```bash
git add packages/ipc-contract apps/desktop/src/main/git-handlers.ts apps/desktop/src/preload/index.ts
git commit -m "feat(desktop): history/sync IPC — limit 검증 포함

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: renderer — 상대 시간 유틸과 스토어 확장

**Files:**
- Create: `apps/desktop/src/renderer/src/components/relative-time.ts`
- Test: `apps/desktop/test/relative-time.test.ts`
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`

- [ ] **Step 1: 실패하는 상대 시간 테스트**

`apps/desktop/test/relative-time.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from '../src/renderer/src/components/relative-time'

const NOW_MS = 1_752_600_000_000 // 고정 기준 시각

function at(secondsAgo: number): number {
  return Math.floor(NOW_MS / 1000) - secondsAgo
}

describe('formatRelativeTime', () => {
  it('1분 미만은 방금 전', () => {
    expect(formatRelativeTime(at(5), NOW_MS)).toBe('방금 전')
    expect(formatRelativeTime(at(59), NOW_MS)).toBe('방금 전')
  })

  it('분 단위', () => {
    expect(formatRelativeTime(at(60), NOW_MS)).toBe('1분 전')
    expect(formatRelativeTime(at(59 * 60), NOW_MS)).toBe('59분 전')
  })

  it('시간 단위', () => {
    expect(formatRelativeTime(at(60 * 60), NOW_MS)).toBe('1시간 전')
    expect(formatRelativeTime(at(23 * 60 * 60), NOW_MS)).toBe('23시간 전')
  })

  it('하루면 어제, 일주일 미만은 N일 전', () => {
    expect(formatRelativeTime(at(24 * 60 * 60), NOW_MS)).toBe('어제')
    expect(formatRelativeTime(at(3 * 24 * 60 * 60), NOW_MS)).toBe('3일 전')
  })

  it('일주일 이상은 날짜로', () => {
    const epoch = at(30 * 24 * 60 * 60)
    const date = new Date(epoch * 1000)
    expect(formatRelativeTime(epoch, NOW_MS)).toBe(
      `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`,
    )
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`apps/desktop/src/renderer/src/components/relative-time.ts`:
```ts
/** epoch 초를 한국어 상대 시간으로 바꾼다 — 표시 전용, 렌더 시점(nowMs) 기준 */
export function formatRelativeTime(epochSeconds: number, nowMs: number): string {
  const diffSeconds = Math.floor(nowMs / 1000) - epochSeconds
  if (diffSeconds < 60) return '방금 전'
  const minutes = Math.floor(diffSeconds / 60)
  if (minutes < 60) return `${minutes}분 전`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}시간 전`
  const days = Math.floor(hours / 24)
  if (days === 1) return '어제'
  if (days < 7) return `${days}일 전`
  const date = new Date(epochSeconds * 1000)
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`
}
```

- [ ] **Step 4: 스토어 확장**

`apps/desktop/src/renderer/src/store/repository-store.ts` 전체 교체:
```ts
import { create } from 'zustand'
import type { CommitSummary, FileChange, RepositoryStatus } from '@git-gui/domain'

const git = () => window.gitApi

const HISTORY_LIMIT = 50

export interface SelectedFile {
  change: FileChange
  staged: boolean
}

interface RepositoryStore {
  repoPath: string | null
  status: RepositoryStatus | null
  history: CommitSummary[]
  selected: SelectedFile | null
  diffText: string
  error: string | null
  busy: boolean

  init(): Promise<void>
  openRepository(): Promise<void>
  refresh(): Promise<void>
  stage(paths: string[]): Promise<void>
  unstage(paths: string[]): Promise<void>
  selectFile(selected: SelectedFile): Promise<void>
  /** 성공 여부를 반환한다 — 실패 시 입력 메시지를 보존하기 위해 */
  commit(message: string): Promise<boolean>
  backup(): Promise<void>
}

/** IPC 에러 메시지의 Electron 래핑 접두사를 벗겨 사용자 메시지만 남긴다 (GitError 등 커스텀 이름 포함) */
function toErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
}

/** 상태와 역사를 함께 스냅샷으로 읽는다 — 화면이 서로 다른 시점을 섞어 보여주지 않게 */
async function fetchSnapshot(
  repoPath: string,
): Promise<Pick<RepositoryStore, 'status' | 'history'>> {
  const [status, history] = await Promise.all([
    git().repo.status(repoPath),
    git().history.list(repoPath, HISTORY_LIMIT),
  ])
  return { status, history }
}

type StoreSet = (partial: Partial<RepositoryStore>) => void
type StoreGet = () => RepositoryStore

/** busy 재진입을 거부하고 busy/error 처리를 일원화한다. 성공 여부를 반환한다 */
async function guard(set: StoreSet, get: StoreGet, run: () => Promise<void>): Promise<boolean> {
  if (get().busy) return false
  set({ busy: true, error: null })
  try {
    await run()
    return true
  } catch (cause) {
    set({ error: toErrorMessage(cause) })
    return false
  } finally {
    set({ busy: false })
  }
}

export const useRepositoryStore = create<RepositoryStore>((set, get) => ({
  repoPath: null,
  status: null,
  history: [],
  selected: null,
  diffText: '',
  error: null,
  busy: false,

  async init() {
    await guard(set, get, async () => {
      const initial = await git().repo.initialPath()
      if (!initial) return
      set({ repoPath: initial, ...(await fetchSnapshot(initial)) })
    })
  },

  async openRepository() {
    await guard(set, get, async () => {
      const path = await git().repo.select()
      if (!path) return
      // guard가 재진입을 거부하므로 refresh()를 부르지 않고 직접 조회한다
      set({ repoPath: path, selected: null, diffText: '', ...(await fetchSnapshot(path)) })
    })
  },

  async refresh() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      // 외부(CLI 등)에서 상태가 바뀌었을 수 있다 — 보고 있던 diff도 함께 무효화한다
      set({ selected: null, diffText: '', ...(await fetchSnapshot(repoPath)) })
    })
  },

  async stage(paths) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().changes.stage(repoPath, paths)
      // stage 후에는 보고 있던 diff의 의미가 달라진다(오인 커밋 방지) — 선택을 비운다
      set({ selected: null, diffText: '', ...(await fetchSnapshot(repoPath)) })
    })
  },

  async unstage(paths) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().changes.unstage(repoPath, paths)
      set({ selected: null, diffText: '', ...(await fetchSnapshot(repoPath)) })
    })
  },

  async selectFile(selected) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      const untracked = selected.change.unstaged === 'untracked'
      const diffText = await git().changes.diff(repoPath, selected.change.path, {
        staged: selected.staged,
        untracked,
      })
      set({ selected, diffText })
    })
  },

  async commit(message) {
    const { repoPath } = get()
    if (!repoPath) return false
    return guard(set, get, async () => {
      await git().commits.create(repoPath, message)
      set({ selected: null, diffText: '', ...(await fetchSnapshot(repoPath)) })
    })
  },

  async backup() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().sync.push(repoPath)
      // 백업 후 upstream/ahead/behind가 바뀐다 — 스냅샷 갱신
      set({ ...(await fetchSnapshot(repoPath)) })
    })
  },
}))
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build`
Expected: **100 tests** (95 + 상대 시간 5), typecheck 5개, build — 전부 exit 0

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/components/relative-time.ts apps/desktop/test/relative-time.test.ts apps/desktop/src/renderer/src/store/repository-store.ts
git commit -m "feat(desktop): 상대 시간 유틸과 스토어 확장 — history 스냅샷·backup

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: renderer UI — HistoryPanel·백업 버튼·메시지 제안

**Files:**
- Create: `apps/desktop/src/renderer/src/components/HistoryPanel.tsx`, `components/history-panel.css`
- Delete: `components/HistoryPlaceholder.tsx`, `components/history-placeholder.css` (`git rm`)
- Modify: `components/CommitForm.tsx`, `App.tsx`, `layout.css`

- [ ] **Step 1: HistoryPanel**

`apps/desktop/src/renderer/src/components/HistoryPanel.tsx`:
```tsx
import type { CommitSummary } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { Panel } from '../ui/Panel'
import { Pictogram } from '../ui/Pictogram'
import { formatRelativeTime } from './relative-time'
import './history-panel.css'

interface HistoryPanelProps {
  history: CommitSummary[]
}

export function HistoryPanel({ history }: HistoryPanelProps) {
  return (
    <Panel
      title="저장된 역사"
      accessory={
        <>
          <Badge tone="git">log</Badge>
          <Badge tone="count">
            <span data-testid="history-count">{history.length}</span>
          </Badge>
        </>
      }
      testId="history-panel"
    >
      {history.length === 0 ? (
        <div className="history-panel__empty">
          <Pictogram kind="commit" size={20} label="저장 시점" />
          <p>
            아직 저장된 시점이 없어요.
            <br />
            저장할 때마다 여기에 쌓여요.
          </p>
        </div>
      ) : (
        <ol className="history-panel__list" data-testid="history-list">
          {history.map((commit) => (
            <li key={commit.hash} className="history-item">
              <span className="history-item__dot" aria-hidden="true" />
              <div className="history-item__body">
                <span className="history-item__subject" title={commit.subject}>
                  {commit.subject}
                </span>
                <span className="history-item__meta">
                  {formatRelativeTime(commit.committedAt, Date.now())} · {commit.authorName}
                </span>
              </div>
              <span className="history-item__hash">{commit.shortHash}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}
```

`apps/desktop/src/renderer/src/components/history-panel.css`:
```css
.history-panel__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-8) var(--space-4);
  text-align: center;
}
.history-panel__empty p {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  line-height: 1.7;
}
.history-panel__list {
  list-style: none;
  margin: 0;
  padding: var(--space-2) 0;
  position: relative;
}
/* 저장 시점을 잇는 세로 선 — 타임라인 픽토그램 언어(commit 파랑)와 동일 */
.history-panel__list::before {
  content: '';
  position: absolute;
  left: 16px;
  top: var(--space-3);
  bottom: var(--space-3);
  width: 2px;
  background: var(--color-border);
}
.history-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  position: relative;
}
.history-item__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 2px solid var(--concept-commit);
  background: var(--color-surface);
  margin-top: 4px;
  flex: none;
  position: relative;
  z-index: 1;
}
.history-item:first-child .history-item__dot {
  background: var(--concept-commit);
}
.history-item__body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.history-item__subject {
  font-size: var(--text-sm);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-item__meta {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
.history-item__hash {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  flex: none;
}
```

- [ ] **Step 2: CommitForm 제안 연동**

`apps/desktop/src/renderer/src/components/CommitForm.tsx` 전체 교체:
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
  onCommit(message: string): Promise<boolean>
}

export function CommitForm({ stagedCount, busy, suggestion, onCommit }: CommitFormProps) {
  const [message, setMessage] = useState('')
  const effectiveMessage = message.trim().length > 0 ? message : suggestion
  const disabled = busy || stagedCount === 0 || effectiveMessage.trim().length === 0

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
      <Button variant="primary" type="submit" isDisabled={disabled} testId="commit-button">
        저장하기 — {stagedCount}개 파일
      </Button>
    </form>
  )
}
```

- [ ] **Step 3: App — 백업 버튼·HistoryPanel·제안**

`apps/desktop/src/renderer/src/App.tsx` 전체 교체:
```tsx
import { CloudUpload, RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import { suggestCommitMessage, type RepositoryStateKind } from '@git-gui/domain'
import { ChangesPanel } from './components/ChangesPanel'
import { CommitForm } from './components/CommitForm'
import { DiffPanel } from './components/DiffPanel'
import { HistoryPanel } from './components/HistoryPanel'
import { RepoPicker } from './components/RepoPicker'
import { useRepositoryStore } from './store/repository-store'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Pictogram } from './ui/Pictogram'

/** 일상어 + 원어 병기(스펙 5장 문구 원칙) — 상태를 숨기지 않는다 */
const STATE_LABELS: Record<RepositoryStateKind, string> = {
  normal: '정상',
  merging: '합치는 중',
  rebasing: '다시 쌓는 중',
  'cherry-picking': '가져오는 중',
  reverting: '되돌리는 중',
  bisecting: '원인 찾는 중',
}

export function App() {
  const store = useRepositoryStore()

  useEffect(() => {
    void store.init()
    // 마운트 시 1회만 실행
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!store.repoPath) {
    return <RepoPicker onOpen={() => void store.openRepository()} error={store.error} />
  }

  const status = store.status
  const stagedCount = status?.changes.filter((c) => c.staged !== null).length ?? 0
  const suggestion = suggestCommitMessage(status?.changes ?? [])
  const repoName = store.repoPath.split('/').pop() ?? store.repoPath

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__repo">
          <strong>{repoName}</strong>
          <span className="app__repo-path" title={store.repoPath}>
            {store.repoPath}
          </span>
        </div>
        {status && (
          <div className="app__status">
            <span className="app__branch" data-testid="header-branch">
              <Pictogram kind="branch" size={13} label="실험 공간 (branch)" />
              {status.branch.name ?? '(브랜치 없음 — detached HEAD)'}
            </span>
            {status.state !== 'normal' && (
              <span className="app__state">
                <Pictogram kind="conflict" size={13} label="진행 중 작업" />
                {STATE_LABELS[status.state]}{' '}
                <span className="app__state-raw">{status.state}</span>
              </span>
            )}
            {status.branch.ahead !== null && status.branch.behind !== null && (
              <Badge>
                ↑{status.branch.ahead} ↓{status.branch.behind}
              </Badge>
            )}
          </div>
        )}
        <div className="app__actions">
          <Button
            variant="neutral"
            size="sm"
            isDisabled={store.busy}
            onPress={() => void store.backup()}
            testId="backup"
          >
            <CloudUpload size={14} aria-hidden="true" /> 백업 <Badge tone="git">push</Badge>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            isDisabled={store.busy}
            onPress={() => void store.refresh()}
            testId="refresh"
          >
            <RefreshCw size={13} aria-hidden="true" /> 새로고침
          </Button>
        </div>
      </header>
      {store.error && (
        <p className="app__error" role="alert" data-testid="error">
          {store.error}
        </p>
      )}
      <main className="app__main">
        <ChangesPanel
          changes={status?.changes ?? []}
          selected={store.selected}
          busy={store.busy}
          onStage={(paths) => void store.stage(paths)}
          onUnstage={(paths) => void store.unstage(paths)}
          onSelect={(selected) => void store.selectFile(selected)}
        />
        <div className="app__center">
          <DiffPanel path={store.selected?.change.path ?? null} diffText={store.diffText} />
          <CommitForm
            stagedCount={stagedCount}
            busy={store.busy}
            suggestion={suggestion}
            onCommit={(message) => store.commit(message)}
          />
        </div>
        <HistoryPanel history={store.history} />
      </main>
    </div>
  )
}
```

`apps/desktop/src/renderer/src/layout.css`의 `.app__actions` 교체:
```css
.app__actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
```

HistoryPlaceholder 삭제:
```bash
git rm apps/desktop/src/renderer/src/components/HistoryPlaceholder.tsx apps/desktop/src/renderer/src/components/history-placeholder.css
```

- [ ] **Step 4: 검증**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: 100 tests + typecheck 5 + build + E2E 1 passed — 전부 exit 0 (기존 E2E는 역사·백업을 건드리지 않으므로 통과. lucide에 CloudUpload가 없으면 UploadCloud로 대체하고 반드시 보고)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src
git commit -m "feat(desktop): 저장된 역사 패널·백업 버튼·메시지 제안 연동

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: E2E 확장 + 최종 게이트 + README + 스크린샷

**Files:**
- Modify: `apps/desktop/e2e/smoke.spec.ts` (전체 교체 — 테스트 2개)
- Modify: `README.md`

- [ ] **Step 1: E2E 전체 교체**

`apps/desktop/e2e/smoke.spec.ts`:
```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { execGitOrThrow } from '@git-gui/git-process'

// cwd에 의존하지 않도록 앱 루트를 절대 경로로 지정한다
const APP_ROOT = join(__dirname, '..')

async function createRepoWithChange(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'git-gui-e2e-'))
  await execGitOrThrow(['init', '--initial-branch=main'], { cwd: dir })
  // 앱이 수행하는 commit도 저장소 로컬 identity를 쓰도록 설정한다 —
  // 머신 전역 gitconfig에 의존하지 않는 hermetic 픽스처 (클린 CI에서도 동작)
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: dir })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: dir })
  await writeFile(join(dir, 'app.txt'), 'v1\n')
  await execGitOrThrow(['add', '-A'], { cwd: dir })
  await execGitOrThrow(['commit', '-m', 'init'], { cwd: dir })
  await writeFile(join(dir, 'app.txt'), 'v2\n')
  return dir
}

/** GIT_SCENARIOS fixture 원칙 — 로컬 bare remote로 백업(push)을 검증한다 */
async function addBareRemote(repo: string): Promise<string> {
  const remote = await mkdtemp(join(tmpdir(), 'git-gui-e2e-remote-'))
  await execGitOrThrow(['init', '--bare', '--initial-branch=main'], { cwd: remote })
  await execGitOrThrow(['remote', 'add', 'origin', remote], { cwd: repo })
  return remote
}

test('열기 → stage → commit → 역사 반영 → 백업', async () => {
  const repo = await createRepoWithChange()
  const remote = await addBareRemote(repo)
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()

    // 변경 파일과 기존 역사(init)가 보인다
    await expect(window.getByTestId('file-unstaged-app.txt')).toBeVisible()
    await expect(window.getByTestId('history-count')).toHaveText('1')
    await window.screenshot({ path: 'test-results/app-initial.png' })

    // stage
    await window.getByTestId('stage-app.txt').click()
    await expect(window.getByTestId('staged-count')).toHaveText('1')
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')

    // commit (명시 메시지)
    await window.getByTestId('commit-message').fill('e2e: 첫 저장')
    await window.getByTestId('commit-button').click()
    await expect(window.getByTestId('staged-count')).toHaveText('0')
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')

    // 역사에 반영
    await expect(window.getByTestId('history-count')).toHaveText('2')
    await expect(window.getByTestId('history-list')).toContainText('e2e: 첫 저장')

    // 실제 커밋 검증
    const log = await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: repo })
    expect(log.stdout.trim()).toBe('e2e: 첫 저장')

    // 백업 — 원격(bare)에 실제로 올라갔는지 + upstream 연결로 ahead/behind 표시
    await window.getByTestId('backup').click()
    await expect(window.getByText('↑0 ↓0')).toBeVisible()
    const remoteLog = await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: remote })
    expect(remoteLog.stdout.trim()).toBe('e2e: 첫 저장')

    await window.screenshot({ path: 'test-results/app-after-commit.png' })
  } finally {
    // 단언이 실패해도 Electron 프로세스와 임시 저장소를 정리한다
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(remote, { recursive: true, force: true })
  }
})

test('빈 메시지로 저장하면 규칙 기반 제안이 대신 들어간다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()

    await window.getByTestId('stage-app.txt').click()
    await expect(window.getByTestId('staged-count')).toHaveText('1')

    // 제안이 placeholder로 보인다
    await expect(window.getByTestId('commit-message')).toHaveAttribute(
      'placeholder',
      'app.txt 수정',
    )

    // 메시지를 입력하지 않고 저장 — 제안이 커밋 메시지가 된다
    await window.getByTestId('commit-button').click()
    await expect(window.getByTestId('staged-count')).toHaveText('0')
    const log = await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: repo })
    expect(log.stdout.trim()).toBe('app.txt 수정')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: E2E 실행**

Run: `cd apps/desktop && pnpm e2e`
Expected: **2 passed**, exit 0

- [ ] **Step 3: 최종 게이트**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: 100 tests + typecheck 5 + build + E2E 2 passed — 전부 exit 0

- [ ] **Step 4: README 갱신**

`README.md`의 "현재 상태" 첫 문단을 다음으로 교체:
```markdown
0단계(기반)와 E0(쉬운 모드 기초)가 동작합니다: 저장소 열기, 상태 감지, 변경 파일 목록, diff 보기, stage/unstage, commit, 저장된 역사 보기, 백업(push), 저장 메시지 자동 제안 — 디자인 토큰·픽토그램 시스템·3열 레이아웃 적용.
```

"다음 단계" 목록을 다음으로 교체:
```markdown
1. 1단계: 보관함(stash)·실험 공간(branch) 만들기·합치기, 최신 받아오기(pull/fetch)
2. 취소 가능한 Git 프로세스와 실행 로그, 네트워크 진행 표시
3. E1: 되돌리기 + 보관함 UI, 스마트 병합
4. 충돌 및 중단 상태별 테스트 fixture 확장
```

- [ ] **Step 5: 스크린샷 확보**

E2E가 생성한 `apps/desktop/test-results/app-initial.png`, `app-after-commit.png` 최신 확인 (역사 패널·백업 후 상태가 담긴다). 코디네이터가 사용자에게 전달한다.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts README.md
git commit -m "test(desktop): E2E 확장 — 역사 반영·백업·메시지 제안 검증

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
