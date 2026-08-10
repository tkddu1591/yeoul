import { spawn, type IPty } from 'node-pty'
import { randomUUID } from 'node:crypto'

/** $SHELL 우선, 없으면 zsh→bash — 로그인 쉘(-l)로 사용자 rc·PATH를 살린다 (스펙) */
export function resolveShell(env: Record<string, string | undefined>): string {
  const shell = env.SHELL
  if (shell !== undefined && shell.trim() !== '') return shell
  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
}

/** pty가 죽지 않는 바닥 — fit addon이 극단 레이아웃에서 0·소수를 줄 수 있다 (품질 리뷰: 순수 함수로 추출해 검증) */
export function clampPtyDims(cols: number, rows: number): { cols: number; rows: number } {
  return { cols: Math.max(2, Math.floor(cols)), rows: Math.max(1, Math.floor(rows)) }
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

  /** 세션 생성 — cwd는 호출자(핸들러)가 allowlist 검증을 마친 저장소 루트다 (E7c에서 워크트리 경로 확장점).
   * 상한은 여기서 안 본다 — 창별 상한이라 창을 아는 terminal-handlers가 센다 (E15b) */
  create(cwd: string): { sessionId: string } {
    const sessionId = randomUUID()
    const shell = resolveShell(process.env)
    let pty: IPty
    try {
      pty = spawn(shell, ['-l'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color' },
      })
    } catch {
      // 깨진 $SHELL(삭제된 바이너리 등) — posix_spawnp 원어를 사용자에게 노출하지 않는다 (품질 리뷰)
      throw new Error(`쉘(${shell})을 실행하지 못했어요. SHELL 환경 변수를 확인해 주세요.`)
    }
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
    const dims = clampPtyDims(cols, rows)
    this.session(sessionId).resize(dims.cols, dims.rows)
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
