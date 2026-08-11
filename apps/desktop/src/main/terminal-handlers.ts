import { app, ipcMain } from 'electron'
import { TERMINAL_CHANNELS } from '@git-gui/ipc-contract'
import { assertAllowedRepo, assertString, assertWorktreePath } from './git-handlers'
import { TerminalManager } from './terminal-manager'

/** 창당 세션 상한 (E15b) — 무한 스폰 방어. 예전엔 앱 전체 8개라, 두 번째 창에서 터미널을
 * 열려다 "안 쓰는 탭을 닫아 주세요"를 보는데 정작 그 탭은 다른 창에 있어 보이지도 않았다 */
export const MAX_SESSIONS_PER_WINDOW = 8

/** targets에서 이 창의 세션 수 — WebContents를 모르게 제네릭으로 둬 단위 테스트가 된다 */
export function countSessionsFor<T>(targets: ReadonlyMap<string, T>, sender: T): number {
  let count = 0
  for (const target of targets.values()) {
    if (target === sender) count += 1
  }
  return count
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

  // 창이 닫히거나 renderer가 죽으면 그 창의 세션을 전부 정리한다 — 렌더러 예절에 의존하지 않는다.
  // macOS는 창을 닫아도 앱이 살아 고아 쉘이 남는다 (품질 리뷰). sender당 1회만 등록한다
  const cleanupHooked = new WeakSet<Electron.WebContents>()

  ipcMain.handle(TERMINAL_CHANNELS.create, async (event, repoPath: unknown, cwd: unknown) => {
    const root = assertAllowedRepo(repoPath)
    // cwd가 오면 이 저장소의 워크트리 경로인지 검증한다 — 임의 경로 쉘 스폰 차단 (E7c 보안 가드)
    const target = cwd === undefined ? root : await assertWorktreePath(root, cwd)
    // 상한은 창별이다 (E15b) — targets가 이미 창(WebContents)을 알고 있으니 여기서 센다.
    // 매니저는 pty만 소유하고 창을 모른다(두 곳에서 세면 문구가 갈린다)
    if (countSessionsFor(targets, event.sender) >= MAX_SESSIONS_PER_WINDOW) {
      throw new Error(
        `이 창에서는 터미널을 ${MAX_SESSIONS_PER_WINDOW}개까지 열 수 있어요. 안 쓰는 탭을 닫아 주세요.`,
      )
    }
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
