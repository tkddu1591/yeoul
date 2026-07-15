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

export function createGitClient(repoPath: string): GitClient {
  const cwd = repoPath
  return {
    repo: {
      async status() {
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
        await execGitOrThrow(['add', '-A', '--', ...paths], { cwd })
      },
      async unstage(paths) {
        await execGitOrThrow(['restore', '--staged', '--', ...paths], { cwd })
      },
      async diff(path, options) {
        if (options.untracked) {
          // --no-index는 차이가 있으면 exit 1이 정상이다
          const args = ['diff', '--no-color', '--no-index', '--', NULL_DEVICE, path]
          const result = await execGit(args, { cwd })
          if (result.exitCode > 1) throw new GitError(args, result)
          return result.stdout
        }
        const args = options.staged
          ? ['diff', '--cached', '--no-color', '--', path]
          : ['diff', '--no-color', '--', path]
        return (await execGitOrThrow(args, { cwd })).stdout
      },
    },
    commits: {
      async create(message) {
        // 메시지는 stdin으로 전달해 따옴표·개행 이스케이프 문제를 피한다
        await execGitOrThrow(['commit', '-F', '-'], { cwd, stdin: message })
      },
    },
  }
}
