import { spawn } from 'node:child_process'

const activeProcesses = new Map<string, Set<ReturnType<typeof spawn>>>()

export interface GitExecutionEvent {
  operation: string
  cwd: string
  durationMs: number
  exitCode: number
  signal: NodeJS.Signals | null
}

type GitExecutionListener = (event: GitExecutionEvent) => void
const executionListeners = new Set<GitExecutionListener>()

/** main 프로세스가 로컬 진단 로그를 남길 수 있는 읽기 전용 실행 완료 스트림. 명령 인자는 노출하지 않는다. */
export const gitExecutionEvents = {
  subscribe(listener: GitExecutionListener): () => void {
    executionListeners.add(listener)
    return () => executionListeners.delete(listener)
  },
}

function publishExecution(event: GitExecutionEvent): void {
  for (const listener of executionListeners) {
    try {
      listener(event)
    } catch {
      // 관찰자(진단 기록)의 실패가 Git 작업 결과를 바꾸면 안 된다.
    }
  }
}

function getOperation(args: readonly string[]): string {
  if (args[0] !== '-c') return args[0] ?? 'unknown'
  return args[2] ?? 'unknown'
}

/** 현재 저장소에서 실행 중인 Git 프로세스를 중단한다. 반환값은 신호를 보낸 프로세스 수다. */
export function cancelGitProcesses(cwd: string): number {
  const processes = activeProcesses.get(cwd)
  if (processes === undefined) return 0
  let canceled = 0
  for (const process of processes) {
    if (process.killed) continue
    process.kill('SIGTERM')
    canceled += 1
  }
  return canceled
}

export interface GitExecOptions {
  cwd: string
  stdin?: string
  signal?: AbortSignal
  /** 커밋 객체 생성에 필요한 제한된 작성자 메타데이터만 허용된다. */
  env?: Partial<Record<'GIT_AUTHOR_NAME' | 'GIT_AUTHOR_EMAIL' | 'GIT_AUTHOR_DATE', string>>
  /** 무기한 멈춤 방지. 기본 5분, 0이면 타임아웃 없음. */
  timeoutMs?: number
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
      result.signal === 'SIGTERM'
        ? 'Git 작업이 중단됐어요. 사용자가 중단했거나 제한 시간을 넘겼을 수 있어요.'
        :
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
  env.LC_ALL = 'C' // stderr 메시지를 영어로 고정 — unborn 감지 등 문자열 매칭의 로케일 의존 제거
  if (options.env?.GIT_AUTHOR_NAME !== undefined) env.GIT_AUTHOR_NAME = options.env.GIT_AUTHOR_NAME
  if (options.env?.GIT_AUTHOR_EMAIL !== undefined) env.GIT_AUTHOR_EMAIL = options.env.GIT_AUTHOR_EMAIL
  if (options.env?.GIT_AUTHOR_DATE !== undefined) env.GIT_AUTHOR_DATE = options.env.GIT_AUTHOR_DATE

  return new Promise<GitResult>((resolve, reject) => {
    const startedAt = Date.now()
    const child = spawn('git', args, { cwd: options.cwd, env, signal: options.signal })
    const processes = activeProcesses.get(options.cwd) ?? new Set<ReturnType<typeof spawn>>()
    processes.add(child)
    activeProcesses.set(options.cwd, processes)
    const forget = () => {
      processes.delete(child)
      if (processes.size === 0) activeProcesses.delete(options.cwd)
    }
    const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000
    const timeout =
      timeoutMs > 0
        ? setTimeout(() => {
            child.kill('SIGTERM')
          }, timeoutMs)
        : null
    timeout?.unref()
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => (stdout += chunk))
    child.stderr.on('data', (chunk: string) => (stderr += chunk))
    child.on('error', (cause) => {
      if (timeout !== null) clearTimeout(timeout)
      forget()
      reject(cause)
    })
    child.on('close', (code, signal) => {
      if (timeout !== null) clearTimeout(timeout)
      forget()
      const result = { stdout, stderr, exitCode: code ?? -1, signal }
      publishExecution({
        operation: getOperation(args),
        cwd: options.cwd,
        durationMs: Date.now() - startedAt,
        exitCode: result.exitCode,
        signal,
      })
      resolve(result)
    })
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
