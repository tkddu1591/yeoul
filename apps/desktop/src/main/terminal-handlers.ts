import { app, ipcMain } from 'electron'
import { TERMINAL_CHANNELS } from '@git-gui/ipc-contract'
import { assertAllowedRepo } from './git-handlers'
import { TerminalManager } from './terminal-manager'

/** git-handlers의 비공개 헬퍼와 같은 규칙 — 문자열이 아니면 거부 (지역 복제) */
function assertString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('잘못된 요청이에요.')
  return value
}

export function registerTerminalHandlers(): void {
  // 이벤트의 목적지는 세션을 만든 창(invoke의 event.sender) — 창 배선 없이 push한다 (실측 3)
  const targets = new Map<string, Electron.WebContents>()
  const manager = new TerminalManager({
    onData(sessionId, chunk) {
      const target = targets.get(sessionId)
      if (target !== undefined && !target.isDestroyed()) {
        target.send(TERMINAL_CHANNELS.data, sessionId, chunk)
      }
    },
    onExit(sessionId, exitCode) {
      const target = targets.get(sessionId)
      targets.delete(sessionId)
      if (target !== undefined && !target.isDestroyed()) {
        target.send(TERMINAL_CHANNELS.exit, sessionId, exitCode)
      }
    },
  })

  ipcMain.handle(TERMINAL_CHANNELS.create, (event, repoPath: unknown) => {
    const cwd = assertAllowedRepo(repoPath)
    const created = manager.create(cwd)
    targets.set(created.sessionId, event.sender)
    return created
  })

  ipcMain.handle(TERMINAL_CHANNELS.input, (_event, sessionId: unknown, data: unknown) => {
    manager.input(assertString(sessionId), assertString(data))
  })

  ipcMain.handle(
    TERMINAL_CHANNELS.resize,
    (_event, sessionId: unknown, cols: unknown, rows: unknown) => {
      if (typeof cols !== 'number' || typeof rows !== 'number') {
        throw new Error('잘못된 요청이에요.')
      }
      manager.resize(assertString(sessionId), cols, rows)
    },
  )

  ipcMain.handle(TERMINAL_CHANNELS.kill, (_event, sessionId: unknown) => {
    manager.kill(assertString(sessionId))
  })

  // 고아 쉘 방지 — 앱 종료 시 전 세션 정리 (실측 3: before-quit 훅은 이 앱에 없어 신설)
  app.on('before-quit', () => manager.killAll())
}
