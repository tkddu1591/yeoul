import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { silentExitNotice } from './silent-exit'

export interface TerminalTab {
  sessionId: string
  /** 탭 라벨 — "1: 쉘" 형태 */
  title: string
  exited: boolean
}

interface SessionView {
  terminal: Terminal
  fit: FitAddon
}

/**
 * xterm 고정 팔레트 — 쉘 출력 영역이라 앱 테마와 독립(후속: 테마 연동 검토).
 * 기본 DOM 렌더러를 쓴다 — 텍스트가 DOM에 남아 E2E가 출력을 읽을 수 있다
 */
const TERMINAL_THEME = {
  background: '#1a1b23',
  foreground: '#e2e2ea',
  cursor: '#9f8fff',
}

/** IPC 래핑 접두 제거 — store toErrorMessage와 같은 규칙(모듈 비공개라 지역 복제) */
function stripIpcPrefix(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
}

/**
 * 터미널 세션 로직 (E7b) — 세션 생성·xterm 인스턴스 수명·push 라우팅을 소유한다.
 * TerminalDock(프레젠테이션)은 이 훅의 값·콜백만 렌더한다 (레이어 분리)
 */
export function useTerminalSessions(repoPath: string | null) {
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const viewsRef = useRef(new Map<string, SessionView>())
  /** create 응답이 돌아오기 전 도착한 청크(로그인 쉘 프롬프트가 invoke 왕복을 이길 수 있다 — Task 3 리뷰) */
  const pendingRef = useRef(new Map<string, string[]>())
  /** 출력을 한 번이라도 보낸 세션 — 무출력 exit(깨진 쉘) 판정용 (E7d ②) */
  const receivedRef = useRef(new Set<string>())
  const counterRef = useRef(0)

  // push 구독은 훅 수명 1회 — sessionId로 해당 xterm에 라우팅한다
  useEffect(() => {
    const offData = window.terminalApi.onData((sessionId, chunk) => {
      receivedRef.current.add(sessionId)
      const view = viewsRef.current.get(sessionId)
      if (view === undefined) {
        const pending = pendingRef.current.get(sessionId) ?? []
        pending.push(chunk)
        pendingRef.current.set(sessionId, pending)
        return
      }
      view.terminal.write(chunk)
    })
    const offExit = window.terminalApi.onExit((sessionId) => {
      // 출력 없이 죽은 세션 = 깨진 쉘 — "(종료)" 탭만으론 원인을 알 수 없다 (E7d ②)
      const notice = silentExitNotice(receivedRef.current.has(sessionId))
      if (notice !== null) setError(notice)
      setTabs((prev) =>
        prev.map((tab) => (tab.sessionId === sessionId ? { ...tab, exited: true } : tab)),
      )
    })
    return () => {
      offData()
      offExit()
    }
  }, [])

  const refit = (sessionId: string) => {
    const view = viewsRef.current.get(sessionId)
    if (view === undefined || view.terminal.element === undefined) return
    view.fit.fit()
    void window.terminalApi.resize(sessionId, view.terminal.cols, view.terminal.rows)
  }

  /** 세션 생성 — cwd·label이 오면 그 워크트리 폴더에서 열고 탭 라벨에 병기한다 (E7c) */
  const create = async (options?: { cwd?: string; label?: string }) => {
    if (repoPath === null) return
    try {
      const { sessionId } = await window.terminalApi.create(repoPath, options?.cwd)
      counterRef.current += 1
      const terminal = new Terminal({ fontSize: 12, theme: TERMINAL_THEME, scrollback: 1000 })
      const fit = new FitAddon()
      terminal.loadAddon(fit)
      terminal.onData((data) => void window.terminalApi.input(sessionId, data))
      viewsRef.current.set(sessionId, { terminal, fit })
      // 먼저 도착해 대기 중인 청크 재생 — 첫 프롬프트 유실 방지 (Task 3 리뷰)
      const pending = pendingRef.current.get(sessionId)
      if (pending !== undefined) {
        pendingRef.current.delete(sessionId)
        for (const chunk of pending) terminal.write(chunk)
      }
      setTabs((prev) => [
        ...prev,
        {
          sessionId,
          title: `${counterRef.current}: ${options?.label ?? '쉘'}`,
          exited: false,
        },
      ])
      setActiveId(sessionId)
      setError(null)
    } catch (cause) {
      setError(stripIpcPrefix(cause instanceof Error ? cause.message : String(cause)))
    }
  }

  const close = (sessionId: string) => {
    void window.terminalApi.kill(sessionId)
    const view = viewsRef.current.get(sessionId)
    viewsRef.current.delete(sessionId)
    view?.terminal.dispose()
    const next = tabs.filter((tab) => tab.sessionId !== sessionId)
    setTabs(next)
    if (activeId === sessionId) setActiveId(next[next.length - 1]?.sessionId ?? null)
  }

  /** 세션 뷰를 DOM에 붙인다 — 숨김 탭에서 붙으면 크기가 0이라, 보이는 시점의 refit이 바로잡는다 */
  const attach = (sessionId: string, element: HTMLDivElement | null) => {
    if (element === null) return
    const view = viewsRef.current.get(sessionId)
    if (view === undefined) return
    if (view.terminal.element !== undefined) {
      refit(sessionId)
      return
    }
    view.terminal.open(element)
    refit(sessionId)
  }

  const refitActive = () => {
    if (activeId !== null) refit(activeId)
  }

  return { tabs, activeId, error, create, close, select: setActiveId, attach, refitActive }
}
