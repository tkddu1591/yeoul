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
      // 일부 명령(commit의 "nothing to commit" 등)은 설명을 stdout으로 낸다 — stderr가 비면 stdout으로 폴백
      `git ${args.join(' ')} failed (exit ${result.exitCode}${
        result.signal ? `, signal ${result.signal}` : ''
      }): ${result.stderr.trim() || result.stdout.trim()}`,
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
