import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { silentExitNotice } from './silent-exit'
import { nextTabNumber } from './tab-number'
import { terminalPalette } from './terminal-theme'
import type { Theme } from '../theme'

export interface TerminalTab {
  sessionId: string
  /** 이 그룹(워크트리) 안에서의 탭 번호 — 닫은 자리는 재사용한다 (E12 nextTabNumber) */
  number: number
  /** 탭 라벨 — 이제 번호뿐이다. 워크트리 이름은 도크 헤더로 옮겼다(E12 — "남의 것이 어딘가 있다"는
     암시를 없앤다) */
  title: string
  exited: boolean
  /** 이 터미널이 열린 워크트리 경로(본체는 repoPath) — 도크가 그룹별로 필터한다 (E7h ④) */
  groupKey: string
}

interface SessionView {
  terminal: Terminal
  fit: FitAddon
}

// 팔레트는 terminal-theme.ts (E7d ③ 테마 연동). 기본 DOM 렌더러 유지 — E2E가 출력을 읽는다

/** IPC 래핑 접두 제거 — store toErrorMessage와 같은 규칙(모듈 비공개라 지역 복제) */
function stripIpcPrefix(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
}

/**
 * 터미널 세션 로직 (E7b) — 세션 생성·xterm 인스턴스 수명·push 라우팅을 소유한다.
 * TerminalDock(프레젠테이션)은 이 훅의 값·콜백만 렌더한다 (레이어 분리)
 */
export function useTerminalSessions(repoPath: string | null, theme: Theme) {
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const viewsRef = useRef(new Map<string, SessionView>())
  /** create 응답이 돌아오기 전 도착한 청크(로그인 쉘 프롬프트가 invoke 왕복을 이길 수 있다 — Task 3 리뷰) */
  const pendingRef = useRef(new Map<string, string[]>())
  /** 출력을 한 번이라도 보낸 세션 — 무출력 exit(깨진 쉘) 판정용 (E7d ②) */
  const receivedRef = useRef(new Set<string>())
  /** 사용자가 닫아서(kill) 죽는 세션 — 프롬프트 도착 전 닫기가 깨진 쉘 오경보가 되는 것 방지 (E7d ② 보완) */
  const closingRef = useRef(new Set<string>())
  /** 그룹별 마지막 활성 탭 — 그룹 전환 시 복원한다 (E7h ④) */
  const lastActiveRef = useRef(new Map<string, string>())

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
      // 출력 없이 죽은 세션 = 깨진 쉘 — 단, 사용자가 닫은 세션은 제외 (E7d ② 보완: 빠른 닫기 오탐)
      const userClosed = closingRef.current.delete(sessionId)
      const notice = userClosed ? null : silentExitNotice(receivedRef.current.has(sessionId))
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

  // 테마 전환 시 열린 세션 전부 즉시 교체 — options.theme는 "객체 재할당"이어야 반영된다 (실측 3)
  useEffect(() => {
    for (const view of viewsRef.current.values()) {
      view.terminal.options.theme = { ...terminalPalette(theme) }
    }
  }, [theme])

  const refit = (sessionId: string) => {
    const view = viewsRef.current.get(sessionId)
    if (view === undefined || view.terminal.element === undefined) return
    view.fit.fit()
    void window.terminalApi.resize(sessionId, view.terminal.cols, view.terminal.rows)
  }

  /**
   * 세션 생성 — cwd가 오면 그 워크트리 폴더에서 연다 (E7c). 탭 번호는 이 그룹(groupKey) 안에서만
   * 매긴다 — nextTabNumber(E12)가 닫힌 자리를 재사용한다. label(워크트리 이름)은 더 이상 탭
   * 제목에 붙지 않는다 — 도크 헤더가 "지금 보고 있는 워크트리"를 이미 보여주므로 탭마다 반복할
   * 필요가 없다(오히려 "다른 그룹의 번호가 여기 붙어온다"는 착시를 만들었다)
   */
  const create = async (options?: { cwd?: string; label?: string }) => {
    if (repoPath === null) return
    try {
      const { sessionId } = await window.terminalApi.create(repoPath, options?.cwd)
      const terminal = new Terminal({ fontSize: 12, theme: terminalPalette(theme), scrollback: 1000 })
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
      const groupKey = options?.cwd ?? repoPath
      // 함수형 업데이터 필수 — 바깥 tabs 클로저를 읽으면 같은 렌더 안에서 연속 생성될 때
      // 번호가 중복된다(:133-137의 close/closeGroup 트랩과 같은 이유)
      setTabs((prev) => {
        const usedNumbers = prev.filter((tab) => tab.groupKey === groupKey).map((tab) => tab.number)
        const number = nextTabNumber(usedNumbers)
        return [...prev, { sessionId, number, title: String(number), exited: false, groupKey }]
      })
      setActiveId(sessionId)
      lastActiveRef.current.set(groupKey, sessionId)
      setError(null)
    } catch (cause) {
      setError(stripIpcPrefix(cause instanceof Error ? cause.message : String(cause)))
    }
  }

  /** 탭 선택 — 그 그룹의 마지막 활성으로 기억한다 (E7h ④) */
  const select = (sessionId: string) => {
    setActiveId(sessionId)
    const tab = tabs.find((t) => t.sessionId === sessionId)
    if (tab !== undefined) lastActiveRef.current.set(tab.groupKey, sessionId)
  }

  // close는 closeGroup에서 같은 렌더 안에 연속 호출된다 — setTabs(next)처럼 바깥 tabs 클로저로
  // "다음 상태"를 미리 계산하면 두 번째 호출이 첫 번째 호출의 아직 반영 안 된 결과를 못 보고 되살려버린다
  // (React가 이벤트 핸들러 내 setState를 배치하기 때문). setTabs/setActiveId 둘 다 함수형 업데이터로 써서
  // 연속 호출이 서로의 결과 위에 누적되게 한다 (E7h ④ 실측 — closeGroup 2세션 정리 검증으로 확인)
  const close = (sessionId: string) => {
    closingRef.current.add(sessionId)
    void window.terminalApi.kill(sessionId)
    const view = viewsRef.current.get(sessionId)
    viewsRef.current.delete(sessionId)
    view?.terminal.dispose()
    setTabs((prev) => {
      const closedGroup = prev.find((tab) => tab.sessionId === sessionId)?.groupKey
      const next = prev.filter((tab) => tab.sessionId !== sessionId)
      setActiveId((prevActive) => {
        if (prevActive !== sessionId) return prevActive
        const sameGroup = next.filter((tab) => tab.groupKey === closedGroup)
        const fallback = sameGroup[sameGroup.length - 1]?.sessionId ?? null
        if (closedGroup !== undefined) {
          if (fallback !== null) lastActiveRef.current.set(closedGroup, fallback)
          else lastActiveRef.current.delete(closedGroup)
        }
        return fallback
      })
      return next
    })
  }

  /** 그룹 전환 (E7h ④) — 그 그룹의 기억된(없으면 마지막) 탭을 활성, 탭이 없으면 자동 1개 생성 */
  const activateGroup = async (
    groupKey: string,
    createOptions?: { cwd?: string; label?: string },
  ) => {
    const group = tabs.filter((tab) => tab.groupKey === groupKey)
    if (group.length === 0) {
      await create(createOptions)
      return
    }
    const remembered = lastActiveRef.current.get(groupKey)
    const target = group.find((tab) => tab.sessionId === remembered) ?? group[group.length - 1]!
    setActiveId(target.sessionId)
  }

  /** 그룹 세션 전부 정리 — 워크트리 지우기 성공 시 (E7h ④). close가 함수형이라 연속 호출도 안전하다 */
  const closeGroup = (groupKey: string) => {
    for (const tab of tabs.filter((t) => t.groupKey === groupKey)) close(tab.sessionId)
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

  return {
    tabs,
    activeId,
    error,
    create,
    close,
    select,
    activateGroup,
    closeGroup,
    attach,
    refitActive,
  }
}
