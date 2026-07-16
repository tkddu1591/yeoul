import {
  detectState,
  type CommitSummary,
  type DiffOptions,
  type FileDiff,
  type RepositoryStatus,
} from '@git-gui/domain'
import { execGit, execGitOrThrow, GitError } from '@git-gui/git-process'
import { parseLog } from './log-parser'
import { parsePatch } from './diff-parser'
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
    diff(path: string, options: DiffOptions): Promise<FileDiff>
  }
  history: {
    /** 최신순 커밋 요약. limit은 1~500으로 잘린다 */
    list(limit: number): Promise<CommitSummary[]>
  }
  sync: {
    /** 현재 브랜치를 원격으로 백업한다. upstream이 없으면 첫 remote에 연결하며 올린다 */
    push(): Promise<void>
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
        // -uall: 미추적 디렉터리를 접지 않고 파일 단위로 나열한다 — 접힌 `dir/` 행은
        // 이름 없는 행·diff 에러·stage/unstage 왕복 시 경로 정체성 문제를 만든다.
        // (알려진 한계: 거대한 미추적 트리는 행이 폭발한다 — E0-3b 가상화에서 흡수)
        const raw = await execGitOrThrow(['status', '--porcelain=v2', '--branch', '-uall', '-z'], { cwd })
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
          return parsePatch(result.stdout)
        }
        const args = options.staged
          ? ['diff', '--cached', '--no-color', '--no-ext-diff', '--', `:(literal)${path}`]
          : ['diff', '--no-color', '--no-ext-diff', '--', `:(literal)${path}`]
        return parsePatch((await execGitOrThrow(args, { cwd })).stdout)
      },
    },
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
          '--format=%H%x1f%h%x1f%an%x1f%ct%x1f%D%x1f%P%x1f%s',
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
    sync: {
      async push() {
        const cwd = await topLevel()
        const remotes = await execGitOrThrow(['remote'], { cwd })
        const remoteNames = remotes.stdout
          .trim()
          .split('\n')
          .filter((name) => name !== '')
        if (remoteNames.length === 0) {
          throw new Error('백업할 원격 저장소가 없어요. 먼저 원격 저장소를 연결해 주세요.')
        }
        // 사용자 직관대로 origin을 우선하고, 없으면 (git remote 출력 = 알파벳순) 첫 remote
        const targetRemote = remoteNames.includes('origin') ? 'origin' : remoteNames[0]!
        const upstream = await execGit(
          ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
          { cwd },
        )
        if (upstream.exitCode === 0) {
          // push.default=matching 같은 사용자 전역 설정이 다른 브랜치까지 올리지 않게 고정한다
          await execGitOrThrow(['-c', 'push.default=simple', 'push'], { cwd })
          return
        }
        // 아직 커밋이 없으면 올릴 것이 없다 — 원문 git 에러 대신 읽히는 메시지로
        const head = await execGit(['rev-parse', '-q', '--verify', 'HEAD'], { cwd })
        if (head.exitCode !== 0) {
          throw new Error('아직 저장된 시점이 없어요. 먼저 저장(commit)한 뒤 백업해 주세요.')
        }
        // detached HEAD에서는 올릴 브랜치가 없다 — 원문 git 에러 대신 읽히는 메시지로
        const branch = await execGit(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd })
        if (branch.exitCode !== 0) {
          throw new Error('지금은 브랜치가 아닌 시점에 있어요. 브랜치로 이동한 뒤 백업해 주세요.')
        }
        // 첫 백업 — 현재 브랜치를 remote에 연결하며 올린다 (이후 ahead/behind가 표시된다).
        // --end-of-options: 대시로 시작하는 remote 이름이 플래그로 해석되는 것을 차단
        await execGitOrThrow(['push', '-u', '--end-of-options', targetRemote, 'HEAD'], { cwd })
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
