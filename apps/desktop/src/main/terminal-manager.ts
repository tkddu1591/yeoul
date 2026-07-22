import { spawn, type IPty } from 'node-pty'
import { randomUUID } from 'node:crypto'

/** 세션 상한 — 무한 스폰 방어. 초과는 읽히는 메시지로 거부한다 */
const MAX_SESSIONS = 8

/** $SHELL 우선, 없으면 zsh→bash — 로그인 쉘(-l)로 사용자 rc·PATH를 살린다 (스펙) */
export function resolveShell(env: Record<string, string | undefined>): string {
  const shell = env.SHELL
  if (shell !== undefined && shell.trim() !== '') return shell
  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
}

export interface TerminalEvents {
  onData(sessionId: string, chunk: string): void
  onExit(sessionId: string, exitCode: number): void
}

/**
 * pty 세션 수명 관리 (E7b) — main 전용. renderer는 sessionId·바이트만 안다.
 * 이벤트는 콜백 주입 — IPC(webContents.send) 배선은 terminal-handlers 책임(테스트 분리)
 */
export class TerminalManager {
  private sessions = new Map<string, IPty>()

  constructor(private events: TerminalEvents) {}

  /** 세션 생성 — cwd는 호출자(핸들러)가 allowlist 검증을 마친 저장소 루트다 (E7c에서 워크트리 경로 확장점) */
  create(cwd: string): { sessionId: string } {
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new Error(`터미널은 ${MAX_SESSIONS}개까지 열 수 있어요. 안 쓰는 탭을 닫아 주세요.`)
    }
    const sessionId = randomUUID()
    const pty = spawn(resolveShell(process.env), ['-l'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    })
    this.sessions.set(sessionId, pty)
    pty.onData((chunk) => this.events.onData(sessionId, chunk))
    pty.onExit(({ exitCode }) => {
      // 명시적 kill이 먼저 지웠으면 no-op — exit 이벤트는 그대로 알린다(렌더러가 탭 정리)
      this.sessions.delete(sessionId)
      this.events.onExit(sessionId, exitCode)
    })
    return { sessionId }
  }

  private session(sessionId: string): IPty {
    const pty = this.sessions.get(sessionId)
    if (pty === undefined) throw new Error('이미 닫힌 터미널이에요.')
    return pty
  }

  input(sessionId: string, data: string): void {
    this.session(sessionId).write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    // fit addon이 극단 레이아웃에서 0·소수를 줄 수 있다 — pty가 죽지 않게 바닥을 깐다
    this.session(sessionId).resize(Math.max(2, Math.floor(cols)), Math.max(1, Math.floor(rows)))
  }

  kill(sessionId: string): void {
    const pty = this.sessions.get(sessionId)
    if (pty === undefined) return
    this.sessions.delete(sessionId)
    pty.kill()
  }

  /** 앱 종료 정리 — 고아 쉘 프로세스를 남기지 않는다 (before-quit에서 호출) */
  killAll(): void {
    for (const pty of this.sessions.values()) pty.kill()
    this.sessions.clear()
  }
}
