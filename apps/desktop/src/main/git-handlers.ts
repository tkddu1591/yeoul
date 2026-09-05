import { applicationActivity } from './application-activity'
import { onboardingJobs } from './onboarding-jobs'
import { stat } from 'node:fs/promises'
import { app, dialog, ipcMain, shell } from 'electron'
import { createGitClient } from '@git-gui/git-adapter'
import type {
  DiffOptions,
  DiscardChangesRequest,
  FileMutationGuard,
  HunkStageRequest,
  LineStageRequest,
  RemoveFileRequest,
  PushConfirmation,
} from '@git-gui/domain'
import { cancelGitProcesses, execGit, execGitOrThrow, type GitResult } from '@git-gui/git-process'
import {
  CHANNELS,
  type RepoOpenResult,
  type WorkspaceChangeBatch,
  type WorkspaceChangeResult,
} from '@git-gui/ipc-contract'
import { watchRepository, watchWorkingTree } from './repo-watcher'
import {
  assertAbsoluteRepoPath,
  isMissingDirectoryError,
  repoGone,
  repoNotARepository,
  repoOpenUnchecked,
} from './repo-open-guard'
import { assertOpenableWorktree } from './worktree-open-guard'
import type { WindowRegistry } from './window-registry'
import { workspaceDiscovery } from './workspace-discovery'
import { RepositoryMutationQueue } from './repository-mutation-queue'

/** `.catch((cause) => cause)`로 합쳐 받은 값이 결과인지 오류인지 가른다 (repoOpen) */
function isGitResult(value: unknown): value is GitResult {
  return typeof value === 'object' && value !== null && 'exitCode' in value
}

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
  return {
    staged: candidate.staged,
    untracked: candidate.untracked,
    origPath: candidate.origPath ?? null,
  }
}

function assertLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 50000) {
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

function assertFileMutationGuard(value: unknown): FileMutationGuard {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('files' in value) ||
    !Array.isArray(value.files)
  ) {
    throw new Error('잘못된 요청 형식이에요.')
  }
  const files = [...value.files].map((entry) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('path' in entry) ||
      typeof entry.path !== 'string' ||
      !('worktree' in entry) ||
      typeof entry.worktree !== 'string' ||
      !('index' in entry) ||
      typeof entry.index !== 'string'
    ) {
      throw new Error('잘못된 요청 형식이에요.')
    }
    return { path: entry.path, worktree: entry.worktree, index: entry.index }
  })
  return { files }
}

function assertDiscardChangesRequest(value: unknown): DiscardChangesRequest {
  if (typeof value !== 'object' || value === null) throw new Error('잘못된 요청 형식이에요.')
  return {
    trackedPaths: assertStringArray('trackedPaths' in value ? value.trackedPaths : undefined),
    untrackedPaths: assertStringArray('untrackedPaths' in value ? value.untrackedPaths : undefined),
    guard: assertFileMutationGuard('guard' in value ? value.guard : undefined),
  }
}

function assertRemoveFileRequest(value: unknown): RemoveFileRequest {
  if (typeof value !== 'object' || value === null) throw new Error('잘못된 요청 형식이에요.')
  return {
    path: assertString('path' in value ? value.path : undefined),
    guard: assertFileMutationGuard('guard' in value ? value.guard : undefined),
  }
}

function assertHunkStageRequest(value: unknown): HunkStageRequest {
  if (typeof value !== 'object' || value === null) throw new Error('잘못된 요청 형식이에요.')
  const options = assertDiffOptions('options' in value ? value.options : undefined)
  const hunk = 'hunk' in value ? value.hunk : null
  if (
    typeof hunk !== 'object' ||
    hunk === null ||
    !('header' in hunk) ||
    typeof hunk.header !== 'string' ||
    !('lines' in hunk) ||
    !Array.isArray(hunk.lines)
  ) {
    throw new Error('잘못된 요청 형식이에요.')
  }
  const lines = [...hunk.lines].map((line) => {
    if (
      typeof line !== 'object' ||
      line === null ||
      !('kind' in line) ||
      !['context', 'add', 'del', 'note'].includes(String(line.kind)) ||
      !('oldLine' in line) ||
      (line.oldLine !== null && typeof line.oldLine !== 'number') ||
      !('newLine' in line) ||
      (line.newLine !== null && typeof line.newLine !== 'number') ||
      !('text' in line) ||
      typeof line.text !== 'string'
    ) {
      throw new Error('잘못된 요청 형식이에요.')
    }
    return {
      kind: line.kind as 'context' | 'add' | 'del' | 'note',
      oldLine: line.oldLine as number | null,
      newLine: line.newLine as number | null,
      text: line.text,
    }
  })
  return {
    path: assertString('path' in value ? value.path : undefined),
    options,
    hunk: { header: hunk.header, lines },
  }
}

function assertLineStageRequest(value: unknown): LineStageRequest {
  const request = assertHunkStageRequest(value)
  if (
    typeof value !== 'object' ||
    value === null ||
    !('lineIndex' in value) ||
    typeof value.lineIndex !== 'number' ||
    !Number.isInteger(value.lineIndex) ||
    value.lineIndex < 0
  ) {
    throw new Error('잘못된 요청 형식이에요.')
  }
  return { ...request, lineIndex: value.lineIndex }
}

function assertPushConfirmation(value: unknown): PushConfirmation | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null) throw new Error('잘못된 요청 형식이에요.')
  return {
    remote: assertString('remote' in value ? value.remote : undefined),
    branch: assertString('branch' in value ? value.branch : undefined),
    expectedHead: assertHash('expectedHead' in value ? value.expectedHead : undefined),
  }
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

/**
 * `repo:open`의 본문 (E15b) — 창 없이도 부를 수 있게 핸들러에서 뽑았다.
 *
 * `window:open`도 같은 검증을 거쳐야 하는데(그 인자도 디스크 설정에서 온 렌더러 입력이다),
 * 검증 함수를 복제하면 둘이 갈라진다 — 그래서 본문을 함수로 만들어 둘이 함께 쓴다.
 * `path`는 호출자가 이미 `assertAbsoluteRepoPath`를 통과시킨 절대 경로다
 */
export async function openRepoPath(path: string): Promise<RepoOpenResult> {
  // 폴더가 있는지는 git이 아니라 fs에게 묻는다 (E15a 리뷰 ④) — spawn 실패로는 "없는 폴더"와
  // "PATH에 git 없음"을 구별할 수 없기 때문이다(둘 다 "spawn git ENOENT"다 — repo-open-guard 참조).
  // 여기서 갈라야 목록 자동 제거가 사인을 단정하지 않는다
  try {
    const info = await stat(path)
    if (!info.isDirectory()) return repoGone()
  } catch (cause) {
    return isMissingDirectoryError(cause) ? repoGone() : repoOpenUnchecked(cause)
  }
  const check = await execGit(['rev-parse', '--is-inside-work-tree'], { cwd: path }).catch(
    (cause: unknown) => cause,
  )
  // 폴더는 실재하는데 git 실행이 실패했다 — 원인을 모르니 목록은 그대로 둔다
  if (!isGitResult(check)) return repoOpenUnchecked(check)
  // bare repo와 .git 디렉터리는 "false"를 출력하며 exit 0으로 끝난다 — stdout까지 확인한다
  if (check.exitCode !== 0 || check.stdout.trim() !== 'true') return repoNotARepository()
  return { ok: true, path: await registerRepoPath(path) }
}

export function registerGitHandlers(registry: WindowRegistry): void {
  applicationActivity.ipc.register()
  const mutations = new RepositoryMutationQueue()
  const mutate = <T>(
    repoPath: unknown,
    mutation: (client: ReturnType<typeof createGitClient>) => Promise<T>,
  ) => {
    const root = assertAllowedRepo(repoPath)
    return mutations.run(root, () => mutation(createGitClient(root)))
  }
  /**
   * 이 탭이 지금 무엇을 열었는지 레지스트리에 반영한다 (E15b, E15c에서 창→탭).
   *
   * 탭의 저장소를 바꾸는 핸들러는 전부 여기를 지난다(select·open·initial-path·open-path).
   * 빠뜨리면 E15a 전환기로 저장소를 바꿨을 때 레지스트리가 옛 경로를 들고 있어
   * **중복 차단이 틀리고**(A가 이미 B로 갈아탔는데 B를 열려 하면 새 창이 뜬다)
   * **복원이 옛 저장소를 되살린다.** senderId는 뷰의 webContents.id — 곧 탭 id다
   */
  const remember = (senderId: number, topLevel: string): string => {
    registry.setTabRepoPath(senderId, topLevel)
    return topLevel
  }

  ipcMain.handle(
    CHANNELS.workspaceMove,
    async (event, request: WorkspaceChangeBatch): Promise<WorkspaceChangeResult> => {
      const workspacePath = registry.getTabWorkspacePath(event.sender.id)
      if (
        !workspacePath ||
        !request ||
        !['staged', 'unstaged'].includes(request.target) ||
        !Array.isArray(request.groups)
      ) {
        throw new Error('작업 공간과 스테이지 대상을 확인해 주세요.')
      }
      const workspace = await workspaceDiscovery.folder.scan(workspacePath)
      const allowed = new Set<string>()
      for (const repository of workspace.repositories) {
        allowed.add(repository.path)
        for (const tree of await createGitClient(repository.path).worktrees.list())
          allowed.add(tree.path)
      }
      const results: WorkspaceChangeResult['results'] = []
      let failed = false
      for (const group of request.groups) {
        if (failed) {
          results.push({ path: group.path, status: 'pending', error: null })
          continue
        }
        try {
          if (!allowed.has(group.path) || !Array.isArray(group.paths))
            throw new Error('작업 공간에 없는 대상이에요.')
          const paths = assertStringArray(group.paths)
          const path = await registerRepoPath(group.path)
          await mutate(path, (client) =>
            request.target === 'staged'
              ? client.changes.stage(paths)
              : client.changes.unstage(paths),
          )
          results.push({ path: group.path, status: 'completed', error: null })
        } catch (cause) {
          failed = true
          results.push({
            path: group.path,
            status: 'failed',
            error: cause instanceof Error ? cause.message : String(cause),
          })
        }
      }
      return { results }
    },
  )

  ipcMain.handle(CHANNELS.jobsCancel, (event, repoPath: unknown) => {
    onboardingJobs.entry.cancel(event.sender.id)
    const pending = onboardingJobs.target.get(event.sender.id)
    if (repoPath === undefined) return pending ? cancelGitProcesses(pending) : 0
    return cancelGitProcesses(pending === repoPath ? pending : assertAllowedRepo(repoPath))
  })

  ipcMain.handle(CHANNELS.repoSelect, async (event) => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    const path = result.filePaths[0]!
    const check = await execGit(['rev-parse', '--is-inside-work-tree'], { cwd: path })
    // bare repo와 .git 디렉터리는 "false"를 출력하며 exit 0으로 끝난다 — stdout까지 확인한다
    if (check.exitCode !== 0 || check.stdout.trim() !== 'true') {
      throw new Error(
        '선택한 폴더는 Git 저장소가 아니에요. .git 폴더가 있는 프로젝트 폴더를 선택해 주세요.',
      )
    }
    return remember(event.sender.id, await registerRepoPath(path))
  })

  ipcMain.handle(CHANNELS.repoClone, async (event, remoteUrl: unknown) => {
    const url = assertString(remoteUrl).trim()
    if (url === '' || url.length > 4096 || url.includes('\0') || url.includes('\n')) {
      throw new Error('복제할 원격 주소를 확인해 주세요.')
    }
    const picked = await dialog.showOpenDialog({
      title: '복제할 빈 폴더 선택',
      buttonLabel: '이 폴더에 복제',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (picked.canceled || picked.filePaths.length === 0) return null
    const destination = picked.filePaths[0]!
    const signal = onboardingJobs.entry.start(event.sender.id, destination)
    const result = await execGit(['clone', '--', url, '.'], { cwd: destination, signal })
      .catch((cause) => {
        if (signal.aborted)
          throw new Error('복제를 중단했어요. 대상 폴더에 일부 파일이 남아 있을 수 있어요.')
        throw cause
      })
      .finally(() => onboardingJobs.entry.finish(event.sender.id))
    if (signal.aborted || result.signal === 'SIGTERM')
      throw new Error('복제를 중단했어요. 대상 폴더에 일부 파일이 남아 있을 수 있어요.')
    if (result.exitCode !== 0) {
      const output = result.stderr + result.stdout
      if (/Authentication failed|could not read Username|Permission denied/i.test(output)) {
        throw new Error(
          'Git 원격 인증에 실패했어요. SSH 키나 macOS Keychain의 Git 자격 증명을 확인해 주세요. GitHub API 연결과는 별개예요.',
        )
      }
      if (/not found|does not appear to be a git repository/i.test(output)) {
        throw new Error('원격 저장소를 찾지 못했어요. 주소와 접근 권한을 확인해 주세요.')
      }
      throw new Error(
        '저장소를 복제하지 못했어요. 대상 폴더가 비어 있는지와 네트워크를 확인해 주세요.',
      )
    }
    return registerRepoPath(destination)
  })

  ipcMain.handle(CHANNELS.repoInit, async () => {
    const picked = await dialog.showOpenDialog({
      title: '새 Git 저장소로 만들 폴더 선택',
      buttonLabel: '저장소 만들기',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (picked.canceled || picked.filePaths.length === 0) return null
    const destination = picked.filePaths[0]!
    const result = await execGit(['init', '-b', 'main'], { cwd: destination })
    if (result.exitCode !== 0) {
      throw new Error('이 폴더에 Git 저장소를 만들지 못했어요. 폴더 권한을 확인해 주세요.')
    }
    return registerRepoPath(destination)
  })

  // 최근 목록에서 고른 경로로 연다 (E15a). 인자는 디스크 settings.json에서 온 렌더러 입력이라
  // repoSelect와 **똑같이** 검증하고, 거기에 절대 경로일 것을 더한다 (E15a 리뷰 ③) — 그냥
  // registerRepoPath에 넘기면 렌더러가 임의 디렉터리에서 git을 돌리는 통로가 된다
  ipcMain.handle(CHANNELS.repoOpen, async (event, repoPath: unknown): Promise<RepoOpenResult> => {
    const result = await openRepoPath(assertAbsoluteRepoPath(repoPath))
    if (result.ok) remember(event.sender.id, result.path)
    return result
  })

  ipcMain.handle(CHANNELS.repoInitialPath, async (event) => {
    // 이 탭의 씨앗 저장소 (E15b — 새 창·복원·E2E 주입, E15c에서 창→탭). 없으면 저장소 없는
    // 빈 탭이다. E2E 주입(GIT_GUI_E2E_REPO)도 index.ts가 **첫 창의 씨앗으로만** 넣는다 —
    // 여기서 환경변수로 되돌아가면 ⌘N이 만든 빈 창까지 그 저장소를 열어 검증 불가능해진다
    const seeded = registry.getTabRepoPath(event.sender.id)
    if (!seeded) return null
    return remember(event.sender.id, await registerRepoPath(seeded))
  })

  ipcMain.handle(CHANNELS.repoStatus, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).repo.status(),
  )

  // 저장소 감시 (E7b) — **창마다 하나**다 (E15b). 예전엔 모듈 하나의 let이라 새 창이 watch를
  // 부르는 순간 옛 창의 감시가 꺼지고, 창 B를 닫으면 그 시점 B를 가리키던 let이 null이 돼
  // A는 되살아나지도 않았다. A는 조용히 E10(외부 변경 감지)을 잃고 사용자는 "왜 갱신이 안
  // 되지"만 겪었다 — 여러 창 이전에도 이미 결함이다.
  // 응답 대상은 invoke의 sender — window 배선 없이 push한다 (실측 3)
  const stopWatching = new Map<number, () => void>()
  // destroyed 정리는 sender당 1회만 등록한다 — watch 재호출마다 쌓이면 MaxListeners 경고 (통합 리뷰, terminal-handlers 관례)
  const watchCleanupHooked = new WeakSet<Electron.WebContents>()
  ipcMain.handle(CHANNELS.repoWatch, async (event, repoPath: unknown) => {
    const path = assertAllowedRepo(repoPath)
    const sender = event.sender
    // destroyed 뒤에는 sender.id 접근이 안전하지 않다 — 콜백 밖에서 미리 잡아 둔다
    const senderId = sender.id
    // **해제를 먼저 한다** (E15a 리뷰 발견): 예전엔 --git-common-dir 해석이 앞이라, rev-parse가
    // 실패하면 옛 저장소의 감시가 살아남은 채 새 저장소는 감시되지 않았다. Map으로 바꾼다고
    // 이 순서가 저절로 고쳐지지는 않는다.
    // 이 순서는 E2E로 못 문다(실측) — rev-parse 실패를 만들려면 allowlist에 든 저장소 폴더를
    // 테스트 중에 지워야 하고, 판정도 "옛 감시가 더는 안 온다"는 부재 단언이라 15초 무대기가 된다
    stopWatching.get(senderId)?.()
    stopWatching.delete(senderId)
    // 링크드 워크트리의 .git은 파일이라 그대로 감시하면 죽는다(실측 H1) — 공용 git dir을 해석해 감시한다
    const gitDir = (
      await execGitOrThrow(['rev-parse', '--path-format=absolute', '--git-common-dir'], {
        cwd: path,
      })
    ).stdout.trim()
    const notify = (): void => {
      if (!sender.isDestroyed()) sender.send(CHANNELS.repoChanged, path)
    }
    // .git 감시는 HEAD·refs·상태 마커를, 워킹트리 감시는 파일 내용을 본다 — 목적이 달라 둘 다 필요하다 (E10)
    const stopGit = watchRepository(gitDir, notify)
    const stopTree = watchWorkingTree(path, notify)
    stopWatching.set(senderId, () => {
      stopGit()
      stopTree()
    })
    if (!watchCleanupHooked.has(sender)) {
      watchCleanupHooked.add(sender)
      sender.once('destroyed', () => {
        // **이 창의 것만** 끈다 — 예전엔 다른 창을 가리키던 감시까지 껐다
        stopWatching.get(senderId)?.()
        stopWatching.delete(senderId)
      })
    }
  })

  ipcMain.handle(CHANNELS.repoOpenPath, async (event, repoPath: unknown, worktreePath: unknown) => {
    const root = assertAllowedRepo(repoPath)
    // 목록 대조 + prunable 친절 거부 (E7d ⑥) — reveal·terminal cwd는 기존 assertWorktreePath 유지
    const path = assertString(worktreePath)
    const list = await createGitClient(root).worktrees.list()
    assertOpenableWorktree(list, path)
    // 워크트리 전환도 그 창이 보는 경로를 바꾼다 — 레지스트리도 따라가야 한다 (E15b)
    return remember(event.sender.id, await registerRepoPath(path))
  })

  // 워크트리 행 `~` 축약용 — repoPath 신뢰 규칙과 무관한 OS 정보라 별도 검증이 필요 없다 (E7j)
  ipcMain.handle(CHANNELS.repoHome, () => app.getPath('home'))

  ipcMain.handle(CHANNELS.worktreesList, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).worktrees.list(),
  )

  ipcMain.handle(
    CHANNELS.worktreesAdd,
    (_event, repoPath: unknown, path: unknown, branch: unknown, createBranch: unknown) =>
      mutate(repoPath, (client) =>
        client.worktrees.add(assertString(path), assertString(branch), {
          createBranch: assertBoolean(createBranch),
        }),
      ),
  )

  ipcMain.handle(
    CHANNELS.worktreesRemove,
    async (_event, repoPath: unknown, path: unknown, force: unknown, guard: unknown) => {
      const root = assertAllowedRepo(repoPath)
      const target = await assertWorktreePath(root, path)
      const parsedGuard = guard === undefined ? undefined : assertString(guard)
      return mutate(root, (client) =>
        client.worktrees.remove(target, assertBoolean(force), parsedGuard),
      )
    },
  )

  ipcMain.handle(CHANNELS.worktreesReveal, async (_event, repoPath: unknown, path: unknown) => {
    const root = assertAllowedRepo(repoPath)
    const target = await assertWorktreePath(root, path)
    shell.showItemInFolder(target)
  })

  ipcMain.handle(CHANNELS.worktreeHeadInfo, async (_event, repoPath: unknown, path: unknown) => {
    const root = assertAllowedRepo(repoPath)
    const target = await assertWorktreePath(root, assertString(path))
    return createGitClient(root).worktrees.headInfo(target)
  })

  ipcMain.handle(CHANNELS.remotesFetch, (_event, repoPath: unknown) =>
    mutate(repoPath, (client) => client.remotes.fetch()),
  )
  ipcMain.handle(CHANNELS.remotesList, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).remotes.list(),
  )
  ipcMain.handle(CHANNELS.remotesAdd, (_event, repoPath: unknown, name: unknown, url: unknown) =>
    mutate(repoPath, (client) => client.remotes.add(assertString(name), assertString(url))),
  )
  ipcMain.handle(CHANNELS.remotesRemove, (_event, repoPath: unknown, name: unknown) =>
    mutate(repoPath, (client) => client.remotes.remove(assertString(name))),
  )

  ipcMain.handle(CHANNELS.branchesList, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).branches.list(),
  )

  ipcMain.handle(
    CHANNELS.branchesCreate,
    (_event, repoPath: unknown, name: unknown, fromHash: unknown) =>
      mutate(repoPath, (client) =>
        client.branches.create(assertString(name), assertNullableHash(fromHash)),
      ),
  )

  ipcMain.handle(CHANNELS.branchesSwitch, (_event, repoPath: unknown, name: unknown) =>
    mutate(repoPath, (client) => client.branches.switch(assertString(name))),
  )

  ipcMain.handle(CHANNELS.branchesMerge, (_event, repoPath: unknown, name: unknown) =>
    mutate(repoPath, (client) => client.branches.merge(assertString(name))),
  )

  ipcMain.handle(
    CHANNELS.branchesRemove,
    (_event, repoPath: unknown, name: unknown, force: unknown) =>
      mutate(repoPath, (client) =>
        client.branches.remove(assertString(name), assertBoolean(force)),
      ),
  )

  ipcMain.handle(
    CHANNELS.branchesRename,
    (_event, repoPath: unknown, oldName: unknown, newName: unknown) =>
      mutate(repoPath, (client) =>
        client.branches.rename(assertString(oldName), assertString(newName)),
      ),
  )

  ipcMain.handle(CHANNELS.branchesOverview, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).branches.overview(),
  )

  ipcMain.handle(CHANNELS.branchesUpdate, (_event, repoPath: unknown, name: unknown) =>
    mutate(repoPath, (client) => client.branches.update(assertString(name))),
  )

  ipcMain.handle(CHANNELS.branchesBackup, (_event, repoPath: unknown, name: unknown) =>
    mutate(repoPath, (client) => client.branches.backup(assertString(name))),
  )

  ipcMain.handle(CHANNELS.branchesCheckoutRemote, (_event, repoPath: unknown, name: unknown) =>
    mutate(repoPath, (client) => client.branches.checkoutRemote(assertString(name))),
  )

  ipcMain.handle(CHANNELS.branchesRemoveRemote, (_event, repoPath: unknown, name: unknown) =>
    mutate(repoPath, (client) => client.branches.removeRemote(assertString(name))),
  )

  ipcMain.handle(CHANNELS.branchesCompare, (_event, repoPath: unknown, name: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).branches.compare(assertString(name)),
  )

  ipcMain.handle(CHANNELS.rebaseStart, (_event, repoPath: unknown, onto: unknown) =>
    mutate(repoPath, (client) => client.rebase.start(assertString(onto))),
  )

  ipcMain.handle(CHANNELS.rebaseContinue, (_event, repoPath: unknown) =>
    mutate(repoPath, (client) => client.rebase.continue()),
  )

  ipcMain.handle(CHANNELS.rebaseAbort, (_event, repoPath: unknown) =>
    mutate(repoPath, (client) => client.rebase.abort()),
  )

  ipcMain.handle(CHANNELS.rebaseProgress, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).rebase.progress(),
  )

  ipcMain.handle(CHANNELS.mergeAbort, (_event, repoPath: unknown) =>
    mutate(repoPath, (client) => client.merge.abort()),
  )

  ipcMain.handle(
    CHANNELS.conflictsResolve,
    (_event, repoPath: unknown, path: unknown, choice: unknown, expectedContent: unknown) =>
      mutate(repoPath, (client) =>
        client.conflicts.resolve(
          assertString(path),
          assertConflictChoice(choice),
          assertString(expectedContent),
        ),
      ),
  )

  ipcMain.handle(CHANNELS.conflictsMarkResolved, (_event, repoPath: unknown, path: unknown) =>
    mutate(repoPath, (client) => client.conflicts.markResolved(assertString(path))),
  )

  ipcMain.handle(
    CHANNELS.conflictsSaveText,
    (_event, repoPath: unknown, path: unknown, content: unknown, expectedContent: unknown) =>
      mutate(repoPath, (client) =>
        client.conflicts.saveText(
          assertString(path),
          assertString(content),
          assertString(expectedContent),
        ),
      ),
  )

  ipcMain.handle(
    CHANNELS.conflictsReset,
    (_event, repoPath: unknown, path: unknown, expectedContent: unknown) =>
      mutate(repoPath, (client) =>
        client.conflicts.reset(assertString(path), assertString(expectedContent)),
      ),
  )

  ipcMain.handle(CHANNELS.commitsRevert, (_event, repoPath: unknown, hash: unknown) =>
    mutate(repoPath, (client) => client.commits.revert(assertHash(hash))),
  )

  ipcMain.handle(CHANNELS.commitsRevertAbort, (_event, repoPath: unknown) =>
    mutate(repoPath, (client) => client.commits.revertAbort()),
  )

  ipcMain.handle(CHANNELS.commitsCherryPick, (_event, repoPath: unknown, hash: unknown) =>
    mutate(repoPath, (client) => client.commits.cherryPick(assertHash(hash))),
  )

  ipcMain.handle(CHANNELS.commitsCherryPickAbort, (_event, repoPath: unknown) =>
    mutate(repoPath, (client) => client.commits.cherryPickAbort()),
  )

  ipcMain.handle(
    CHANNELS.commitsCreateTag,
    (_event, repoPath: unknown, name: unknown, hash: unknown) =>
      mutate(repoPath, (client) => client.commits.createTag(assertString(name), assertHash(hash))),
  )

  ipcMain.handle(CHANNELS.commitsUndoLast, (_event, repoPath: unknown, hash: unknown) =>
    mutate(repoPath, (client) => client.commits.undoLast(assertHash(hash))),
  )

  ipcMain.handle(
    CHANNELS.commitsReword,
    (_event, repoPath: unknown, hash: unknown, message: unknown) =>
      mutate(repoPath, (client) => client.commits.reword(assertHash(hash), assertString(message))),
  )

  ipcMain.handle(CHANNELS.filesReadText, (_event, repoPath: unknown, path: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).files.readText(assertString(path)),
  )

  ipcMain.handle(CHANNELS.shelfSave, (_event, repoPath: unknown, message: unknown) =>
    mutate(repoPath, (client) => client.shelf.save(assertString(message))),
  )

  ipcMain.handle(CHANNELS.shelfList, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).shelf.list(),
  )

  ipcMain.handle(CHANNELS.shelfRestore, (_event, repoPath: unknown, ref: unknown) =>
    mutate(repoPath, (client) => client.shelf.restore(assertShelfRef(ref))),
  )

  ipcMain.handle(CHANNELS.shelfDrop, (_event, repoPath: unknown, ref: unknown) =>
    mutate(repoPath, (client) => client.shelf.drop(assertShelfRef(ref))),
  )

  ipcMain.handle(CHANNELS.changesStage, (_event, repoPath: unknown, paths: unknown) =>
    mutate(repoPath, (client) => client.changes.stage(assertStringArray(paths))),
  )

  ipcMain.handle(CHANNELS.changesUnstage, (_event, repoPath: unknown, paths: unknown) =>
    mutate(repoPath, (client) => client.changes.unstage(assertStringArray(paths))),
  )

  ipcMain.handle(CHANNELS.changesHunkStage, (_event, repoPath: unknown, request: unknown) =>
    mutate(repoPath, (client) => client.changes.hunk.stage(assertHunkStageRequest(request))),
  )

  ipcMain.handle(CHANNELS.changesHunkUnstage, (_event, repoPath: unknown, request: unknown) =>
    mutate(repoPath, (client) => client.changes.hunk.unstage(assertHunkStageRequest(request))),
  )

  ipcMain.handle(CHANNELS.changesLineStage, (_event, repoPath: unknown, request: unknown) =>
    mutate(repoPath, (client) => client.changes.line.stage(assertLineStageRequest(request))),
  )

  ipcMain.handle(CHANNELS.changesLineUnstage, (_event, repoPath: unknown, request: unknown) =>
    mutate(repoPath, (client) => client.changes.line.unstage(assertLineStageRequest(request))),
  )

  ipcMain.handle(CHANNELS.changesGuardCapture, (_event, repoPath: unknown, paths: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).changes.guard.capture(assertStringArray(paths)),
  )

  ipcMain.handle(CHANNELS.changesDiscard, (_event, repoPath: unknown, request: unknown) =>
    mutate(repoPath, (client) => client.changes.discard(assertDiscardChangesRequest(request))),
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
    mutate(repoPath, (client) => client.commits.create(assertString(message))),
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
      mutate(repoPath, (client) =>
        client.commits.restoreFile(assertHash(hash), assertString(path)),
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

  ipcMain.handle(CHANNELS.changesRemoveFile, (_event, repoPath: unknown, request: unknown) =>
    mutate(repoPath, (client) => client.changes.removeFile(assertRemoveFileRequest(request))),
  )

  ipcMain.handle(CHANNELS.historyList, (_event, repoPath: unknown, limit: unknown, ref: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).history.list(
      assertLimit(limit),
      ref === undefined ? undefined : assertString(ref),
    ),
  )

  ipcMain.handle(
    CHANNELS.historySearch,
    (_event, repoPath: unknown, query: unknown, ref: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).history.search(
        assertString(query),
        ref === undefined ? undefined : assertString(ref),
      ),
  )

  ipcMain.handle(CHANNELS.syncPushPreview, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).sync.previewPush(),
  )

  ipcMain.handle(CHANNELS.syncPush, (_event, repoPath: unknown, confirmation: unknown) =>
    mutate(repoPath, async (client) => {
      const parsed = assertPushConfirmation(confirmation)
      const preview = await client.sync.previewPush()
      if (preview.needsConfirmation && parsed === undefined) {
        throw new Error('처음 푸시할 원격과 브랜치를 먼저 확인해 주세요.')
      }
      return client.sync.push(parsed)
    }),
  )

  ipcMain.handle(CHANNELS.syncPull, (_event, repoPath: unknown, mode: unknown) => {
    if (mode !== 'merge' && mode !== 'rebase') throw new Error('잘못된 요청 형식이에요.')
    return mutate(repoPath, (client) => client.sync.pull(mode))
  })
}
