import { dialog, ipcMain } from 'electron'
import { createGitClient } from '@git-gui/git-adapter'
import type { DiffOptions } from '@git-gui/domain'
import { execGit, execGitOrThrow } from '@git-gui/git-process'
import { CHANNELS } from '@git-gui/ipc-contract'

/** main이 직접 검증해 돌려준 경로만 이후 요청에서 신뢰한다 — renderer는 경로를 만들어낼 수 없다 */
const allowedRepoPaths = new Set<string>()

function assertAllowedRepo(repoPath: unknown): string {
  if (typeof repoPath !== 'string' || !allowedRepoPaths.has(repoPath)) {
    throw new Error('열려 있지 않은 저장소 경로예요. 저장소를 먼저 열어 주세요.')
  }
  return repoPath
}

function assertString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('잘못된 요청 형식이에요.')
  return value
}

function assertStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('잘못된 요청 형식이에요.')
  // sparse array의 hole은 every가 건너뛰어 통과된다 — 실체화(undefined로 변환)한 뒤 검사한다
  const items = [...(value as unknown[])]
  if (!items.every((item): item is string => typeof item === 'string')) {
    throw new Error('잘못된 요청 형식이에요.')
  }
  return items
}

function assertDiffOptions(value: unknown): DiffOptions {
  const candidate = value as DiffOptions | null
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof candidate.staged !== 'boolean' ||
    typeof candidate.untracked !== 'boolean' ||
    (candidate.origPath != null && typeof candidate.origPath !== 'string')
  ) {
    throw new Error('잘못된 요청 형식이에요.')
  }
  // 잉여 필드가 하류로 밀수되지 않도록 알려진 필드만 복사한다
  return { staged: candidate.staged, untracked: candidate.untracked, origPath: candidate.origPath ?? null }
}

function assertLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10000) {
    throw new Error('잘못된 요청 형식이에요.')
  }
  return value
}

/** 40자 hex 전체 해시만 통과 — ref 표현식·옵션 문자열 밀수를 IPC 경계에서 차단한다 (adapter의 검증은 심층 방어) */
function assertHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error('잘못된 요청 형식이에요.')
  }
  return value
}

function assertNullableString(value: unknown): string | null {
  if (value === null) return null
  return assertString(value)
}

/** 하위 폴더를 선택해도 저장소 루트로 정규화해 allowlist에 기록한다 */
async function registerRepoPath(path: string): Promise<string> {
  const topLevel = (
    await execGitOrThrow(['rev-parse', '--show-toplevel'], { cwd: path })
  ).stdout.trim()
  allowedRepoPaths.add(topLevel)
  return topLevel
}

export function registerGitHandlers(): void {
  ipcMain.handle(CHANNELS.repoSelect, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    const path = result.filePaths[0]!
    const check = await execGit(['rev-parse', '--is-inside-work-tree'], { cwd: path })
    // bare repo와 .git 디렉터리는 "false"를 출력하며 exit 0으로 끝난다 — stdout까지 확인한다
    if (check.exitCode !== 0 || check.stdout.trim() !== 'true') {
      throw new Error('선택한 폴더는 Git 저장소가 아니에요. .git 폴더가 있는 프로젝트 폴더를 선택해 주세요.')
    }
    return registerRepoPath(path)
  })

  ipcMain.handle(CHANNELS.repoInitialPath, async () => {
    const initial = process.env.GIT_GUI_E2E_REPO
    if (!initial) return null
    return registerRepoPath(initial)
  })

  ipcMain.handle(CHANNELS.repoStatus, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).repo.status(),
  )

  ipcMain.handle(CHANNELS.changesStage, (_event, repoPath: unknown, paths: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).changes.stage(assertStringArray(paths)),
  )

  ipcMain.handle(CHANNELS.changesUnstage, (_event, repoPath: unknown, paths: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).changes.unstage(assertStringArray(paths)),
  )

  ipcMain.handle(
    CHANNELS.changesDiscard,
    (_event, repoPath: unknown, trackedPaths: unknown, untrackedPaths: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).changes.discard(
        assertStringArray(trackedPaths),
        assertStringArray(untrackedPaths),
      ),
  )

  ipcMain.handle(
    CHANNELS.changesDiff,
    (_event, repoPath: unknown, path: unknown, options: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).changes.diff(
        assertString(path),
        assertDiffOptions(options),
      ),
  )

  ipcMain.handle(CHANNELS.commitsCreate, (_event, repoPath: unknown, message: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).commits.create(assertString(message)),
  )

  ipcMain.handle(CHANNELS.commitsShow, (_event, repoPath: unknown, hash: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).commits.show(assertHash(hash)),
  )

  ipcMain.handle(
    CHANNELS.commitsDiffFile,
    (_event, repoPath: unknown, hash: unknown, path: unknown, origPath: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).commits.diffFile(
        assertHash(hash),
        assertString(path),
        assertNullableString(origPath),
      ),
  )

  ipcMain.handle(CHANNELS.historyList, (_event, repoPath: unknown, limit: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).history.list(assertLimit(limit)),
  )

  ipcMain.handle(CHANNELS.syncPush, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).sync.push(),
  )
}
