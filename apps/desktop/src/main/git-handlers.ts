import { dialog, ipcMain, shell } from 'electron'
import { createGitClient } from '@git-gui/git-adapter'
import type { DiffOptions } from '@git-gui/domain'
import { execGit, execGitOrThrow } from '@git-gui/git-process'
import { CHANNELS } from '@git-gui/ipc-contract'
import { watchRepository } from './repo-watcher'
import { assertOpenableWorktree } from './worktree-open-guard'

/** main이 직접 검증해 돌려준 경로만 이후 요청에서 신뢰한다 — renderer는 경로를 만들어낼 수 없다 */
const allowedRepoPaths = new Set<string>()

export function assertAllowedRepo(repoPath: unknown): string {
  if (typeof repoPath !== 'string' || !allowedRepoPaths.has(repoPath)) {
    throw new Error('열려 있지 않은 저장소 경로예요. 저장소를 먼저 열어 주세요.')
  }
  return repoPath
}

export function assertString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('잘못된 요청 형식이에요.')
  return value
}

/**
 * 경로가 이 저장소의 워크트리인지 검증한다 (E7c 보안 가드) — renderer가 임의 경로를
 * 열거나(openPath) 쉘을 스폰하거나(terminal cwd) 노출(reveal)시키지 못하게 목록과 대조한다
 */
export async function assertWorktreePath(repoPath: string, candidate: unknown): Promise<string> {
  const path = assertString(candidate)
  const list = await createGitClient(repoPath).worktrees.list()
  if (!list.some((worktree) => worktree.path === path)) {
    throw new Error('이 저장소의 워크트리가 아니에요. 새로고침해 주세요.')
  }
  return path
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

/** stash ref 형식만 통과 — 임의 문자열이 stash 명령 인자로 흘러가는 것을 IPC 경계에서 차단 (adapter 검증은 심층 방어) */
function assertShelfRef(value: unknown): string {
  if (typeof value !== 'string' || !/^stash@\{\d{1,6}\}$/.test(value)) {
    throw new Error('잘못된 요청 형식이에요.')
  }
  return value
}

/** 충돌 확정 방향은 두 값만 — 임의 문자열이 checkout 인자로 흘러가는 것을 차단 */
function assertConflictChoice(value: unknown): 'ours' | 'theirs' {
  if (value !== 'ours' && value !== 'theirs') {
    throw new Error('잘못된 요청 형식이에요.')
  }
  return value
}

function assertBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('잘못된 요청 형식이에요.')
  return value
}

function assertNullableHash(value: unknown): string | null {
  if (value === null) return null
  return assertHash(value)
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

  // 저장소 감시 (E7b) — 한 번에 하나만. 새 경로가 오면 이전 감시를 교체한다.
  // 응답 대상은 invoke의 sender — window 배선 없이 push한다 (실측 3)
  let stopWatching: (() => void) | null = null
  // destroyed 정리는 sender당 1회만 등록한다 — watch 재호출마다 쌓이면 MaxListeners 경고 (통합 리뷰, terminal-handlers 관례)
  const watchCleanupHooked = new WeakSet<Electron.WebContents>()
  ipcMain.handle(CHANNELS.repoWatch, async (event, repoPath: unknown) => {
    const path = assertAllowedRepo(repoPath)
    // 링크드 워크트리의 .git은 파일이라 그대로 감시하면 죽는다(실측 H1) — 공용 git dir을 해석해 감시한다
    const gitDir = (
      await execGitOrThrow(['rev-parse', '--path-format=absolute', '--git-common-dir'], {
        cwd: path,
      })
    ).stdout.trim()
    stopWatching?.()
    const sender = event.sender
    stopWatching = watchRepository(gitDir, () => {
      if (!sender.isDestroyed()) sender.send(CHANNELS.repoChanged, path)
    })
    if (!watchCleanupHooked.has(sender)) {
      watchCleanupHooked.add(sender)
      sender.once('destroyed', () => {
        stopWatching?.()
        stopWatching = null
      })
    }
  })

  ipcMain.handle(CHANNELS.repoOpenPath, async (_event, repoPath: unknown, worktreePath: unknown) => {
    const root = assertAllowedRepo(repoPath)
    // 목록 대조 + prunable 친절 거부 (E7d ⑥) — reveal·terminal cwd는 기존 assertWorktreePath 유지
    const path = assertString(worktreePath)
    const list = await createGitClient(root).worktrees.list()
    assertOpenableWorktree(list, path)
    return registerRepoPath(path)
  })

  ipcMain.handle(CHANNELS.worktreesList, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).worktrees.list(),
  )

  ipcMain.handle(
    CHANNELS.worktreesAdd,
    (_event, repoPath: unknown, path: unknown, branch: unknown, createBranch: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).worktrees.add(
        assertString(path),
        assertString(branch),
        { createBranch: assertBoolean(createBranch) },
      ),
  )

  ipcMain.handle(
    CHANNELS.worktreesRemove,
    (_event, repoPath: unknown, path: unknown, force: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).worktrees.remove(
        assertString(path),
        assertBoolean(force),
      ),
  )

  ipcMain.handle(CHANNELS.worktreesReveal, async (_event, repoPath: unknown, path: unknown) => {
    const root = assertAllowedRepo(repoPath)
    const target = await assertWorktreePath(root, path)
    shell.showItemInFolder(target)
  })

  ipcMain.handle(CHANNELS.branchesList, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).branches.list(),
  )

  ipcMain.handle(
    CHANNELS.branchesCreate,
    (_event, repoPath: unknown, name: unknown, fromHash: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).branches.create(
        assertString(name),
        assertNullableHash(fromHash),
      ),
  )

  ipcMain.handle(CHANNELS.branchesSwitch, (_event, repoPath: unknown, name: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).branches.switch(assertString(name)),
  )

  ipcMain.handle(CHANNELS.branchesMerge, (_event, repoPath: unknown, name: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).branches.merge(assertString(name)),
  )

  ipcMain.handle(
    CHANNELS.branchesRemove,
    (_event, repoPath: unknown, name: unknown, force: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).branches.remove(
        assertString(name),
        assertBoolean(force),
      ),
  )

  ipcMain.handle(
    CHANNELS.branchesRename,
    (_event, repoPath: unknown, oldName: unknown, newName: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).branches.rename(
        assertString(oldName),
        assertString(newName),
      ),
  )

  ipcMain.handle(CHANNELS.branchesOverview, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).branches.overview(),
  )

  ipcMain.handle(CHANNELS.branchesUpdate, (_event, repoPath: unknown, name: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).branches.update(assertString(name)),
  )

  ipcMain.handle(CHANNELS.branchesBackup, (_event, repoPath: unknown, name: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).branches.backup(assertString(name)),
  )

  ipcMain.handle(CHANNELS.branchesCheckoutRemote, (_event, repoPath: unknown, name: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).branches.checkoutRemote(assertString(name)),
  )

  ipcMain.handle(CHANNELS.branchesRemoveRemote, (_event, repoPath: unknown, name: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).branches.removeRemote(assertString(name)),
  )

  ipcMain.handle(CHANNELS.branchesCompare, (_event, repoPath: unknown, name: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).branches.compare(assertString(name)),
  )

  ipcMain.handle(CHANNELS.rebaseStart, (_event, repoPath: unknown, onto: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).rebase.start(assertString(onto)),
  )

  ipcMain.handle(CHANNELS.rebaseContinue, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).rebase.continue(),
  )

  ipcMain.handle(CHANNELS.rebaseAbort, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).rebase.abort(),
  )

  ipcMain.handle(CHANNELS.rebaseProgress, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).rebase.progress(),
  )

  ipcMain.handle(CHANNELS.mergeAbort, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).merge.abort(),
  )

  ipcMain.handle(
    CHANNELS.conflictsResolve,
    (_event, repoPath: unknown, path: unknown, choice: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).conflicts.resolve(
        assertString(path),
        assertConflictChoice(choice),
      ),
  )

  ipcMain.handle(CHANNELS.conflictsMarkResolved, (_event, repoPath: unknown, path: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).conflicts.markResolved(assertString(path)),
  )

  ipcMain.handle(
    CHANNELS.conflictsSaveText,
    (_event, repoPath: unknown, path: unknown, content: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).conflicts.saveText(
        assertString(path),
        assertString(content),
      ),
  )

  ipcMain.handle(CHANNELS.conflictsReset, (_event, repoPath: unknown, path: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).conflicts.reset(assertString(path)),
  )

  ipcMain.handle(CHANNELS.commitsRevert, (_event, repoPath: unknown, hash: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).commits.revert(assertHash(hash)),
  )

  ipcMain.handle(CHANNELS.commitsRevertAbort, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).commits.revertAbort(),
  )

  ipcMain.handle(CHANNELS.commitsCherryPick, (_event, repoPath: unknown, hash: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).commits.cherryPick(assertHash(hash)),
  )

  ipcMain.handle(CHANNELS.commitsCherryPickAbort, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).commits.cherryPickAbort(),
  )

  ipcMain.handle(
    CHANNELS.commitsCreateTag,
    (_event, repoPath: unknown, name: unknown, hash: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).commits.createTag(
        assertString(name),
        assertHash(hash),
      ),
  )

  ipcMain.handle(CHANNELS.commitsUndoLast, (_event, repoPath: unknown, hash: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).commits.undoLast(assertHash(hash)),
  )

  ipcMain.handle(
    CHANNELS.commitsReword,
    (_event, repoPath: unknown, hash: unknown, message: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).commits.reword(
        assertHash(hash),
        assertString(message),
      ),
  )

  ipcMain.handle(CHANNELS.filesReadText, (_event, repoPath: unknown, path: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).files.readText(assertString(path)),
  )

  ipcMain.handle(CHANNELS.shelfSave, (_event, repoPath: unknown, message: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).shelf.save(assertString(message)),
  )

  ipcMain.handle(CHANNELS.shelfList, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).shelf.list(),
  )

  ipcMain.handle(CHANNELS.shelfRestore, (_event, repoPath: unknown, ref: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).shelf.restore(assertShelfRef(ref)),
  )

  ipcMain.handle(CHANNELS.shelfDrop, (_event, repoPath: unknown, ref: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).shelf.drop(assertShelfRef(ref)),
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

  ipcMain.handle(
    CHANNELS.commitsRestoreFile,
    (_event, repoPath: unknown, hash: unknown, path: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).commits.restoreFile(
        assertHash(hash),
        assertString(path),
      ),
  )

  ipcMain.handle(
    CHANNELS.commitsDiffWorktree,
    (_event, repoPath: unknown, hash: unknown, path: unknown, origPath: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).commits.diffAgainstWorktree(
        assertHash(hash),
        assertString(path),
        assertNullableString(origPath),
      ),
  )

  ipcMain.handle(CHANNELS.changesRemoveFile, (_event, repoPath: unknown, path: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).changes.removeFile(assertString(path)),
  )

  ipcMain.handle(CHANNELS.historyList, (_event, repoPath: unknown, limit: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).history.list(assertLimit(limit)),
  )

  ipcMain.handle(CHANNELS.syncPush, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).sync.push(),
  )

  ipcMain.handle(CHANNELS.syncPull, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).sync.pull(),
  )
}
