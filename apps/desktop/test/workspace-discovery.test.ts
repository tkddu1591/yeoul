import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { workspaceDiscovery } from '../src/main/workspace-discovery'

const cleanupPaths: string[] = []

async function createTemporaryFolder(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'yeoul-workspace-'))
  cleanupPaths.push(path)
  return path
}

function git(path: string, ...args: string[]): string {
  return execFileSync('git', ['-C', path, ...args], { encoding: 'utf8' }).trim()
}

async function initializeRepository(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
  git(path, 'init', '-q')
}

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('workspaceDiscovery.folder.scan', () => {
  it('껍데기 폴더 아래의 독립 저장소를 상대 경로 순으로 찾는다', async () => {
    const workspace = await createTemporaryFolder()
    await initializeRepository(join(workspace, 'back'))
    await initializeRepository(join(workspace, 'front'))

    const result = await workspaceDiscovery.folder.scan(workspace)

    expect(result.path).toBe(await realpath(workspace))
    expect(result.repositories.map((repository) => repository.relativePath)).toEqual(['back', 'front'])
  })

  it('저장소 내부 폴더를 고르면 기존 선택 동작처럼 저장소 루트로 올린다', async () => {
    const workspace = await createTemporaryFolder()
    const repository = join(workspace, 'project')
    const child = join(repository, 'src', 'feature')
    await initializeRepository(repository)
    await mkdir(child, { recursive: true })

    const result = await workspaceDiscovery.folder.scan(child)

    const repositoryPath = await realpath(repository)
    expect(result.path).toBe(repositoryPath)
    expect(result.repositories).toEqual([
      { path: repositoryPath, relativePath: '.', name: 'project' },
    ])
  })

  it('의존성·빌드 폴더는 검색하지 않는다', async () => {
    const workspace = await createTemporaryFolder()
    await initializeRepository(join(workspace, 'app'))
    await initializeRepository(join(workspace, 'node_modules', 'nested-package'))
    await initializeRepository(join(workspace, 'dist', 'generated-repo'))

    const result = await workspaceDiscovery.folder.scan(workspace)

    expect(result.repositories.map((repository) => repository.relativePath)).toEqual(['app'])
  })

  it('링크드 워크트리는 별도 저장소로 중복 표시하지 않고 본체 아래 워크트리로 남긴다', async () => {
    const workspace = await createTemporaryFolder()
    const repository = join(workspace, 'main')
    const linked = join(workspace, 'linked')
    await initializeRepository(repository)
    git(repository, 'config', 'user.name', 'Yeoul Test')
    git(repository, 'config', 'user.email', 'yeoul@example.test')
    await writeFile(join(repository, 'README.md'), 'workspace test\n')
    git(repository, 'add', 'README.md')
    git(repository, 'commit', '-q', '-m', 'initial')
    git(repository, 'worktree', 'add', '-q', '-b', 'feature', linked)

    const result = await workspaceDiscovery.folder.scan(workspace)

    const repositoryPath = await realpath(repository)
    expect(result.repositories).toEqual([
      { path: repositoryPath, relativePath: 'main', name: 'main' },
    ])
  })
})
