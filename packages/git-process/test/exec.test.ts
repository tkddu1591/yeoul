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
})

describe('execGitOrThrow', () => {
  it('실패 시 stderr를 담은 GitError를 던진다', async () => {
    const cwd = await tempDir()
    await expect(execGitOrThrow(['rev-parse', 'HEAD'], { cwd })).rejects.toBeInstanceOf(GitError)
  })
})
