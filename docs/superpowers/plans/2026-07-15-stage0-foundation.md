# 0단계(기반) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Electron + React 모노레포를 부트스트랩하고, 저장소 열기 → 상태 감지 → 변경 파일 → diff → stage/unstage → commit의 최소 수직 기능을 계층 분리 구조로 구현한다.

**Architecture:** 비전 문서 8장의 계층을 pnpm 모노레포 패키지로 분리한다. `domain`(순수 TS 상태 모델) ← `git-adapter`(CLI 출력 → 도메인 변환) ← `git-process`(git 실행)는 Electron main 프로세스에서 동작하고, renderer(React)는 `ipc-contract`의 타입 계약을 통해서만 main과 통신한다. renderer는 Node API에 접근하지 않는다(contextIsolation 유지).

**Tech Stack:** Electron, electron-vite, React 19 + TypeScript(strict), Zustand, Vitest, Playwright. git 실행은 시스템 git CLI(spawn) — 바이너리 번들은 후속 단계에서 도입하고, 실행 계층이 격리되어 있어 교체 비용이 낮다.

**참조 스펙:** `docs/superpowers/specs/2026-07-15-easy-mode-design.md`, `docs/superpowers/specs/2026-07-15-tech-stack-design.md`

**이번 범위가 아닌 것:** 쉬운 모드 UI(E0), 디자인 토큰/React Aria 적용, push/pull, 히스토리 그래프, 보관함. 이번 renderer UI는 계층 검증용 개발자 모드 골격이며, 디자인 시스템은 E0 계획에서 입힌다.

**알려진 한계(의도적):** 첫 commit이 없는 저장소(unborn HEAD)에서 unstage(`git restore --staged`)는 실패한다. 이 케이스는 1단계에서 다룬다. 또한 git-process가 출력을 utf8로 디코딩하므로 비 UTF-8 파일명·내용은 U+FFFD로 치환된다 — macOS(0단계 대상)에서는 드물지만, 1단계에서 Buffer 경계 도입으로 해소한다.

**후속 확장 포인트(Task 2 품질 리뷰에서 식별, 이번 범위 아님):**
- `.git/rebase-apply/`는 `git am` 진행 중에도 생기므로 현재 모델은 `git am`을 rebasing으로 표시한다 — 마커 세분화 필요 시 `applying`/`rebasing` 내부 파일로 구분
- 다중 cherry-pick 도중 `git commit`으로 CHERRY_PICK_HEAD가 사라져도 `.git/sequencer/`가 남는 케이스(S-004) — sequencer 마커 추가 필요
- 모순된 메타데이터 조합을 위한 `unknown`/진단 상태 kind(GIT_SCENARIOS 원칙) — 소비자가 생길 때 추가
- `# branch.oid (initial)`(unborn HEAD) 미노출 — 1단계에서 `oid: string | null`로 노출해 unborn 진단에 사용
- IPC sender 검증(`event.senderFrame` 대조)과 dialog 부모 창 전달 — 1단계 구조화 에러 작업과 함께 도입 (0단계는 창 1개 + 네비게이션 차단으로 수용)
- IPC 에러 구조화(GitError의 exitCode/stderr 전달) — 현재는 message 문자열만 renderer에 도달

---

## 파일 구조

```
package.json                      # 루트: pnpm workspace, 공통 스크립트
pnpm-workspace.yaml
tsconfig.base.json                # strict 공통 설정 + @git-gui/* paths
vitest.config.ts                  # 루트 vitest projects 설정
packages/domain/                  # 순수 TS: 상태 모델, 상태 감지 정책
packages/git-process/             # git spawn, 취소, 환경 변수 격리
packages/git-adapter/             # porcelain 파싱, GitClient(namespace 객체)
packages/ipc-contract/            # renderer ↔ main 타입 계약, 채널 상수
apps/desktop/                     # Electron main/preload/renderer, E2E
```

각 패키지는 `"main": "src/index.ts"`로 TS 소스를 직접 노출한다(vite/vitest가 변환). 빌드 파이프라인은 앱만 갖는다.

---

### Task 1: pnpm 모노레포 부트스트랩

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`
- Modify: `.gitignore`

- [ ] **Step 1: 루트 설정 파일 작성**

`package.json`:
```json
{
  "name": "git-gui",
  "private": true,
  "packageManager": "pnpm@10.24.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "pnpm -r run typecheck"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.8.0",
    "vitest": "^3.0.0"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "apps/*"

# pnpm 10은 의존성 postinstall을 기본 차단한다 — Electron 바이너리 설치 허용
onlyBuiltDependencies:
  - electron
  - esbuild
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "types": ["node"],
    "baseUrl": ".",
    "paths": {
      "@git-gui/domain": ["packages/domain/src/index.ts"],
      "@git-gui/git-process": ["packages/git-process/src/index.ts"],
      "@git-gui/git-adapter": ["packages/git-adapter/src/index.ts"],
      "@git-gui/ipc-contract": ["packages/ipc-contract/src/index.ts"]
    }
  },
  "include": ["packages/*/src/**/*.ts", "packages/*/test/**/*.ts"]
}
```

`vitest.config.ts` — Task 1 시점에는 패키지가 없어 projects를 비워 둔다(Task 2에서 projects 추가). deprecated된 `vitest.workspace.ts` 방식은 사용하지 않는다:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({})
```

`.gitignore`에 추가:
```
node_modules/
dist/
out/
*.local
coverage/
test-results/
playwright-report/
.DS_Store
```

- [ ] **Step 2: 설치 및 동작 확인**

Run: `pnpm install && pnpm vitest run --passWithNoTests && pnpm typecheck`
Expected: 설치 성공, vitest "No test files found"로 종료 코드 0, typecheck(실행할 패키지 없음)도 종료 코드 0. **실제 종료 코드를 확인하고 커밋할 것.**

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.config.ts .gitignore pnpm-lock.yaml
git commit -m "chore: pnpm 모노레포 부트스트랩

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: domain 패키지 — 상태 모델과 상태 감지

**Files:**
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/vitest.config.ts`
- Create: `packages/domain/src/index.ts`, `packages/domain/src/repository.ts`, `packages/domain/src/state.ts`
- Test: `packages/domain/test/state.test.ts`

- [ ] **Step 1: 패키지 뼈대 작성**

`packages/domain/package.json`:
```json
{
  "name": "@git-gui/domain",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit" }
}
```

`packages/domain/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/domain/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } })
```

루트 `vitest.config.ts`를 projects 설정으로 교체 (첫 패키지가 생겼으므로):
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { projects: ['packages/*/vitest.config.ts'] } })
```

- [ ] **Step 2: 실패하는 테스트 작성**

`packages/domain/test/state.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { detectState, type GitDirMarkers } from '../src/state'

const none: GitDirMarkers = {
  mergeHead: false,
  rebaseMerge: false,
  rebaseApply: false,
  cherryPickHead: false,
  revertHead: false,
  bisectLog: false,
}

describe('detectState', () => {
  it('마커가 없으면 normal', () => {
    expect(detectState(none)).toBe('normal')
  })

  it('MERGE_HEAD가 있으면 merging', () => {
    expect(detectState({ ...none, mergeHead: true })).toBe('merging')
  })

  it('rebase 디렉터리가 있으면 rebasing — merge 마커보다 우선', () => {
    expect(detectState({ ...none, rebaseMerge: true, mergeHead: true })).toBe('rebasing')
    expect(detectState({ ...none, rebaseApply: true })).toBe('rebasing')
  })

  it('CHERRY_PICK_HEAD가 있으면 cherry-picking', () => {
    expect(detectState({ ...none, cherryPickHead: true })).toBe('cherry-picking')
  })

  it('REVERT_HEAD가 있으면 reverting', () => {
    expect(detectState({ ...none, revertHead: true })).toBe('reverting')
  })

  it('BISECT_LOG가 있으면 bisecting', () => {
    expect(detectState({ ...none, bisectLog: true })).toBe('bisecting')
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm vitest run`
Expected: FAIL — `Cannot find module '../src/state'`

- [ ] **Step 4: 구현**

`packages/domain/src/repository.ts`:
```ts
export type RepositoryStateKind =
  | 'normal'
  | 'merging'
  | 'rebasing'
  | 'cherry-picking'
  | 'reverting'
  | 'bisecting'

export interface BranchInfo {
  /** detached HEAD면 null */
  name: string | null
  upstream: string | null
  /** upstream과의 차이. `branch.ab`를 확인하지 못했으면 null (예: upstream ref 소실) — 0/0(동기화됨)으로 추측하지 않는다 */
  ahead: number | null
  behind: number | null
}

export type ChangeKind =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'untracked'
  | 'conflicted'

export interface FileChange {
  path: string
  /** rename/copy일 때 원래 경로 */
  origPath: string | null
  /** index(staged) 쪽 변경. 없으면 null */
  staged: ChangeKind | null
  /** worktree(unstaged) 쪽 변경. 없으면 null */
  unstaged: ChangeKind | null
}

export interface RepositoryStatus {
  state: RepositoryStateKind
  branch: BranchInfo
  changes: FileChange[]
}

/** diff 조회 대상 — index(staged) 쪽인지, untracked 신규 파일인지. adapter와 IPC 계약이 공유한다 */
export interface DiffOptions {
  staged: boolean
  untracked: boolean
}
```

`packages/domain/src/state.ts`:
```ts
import type { RepositoryStateKind } from './repository'

/** .git 디렉터리에서 관찰한 사실. 파일 접근은 adapter 계층 책임이다. */
export interface GitDirMarkers {
  mergeHead: boolean
  rebaseMerge: boolean
  rebaseApply: boolean
  cherryPickHead: boolean
  revertHead: boolean
  bisectLog: boolean
}

export function detectState(markers: GitDirMarkers): RepositoryStateKind {
  // rebase 도중 충돌 해결을 위해 MERGE_HEAD 등이 함께 존재할 수 있어 rebase를 먼저 본다
  if (markers.rebaseMerge || markers.rebaseApply) return 'rebasing'
  if (markers.mergeHead) return 'merging'
  if (markers.cherryPickHead) return 'cherry-picking'
  if (markers.revertHead) return 'reverting'
  if (markers.bisectLog) return 'bisecting'
  return 'normal'
}
```

`packages/domain/src/index.ts`:
```ts
export * from './repository'
export * from './state'
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm vitest run`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/domain vitest.config.ts pnpm-lock.yaml
git commit -m "feat(domain): 저장소 상태 모델과 상태 감지 정책

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: git-process 패키지 — git 실행 계층

**Files:**
- Create: `packages/git-process/package.json`, `packages/git-process/tsconfig.json`, `packages/git-process/vitest.config.ts`
- Create: `packages/git-process/src/index.ts`, `packages/git-process/src/exec.ts`
- Test: `packages/git-process/test/exec.test.ts`

- [ ] **Step 1: 패키지 뼈대 작성**

`packages/git-process/package.json`:
```json
{
  "name": "@git-gui/git-process",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit" }
}
```

`tsconfig.json`은 Task 2의 domain과 동일. `vitest.config.ts`는 프로세스 spawn 테스트가 워커 경합 시 기본 5초를 넘길 수 있어 타임아웃을 상향한다:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 15_000 } })
```

- [ ] **Step 2: 실패하는 테스트 작성**

`packages/git-process/test/exec.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { execGit, execGitOrThrow, GitError } from '../src/exec'

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'git-gui-proc-'))
}

describe('execGit', () => {
  it('성공한 명령의 stdout과 exitCode 0을 반환한다', async () => {
    const cwd = await tempDir()
    const result = await execGit(['version'], { cwd })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('git version')
  })

  it('실패한 명령은 0이 아닌 exitCode와 stderr를 반환한다', async () => {
    const cwd = await tempDir()
    const result = await execGit(['rev-parse', 'HEAD'], { cwd })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.length).toBeGreaterThan(0)
  })

  it('stdin을 전달할 수 있다', async () => {
    const cwd = await tempDir()
    await execGitOrThrow(['init'], { cwd })
    const result = await execGitOrThrow(['hash-object', '--stdin'], { cwd, stdin: 'hello\n' })
    expect(result.stdout.trim()).toMatch(/^[0-9a-f]{40,64}$/)
  })

  it('이미 중단된 AbortSignal이면 실행하지 않고 거부한다', async () => {
    const cwd = await tempDir()
    const controller = new AbortController()
    controller.abort()
    await expect(execGit(['version'], { cwd, signal: controller.signal })).rejects.toThrow()
  })

  it('git이 stdin을 읽지 않아도 대용량 stdin이 프로세스를 죽이지 않는다 (EPIPE 무시)', async () => {
    const cwd = await tempDir()
    const big = 'x'.repeat(8 * 1024 * 1024)
    const result = await execGit(['version'], { cwd, stdin: big })
    expect(result.exitCode).toBe(0)
  })

  it('실행 중 abort하면 거부된다', async () => {
    const cwd = await tempDir()
    await execGitOrThrow(['init'], { cwd })
    const controller = new AbortController()
    const big = 'x'.repeat(64 * 1024 * 1024)
    const promise = execGit(['hash-object', '--stdin'], {
      cwd,
      stdin: big,
      signal: controller.signal,
    })
    controller.abort()
    await expect(promise).rejects.toThrow()
  })
})

describe('execGitOrThrow', () => {
  it('실패 시 stderr를 담은 GitError를 던진다', async () => {
    const cwd = await tempDir()
    await expect(execGitOrThrow(['rev-parse', 'HEAD'], { cwd })).rejects.toBeInstanceOf(GitError)
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm vitest run`
Expected: FAIL — `Cannot find module '../src/exec'`

- [ ] **Step 4: 구현**

`packages/git-process/src/exec.ts`:
```ts
import { spawn } from 'node:child_process'

export interface GitExecOptions {
  cwd: string
  stdin?: string
  signal?: AbortSignal
}

export interface GitResult {
  stdout: string
  stderr: string
  exitCode: number
  /** 프로세스가 시그널로 종료된 경우 그 시그널 이름 */
  signal: NodeJS.Signals | null
}

export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly result: GitResult,
  ) {
    super(
      `git ${args.join(' ')} failed (exit ${result.exitCode}${
        result.signal ? `, signal ${result.signal}` : ''
      }): ${result.stderr.trim()}`,
    )
    this.name = 'GitError'
  }
}

/**
 * 저장소 해석과 설정 주입에 영향을 주는 환경 변수를 제거해 실행을 격리한다.
 * HOME은 보존한다 — 사용자 gitconfig(user.name/email)가 commit에 필요하다.
 */
const REMOVED_ENV_EXACT = new Set([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
])

function isRemovedEnvKey(key: string): boolean {
  return (
    REMOVED_ENV_EXACT.has(key) ||
    key.startsWith('GIT_CONFIG_KEY_') ||
    key.startsWith('GIT_CONFIG_VALUE_')
  )
}

export function execGit(args: string[], options: GitExecOptions): Promise<GitResult> {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!isRemovedEnvKey(key)) env[key] = value
  }
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_OPTIONAL_LOCKS = '0'
  env.GIT_EDITOR = 'true' // 에디터를 여는 명령이 GUI를 행시키지 않도록

  return new Promise<GitResult>((resolve, reject) => {
    const child = spawn('git', args, { cwd: options.cwd, env, signal: options.signal })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => (stdout += chunk))
    child.stderr.on('data', (chunk: string) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code, signal) =>
      resolve({ stdout, stderr, exitCode: code ?? -1, signal }),
    )
    // git이 stdin을 다 읽기 전에 종료하면 EPIPE가 스트림 error로 발생한다.
    // 리스너가 없으면 uncaughtException으로 main 프로세스가 죽는다.
    // 실패 판정은 exitCode/stderr가 담당하므로 여기서는 무시한다.
    child.stdin.on('error', () => {})
    if (options.stdin != null) child.stdin.end(options.stdin)
    else child.stdin.end()
  })
}

export async function execGitOrThrow(args: string[], options: GitExecOptions): Promise<GitResult> {
  const result = await execGit(args, options)
  if (result.exitCode !== 0) throw new GitError(args, result)
  return result
}
```

`packages/git-process/src/index.ts`:
```ts
export * from './exec'
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm vitest run`
Expected: PASS (git-process 7 tests + domain 8 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/git-process
git commit -m "feat(git-process): git 실행 계층 — spawn, 환경 격리, 취소, stdin

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: git-adapter — porcelain v2 상태 파서

**Files:**
- Create: `packages/git-adapter/package.json`, `packages/git-adapter/tsconfig.json`, `packages/git-adapter/vitest.config.ts`
- Create: `packages/git-adapter/src/index.ts`, `packages/git-adapter/src/status-parser.ts`
- Test: `packages/git-adapter/test/status-parser.test.ts`

- [ ] **Step 1: 패키지 뼈대 작성**

`packages/git-adapter/package.json`:
```json
{
  "name": "@git-gui/git-adapter",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@git-gui/domain": "workspace:*",
    "@git-gui/git-process": "workspace:*"
  }
}
```

`tsconfig.json`, `vitest.config.ts`는 Task 2와 동일한 내용. 작성 후 `pnpm install`로 workspace 링크를 갱신한다.

- [ ] **Step 2: 실패하는 테스트 작성**

`packages/git-adapter/test/status-parser.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseStatusV2 } from '../src/status-parser'

// git status --porcelain=v2 --branch -z 출력은 NUL(\0) 구분 레코드다
function raw(records: string[]): string {
  return records.join('\0') + '\0'
}

describe('parseStatusV2', () => {
  it('브랜치 헤더를 파싱한다', () => {
    const parsed = parseStatusV2(
      raw([
        '# branch.oid 1234567890abcdef',
        '# branch.head main',
        '# branch.upstream origin/main',
        '# branch.ab +2 -1',
      ]),
    )
    expect(parsed.branch).toEqual({ name: 'main', upstream: 'origin/main', ahead: 2, behind: 1 })
    expect(parsed.changes).toEqual([])
  })

  it('detached HEAD는 name이 null이다', () => {
    const parsed = parseStatusV2(raw(['# branch.oid abc', '# branch.head (detached)']))
    expect(parsed.branch.name).toBeNull()
  })

  it('일반 변경(1) 레코드를 staged/unstaged로 나눠 파싱한다', () => {
    const parsed = parseStatusV2(
      raw([
        '1 M. N... 100644 100644 100644 aaa bbb staged-only.ts',
        '1 .M N... 100644 100644 100644 aaa bbb unstaged-only.ts',
        '1 MM N... 100644 100644 100644 aaa bbb both.ts',
        '1 A. N... 000000 100644 100644 000 bbb new-staged.ts',
        '1 .D N... 100644 100644 000000 aaa bbb deleted.ts',
      ]),
    )
    expect(parsed.changes).toEqual([
      { path: 'staged-only.ts', origPath: null, staged: 'modified', unstaged: null },
      { path: 'unstaged-only.ts', origPath: null, staged: null, unstaged: 'modified' },
      { path: 'both.ts', origPath: null, staged: 'modified', unstaged: 'modified' },
      { path: 'new-staged.ts', origPath: null, staged: 'added', unstaged: null },
      { path: 'deleted.ts', origPath: null, staged: null, unstaged: 'deleted' },
    ])
  })

  it('공백이 포함된 파일명을 보존한다', () => {
    const parsed = parseStatusV2(raw(['1 .M N... 100644 100644 100644 aaa bbb my file.txt']))
    expect(parsed.changes[0]?.path).toBe('my file.txt')
  })

  it('rename(2) 레코드는 다음 토큰을 origPath로 읽는다', () => {
    const parsed = parseStatusV2(
      raw(['2 R. N... 100644 100644 100644 aaa bbb R100 new-name.ts', 'old-name.ts']),
    )
    expect(parsed.changes).toEqual([
      { path: 'new-name.ts', origPath: 'old-name.ts', staged: 'renamed', unstaged: null },
    ])
  })

  it('untracked(?) 레코드를 파싱한다', () => {
    const parsed = parseStatusV2(raw(['? new.txt']))
    expect(parsed.changes).toEqual([
      { path: 'new.txt', origPath: null, staged: null, unstaged: 'untracked' },
    ])
  })

  it('unmerged(u) 레코드는 conflicted로 표시한다', () => {
    const parsed = parseStatusV2(
      raw(['u UU N... 100644 100644 100644 100644 h1 h2 h3 conflict.ts']),
    )
    expect(parsed.changes).toEqual([
      { path: 'conflict.ts', origPath: null, staged: null, unstaged: 'conflicted' },
    ])
  })

  it('빈 출력이면 빈 결과를 반환한다', () => {
    const parsed = parseStatusV2('')
    expect(parsed.branch).toEqual({ name: null, upstream: null, ahead: null, behind: null })
    expect(parsed.changes).toEqual([])
  })

  it('upstream은 있지만 branch.ab가 없으면 ahead/behind는 null이다', () => {
    const parsed = parseStatusV2(
      raw(['# branch.oid abc', '# branch.head main', '# branch.upstream origin/main']),
    )
    expect(parsed.branch).toEqual({
      name: 'main',
      upstream: 'origin/main',
      ahead: null,
      behind: null,
    })
  })

  it('typechange와 copied를 파싱한다', () => {
    const parsed = parseStatusV2(
      raw([
        '1 .T N... 100644 100644 120000 aaa bbb link.ts',
        '2 C. N... 100644 100644 100644 aaa bbb C100 copy.ts',
        'orig.ts',
      ]),
    )
    expect(parsed.changes).toEqual([
      { path: 'link.ts', origPath: null, staged: null, unstaged: 'typechange' },
      { path: 'copy.ts', origPath: 'orig.ts', staged: 'copied', unstaged: null },
    ])
  })

  it('필드가 모자란 기형 레코드는 추측하지 않고 건너뛴다', () => {
    const parsed = parseStatusV2(raw(['1 .M N... 100644', 'u UU N...']))
    expect(parsed.changes).toEqual([])
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm vitest run`
Expected: FAIL — `Cannot find module '../src/status-parser'`

- [ ] **Step 4: 구현**

`packages/git-adapter/src/status-parser.ts`:
```ts
import type { BranchInfo, ChangeKind, FileChange, RepositoryStatus } from '@git-gui/domain'

export type ParsedStatus = Pick<RepositoryStatus, 'branch' | 'changes'>

function kindFromChar(char: string): ChangeKind | null {
  switch (char) {
    case 'M':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'T':
      return 'typechange'
    case '.':
      return null
    default:
      // 실물 porcelain v2의 1/2 레코드에는 위 문자만 등장한다(충돌은 u 레코드 전담).
      // 미래 git이 새 문자를 도입하면 일단 modified로 표시된다 — 여기가 그 위장 지점이다.
      return 'modified'
  }
}

/**
 * `git status --porcelain=v2 --branch -z` 출력을 파싱한다.
 * -z 모드: 레코드는 NUL로 구분되고, rename(2) 레코드는 경로 뒤 NUL 다음에 원본 경로가 온다.
 * 필드 수가 모자란 기형 레코드는 추측해 채우지 않고 건너뛴다.
 */
export function parseStatusV2(rawOutput: string): ParsedStatus {
  const tokens = rawOutput.split('\0')
  if (tokens.length > 0 && tokens[tokens.length - 1] === '') tokens.pop()

  const branch: BranchInfo = { name: null, upstream: null, ahead: null, behind: null }
  const changes: FileChange[] = []

  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]!
    if (token.startsWith('# branch.head ')) {
      const value = token.slice('# branch.head '.length)
      branch.name = value === '(detached)' ? null : value
    } else if (token.startsWith('# branch.upstream ')) {
      branch.upstream = token.slice('# branch.upstream '.length)
    } else if (token.startsWith('# branch.ab ')) {
      const match = /\+(\d+) -(\d+)/.exec(token)
      if (match) {
        branch.ahead = Number(match[1])
        branch.behind = Number(match[2])
      }
    } else if (token.startsWith('1 ')) {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const parts = token.split(' ')
      if (parts.length >= 9) {
        const xy = parts[1]!
        changes.push({
          path: parts.slice(8).join(' '),
          origPath: null,
          staged: kindFromChar(xy[0]!),
          unstaged: kindFromChar(xy[1]!),
        })
      }
    } else if (token.startsWith('2 ')) {
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <Xscore> <path> NUL <origPath>
      const parts = token.split(' ')
      const origPath = tokens[i + 1]
      if (parts.length >= 10 && origPath !== undefined) {
        i += 1
        const xy = parts[1]!
        changes.push({
          path: parts.slice(9).join(' '),
          origPath,
          staged: kindFromChar(xy[0]!),
          unstaged: kindFromChar(xy[1]!),
        })
      }
    } else if (token.startsWith('u ')) {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      const parts = token.split(' ')
      if (parts.length >= 11) {
        changes.push({
          path: parts.slice(10).join(' '),
          origPath: null,
          staged: null,
          unstaged: 'conflicted',
        })
      }
    } else if (token.startsWith('? ')) {
      changes.push({
        path: token.slice(2),
        origPath: null,
        staged: null,
        unstaged: 'untracked',
      })
    }
    // '!'(ignored)와 '# branch.oid'는 이번 범위에서 무시한다
    i += 1
  }

  return { branch, changes }
}
```

`packages/git-adapter/src/index.ts`:
```ts
export * from './status-parser'
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm vitest run`
Expected: PASS (전체 26 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/git-adapter pnpm-lock.yaml
git commit -m "feat(git-adapter): porcelain v2 상태 파서

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: git-adapter — GitClient 작업 (fixture 통합 테스트)

**Files:**
- Create: `packages/git-adapter/src/client.ts`, `packages/git-adapter/src/markers.ts`
- Create: `packages/git-adapter/test/fixture.ts`
- Test: `packages/git-adapter/test/client.test.ts`
- Modify: `packages/git-adapter/src/index.ts`

- [ ] **Step 1: fixture 헬퍼 작성**

`packages/git-adapter/test/fixture.ts`:
```ts
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execGitOrThrow } from '@git-gui/git-process'

/** 커밋 작성자 설정을 저장소 로컬로 주입해 시스템 설정과 격리한다 */
export const FIXTURE_IDENT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@test.local']

export async function createFixtureRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'git-gui-fixture-'))
  await execGitOrThrow(['init', '--initial-branch=main'], { cwd: dir })
  await writeFile(join(dir, 'README.md'), '# fixture\n')
  await execGitOrThrow(['add', '-A'], { cwd: dir })
  await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'init'], { cwd: dir })
  return dir
}

export async function writeFixtureFile(repo: string, name: string, content: string): Promise<void> {
  await writeFile(join(repo, name), content)
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`packages/git-adapter/test/client.test.ts`:
```ts
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { execGit, execGitOrThrow, GitError } from '@git-gui/git-process'
import { createGitClient } from '../src/client'
import { createFixtureRepo, FIXTURE_IDENT, writeFixtureFile } from './fixture'

describe('GitClient', () => {
  it('깨끗한 저장소의 status — normal 상태, main 브랜치, 변경 없음', async () => {
    const repo = await createFixtureRepo()
    const status = await createGitClient(repo).repo.status()
    expect(status.state).toBe('normal')
    expect(status.branch.name).toBe('main')
    expect(status.changes).toEqual([])
  })

  it('수정 → untracked/modified 감지 → stage → unstage 왕복', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# changed\n')
    await writeFixtureFile(repo, 'new.txt', 'hello\n')

    let status = await client.repo.status()
    expect(status.changes).toHaveLength(2)
    expect(status.changes.find((c) => c.path === 'README.md')?.unstaged).toBe('modified')
    expect(status.changes.find((c) => c.path === 'new.txt')?.unstaged).toBe('untracked')

    await client.changes.stage(['README.md', 'new.txt'])
    status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'README.md')?.staged).toBe('modified')
    expect(status.changes.find((c) => c.path === 'new.txt')?.staged).toBe('added')

    await client.changes.unstage(['new.txt'])
    status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'new.txt')?.unstaged).toBe('untracked')
  })

  it('diff — unstaged, staged, untracked 각각 patch 텍스트를 반환한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# changed\n')
    await writeFixtureFile(repo, 'new.txt', 'hello\n')

    const unstaged = await client.changes.diff('README.md', { staged: false, untracked: false })
    expect(unstaged).toContain('-# fixture')
    expect(unstaged).toContain('+# changed')

    await client.changes.stage(['README.md'])
    const staged = await client.changes.diff('README.md', { staged: true, untracked: false })
    expect(staged).toContain('+# changed')

    const untracked = await client.changes.diff('new.txt', { staged: false, untracked: true })
    expect(untracked).toContain('+hello')
  })

  it('commit — stage된 변경으로 커밋을 만들고 changes가 비워진다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# changed\n')
    await client.changes.stage(['README.md'])
    await client.commits.create('feat: 첫 줄\n\n본문 "따옴표" 포함')

    const status = await client.repo.status()
    expect(status.changes).toEqual([])
    const log = await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: repo })
    expect(log.stdout.trim()).toBe('feat: 첫 줄')
  })

  it('merge 충돌 상태를 merging으로 감지한다', async () => {
    const repo = await createFixtureRepo()
    await execGitOrThrow(['checkout', '-b', 'feature'], { cwd: repo })
    await writeFixtureFile(repo, 'README.md', '# feature\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'feature'], { cwd: repo })
    await execGitOrThrow(['checkout', 'main'], { cwd: repo })
    await writeFixtureFile(repo, 'README.md', '# main\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'main'], { cwd: repo })
    // 충돌하는 merge — 실패(exit != 0)가 정상이므로 결과를 확인하지 않는다
    await execGit(['merge', 'feature'], { cwd: repo })

    const status = await createGitClient(repo).repo.status()
    expect(status.state).toBe('merging')
    expect(status.changes.find((c) => c.path === 'README.md')?.unstaged).toBe('conflicted')
  })

  it('stage/unstage에 빈 배열을 넘기면 전체 작업으로 확대되지 않고 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# changed\n')
    await expect(client.changes.stage([])).rejects.toThrow()
    await expect(client.changes.unstage([])).rejects.toThrow()
    await expect(client.changes.stage([''])).rejects.toThrow()
    await expect(client.changes.diff('', { staged: false, untracked: false })).rejects.toThrow()
    const status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'README.md')?.staged).toBeNull()
  })

  it('pathspec 매직·글롭 파일명을 리터럴로 처리한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'a*.txt', 'glob\n')
    await writeFixtureFile(repo, 'axx.txt', 'other\n')
    await writeFixtureFile(repo, ':(top)', 'magic\n')
    await client.changes.stage(['a*.txt', ':(top)'])
    const status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'a*.txt')?.staged).toBe('added')
    expect(status.changes.find((c) => c.path === ':(top)')?.staged).toBe('added')
    expect(status.changes.find((c) => c.path === 'axx.txt')?.staged).toBeNull()
    expect(status.changes.find((c) => c.path === 'axx.txt')?.unstaged).toBe('untracked')
  })

  it('untracked 디렉터리 diff는 빈 결과로 위장하지 않고 에러를 던진다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await mkdir(join(repo, 'newdir'))
    await writeFixtureFile(repo, 'newdir/inner.txt', 'x\n')
    await expect(
      client.changes.diff('newdir/', { staged: false, untracked: true }),
    ).rejects.toThrow()
  })

  it('저장소 밖 경로의 untracked diff를 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(
      client.changes.diff('/etc/hosts', { staged: false, untracked: true }),
    ).rejects.toThrow()
    await expect(
      client.changes.diff('../outside.txt', { staged: false, untracked: true }),
    ).rejects.toThrow()
  })

  it('저장소 하위 폴더 경로로 열어도 루트 기준으로 동작한다', async () => {
    const repo = await createFixtureRepo()
    await mkdir(join(repo, 'sub'))
    await writeFixtureFile(repo, 'sub/inner.txt', 'v1\n')
    const client = createGitClient(join(repo, 'sub'))
    await client.changes.stage(['sub/inner.txt'])
    const status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'sub/inner.txt')?.staged).toBe('added')
  })

  it('빈 커밋 메시지는 GitError로 거부된다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# changed\n')
    await client.changes.stage(['README.md'])
    await expect(client.commits.create('')).rejects.toBeInstanceOf(GitError)
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm vitest run`
Expected: FAIL — `Cannot find module '../src/client'`

- [ ] **Step 4: 구현**

`packages/git-adapter/src/markers.ts`:
```ts
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { GitDirMarkers } from '@git-gui/domain'

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function readGitDirMarkers(gitDir: string): Promise<GitDirMarkers> {
  const [mergeHead, rebaseMerge, rebaseApply, cherryPickHead, revertHead, bisectLog] =
    await Promise.all([
      exists(join(gitDir, 'MERGE_HEAD')),
      exists(join(gitDir, 'rebase-merge')),
      exists(join(gitDir, 'rebase-apply')),
      exists(join(gitDir, 'CHERRY_PICK_HEAD')),
      exists(join(gitDir, 'REVERT_HEAD')),
      exists(join(gitDir, 'BISECT_LOG')),
    ])
  return { mergeHead, rebaseMerge, rebaseApply, cherryPickHead, revertHead, bisectLog }
}
```

`packages/git-adapter/src/client.ts`:
```ts
import { detectState, type DiffOptions, type RepositoryStatus } from '@git-gui/domain'
import { execGit, execGitOrThrow, GitError } from '@git-gui/git-process'
import { readGitDirMarkers } from './markers'
import { parseStatusV2 } from './status-parser'

export type { DiffOptions } from '@git-gui/domain'

export interface GitClient {
  repo: {
    status(): Promise<RepositoryStatus>
  }
  changes: {
    stage(paths: string[]): Promise<void>
    unstage(paths: string[]): Promise<void>
    diff(path: string, options: DiffOptions): Promise<string>
  }
  commits: {
    create(message: string): Promise<void>
  }
}

const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null'

/**
 * pathspec 매직(':(top)' 등)과 글롭('*')이 해석되지 않도록 리터럴로 고정한다.
 * 빈 배열은 pathspec 없는 전체 작업(add -A --)으로 전락하므로 명시적으로 거부한다 —
 * staged-only 내용이 워크트리 내용으로 덮어써지는 유실 경로다.
 */
function toPathspecs(paths: string[]): string[] {
  // 빈 문자열 요소도 ':(literal)' + '' = match-all pathspec으로 전락한다 — 함께 거부
  if (paths.length === 0 || paths.some((path) => path === '')) {
    throw new Error('빈 경로 — 전체 작업으로 확대되는 것을 막기 위해 거부한다')
  }
  return paths.map((path) => `:(literal)${path}`)
}

/** 저장소 루트 상대 경로만 허용한다 — 빈 경로, 절대 경로, 상위 탈출(..)을 거부한다 */
function assertRepoRelative(path: string): void {
  if (path === '' || path.startsWith('/') || path.split('/').includes('..')) {
    throw new Error(`저장소 밖 경로는 다룰 수 없다: ${path}`)
  }
}

export function createGitClient(repoPath: string): GitClient {
  // porcelain 출력 경로는 루트 상대, pathspec은 cwd 상대다 —
  // 하위 폴더로 열려도 어긋나지 않도록 cwd를 저장소 루트로 정규화한다.
  let topLevelPromise: Promise<string> | null = null
  const topLevel = (): Promise<string> => {
    topLevelPromise ??= execGitOrThrow(['rev-parse', '--show-toplevel'], { cwd: repoPath }).then(
      (result) => result.stdout.trim(),
    )
    return topLevelPromise
  }

  return {
    repo: {
      async status() {
        const cwd = await topLevel()
        const raw = await execGitOrThrow(['status', '--porcelain=v2', '--branch', '-z'], { cwd })
        const parsed = parseStatusV2(raw.stdout)
        const gitDir = (
          await execGitOrThrow(['rev-parse', '--absolute-git-dir'], { cwd })
        ).stdout.trim()
        const markers = await readGitDirMarkers(gitDir)
        return { state: detectState(markers), branch: parsed.branch, changes: parsed.changes }
      },
    },
    changes: {
      async stage(paths) {
        const cwd = await topLevel()
        await execGitOrThrow(['add', '-A', '--', ...toPathspecs(paths)], { cwd })
      },
      async unstage(paths) {
        const cwd = await topLevel()
        await execGitOrThrow(['restore', '--staged', '--', ...toPathspecs(paths)], { cwd })
      },
      async diff(path, options) {
        const cwd = await topLevel()
        assertRepoRelative(path)
        if (options.untracked) {
          // --no-index는 차이가 있으면 exit 1이 정상이지만 접근 실패도 exit 1이다 —
          // stdout 유무로 진짜 diff와 에러를 구분한다 (빈 결과로 위장하지 않는다)
          const args = [
            'diff',
            '--no-color',
            '--no-ext-diff',
            '--no-index',
            '--',
            NULL_DEVICE,
            path,
          ]
          const result = await execGit(args, { cwd })
          if (
            result.exitCode > 1 ||
            (result.exitCode === 1 && result.stdout === '' && result.stderr !== '')
          ) {
            throw new GitError(args, result)
          }
          return result.stdout
        }
        const args = options.staged
          ? ['diff', '--cached', '--no-color', '--no-ext-diff', '--', `:(literal)${path}`]
          : ['diff', '--no-color', '--no-ext-diff', '--', `:(literal)${path}`]
        return (await execGitOrThrow(args, { cwd })).stdout
      },
    },
    commits: {
      async create(message) {
        const cwd = await topLevel()
        // 메시지는 stdin으로 전달해 따옴표·개행 이스케이프 문제를 피한다.
        // 빈 메시지는 git이 exit 1로 거부한다 — GitError로 전파된다.
        await execGitOrThrow(['commit', '-F', '-'], { cwd, stdin: message })
      },
    },
  }
}
```

`packages/git-adapter/src/index.ts`:
```ts
export * from './status-parser'
export * from './client'
export * from './markers'
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm vitest run`
Expected: PASS (전체 37 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/git-adapter
git commit -m "feat(git-adapter): GitClient — status/stage/unstage/diff/commit

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: ipc-contract 패키지 — renderer ↔ main 타입 계약

**Files:**
- Create: `packages/ipc-contract/package.json`, `packages/ipc-contract/tsconfig.json`
- Create: `packages/ipc-contract/src/index.ts`

- [ ] **Step 1: 패키지 작성**

`packages/ipc-contract/package.json`:
```json
{
  "name": "@git-gui/ipc-contract",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@git-gui/domain": "workspace:*"
  }
}
```

`tsconfig.json`은 Task 2와 동일한 내용.

`packages/ipc-contract/src/index.ts`:
```ts
import type { DiffOptions, RepositoryStatus } from '@git-gui/domain'

export type { DiffOptions } from '@git-gui/domain'

/**
 * preload가 contextBridge로 노출하고 renderer가 사용하는 API 표면.
 *
 * 신뢰 규칙: `repoPath`는 repo.select() 또는 repo.initialPath()가 반환한 값만 유효하다 —
 * main은 자신이 돌려준 경로만 allowlist로 신뢰하고 그 외는 거부한다.
 * 파일 `path`는 저장소 루트 상대 경로만 허용된다 (절대 경로·`..`·빈 문자열 거부).
 */
export interface GitApi {
  repo: {
    /** 폴더 선택 다이얼로그. 취소하면 null. 반환 경로는 저장소 루트로 정규화된다 */
    select(): Promise<string | null>
    /** E2E 등에서 환경 변수로 주입한 초기 저장소 경로. 반환 경로는 저장소 루트로 정규화된다 */
    initialPath(): Promise<string | null>
    status(repoPath: string): Promise<RepositoryStatus>
  }
  changes: {
    stage(repoPath: string, paths: string[]): Promise<void>
    unstage(repoPath: string, paths: string[]): Promise<void>
    diff(repoPath: string, path: string, options: DiffOptions): Promise<string>
  }
  commits: {
    create(repoPath: string, message: string): Promise<void>
  }
}

export const GIT_API_KEY = 'gitApi' as const

export const CHANNELS = {
  repoSelect: 'repo:select',
  repoInitialPath: 'repo:initial-path',
  repoStatus: 'repo:status',
  changesStage: 'changes:stage',
  changesUnstage: 'changes:unstage',
  changesDiff: 'changes:diff',
  commitsCreate: 'commits:create',
} as const
```

- [ ] **Step 2: 타입 검사 확인**

Run: `pnpm install && pnpm typecheck`
Expected: 오류 없이 종료

- [ ] **Step 3: Commit**

```bash
git add packages/ipc-contract pnpm-lock.yaml
git commit -m "feat(ipc-contract): renderer-main IPC 타입 계약과 채널 상수

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Electron 앱 스캐폴드

**Files:**
- Create: `apps/desktop/package.json`, `apps/desktop/electron.vite.config.ts`, `apps/desktop/tsconfig.json`
- Create: `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/src/renderer/index.html`, `apps/desktop/src/renderer/src/main.tsx`, `apps/desktop/src/renderer/src/App.tsx`, `apps/desktop/src/renderer/src/env.d.ts`

- [ ] **Step 1: 앱 패키지 작성**

`apps/desktop/package.json`:
```json
{
  "name": "@git-gui/desktop",
  "private": true,
  "version": "0.0.1",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit",
    "e2e": "electron-vite build && playwright test"
  },
  "dependencies": {
    "@git-gui/domain": "workspace:*",
    "@git-gui/git-adapter": "workspace:*",
    "@git-gui/git-process": "workspace:*",
    "@git-gui/ipc-contract": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.50.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "electron": "^35.0.0",
    "electron-vite": "^3.0.0",
    "vite": "^6.0.0"
  }
}
```

`apps/desktop/electron.vite.config.ts`:
```ts
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin({ exclude: ['@git-gui/domain', '@git-gui/git-adapter', '@git-gui/git-process', '@git-gui/ipc-contract'] })] },
  preload: { plugins: [externalizeDepsPlugin({ exclude: ['@git-gui/domain', '@git-gui/ipc-contract'] })] },
  renderer: { plugins: [react()] },
})
```

`apps/desktop/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "types": ["node"],
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src"]
}
```

- [ ] **Step 2: main/preload/renderer 최소 코드 작성**

`apps/desktop/src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerGitHandlers } from './git-handlers'

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // 이 창은 preload로 git 조작 API를 갖는 특권 창이다 — 외부 네비게이션과 새 창을 차단한다
  // (파일 드래그&드롭의 file:// 네비게이션 같은 기본 동작도 여기서 막힌다)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  // 패키징된 앱에서는 env로 임의 URL을 주입할 수 없어야 한다
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app
  .whenReady()
  .then(() => {
    registerGitHandlers()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((error) => {
    console.error('앱 초기화 실패:', error)
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

`apps/desktop/src/main/git-handlers.ts` — 이 Task에서는 빈 등록 함수만 두고 Task 8에서 채운다:
```ts
export function registerGitHandlers(): void {
  // Task 8에서 IPC 핸들러를 등록한다
}
```

`apps/desktop/src/preload/index.ts` — 이 Task에서는 빈 파일 수준으로 두고 Task 8에서 채운다:
```ts
export {}
```

`apps/desktop/src/renderer/index.html`:
```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'" />
    <title>Git GUI</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/desktop/src/renderer/src/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
```

`apps/desktop/src/renderer/src/App.tsx`:
```tsx
export function App() {
  return <h1>Git GUI</h1>
}
```

`apps/desktop/src/renderer/src/env.d.ts`:
```ts
import type { GitApi } from '@git-gui/ipc-contract'

declare global {
  interface Window {
    gitApi: GitApi
  }
}

export {}
```

- [ ] **Step 3: 빌드·실행 확인**

Run: `pnpm install && pnpm --filter @git-gui/desktop build`
Expected: main/preload/renderer 번들 생성 성공

Run(수동 확인 가능 환경일 때): `pnpm --filter @git-gui/desktop dev`
Expected: "Git GUI" 헤딩이 보이는 창이 뜬다

- [ ] **Step 4: Commit**

```bash
git add apps/desktop pnpm-lock.yaml
git commit -m "feat(desktop): electron-vite 앱 스캐폴드

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: main IPC 핸들러와 preload 브리지

**Files:**
- Modify: `apps/desktop/src/main/git-handlers.ts`
- Modify: `apps/desktop/src/preload/index.ts`

- [ ] **Step 1: main 핸들러 구현**

`apps/desktop/src/main/git-handlers.ts` 전체 교체. 두 가지 보안 불변식을 지킨다: (1) **repoPath allowlist** — main이 직접 검증해 돌려준 경로만 이후 요청에서 신뢰한다. (2) **IPC 인자는 unknown으로 취급** — 계약 타입은 renderer 편의이지 main의 신뢰 근거가 아니므로 형태를 직접 검증한다.
```ts
import { dialog, ipcMain } from 'electron'
import { createGitClient } from '@git-gui/git-adapter'
import type { DiffOptions } from '@git-gui/domain'
import { execGit, execGitOrThrow } from '@git-gui/git-process'
import { CHANNELS } from '@git-gui/ipc-contract'

/** main이 직접 검증해 돌려준 경로만 이후 요청에서 신뢰한다 — renderer는 경로를 만들어낼 수 없다 */
const allowedRepoPaths = new Set<string>()

function assertAllowedRepo(repoPath: unknown): string {
  if (typeof repoPath !== 'string' || !allowedRepoPaths.has(repoPath)) {
    throw new Error('열려 있지 않은 저장소 경로예요. 저장소를 먼저 열어 주세요.')
  }
  return repoPath
}

function assertString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('잘못된 요청 형식이에요.')
  return value
}

function assertStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('잘못된 요청 형식이에요.')
  // sparse array의 hole은 every가 건너뛰어 통과된다 — 실체화(undefined로 변환)한 뒤 검사한다
  const items = [...(value as unknown[])]
  if (!items.every((item): item is string => typeof item === 'string')) {
    throw new Error('잘못된 요청 형식이에요.')
  }
  return items
}

function assertDiffOptions(value: unknown): DiffOptions {
  const candidate = value as DiffOptions | null
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof candidate.staged !== 'boolean' ||
    typeof candidate.untracked !== 'boolean'
  ) {
    throw new Error('잘못된 요청 형식이에요.')
  }
  // 잉여 필드가 하류로 밀수되지 않도록 알려진 필드만 복사한다
  return { staged: candidate.staged, untracked: candidate.untracked }
}

/** 하위 폴더를 선택해도 저장소 루트로 정규화해 allowlist에 기록한다 */
async function registerRepoPath(path: string): Promise<string> {
  const topLevel = (
    await execGitOrThrow(['rev-parse', '--show-toplevel'], { cwd: path })
  ).stdout.trim()
  allowedRepoPaths.add(topLevel)
  return topLevel
}

export function registerGitHandlers(): void {
  ipcMain.handle(CHANNELS.repoSelect, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    const path = result.filePaths[0]!
    const check = await execGit(['rev-parse', '--is-inside-work-tree'], { cwd: path })
    // bare repo와 .git 디렉터리는 "false"를 출력하며 exit 0으로 끝난다 — stdout까지 확인한다
    if (check.exitCode !== 0 || check.stdout.trim() !== 'true') {
      throw new Error('선택한 폴더는 Git 저장소가 아니에요. .git 폴더가 있는 프로젝트 폴더를 선택해 주세요.')
    }
    return registerRepoPath(path)
  })

  ipcMain.handle(CHANNELS.repoInitialPath, async () => {
    const initial = process.env.GIT_GUI_E2E_REPO
    if (!initial) return null
    return registerRepoPath(initial)
  })

  ipcMain.handle(CHANNELS.repoStatus, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).repo.status(),
  )

  ipcMain.handle(CHANNELS.changesStage, (_event, repoPath: unknown, paths: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).changes.stage(assertStringArray(paths)),
  )

  ipcMain.handle(CHANNELS.changesUnstage, (_event, repoPath: unknown, paths: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).changes.unstage(assertStringArray(paths)),
  )

  ipcMain.handle(
    CHANNELS.changesDiff,
    (_event, repoPath: unknown, path: unknown, options: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).changes.diff(
        assertString(path),
        assertDiffOptions(options),
      ),
  )

  ipcMain.handle(CHANNELS.commitsCreate, (_event, repoPath: unknown, message: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).commits.create(assertString(message)),
  )
}
```

- [ ] **Step 2: preload 브리지 구현**

`apps/desktop/src/preload/index.ts` 전체 교체:
```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { DiffOptions, GitApi } from '@git-gui/ipc-contract'
import { CHANNELS, GIT_API_KEY } from '@git-gui/ipc-contract'

const api: GitApi = {
  repo: {
    select: () => ipcRenderer.invoke(CHANNELS.repoSelect),
    initialPath: () => ipcRenderer.invoke(CHANNELS.repoInitialPath),
    status: (repoPath) => ipcRenderer.invoke(CHANNELS.repoStatus, repoPath),
  },
  changes: {
    stage: (repoPath, paths) => ipcRenderer.invoke(CHANNELS.changesStage, repoPath, paths),
    unstage: (repoPath, paths) => ipcRenderer.invoke(CHANNELS.changesUnstage, repoPath, paths),
    diff: (repoPath, path, options: DiffOptions) =>
      ipcRenderer.invoke(CHANNELS.changesDiff, repoPath, path, options),
  },
  commits: {
    create: (repoPath, message) => ipcRenderer.invoke(CHANNELS.commitsCreate, repoPath, message),
  },
}

contextBridge.exposeInMainWorld(GIT_API_KEY, api)
```

- [ ] **Step 3: 빌드·타입 확인**

Run: `pnpm --filter @git-gui/desktop build && pnpm typecheck`
Expected: 오류 없음

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/git-handlers.ts apps/desktop/src/preload/index.ts
git commit -m "feat(desktop): git IPC 핸들러와 preload 브리지

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: renderer — 스토어와 최소 UI

**Files:**
- Create: `apps/desktop/src/renderer/src/store/repository-store.ts`
- Create: `apps/desktop/src/renderer/src/components/RepoPicker.tsx`, `.../ChangesPanel.tsx`, `.../DiffPanel.tsx`, `.../CommitForm.tsx`
- Create: `apps/desktop/src/renderer/src/app.css`
- Modify: `apps/desktop/src/renderer/src/App.tsx`, `apps/desktop/src/renderer/src/main.tsx`

레이어 규칙: 비즈니스 로직은 전부 스토어에 둔다. 컴포넌트는 props만 받는 프레젠테이션이며 `window.gitApi`를 직접 호출하지 않는다. `useMemo`/`useCallback`은 사용하지 않는다.

- [ ] **Step 1: 스토어 구현**

`apps/desktop/src/renderer/src/store/repository-store.ts`:
```ts
import { create } from 'zustand'
import type { FileChange, RepositoryStatus } from '@git-gui/domain'

const git = () => window.gitApi

export interface SelectedFile {
  change: FileChange
  staged: boolean
}

interface RepositoryStore {
  repoPath: string | null
  status: RepositoryStatus | null
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
}

/** IPC 에러 메시지의 Electron 래핑 접두사를 벗겨 사용자 메시지만 남긴다 */
function toErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
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
  selected: null,
  diffText: '',
  error: null,
  busy: false,

  async init() {
    await guard(set, get, async () => {
      const initial = await git().repo.initialPath()
      if (!initial) return
      set({ repoPath: initial, status: await git().repo.status(initial) })
    })
  },

  async openRepository() {
    await guard(set, get, async () => {
      const path = await git().repo.select()
      if (!path) return
      // guard가 재진입을 거부하므로 refresh()를 부르지 않고 status를 직접 조회한다
      set({ repoPath: path, selected: null, diffText: '', status: await git().repo.status(path) })
    })
  },

  async refresh() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      set({ status: await git().repo.status(repoPath) })
    })
  },

  async stage(paths) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().changes.stage(repoPath, paths)
      // stage 후에는 보고 있던 diff의 의미가 달라진다(오인 커밋 방지) — 선택을 비운다
      set({ selected: null, diffText: '', status: await git().repo.status(repoPath) })
    })
  },

  async unstage(paths) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().changes.unstage(repoPath, paths)
      set({ selected: null, diffText: '', status: await git().repo.status(repoPath) })
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
      set({ selected: null, diffText: '', status: await git().repo.status(repoPath) })
    })
  },
}))
```

- [ ] **Step 2: 프레젠테이션 컴포넌트 구현**

`apps/desktop/src/renderer/src/components/RepoPicker.tsx`:
```tsx
interface RepoPickerProps {
  onOpen(): void
  error: string | null
}

export function RepoPicker({ onOpen, error }: RepoPickerProps) {
  return (
    <div className="repo-picker">
      <h1>Git GUI</h1>
      <button type="button" onClick={onOpen}>
        저장소 열기
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
```

`apps/desktop/src/renderer/src/components/ChangesPanel.tsx`:
```tsx
import type { FileChange } from '@git-gui/domain'
import type { SelectedFile } from '../store/repository-store'

interface ChangesPanelProps {
  changes: FileChange[]
  selected: SelectedFile | null
  /** 작업 중에는 모든 버튼을 비활성화한다 — 연타로 git 작업이 겹치면 index.lock 충돌이 난다 */
  busy: boolean
  onStage(paths: string[]): void
  onUnstage(paths: string[]): void
  onSelect(selected: SelectedFile): void
}

export function ChangesPanel({ changes, selected, busy, onStage, onUnstage, onSelect }: ChangesPanelProps) {
  const stagedChanges = changes.filter((c) => c.staged !== null)
  const unstagedChanges = changes.filter((c) => c.unstaged !== null)

  return (
    <div className="changes-panel">
      <section>
        <h2>저장 예정 (staged) — {stagedChanges.length}</h2>
        <ul>
          {stagedChanges.map((change) => (
            <li
              key={`staged-${change.path}`}
              className={selected?.staged && selected.change.path === change.path ? 'selected' : ''}
            >
              <button
                type="button"
                className="file"
                disabled={busy}
                onClick={() => onSelect({ change, staged: true })}
              >
                {change.path} <em>{change.staged}</em>
              </button>
              <button type="button" disabled={busy} onClick={() => onUnstage([change.path])}>
                내리기
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>작업 중 (unstaged) — {unstagedChanges.length}</h2>
        <ul>
          {unstagedChanges.map((change) => (
            <li
              key={`unstaged-${change.path}`}
              className={selected && !selected.staged && selected.change.path === change.path ? 'selected' : ''}
            >
              <button
                type="button"
                className="file"
                disabled={busy}
                onClick={() => onSelect({ change, staged: false })}
              >
                {change.path} <em>{change.unstaged}</em>
              </button>
              <button type="button" disabled={busy} onClick={() => onStage([change.path])}>
                올리기
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
```

`apps/desktop/src/renderer/src/components/DiffPanel.tsx`:
```tsx
interface DiffPanelProps {
  path: string | null
  diffText: string
}

export function DiffPanel({ path, diffText }: DiffPanelProps) {
  if (!path) return <div className="diff-panel empty">파일을 선택하면 변경 내용이 보여요</div>
  return (
    <div className="diff-panel">
      <h2>{path}</h2>
      <pre>{diffText || '변경 내용이 없어요'}</pre>
    </div>
  )
}
```

`apps/desktop/src/renderer/src/components/CommitForm.tsx`:
```tsx
import { useState } from 'react'

interface CommitFormProps {
  stagedCount: number
  busy: boolean
  onCommit(message: string): Promise<boolean>
}

export function CommitForm({ stagedCount, busy, onCommit }: CommitFormProps) {
  const [message, setMessage] = useState('')
  const disabled = busy || stagedCount === 0 || message.trim().length === 0

  return (
    <form
      className="commit-form"
      onSubmit={(event) => {
        event.preventDefault()
        // 커밋이 실패하면(훅 거부, 충돌 상태 등) 입력한 메시지를 보존한다
        void onCommit(message).then((committed) => {
          if (committed) setMessage('')
        })
      }}
    >
      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="저장 메시지를 입력하세요"
        rows={3}
      />
      <button type="submit" disabled={disabled}>
        저장하기 (commit) — {stagedCount}개 파일
      </button>
    </form>
  )
}
```

- [ ] **Step 3: App 조립과 스타일**

`apps/desktop/src/renderer/src/App.tsx` 전체 교체:
```tsx
import { useEffect } from 'react'
import { ChangesPanel } from './components/ChangesPanel'
import { CommitForm } from './components/CommitForm'
import { DiffPanel } from './components/DiffPanel'
import { RepoPicker } from './components/RepoPicker'
import { useRepositoryStore } from './store/repository-store'

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

  return (
    <div className="app">
      <header>
        <strong>{store.repoPath}</strong>
        <span className="state">
          {status ? `${status.branch.name ?? '(detached)'} · ${status.state}` : '읽는 중…'}
        </span>
        <button type="button" onClick={() => void store.refresh()} disabled={store.busy}>
          새로고침
        </button>
      </header>
      {store.error && <p className="error">{store.error}</p>}
      <main>
        <ChangesPanel
          changes={status?.changes ?? []}
          selected={store.selected}
          busy={store.busy}
          onStage={(paths) => void store.stage(paths)}
          onUnstage={(paths) => void store.unstage(paths)}
          onSelect={(selected) => void store.selectFile(selected)}
        />
        <div className="right">
          <DiffPanel path={store.selected?.change.path ?? null} diffText={store.diffText} />
          <CommitForm
            stagedCount={stagedCount}
            busy={store.busy}
            onCommit={(message) => store.commit(message)}
          />
        </div>
      </main>
    </div>
  )
}
```

`apps/desktop/src/renderer/src/app.css` — 0단계 임시 스타일(디자인 토큰은 E0에서 도입):
```css
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; }
.app { display: flex; flex-direction: column; height: 100vh; }
.app header { display: flex; gap: 12px; align-items: center; padding: 10px 16px; border-bottom: 1px solid #ddd; }
.app main { display: grid; grid-template-columns: 320px 1fr; flex: 1; min-height: 0; }
.changes-panel { border-right: 1px solid #ddd; overflow-y: auto; padding: 8px; }
.changes-panel ul { list-style: none; padding: 0; margin: 0; }
.changes-panel li { display: flex; gap: 6px; padding: 2px 0; }
.changes-panel li.selected .file { font-weight: 700; }
.right { display: flex; flex-direction: column; min-height: 0; }
.diff-panel { flex: 1; overflow: auto; padding: 8px 16px; }
.diff-panel pre { font-size: 12px; white-space: pre-wrap; }
.commit-form { display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; border-top: 1px solid #ddd; }
.error { color: #b4232a; padding: 4px 16px; }
.repo-picker { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; gap: 16px; }
```

`apps/desktop/src/renderer/src/main.tsx`에 import 추가:
```tsx
import './app.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
```

- [ ] **Step 4: 빌드·수동 확인**

Run: `pnpm --filter @git-gui/desktop build && pnpm typecheck`
Expected: 오류 없음

Run(수동 확인 가능 환경일 때): `GIT_GUI_E2E_REPO=$(pwd) pnpm --filter @git-gui/desktop dev`
Expected: 이 저장소가 자동으로 열리고 변경 파일·diff·stage가 동작한다

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer
git commit -m "feat(desktop): 변경 파일·diff·stage/unstage·commit 최소 UI

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: E2E 스모크 테스트와 README 갱신

**Files:**
- Create: `apps/desktop/playwright.config.ts`, `apps/desktop/e2e/smoke.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: Playwright 설정**

`apps/desktop/playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { trace: 'retain-on-failure' },
})
```

- [ ] **Step 2: 실패하는 스모크 테스트 작성**

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

test('저장소 열기 → 변경 확인 → stage → commit', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()

    // 변경 파일이 보인다
    await expect(window.getByText('app.txt')).toBeVisible()

    // stage
    await window.getByRole('button', { name: '올리기' }).click()
    await expect(window.getByText('저장 예정 (staged) — 1')).toBeVisible()

    // commit
    await window.getByPlaceholder('저장 메시지를 입력하세요').fill('e2e: 첫 저장')
    await window.getByRole('button', { name: /저장하기/ }).click()
    await expect(window.getByText('저장 예정 (staged) — 0')).toBeVisible()
    await expect(window.getByText('작업 중 (unstaged) — 0')).toBeVisible()

    // 실제 커밋이 생겼는지 검증
    const log = await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: repo })
    expect(log.stdout.trim()).toBe('e2e: 첫 저장')
  } finally {
    // 단언이 실패해도 Electron 프로세스와 임시 저장소를 정리한다
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

- [ ] **Step 3: 실행 확인**

Run: `cd apps/desktop && pnpm exec playwright install chromium && pnpm e2e`
Expected: PASS (빌드 후 Electron이 뜨고 시나리오 통과). 헤드리스 CI 환경이면 xvfb가 필요할 수 있다 — 로컬(macOS)에서는 그대로 동작한다.

- [ ] **Step 4: README 갱신**

`README.md`의 "현재 상태"와 "다음 단계"를 갱신:

- 현재 상태 문단을 다음으로 교체:
```markdown
## 현재 상태

0단계(기반) 최소 수직 기능이 동작합니다: 저장소 열기, 상태 감지, 변경 파일 목록, diff 보기, stage/unstage, commit.

- [제품 목적과 범위](docs/PRODUCT_VISION.md)
- [Git 시나리오 카탈로그](docs/GIT_SCENARIOS.md)
- [쉬운 모드 설계](docs/superpowers/specs/2026-07-15-easy-mode-design.md)
- [기술 스택 설계](docs/superpowers/specs/2026-07-15-tech-stack-design.md)

### 요구사항

Node.js 22 이상, pnpm 10, git 2.28 이상

### 실행

pnpm install
pnpm --filter @git-gui/desktop dev   # 앱 실행
pnpm test                            # 단위·통합 테스트
pnpm --filter @git-gui/desktop e2e   # E2E 스모크 (Electron 창 실행)
```

- "다음 단계" 목록을 다음으로 교체:
```markdown
## 다음 단계

1. fetch/pull/push와 브랜치 생성·전환 (0단계 마무리)
2. 취소 가능한 Git 프로세스와 실행 로그
3. E0: 쉬운 모드 2패널 UI와 디자인 토큰 (React Aria)
4. 충돌 및 중단 상태별 테스트 fixture 확장
```

- [ ] **Step 5: 전체 검증 후 Commit**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build`
Expected: 모두 통과

```bash
git add apps/desktop/playwright.config.ts apps/desktop/e2e README.md
git commit -m "test(desktop): E2E 스모크 — 열기·stage·commit 수직 흐름

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
