import { detectState, type RepositoryStatus } from '@git-gui/domain'
import { execGit, execGitOrThrow, GitError } from '@git-gui/git-process'
import { readGitDirMarkers } from './markers'
import { parseStatusV2 } from './status-parser'

export interface DiffOptions {
  staged: boolean
  untracked: boolean
}

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
