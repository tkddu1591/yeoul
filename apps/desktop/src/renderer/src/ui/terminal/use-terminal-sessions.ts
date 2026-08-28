import { useEffect, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { silentExitNotice } from './silent-exit'
import { nextTabNumber } from './tab-number'
import { terminalAppearance } from './terminal-theme'
import type { Dispatch, SetStateAction } from 'react'
import type { Appearance } from '@git-gui/ipc-contract'

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
  /** 빈 상태 안내 오버레이가 아직 떠 있는가 — 첫 입력·첫 출력 중 먼저 오는 것에 꺼진다 (E12) */
  hintVisible: boolean
}

interface SessionView {
  terminal: Terminal
  fit: FitAddon
}

/** 액션이 렌더 클로저 대신 읽는 최신 스냅숏 — 훅이 매 렌더 미러한다 (E14c 참조 안정화) */
interface LatestSnapshot {
  repoPath: string | null
  appearance: Appearance
  tabs: TerminalTab[]
  activeId: string | null
}

interface CoreSetters {
  setTabs: Dispatch<SetStateAction<TerminalTab[]>>
  setActiveId: Dispatch<SetStateAction<string | null>>
  setError: Dispatch<SetStateAction<string | null>>
}

// 팔레트는 terminal-theme.ts (E7d ③ 테마 연동). 기본 DOM 렌더러 유지 — E2E가 출력을 읽는다

/**
 * xterm 폰트 — 앱 전체가 쓰는 `--font-mono`(tokens.css)와 같은 스택 (E12 터미널 외형).
 * xterm은 셀 폭을 문자 측정으로 계산하는데 그 측정용 요소가 문서 밖(오프스크린)에 잠깐
 * 붙었다 떼였다 하며 var() 해석이 타이밍에 흔들릴 수 있어(실측 전 리스크) — CSS 변수를
 * 참조하지 않고 tokens.css:9의 값을 그대로 복사해 고정한다(토큰이 바뀌면 여기도 손으로 맞춘다)
 */
const TERMINAL_FONT_FAMILY = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"

/** IPC 래핑 접두 제거 — store toErrorMessage와 같은 규칙(모듈 비공개라 지역 복제) */
function stripIpcPrefix(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
}

/**
 * 세션 코어 — 훅 인스턴스당 1회만 생성된다(useState lazy init). 모든 액션이 렌더 간 같은
 * 참조를 유지하므로 소비자(TerminalDock) 이펙트의 deps에 정직하게 넣어도 재실행을 만들지
 * 않는다 — E14b가 남긴 exhaustive-deps 억제 5곳과, `[]`로 굳은 클로저가 refitActive를
 * 항상 activeId=null로 부르던 잠복 버그(사이드 접기 refit 불능, E12부터)의 공통 해법이다.
 * 렌더에 묶인 값(repoPath·appearance·tabs·activeId)은 클로저가 아니라 `latest` 스냅숏으로 읽는다
 * (훅이 매 렌더 이펙트에서 미러 — 액션은 이벤트·이펙트에서만 불리므로 미러가 항상 앞선다).
 * useMemo/useCallback 없이 참조가 안정되는 구조라 지침(성능 훅 지양)과도 어긋나지 않는다
 */
function createTerminalCore(initial: LatestSnapshot, set: CoreSetters) {
  /**
   * 코어 소유의 최신 스냅숏 — 훅이 매 렌더 syncLatest로 갈아 끼운다. useRef가 아니라 모듈
   * 클로저 변수인 이유: ref 객체를 렌더 중(useState 초기화) 함수에 넘기는 것 자체가
   * react-hooks/refs 위반이다(실측 — "Passing a ref to a function may read its value
   * during render"). 액션은 렌더 클로저 대신 latest()로 호출 시점 값을 읽는다
   */
  let snapshot = initial
  const latest = () => snapshot
  /** 훅의 미러 이펙트 전용 — 렌더 값(스냅숏)을 통째로 교체한다 */
  const syncLatest = (next: LatestSnapshot) => {
    snapshot = next
  }
  const views = new Map<string, SessionView>()
  /** create 응답이 돌아오기 전 도착한 청크(로그인 쉘 프롬프트가 invoke 왕복을 이길 수 있다 — Task 3 리뷰) */
  const pending = new Map<string, string[]>()
  /** 출력을 한 번이라도 보낸 세션 — 무출력 exit(깨진 쉘) 판정용 (E7d ②) */
  const received = new Set<string>()
  /** 사용자가 닫아서(kill) 죽는 세션 — 프롬프트 도착 전 닫기가 깨진 쉘 오경보가 되는 것 방지 (E7d ② 보완) */
  const closing = new Set<string>()
  /** 그룹별 마지막 활성 탭 — 그룹 전환 시 복원한다 (E7h ④) */
  const lastActive = new Map<string, string>()
  /** 빈 상태 안내를 이미 껐던 세션 — 반복 입력마다 setTabs를 다시 부르지 않기 위한 가드 (E12) */
  const hintGone = new Set<string>()
  /**
   * 자동 생성이 진행 중인 그룹 — activateGroup의 이중 생성 가드. create의 invoke 왕복이
   * 끝나기 전(setTabs 반영 전) activateGroup이 또 불리면 "탭 0개" 스냅숏을 다시 보고 세션을
   * 하나 더 만들던 함정(E7h 실측, 구 TerminalDock 주석)을 호출부 사정과 무관하게 여기서 막는다.
   * "+" 버튼의 create 직접 호출에는 가드를 걸지 않는다 — 빠른 연타로 탭 여러 개는 의도된 동작
   */
  const activating = new Set<string>()

  /** 빈 상태 안내를 끈다 — 첫 입력·첫 출력 중 먼저 온 쪽이 부른다. 한 세션당 1회만 렌더에 반영 */
  const dismissHint = (sessionId: string) => {
    if (hintGone.has(sessionId)) return
    hintGone.add(sessionId)
    set.setTabs((prev) =>
      prev.map((tab) => (tab.sessionId === sessionId ? { ...tab, hintVisible: false } : tab)),
    )
  }

  /** push 데이터 수신 — sessionId로 해당 xterm에 라우팅한다 (구독은 훅의 이펙트가 담당) */
  const handleData = (sessionId: string, chunk: string) => {
    received.add(sessionId)
    dismissHint(sessionId)
    const view = views.get(sessionId)
    if (view === undefined) {
      const queue = pending.get(sessionId) ?? []
      queue.push(chunk)
      pending.set(sessionId, queue)
      return
    }
    view.terminal.write(chunk)
  }

  /** 세션 종료 — 출력 없이 죽은 세션 = 깨진 쉘. 단, 사용자가 닫은 세션은 제외 (E7d ② 보완: 빠른 닫기 오탐) */
  const handleExit = (sessionId: string) => {
    const userClosed = closing.delete(sessionId)
    const notice = userClosed ? null : silentExitNotice(received.has(sessionId))
    if (notice !== null) set.setError(notice)
    set.setTabs((prev) =>
      prev.map((tab) => (tab.sessionId === sessionId ? { ...tab, exited: true } : tab)),
    )
  }

  const refit = (sessionId: string) => {
    const view = views.get(sessionId)
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
    const { repoPath, appearance } = latest()
    if (repoPath === null) return
    try {
      const { sessionId } = await window.terminalApi.create(repoPath, options?.cwd)
      const terminal = new Terminal({
        fontSize: 12,
        fontFamily: TERMINAL_FONT_FAMILY,
        lineHeight: 1.4,
        theme: terminalAppearance.palette.get(appearance),
        scrollback: 1000,
      })
      const fit = new FitAddon()
      terminal.loadAddon(fit)
      terminal.onData((data) => {
        // 셸로 보내는 것과 별개로, 빈 상태 안내를 끄는 신호로도 쓴다 — 문자를 추가로 주입하지
        // 않는다(이미 사용자가 친 입력을 그대로 전달할 뿐이다), 첫 호출 이후는 dismissHint가 무시한다
        dismissHint(sessionId)
        void window.terminalApi.input(sessionId, data)
      })
      views.set(sessionId, { terminal, fit })
      // 먼저 도착해 대기 중인 청크 재생 — 첫 프롬프트 유실 방지 (Task 3 리뷰)
      const queued = pending.get(sessionId)
      if (queued !== undefined) {
        pending.delete(sessionId)
        for (const chunk of queued) terminal.write(chunk)
      }
      const groupKey = options?.cwd ?? repoPath
      // 함수형 업데이터 필수 — 스냅숏 tabs를 읽으면 같은 렌더 안에서 연속 생성될 때
      // 번호가 중복된다(close/closeGroup 트랩과 같은 이유)
      set.setTabs((prev) => {
        const usedNumbers = prev.filter((tab) => tab.groupKey === groupKey).map((tab) => tab.number)
        const number = nextTabNumber(usedNumbers)
        return [
          ...prev,
          { sessionId, number, title: String(number), exited: false, groupKey, hintVisible: true },
        ]
      })
      set.setActiveId(sessionId)
      lastActive.set(groupKey, sessionId)
      set.setError(null)
    } catch (cause) {
      set.setError(stripIpcPrefix(cause instanceof Error ? cause.message : String(cause)))
    }
  }

  /** 탭 선택 — 그 그룹의 마지막 활성으로 기억한다 (E7h ④) */
  const select = (sessionId: string) => {
    set.setActiveId(sessionId)
    const tab = latest().tabs.find((t) => t.sessionId === sessionId)
    if (tab !== undefined) lastActive.set(tab.groupKey, sessionId)
  }

  // close는 closeGroup에서 같은 렌더 안에 연속 호출된다 — setTabs(next)처럼 스냅숏 tabs로
  // "다음 상태"를 미리 계산하면 두 번째 호출이 첫 번째 호출의 아직 반영 안 된 결과를 못 보고 되살려버린다
  // (React가 이벤트 핸들러 내 setState를 배치하기 때문). setTabs/setActiveId 둘 다 함수형 업데이터로 써서
  // 연속 호출이 서로의 결과 위에 누적되게 한다 (E7h ④ 실측 — closeGroup 2세션 정리 검증으로 확인)
  const close = (sessionId: string) => {
    closing.add(sessionId)
    void window.terminalApi.kill(sessionId)
    const view = views.get(sessionId)
    views.delete(sessionId)
    view?.terminal.dispose()
    hintGone.delete(sessionId)
    set.setTabs((prev) => {
      const closedGroup = prev.find((tab) => tab.sessionId === sessionId)?.groupKey
      const next = prev.filter((tab) => tab.sessionId !== sessionId)
      set.setActiveId((prevActive) => {
        if (prevActive !== sessionId) return prevActive
        const sameGroup = next.filter((tab) => tab.groupKey === closedGroup)
        const fallback = sameGroup[sameGroup.length - 1]?.sessionId ?? null
        if (closedGroup !== undefined) {
          if (fallback !== null) lastActive.set(closedGroup, fallback)
          else lastActive.delete(closedGroup)
        }
        return fallback
      })
      return next
    })
  }

  /**
   * 그룹 활성화 (E7h ④) — 탭이 없으면 자동 1개 생성, 활성 탭이 이미 이 그룹이면(재열림 등)
   * refit만, 아니면 기억된(없으면 마지막) 탭을 활성. 재열림 refit 분기는 원래 TerminalDock의
   * open/groupKey 이펙트가 들고 있었는데 로직 레이어인 이쪽으로 내렸다 (E14c — 레이어 분리)
   */
  const activateGroup = async (
    groupKey: string,
    createOptions?: { cwd?: string; label?: string },
  ) => {
    const { tabs, activeId } = latest()
    const group = tabs.filter((tab) => tab.groupKey === groupKey)
    if (group.length === 0) {
      if (activating.has(groupKey)) return // 자동 생성 진행 중 — 이중 생성 가드 (위 주석)
      activating.add(groupKey)
      try {
        await create(createOptions)
      } finally {
        activating.delete(groupKey)
      }
      return
    }
    if (activeId !== null && group.some((tab) => tab.sessionId === activeId)) {
      refit(activeId)
      return
    }
    const remembered = lastActive.get(groupKey)
    const target = group.find((tab) => tab.sessionId === remembered) ?? group[group.length - 1]!
    set.setActiveId(target.sessionId)
  }

  /** 그룹 세션 전부 정리 — 워크트리 지우기 성공 시 (E7h ④). close가 함수형이라 연속 호출도 안전하다 */
  const closeGroup = (groupKey: string) => {
    for (const tab of latest().tabs.filter((t) => t.groupKey === groupKey)) close(tab.sessionId)
  }

  /** 세션 뷰를 DOM에 붙인다 — 숨김 탭에서 붙으면 크기가 0이라, 보이는 시점의 refit이 바로잡는다 */
  const attach = (sessionId: string, element: HTMLDivElement | null) => {
    if (element === null) return
    const view = views.get(sessionId)
    if (view === undefined) return
    if (view.terminal.element !== undefined) {
      refit(sessionId)
      return
    }
    view.terminal.open(element)
    refit(sessionId)
  }

  /** 활성 세션 refit — activeId를 스냅숏에서 읽으므로 오래된 클로저에서 불려도 최신 탭을 맞춘다 */
  const refitActive = () => {
    const { activeId } = latest()
    if (activeId !== null) refit(activeId)
  }

  return {
    views,
    syncLatest,
    handleData,
    handleExit,
    create,
    close,
    select,
    activateGroup,
    closeGroup,
    attach,
    refitActive,
  }
}

/**
 * 터미널 세션 로직 (E7b) — 세션 생성·xterm 인스턴스 수명·push 라우팅을 소유한다.
 * TerminalDock(프레젠테이션)은 이 훅의 값·콜백만 렌더한다 (레이어 분리).
 * E14c — 액션은 createTerminalCore가 1회만 만들어 렌더 간 참조가 안정적이다: 소비자 이펙트가
 * `sessions.view.refit` 등을 deps에 정직하게 넣을 수 있다(넣어도 재실행 없음)
 */
export function useTerminalSessions(repoPath: string | null, appearance: Appearance) {
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 코어는 첫 렌더에 1회 생성 — 안정 참조인 세터만 캡처하므로 낡지 않는다. 스냅숏은 코어가
  // 소유한다(useState에 담아 필드를 고쳐 쓰면 immutability, ref를 렌더 중 넘기면 refs 규칙
  // 위반 — 둘 다 실측 lint 에러라 모듈 클로저 소유로 정리했다. createTerminalCore 주석)
  const [core] = useState(() =>
    createTerminalCore(
      { repoPath, appearance, tabs: [], activeId: null },
      { setTabs, setActiveId, setError },
    ),
  )

  // 최신 스냅숏 미러(매 렌더, deps 없음) — 액션은 이벤트·이펙트에서만 불리고, 이 이펙트는 훅
  // 안에 있어 소비자 컴포넌트의 어떤 이펙트보다 먼저 돈다(등록 순서) — 액션이 읽는 스냅숏이
  // 항상 그 커밋의 값임이 보장된다. 유일한 예외인 attach(ref 콜백, 이펙트보다 앞선 커밋 단계)는
  // 스냅숏을 읽지 않는다(views와 인자 sessionId만 쓴다)
  useEffect(() => {
    core.syncLatest({ repoPath, appearance, tabs, activeId })
  })

  // push 구독 — core가 안정 참조라 실질 마운트 1회다
  useEffect(() => {
    const offData = window.terminalApi.onData(core.handleData)
    const offExit = window.terminalApi.onExit(core.handleExit)
    return () => {
      offData()
      offExit()
    }
  }, [core])

  // 테마 전환 시 열린 세션 전부 즉시 교체 — options.theme는 "객체 재할당"이어야 반영된다 (실측 3)
  useEffect(() => {
    for (const view of core.views.values()) {
      view.terminal.options.theme = { ...terminalAppearance.palette.get(appearance) }
    }
  }, [core, appearance])

  return {
    data: { tabs, activeId, error },
    session: { create: core.create, close: core.close, select: core.select },
    group: { activate: core.activateGroup, close: core.closeGroup },
    view: { attach: core.attach, refit: core.refitActive },
  }
}
