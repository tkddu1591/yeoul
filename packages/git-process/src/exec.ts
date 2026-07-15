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
}

export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly result: GitResult,
  ) {
    super(`git ${args.join(' ')} failed (exit ${result.exitCode}): ${result.stderr.trim()}`)
    this.name = 'GitError'
  }
}

/** 부모 환경에서 저장소 해석에 영향을 주는 변수를 제거해 실행을 격리한다 */
const REMOVED_ENV_KEYS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'] as const

export async function execGit(args: string[], options: GitExecOptions): Promise<GitResult> {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of REMOVED_ENV_KEYS) delete env[key]
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_OPTIONAL_LOCKS = '0'

  return new Promise<GitResult>((resolve, reject) => {
    const child = spawn('git', args, { cwd: options.cwd, env, signal: options.signal })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => (stdout += chunk))
    child.stderr.on('data', (chunk: string) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }))
    if (options.stdin != null) child.stdin.write(options.stdin)
    child.stdin.end()
  })
}

export async function execGitOrThrow(args: string[], options: GitExecOptions): Promise<GitResult> {
  const result = await execGit(args, options)
  if (result.exitCode !== 0) throw new GitError(args, result)
  return result
}
