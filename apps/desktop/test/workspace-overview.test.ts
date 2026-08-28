import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { WorkspaceInfo } from '@git-gui/ipc-contract'
import { workspaceOverview } from '../src/main/workspace-overview'

const cleanupPaths: string[] = []

function git(path: string, ...args: string[]): string {
  return execFileSync('git', ['-C', path, ...args], { encoding: 'utf8' }).trim()
}

async function createRepository(path: string, branch: string): Promise<string> {
  await mkdir(path, { recursive: true })
  git(path, 'init', '-q', '-b', 'main')
  git(path, 'config', 'user.name', 'Yeoul Test')
  git(path, 'config', 'user.email', 'yeoul@example.test')
  await writeFile(join(path, 'README.md'), `${branch}\n`)
  git(path, 'add', 'README.md')
  git(path, 'commit', '-q', '-m', 'initial')
  git(path, 'branch', branch)
  return realpath(path)
}

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('workspaceOverview.repositories.get', () => {
  it('모든 저장소의 변경·브랜치·워크트리·이력을 저장소별로 병렬 집계한다', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yeoul-workspace-overview-'))
    cleanupPaths.push(root)
    const back = await createRepository(join(root, 'back'), 'api')
    const front = await createRepository(join(root, 'front'), 'ui')
    git(back, 'worktree', 'add', '-q', join(root, 'back-api'), 'api')

    const workspace: WorkspaceInfo = {
      path: await realpath(root),
      name: root.split('/').pop()!,
      repositories: [
        { path: back, relativePath: 'back', name: 'back' },
        { path: front, relativePath: 'front', name: 'front' },
      ],
    }

    const result = await workspaceOverview.repositories.get(workspace)

    expect(result.repositories[0]?.branches?.locals.map((branch) => branch.name)).toEqual([
      'api',
      'main',
    ])
    expect(result.repositories[0]?.worktrees).toHaveLength(2)
    expect(result.repositories[0]?.status?.branch.name).toBe('main')
    expect(result.repositories[0]?.history?.[0]?.subject).toBe('initial')
    expect(result.repositories[1]?.branches?.locals.map((branch) => branch.name)).toEqual([
      'main',
      'ui',
    ])
    expect(result.repositories[1]?.worktrees).toHaveLength(1)
    expect(result.repositories[1]?.status?.changes).toEqual([])
    expect(result.repositories[1]?.history).toHaveLength(1)
  })
})
