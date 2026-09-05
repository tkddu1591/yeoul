import { readdir, realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { execGit } from '@git-gui/git-process'
import type { WorkspaceInfo, WorkspaceRepository } from '@git-gui/ipc-contract'

const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.next',
  '.turbo',
  '.yarn',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'Pods',
  'target',
  'vendor',
])

/** 큰 홈 폴더를 실수로 골라도 앱이 끝없이 디스크를 훑지 않게 하는 안전 상한. */
const MAX_SCANNED_DIRECTORIES = 10_000

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..')
}

interface RepositoryMetadata {
  path: string
  identity: string
  isMainWorktree: boolean
}

function absoluteGitPath(repositoryPath: string, gitPath: string): string {
  return isAbsolute(gitPath) ? gitPath : resolve(repositoryPath, gitPath)
}

async function getRepositoryMetadata(path: string): Promise<RepositoryMetadata | null> {
  const inside = await execGit(['rev-parse', '--is-inside-work-tree'], { cwd: path }).catch(
    () => null,
  )
  if (inside === null || inside.exitCode !== 0 || inside.stdout.trim() !== 'true') return null
  const [topLevel, commonDirectory, gitDirectory] = await Promise.all([
    execGit(['rev-parse', '--show-toplevel'], { cwd: path }).catch(() => null),
    execGit(['rev-parse', '--git-common-dir'], { cwd: path }).catch(() => null),
    execGit(['rev-parse', '--git-dir'], { cwd: path }).catch(() => null),
  ])
  if (
    topLevel === null ||
    commonDirectory === null ||
    gitDirectory === null ||
    topLevel.exitCode !== 0 ||
    commonDirectory.exitCode !== 0 ||
    gitDirectory.exitCode !== 0
  ) {
    return null
  }
  const repositoryPath = topLevel.stdout.trim()
  const identity = absoluteGitPath(repositoryPath, commonDirectory.stdout.trim())
  const gitPath = absoluteGitPath(repositoryPath, gitDirectory.stdout.trim())
  return { path: repositoryPath, identity, isMainWorktree: identity === gitPath }
}

async function findRepositoryCandidates(root: string, signal?: AbortSignal): Promise<string[]> {
  const candidates = new Set<string>()
  const selectedRepository = await getRepositoryMetadata(root)
  if (selectedRepository !== null) candidates.add(selectedRepository.path)

  const queue = [root]
  let scanned = 0
  while (queue.length > 0) {
    signal?.throwIfAborted()
    const directory = queue.shift()!
    scanned += 1
    if (scanned > MAX_SCANNED_DIRECTORIES) {
      throw new Error(
        '폴더가 너무 커서 저장소 검색을 중단했어요. 저장소들을 바로 감싸는 더 가까운 폴더를 선택해 주세요.',
      )
    }

    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (cause) {
      if (directory === root) throw cause
      continue
    }

    if (entries.some((entry) => entry.name === '.git')) candidates.add(directory)
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      if (IGNORED_DIRECTORY_NAMES.has(entry.name)) continue
      queue.push(resolve(directory, entry.name))
    }
  }
  return [...candidates]
}

async function scanFolder(selectedPath: string, signal?: AbortSignal): Promise<WorkspaceInfo> {
  const selectedRealPath = await realpath(selectedPath)
  // 저장소 안쪽 폴더를 골랐다면 기존 동작처럼 저장소 루트까지 올린다. 껍데기 폴더라면
  // 선택한 위치 자체가 워크스페이스 루트다.
  const selectedRepository = await getRepositoryMetadata(selectedRealPath)
  const root = selectedRepository?.path ?? selectedRealPath
  const candidates = await findRepositoryCandidates(root, signal)
  const repositoriesByIdentity = new Map<
    string,
    { repository: WorkspaceRepository; isMainWorktree: boolean }
  >()

  for (const candidate of candidates) {
    signal?.throwIfAborted()
    const metadata = await getRepositoryMetadata(candidate)
    if (metadata === null || !isInside(root, metadata.path)) continue
    const relativePath = relative(root, metadata.path) || '.'
    const repository = {
      path: metadata.path,
      relativePath,
      name: basename(metadata.path),
    }
    const current = repositoriesByIdentity.get(metadata.identity)
    if (current === undefined || (!current.isMainWorktree && metadata.isMainWorktree)) {
      repositoriesByIdentity.set(metadata.identity, {
        repository,
        isMainWorktree: metadata.isMainWorktree,
      })
    }
  }

  const repositories = [...repositoriesByIdentity.values()]
    .map((entry) => entry.repository)
    .sort((left, right) => {
      if (left.relativePath === '.') return -1
      if (right.relativePath === '.') return 1
      return left.relativePath.localeCompare(right.relativePath)
    })
  if (repositories.length === 0) {
    throw new Error(
      '이 폴더와 하위 폴더에서 Git 저장소를 찾지 못했어요. 저장소가 들어 있는 상위 폴더를 선택해 주세요.',
    )
  }

  return { path: root, name: basename(root), repositories }
}

/** 워크스페이스 파일 탐색 경계. Git 명령 실행과 디렉터리 순회는 main 레이어에서만 한다. */
export const workspaceDiscovery = {
  folder: {
    scan: scanFolder,
  },
}
