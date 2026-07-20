import { execFile } from 'node:child_process'

export type CommandRunner = (command: string, args: string[]) => Promise<string>

/** execFile 얇은 래퍼 — 명령이 없거나 exit != 0이면 reject */
const defaultRunner: CommandRunner = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 5_000 }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })

/**
 * gh CLI가 로그인돼 있으면 그 토큰을 돌려준다 — 없거나 로그인 전이면 null (조용히).
 * gh는 git이 아니므로 git-process의 env 격리는 쓰지 않는다.
 */
export async function detectGhToken(runner: CommandRunner = defaultRunner): Promise<string | null> {
  try {
    const token = (await runner('gh', ['auth', 'token'])).trim()
    return token === '' ? null : token
  } catch {
    return null
  }
}
