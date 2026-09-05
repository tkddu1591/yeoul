import { onboardingJobs } from './onboarding-jobs'
import { isAbsolute } from 'node:path'
import { dialog, ipcMain } from 'electron'
import {
  CHANNELS,
  type WorkspaceInfo,
  type WorkspaceOverview,
  type WorkspaceOverviewRequest,
} from '@git-gui/ipc-contract'
import type { WindowRegistry } from './window-registry'
import { workspaceDiscovery } from './workspace-discovery'
import { workspaceOverview } from './workspace-overview'
import { workspaceWatch } from './workspace-watch'

function assertWorkspacePath(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    throw new Error('잘못된 워크스페이스 경로예요.')
  }
  return value
}

export function registerWorkspaceHandlers(registry: WindowRegistry): void {
  const cache = new Map<number, WorkspaceInfo>()
  const watchers = new Map<number, { key: string; stop: () => void }>()
  const hooked = new WeakSet<Electron.WebContents>()
  const clear = (id: number) => {
    watchers.get(id)?.stop()
    watchers.delete(id)
    cache.delete(id)
  }

  ipcMain.handle(CHANNELS.workspaceSelect, async (event): Promise<WorkspaceInfo | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Git 워크스페이스 열기',
      buttonLabel: '이 폴더 열기',
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const signal = onboardingJobs.entry.start(event.sender.id)
    const workspace = await workspaceDiscovery.folder
      .scan(result.filePaths[0]!, signal)
      .catch((cause) => {
        if (signal.aborted) throw new Error('저장소 탐색을 중단했어요.')
        throw cause
      })
      .finally(() => onboardingJobs.entry.finish(event.sender.id))
    registry.setTabWorkspacePath(event.sender.id, workspace.path)
    cache.set(event.sender.id, workspace)
    return workspace
  })

  ipcMain.handle(CHANNELS.workspaceOpen, async (event, path: unknown): Promise<WorkspaceInfo> => {
    const workspace = await workspaceDiscovery.folder.scan(assertWorkspacePath(path))
    if (event.sender.isDestroyed()) throw new Error('작업 창이 닫혔어요.')
    registry.setTabWorkspacePath(event.sender.id, workspace.path)
    cache.set(event.sender.id, workspace)
    return workspace
  })

  ipcMain.handle(CHANNELS.workspaceInitial, async (event): Promise<WorkspaceInfo | null> => {
    const path = registry.getTabWorkspacePath(event.sender.id)
    if (path == null) return null
    try {
      return await workspaceDiscovery.folder.scan(assertWorkspacePath(path))
    } catch {
      // 저장소 탭은 그대로 복원하고, 사라진 상위 폴더 문맥만 걷어낸다.
      registry.setTabWorkspacePath(event.sender.id, null)
      return null
    }
  })

  ipcMain.handle(CHANNELS.workspaceRefresh, async (event): Promise<WorkspaceInfo | null> => {
    const path = registry.getTabWorkspacePath(event.sender.id)
    if (path == null) return null
    return workspaceDiscovery.folder.scan(assertWorkspacePath(path))
  })

  ipcMain.handle(
    CHANNELS.workspaceOverview,
    async (event, input: WorkspaceOverviewRequest = {}): Promise<WorkspaceOverview | null> => {
      const path = registry.getTabWorkspacePath(event.sender.id)
      if (path == null) return null
      const request: WorkspaceOverviewRequest = {
        historyLimit: Number.isFinite(input?.historyLimit)
          ? Math.max(1, Math.min(5000, Math.trunc(input.historyLimit!)))
          : 50,
        query: typeof input?.query === 'string' ? input.query.slice(0, 500) : '',
      }
      const id = event.sender.id
      const previous = cache.get(id)
      const workspace =
        previous?.path === path && input?.discover !== true
          ? previous
          : await workspaceDiscovery.folder.scan(assertWorkspacePath(path))
      cache.set(id, workspace)
      const overview = await workspaceOverview.repositories.get(workspace, request)
      if (event.sender.isDestroyed() || registry.getTabWorkspacePath(id) !== path) return null
      const key = JSON.stringify([
        path,
        overview.repositories.map((item) => item.worktrees?.map((tree) => tree.path)),
      ])
      if (watchers.get(id)?.key !== key) {
        watchers.get(id)?.stop()
        const stop = await workspaceWatch.events.subscribe(overview, () => {
          if (!event.sender.isDestroyed()) event.sender.send(CHANNELS.workspaceChanged)
        })
        if (event.sender.isDestroyed() || registry.getTabWorkspacePath(id) !== path) {
          stop()
          return null
        }
        watchers.get(id)?.stop()
        watchers.set(id, { key, stop })
      }
      if (!hooked.has(event.sender)) {
        hooked.add(event.sender)
        event.sender.once('destroyed', () => clear(id))
      }
      return overview
    },
  )

  ipcMain.handle(CHANNELS.workspaceClose, (event) => {
    registry.setTabWorkspacePath(event.sender.id, null)
    clear(event.sender.id)
  })
}
