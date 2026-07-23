import { app, ipcMain } from 'electron'
import { TERMINAL_CHANNELS } from '@git-gui/ipc-contract'
import { assertAllowedRepo, assertString, assertWorktreePath } from './git-handlers'
import { TerminalManager } from './terminal-manager'

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

  // 창이 닫히거나 renderer가 죽으면 그 창의 세션을 전부 정리한다 — 렌더러 예절에 의존하지 않는다.
  // macOS는 창을 닫아도 앱이 살아 고아 쉘이 남는다 (품질 리뷰). sender당 1회만 등록한다
  const cleanupHooked = new WeakSet<Electron.WebContents>()

  ipcMain.handle(TERMINAL_CHANNELS.create, async (event, repoPath: unknown, cwd: unknown) => {
    const root = assertAllowedRepo(repoPath)
    // cwd가 오면 이 저장소의 워크트리 경로인지 검증한다 — 임의 경로 쉘 스폰 차단 (E7c 보안 가드)
    const target = cwd === undefined ? root : await assertWorktreePath(root, cwd)
    const created = manager.create(target)
    targets.set(created.sessionId, event.sender)
    if (!cleanupHooked.has(event.sender)) {
      cleanupHooked.add(event.sender)
      event.sender.once('destroyed', () => {
        const ids = [...targets.entries()]
          .filter(([, target]) => target === event.sender)
          .map(([id]) => id)
        for (const id of ids) {
          targets.delete(id)
          manager.kill(id)
        }
      })
    }
    return created
  })

  ipcMain.handle(TERMINAL_CHANNELS.input, (_event, sessionId: unknown, data: unknown) => {
    manager.input(assertString(sessionId), assertString(data))
  })

  ipcMain.handle(
    TERMINAL_CHANNELS.resize,
    (_event, sessionId: unknown, cols: unknown, rows: unknown) => {
      if (
        typeof cols !== 'number' ||
        typeof rows !== 'number' ||
        !Number.isFinite(cols) ||
        !Number.isFinite(rows)
      ) {
        throw new Error('잘못된 요청 형식이에요.')
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
