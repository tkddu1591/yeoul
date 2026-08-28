import { isAbsolute } from 'node:path'
import { dialog, ipcMain } from 'electron'
import { CHANNELS, type WorkspaceInfo, type WorkspaceOverview } from '@git-gui/ipc-contract'
import type { WindowRegistry } from './window-registry'
import { workspaceDiscovery } from './workspace-discovery'
import { workspaceOverview } from './workspace-overview'

function assertWorkspacePath(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    throw new Error('잘못된 워크스페이스 경로예요.')
  }
  return value
}

export function registerWorkspaceHandlers(registry: WindowRegistry): void {
  ipcMain.handle(CHANNELS.workspaceSelect, async (event): Promise<WorkspaceInfo | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Git 워크스페이스 열기',
      buttonLabel: '이 폴더 열기',
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const workspace = await workspaceDiscovery.folder.scan(result.filePaths[0]!)
    registry.setTabWorkspacePath(event.sender.id, workspace.path)
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

  ipcMain.handle(CHANNELS.workspaceOverview, async (event): Promise<WorkspaceOverview | null> => {
    const path = registry.getTabWorkspacePath(event.sender.id)
    if (path == null) return null
    // renderer가 보낸 저장소 경로를 신뢰하지 않는다. 영속된 워크스페이스를 다시 검색한 결과만 읽는다.
    const workspace = await workspaceDiscovery.folder.scan(assertWorkspacePath(path))
    return workspaceOverview.repositories.get(workspace)
  })

  ipcMain.handle(CHANNELS.workspaceClose, (event) => {
    registry.setTabWorkspacePath(event.sender.id, null)
  })
}
