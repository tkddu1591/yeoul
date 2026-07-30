import {
  CloudUpload,
  DownloadCloud,
  GitMerge,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Settings,
  Terminal,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { suggestCommitMessage, type RepositoryStateKind } from '@git-gui/domain'
import { isHeadBackedUp } from './components/backup-state'
import { AddWorktreeDialog } from './components/AddWorktreeDialog'
import { BranchesPanel } from './components/BranchesPanel'
import { BranchSwitcher } from './components/BranchSwitcher'
import { ConflictPanel } from './components/ConflictPanel'
import { ChangesPanel } from './components/ChangesPanel'
import { CommitDetailPanel } from './components/CommitDetailPanel'
import { CommitForm } from './components/CommitForm'
import { DiffPanel } from './components/DiffPanel'
import { HistoryPanel } from './components/HistoryPanel'
import { ManageBranchesDialog } from './components/ManageBranchesDialog'
import { RepoPicker } from './components/RepoPicker'
import { ReviewDetailPanel } from './components/ReviewDetailPanel'
import { ReviewPopover } from './components/ReviewPopover'
import { ShelfPopover } from './components/ShelfPopover'
import { WorktreesPanel } from './components/WorktreesPanel'
import {
  clampRightWidth,
  computeColumns,
  isCompactHeader,
  loadLeftCollapsed,
  loadRightCollapsed,
  loadRightWidth,
  resetRightWidth,
  RIGHT_COLUMN_DEFAULT,
  saveLeftCollapsed,
  saveRightCollapsed,
  saveRightWidth,
} from './ui/column-resize'
import {
  buildMainColumns,
  buildMainRows,
  MAIN_DOCK_GRID_COLUMN,
  MAIN_DOCK_GRID_ROW,
} from './ui/grid-tracks'
import {
  clampDockHeight,
  loadDockHeight,
  loadDockOpen,
  saveDockHeight,
  saveDockOpen,
} from './ui/terminal/dock-height'
import { TerminalDock } from './ui/terminal/TerminalDock'
import { SettingsDialog } from './ui/settings/SettingsDialog'
import {
  loadWorktreeSelectAction,
  saveWorktreeSelectAction,
  type WorktreeSelectAction,
} from './ui/settings/worktree-select-action'
import { loadAutoFetch, saveAutoFetch } from './ui/settings/sync-settings'
import { NOTICE_TTL_MS, useRepositoryStore } from './store/repository-store'
import { applyTheme, initTheme, type Theme } from './ui/theme'
import { T } from './terms'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Pictogram } from './ui/Pictogram'
import { Tooltip } from './ui/Tooltip'
import { PromptDialog } from './ui/PromptDialog'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { ListDialog } from './ui/ListDialog'

/** 일상어 + 원어 병기(스펙 5장 문구 원칙) — 상태를 숨기지 않는다 */
const STATE_LABELS: Record<RepositoryStateKind, string> = {
  normal: '정상',
  merging: '합치는 중',
  rebasing: '다시 쌓는 중',
  'cherry-picking': '가져오는 중',
  reverting: '되돌리는 중',
  bisecting: '원인 찾는 중',
}

/** 진행 중 작업 상태 바 문구 — merging/reverting/cherry-picking/rebasing 4겸용 (E5b·E7a) */
const OP_BAR = {
  merging: { doing: `${T.branch} ${T.merge}하는 중`, abort: `${T.merge} 취소` },
  reverting: { doing: `${T.commit} 되돌리는 중`, abort: `${T.revert} 취소` },
  'cherry-picking': { doing: `${T.cherryPick}하는 중`, abort: `${T.cherryPick} 취소` },
  rebasing: { doing: `${T.commit} ${T.rebase} 중`, abort: `${T.rebase} 취소` },
} as const

export function App() {
  const store = useRepositoryStore()

  // 첫 렌더에서 문서에 테마를 새긴다 — 저장값 우선, 없으면 시스템 설정 (⑥)
  const [theme, setTheme] = useState<Theme>(() => initTheme())
  // 전환 UI는 설정 모달 [테마] 카테고리로 이관 (E7d ⑦ — 헤더 단순화)
  const changeTheme = (next: Theme) => {
    applyTheme(next)
    setTheme(next)
  }

  // 새 실험 공간 다이얼로그 — fromHash가 있으면 우클릭한 저장 시점에서 갈라진다
  const [branchPrompt, setBranchPrompt] = useState<{ fromHash: string | null } | null>(null)

  // 합치기 대상 선택·취소 확인
  const [mergePicker, setMergePicker] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [confirmingAbort, setConfirmingAbort] = useState(false)

  // E7a 좌측 탭 — [변경 | 실험 공간]. 기본은 변경(커밋 흐름 무변). 탭 상태는 렌더 로컬(store 오염 없음)
  const [leftTab, setLeftTab] = useState<'changes' | 'branches' | 'worktrees'>('changes')
  // E7c 활성 워크트리(터미널 대상) — renderer 로컬(재시작 시 앱이 연 곳으로 초기화, 영속 안 함)
  const [activeWorktree, setActiveWorktree] = useState<{ cwd: string; label: string } | null>(null)
  // E7j — 워크트리 행 `~` 축약용 홈 경로. 못 구하면 빈 문자열(순수 함수가 축약 없이 처리)
  const [home, setHome] = useState('')
  const [addWorktreeOpen, setAddWorktreeOpen] = useState(false)
  const [confirmingRemoveWorktree, setConfirmingRemoveWorktree] = useState<{
    path: string
    force: boolean
  } | null>(null)
  // E7h ④ 워크트리 지우기 성공 직후 그 경로를 1회성으로 담아 TerminalDock에 내려보낸다 —
  // 도크가 closeGroup 후 onPurged로 비운다(세션 훅을 App으로 끌어올리는 큰 리팩터 없이 배선)
  const [purgeTerminalGroup, setPurgeTerminalGroup] = useState<string | null>(null)
  // E7a 실험 공간 우클릭 다이얼로그 — 재배치 확인·이름 바꾸기·지우기(needsForce 2단)·원격 지우기
  const [confirmingRebase, setConfirmingRebase] = useState<{ name: string } | null>(null)
  const [renamePrompt, setRenamePrompt] = useState<{ name: string } | null>(null)
  const [confirmingRemove, setConfirmingRemove] = useState<{ name: string; force: boolean } | null>(
    null,
  )
  // E7h ⑤ — 워크트리가 쓰는 실험 공간: 워크트리 동반 삭제 확인
  const [confirmingRemoveWithWorktree, setConfirmingRemoveWithWorktree] = useState<{
    name: string
    force: boolean
    worktreePath: string
  } | null>(null)
  const [confirmingRemoveRemote, setConfirmingRemoveRemote] = useState<{ name: string } | null>(
    null,
  )

  // E7c 설정 모달 + 워크트리 선택 동작(클릭의 기본 동작만 결정 — 우클릭엔 항상 둘 다)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [worktreeSelectAction, setWorktreeSelectAction] = useState<WorktreeSelectAction>(() =>
    loadWorktreeSelectAction(),
  )
  const changeWorktreeSelectAction = (action: WorktreeSelectAction) => {
    setWorktreeSelectAction(action)
    saveWorktreeSelectAction(action)
  }

  // E7b 터미널 도크 — 중앙+우측 하단. 열림·높이는 설정 영속(rightWidth 관례).
  // 접힘은 숨김일 뿐 언마운트가 아니다 — 언마운트하면 xterm 인스턴스가 죽어 세션 유지가 깨진다 (스펙)
  const [dockOpen, setDockOpen] = useState<boolean>(() => loadDockOpen())
  const [dockHeight, setDockHeight] = useState<number>(() =>
    clampDockHeight(loadDockHeight(), window.innerHeight),
  )
  const toggleDock = () => {
    setDockOpen((prev) => {
      saveDockOpen(!prev)
      return !prev
    })
  }
  const startDockResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    // E13 Task 3 — 열 리사이즈(startResize)와 같은 이유: 행 전환(240ms)이 걸린 채 드래그하면
    // 커서를 뒤쫓아 오는 모양으로 보인다. 손 떼는 순간까지 억제한다 (아래 noColumnTransition)
    setDockDragSuppress(true)
    const onMove = (move: PointerEvent) => {
      setDockHeight(clampDockHeight(window.innerHeight - move.clientY - 20, window.innerHeight))
    }
    const onUp = (up: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      saveDockHeight(clampDockHeight(window.innerHeight - up.clientY - 20, window.innerHeight))
      setDockDragSuppress(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // E5b 커밋 작업 다이얼로그 — 태그 이름·실행취소 확인·메시지 고치기 (대상 커밋 정보를 함께 보관)
  const [tagPrompt, setTagPrompt] = useState<{ hash: string } | null>(null)
  const [confirmingUndo, setConfirmingUndo] = useState<{ hash: string } | null>(null)
  const [rewordPrompt, setRewordPrompt] = useState<{ hash: string; subject: string } | null>(null)

  // 리뷰(호스팅) 다이얼로그 — 토큰 붙여넣기·리뷰 요청 제목 (팝오버는 닫고 연다)
  const [tokenPrompt, setTokenPrompt] = useState(false)
  const [pullPrompt, setPullPrompt] = useState(false)

  // 리뷰 상세의 병합 확인과 병합 후 "기본 공간 이동+받아오기" 제안(base 이름 보관)
  const [confirmingMerge, setConfirmingMerge] = useState(false)
  const [mergeFollowUp, setMergeFollowUp] = useState<string | null>(null)

  // 우측 열 폭 — 드래그로 조절하고 기억한다 (5차 피드백). 저장값·창 크기 변화 모두
  // 뷰포트 기준으로 재클램프한다 — 큰 모니터에서 넓혀둔 폭이 노트북에서 중앙을 짓누르지 않게
  const [rightWidth, setRightWidth] = useState<number>(() =>
    clampRightWidth(loadRightWidth(), window.innerWidth),
  )
  // 창 폭 — 좌·우 열이 창 폭에 따라 줄어드는 반응형 계산(computeColumns)의 입력 (E6a)
  const [viewportWidth, setViewportWidth] = useState<number>(() => window.innerWidth)
  // E13 — .app__main의 grid-template-columns(열) · grid-template-rows(행, Task 3) 전환(240ms)을
  // 꺼야 하는 네 순간을 각자 독립된 플래그로 추적하고 OR로 합친다(부팅·열 드래그·창 크기 변경·
  // 도크 높이 드래그는 서로 다른 생명주기라 하나로 뭉치면 한쪽이 끝나며 다른 쪽 억제까지 같이
  // 풀린다). 부팅은 E11 theme-switching과 같은 idiom(rAF 두 번 — 첫 rAF는 새 스타일이 커밋된
  // 뒤, 그 안의 두 번째 rAF에서 억제 해제)
  const [bootSuppress, setBootSuppress] = useState(true)
  const [dragSuppress, setDragSuppress] = useState(false)
  const [resizeSuppress, setResizeSuppress] = useState(false)
  const [dockDragSuppress, setDockDragSuppress] = useState(false)
  const noColumnTransition = bootSuppress || dragSuppress || resizeSuppress || dockDragSuppress
  useEffect(() => {
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => setBootSuppress(false))
    })
    return () => cancelAnimationFrame(raf1)
    // 마운트 시 1회만 실행
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const resizeSuppressTimerRef = useRef<number | null>(null)
  useEffect(() => {
    const onWindowResize = () => {
      // 창 가장자리를 뒤쫓는 동안은 전환을 끈다 — 마지막 resize 이벤트로부터 200ms 조용하면 푼다
      setResizeSuppress(true)
      if (resizeSuppressTimerRef.current !== null) window.clearTimeout(resizeSuppressTimerRef.current)
      resizeSuppressTimerRef.current = window.setTimeout(() => setResizeSuppress(false), 200)
      setViewportWidth(window.innerWidth)
      setRightWidth((width) => clampRightWidth(width, window.innerWidth))
      // 도크도 창 세로 축소를 따라 재클램프 — 60% 상한 초과로 1행이 짓눌리는 것을 막는다 (품질 리뷰, rightWidth 선례)
      setDockHeight((height) => clampDockHeight(height, window.innerHeight))
    }
    window.addEventListener('resize', onWindowResize)
    return () => {
      window.removeEventListener('resize', onWindowResize)
      if (resizeSuppressTimerRef.current !== null) window.clearTimeout(resizeSuppressTimerRef.current)
    }
  }, [])
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    // 드래그 중엔 커서를 1:1로 따라가야 한다 — 240ms 전환이 걸리면 손잡이가 커서에 뒤처진다
    setDragSuppress(true)
    const onMove = (move: PointerEvent) => {
      setRightWidth(clampRightWidth(window.innerWidth - move.clientX - 20, window.innerWidth))
    }
    const onUp = (up: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      saveRightWidth(clampRightWidth(window.innerWidth - up.clientX - 20, window.innerWidth))
      setDragSuppress(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }
  const resetResize = () => {
    resetRightWidth()
    setRightWidth(RIGHT_COLUMN_DEFAULT)
  }

  // 좌·우 사이드 접기 (E12) — 저장·복원은 dockOpen 선례와 같은 자리(settingsApi). 접힘은
  // computeColumns의 입력일 뿐 별도 CSS 분기가 아니다 — 최소 창·양쪽 접기 조합이 저절로 정합한다
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(() => loadLeftCollapsed())
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(() => loadRightCollapsed())
  const toggleLeftCollapsed = () => {
    setLeftCollapsed((prev) => {
      saveLeftCollapsed(!prev)
      return !prev
    })
  }
  const toggleRightCollapsed = () => {
    setRightCollapsed((prev) => {
      saveRightCollapsed(!prev)
      return !prev
    })
  }
  // 우측이 접힌 채 죽은 클릭(결과를 볼 수 없는 곳으로 보내는 것)을 만들 상황이면 편다 (E12 스펙 에러표).
  // 이미 펼쳐져 있으면 그대로 둔다 — 매번 저장을 부르지 않는다
  const expandRightIfCollapsed = () => {
    setRightCollapsed((prev) => {
      if (!prev) return prev
      saveRightCollapsed(false)
      return false
    })
  }
  const expandLeftIfCollapsed = () => {
    setLeftCollapsed((prev) => {
      if (!prev) return prev
      saveLeftCollapsed(false)
      return false
    })
  }
  // E13 — 아래 ⌘F 키다운 리스너는 마운트 시 1회만 등록돼([] 의존성) 클로저가 접힘의 초기값을
  // 그대로 굳힌다. 리스너 안에서 "지금" 접혀 있는지 읽으려면 최신값을 따라가는 ref가 필요하다
  const leftCollapsedRef = useRef(leftCollapsed)
  const rightCollapsedRef = useRef(rightCollapsed)
  useEffect(() => {
    leftCollapsedRef.current = leftCollapsed
  }, [leftCollapsed])
  useEffect(() => {
    rightCollapsedRef.current = rightCollapsed
  }, [rightCollapsed])

  // 상세 전환이 열 폭을 강제로 넓히면 중앙이 밀린다(피드백 4: 레이아웃 시프트) — 사용자가 정한
  // 폭은 존중하되, 중앙 diff 최소 폭(380px)이 깨지면 좌측→우측 순으로 함께 줄인다 (E6a 반응형)
  const columns = computeColumns(viewportWidth, rightWidth, {
    left: leftCollapsed,
    right: rightCollapsed,
  })
  // E7k — 창이 좁으면 헤더 액션이 아이콘만 남는다(이름은 Tooltip이 담당). 판정만 여기서, 숨김은 CSS
  const compactHeader = isCompactHeader(viewportWidth)
  // E13 — 접힌 열도 트랙을 유지하고 0px로 둔다(grid-tracks.ts). 간격도 트랙으로 옮겨져
  // 열·간격·리사이저가 이 한 값 안에서 함께 보간된다 — .app__main의 transition이 이 값의
  // 변화를 탄다(부팅·드래그·창 크기 변경 중엔 noColumnTransition으로 억제)
  const gridTemplateColumns = buildMainColumns(columns, { left: leftCollapsed, right: rightCollapsed })
  // 도크(터미널)는 좌측 관리 존(좌 트랙+그 간격)만 제외한 나머지 트랙 전부를 덮는다 — 트랙 수가
  // 이제 접힘과 무관하게 항상 고정이라(grid-tracks.ts) 시작선도 항상 3번째로 고정이다
  const dockGridColumn = MAIN_DOCK_GRID_COLUMN
  // E13 Task 3 — 닫힌 도크도 행 트랙을 유지하고 0px로 둔다(grid-tracks.ts) — 간격도 트랙으로
  // 옮겨져 콘텐츠·간격·도크가 이 한 값 안에서 함께 보간된다. .app__main의 transition이 이 값의
  // 변화도 탄다(부팅·열 드래그·창 크기 변경·도크 드래그 중엔 noColumnTransition으로 억제)
  const gridTemplateRows = buildMainRows(dockOpen, dockHeight)
  // 도크는 항상 3번째(마지막) 행 — 암시적 배치에 맡기면 2번째 간격 행에 잘못 올라갈 수 있다
  const dockGridRow = MAIN_DOCK_GRID_ROW

  useEffect(() => {
    void store.init()
    // 마운트 시 1회만 실행
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // 실패해도 빈 문자열 유지 — 축약 없이 전체 경로가 보일 뿐 기능은 죽지 않는다 (E7j)
    void window.gitApi.repo.home().then(setHome).catch(() => {})
    // 마운트 시 1회만 실행
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // notice만 10초 뒤 자동으로 사라진다 — 에러·머지 바는 남는다 (E1d 후속). 새 notice가 오면
  // 값이 바뀌어 effect가 다시 걸리며 타이머가 리셋된다. 같은 문구가 연속으로 와도 guard가
  // 작업 시작마다 notice를 null로 비우므로 null→값 전이로 반드시 리셋된다
  useEffect(() => {
    if (store.notice === null) return
    const timer = window.setTimeout(() => store.clearNotice(), NOTICE_TTL_MS)
    return () => window.clearTimeout(timer)
    // store 객체는 렌더마다 새 참조 — notice 값 변화에만 반응해야 임의 갱신이 타이머를 연장하지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.notice])

  // E7h ⑥ — ⌘F 검색 대상 패널(마우스 위치의 data-find-scope, 없으면 diff)
  const [findScope, setFindScope] = useState<'history' | 'diff' | 'commit-files' | 'changes' | null>(
    null,
  )
  // E7h ⑥ 보완 — 같은 스코프로 재⌘F해도 findScope 값은 안 바뀌어(bail-out) FindBar가 재마운트도
  // 재렌더도 안 되니, 재⌘F마다 증가시켜 FindBar의 focusSignal로 흘려보내 재포커스를 강제한다
  const [findNonce, setFindNonce] = useState(0)
  const pointerRef = useRef({ x: 0, y: 0 })
  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY }
    }
    window.addEventListener('pointermove', onPointerMove)
    return () => window.removeEventListener('pointermove', onPointerMove)
  }, [])

  // ⌘`(맥)/Ctrl+` — 터미널 도크 토글 (E7b). 수정키 조합이라 입력 필드와 충돌하지 않는다.
  // ⌘F/Ctrl+F — 패널 검색 오버레이 열기 (E7h ⑥, 같은 훅에 이어 붙인다). 마우스가 올라간
  // 패널의 data-find-scope를 대상으로 삼는다 — 없으면 중앙 diff를 기본으로 한다
  // ⌘⌥1/⌘⌥2 — 좌·우 사이드 접기 토글 (E12). event.altKey를 반드시 같이 봐야 한다 — macOS는
  // Option을 누른 채면 event.key가 '1'이 아니라 특수문자(예: '¡')로 바뀐다(실측) — event.key만
  // 보면 이 단축키 자체가 죽는다. event.code('Digit1'/'Digit2')는 물리 키라 흔들리지 않는다
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === '`') {
        event.preventDefault()
        setDockOpen((prev) => {
          saveDockOpen(!prev)
          return !prev
        })
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.altKey &&
        (event.code === 'Digit1' || event.code === 'Digit2')
      ) {
        event.preventDefault()
        if (event.code === 'Digit1') {
          setLeftCollapsed((prev) => {
            saveLeftCollapsed(!prev)
            return !prev
          })
        } else {
          setRightCollapsed((prev) => {
            saveRightCollapsed(!prev)
            return !prev
          })
        }
      } else if ((event.metaKey || event.ctrlKey) && (event.key === 'f' || event.key === 'F')) {
        // 터미널(xterm) 포커스면 쉘의 자체 검색을 존중 — 가로채지 않는다. closest는 매치가
        // 없으면 null을 돌려주므로, activeElement가 .terminal-dock 안에 있을 때만(= 매치 있음
        // = null이 아님) 이 분기가 참이 되어 return한다 — "터미널 안이면 가로채지 않는다"와 일치
        if (document.activeElement?.closest('.terminal-dock') !== null) return
        event.preventDefault()
        const { x, y } = pointerRef.current
        const scopeEl = document.elementFromPoint(x, y)?.closest('[data-find-scope]')
        const rawScope = scopeEl?.getAttribute('data-find-scope') as
          | NonNullable<typeof findScope>
          | null
        // E13 — 접힌 패널도 이제 DOM에 남는다(트랙만 0px, App.tsx가 언마운트하지 않는다 —
        // 전환의 시작점을 유지하려고). elementFromPoint가 그 잔여 요소를 잡아채 스코프로
        // 삼으면 찾기 오버레이가 안 보이는 접힌 열에 뜬다 — E12는 언마운트라 이 경로 자체가
        // 없었다(그래서 아래 expand 방어 코드가 그때는 재현 불가였다). 접힌 쪽이면 버린다
        const scope: NonNullable<typeof findScope> =
          (rawScope === 'changes' && leftCollapsedRef.current) ||
          ((rawScope === 'history' || rawScope === 'commit-files') && rightCollapsedRef.current)
            ? 'diff'
            : (rawScope ?? 'diff')
        // 접힌 패널을 대상으로 하면 먼저 편다 — 안 그러면 찾기 오버레이가 안 보이는 곳에 뜬다
        // (E12 죽은 클릭 방지, 커밋 클릭과 같은 이유). 위 스코프 대체 덕에 이제 이 두 분기는
        // 도달할 수 없다(접힌 패널의 스코프는 이미 'diff'로 바뀐 뒤라서) — 방어선을 하나 더
        // 두는 셈이라 그대로 둔다
        if (scope === 'history' || scope === 'commit-files') expandRightIfCollapsed()
        else if (scope === 'changes') expandLeftIfCollapsed()
        setFindScope(scope)
        setFindNonce((n) => n + 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const status = store.status
  const stagedCount = status?.changes.filter((c) => c.staged !== null).length ?? 0
  const conflictCount = status?.changes.filter((c) => c.unstaged === 'conflicted').length ?? 0
  // E7d ① 충돌이 "생기는 순간" 1회만 변경 탭으로 — 유발 경로(merge·pull·rebase·cherry-pick·
  // revert·stash) 무관하게 충돌 개수 0→1+ 전이가 신호. 이후 사용자의 탭 이동은 다시 막지 않는다.
  // 훅 순서 불변 규칙 때문에 아래 "repoPath 없으면 이른 반환"보다 앞에 둔다(반환 이후에 두면
  // repoPath가 null→값으로 바뀌는 순간 훅 개수가 렌더마다 달라져 앱 전체가 깨진다 — 실행 중 실측)
  const prevConflictsRef = useRef(0)
  useEffect(() => {
    if (conflictCount > 0 && prevConflictsRef.current === 0) setLeftTab('changes')
    prevConflictsRef.current = conflictCount
  }, [conflictCount])

  // E12 — 우측이 접힌 채 커밋 상세가 뜨면 죽은 클릭이다. 히스토리 목록을 직접 클릭하는 경로는
  // 우측 자체가 접혀 있어 애초에 불가능하지만, 헤더 보관함(ShelfPopover) "미리보기"처럼 우측
  // 밖에서 store.selectCommit을 부르는 경로가 있다(ShelfPopover onPreview) — commitDetail이
  // 채워지는 순간을 공통으로 잡아 우측을 편다
  useEffect(() => {
    if (store.commitDetail === null) return
    expandRightIfCollapsed()
    // commitDetail 값 자체(어느 커밋인지)에 반응할 필요는 없다 — null→값 전이만 신호
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.commitDetail])

  // E7e ① 자동 원격 새로고침 — 시작 직후 1회 + 10분 주기. fetch만 던지고 갱신은 감시가 담당.
  // 훅 순서 불변 — 이른 반환보다 앞 (E7d ① 교훈)
  const [autoFetch, setAutoFetch] = useState<boolean>(() => loadAutoFetch())
  const changeAutoFetch = (enabled: boolean) => {
    saveAutoFetch(enabled)
    setAutoFetch(enabled)
  }
  const repoPathForFetch = store.repoPath
  useEffect(() => {
    if (!autoFetch || repoPathForFetch === null) return
    void store.autoFetchRemotes()
    const timer = window.setInterval(() => void store.autoFetchRemotes(), 600_000)
    return () => window.clearInterval(timer)
    // store 액션은 zustand에서 안정 참조 — repoPath·autoFetch 전이에만 재구독
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch, repoPathForFetch])

  // E7f 전체화면 전환 — 신호등이 숨는 동안 헤더의 신호등 패딩을 접는다 (body 클래스 — CSS 몫)
  useEffect(() => {
    return window.windowApi.onFullScreen((isFullScreen) => {
      document.body.classList.toggle('is-fullscreen', isFullScreen)
    })
  }, [])

  // 저장소 전환 시 열려 있던 ⌘F 검색을 닫는다 — 옛 저장소 기준 검색 상태가 새 저장소 화면에
  // 남지 않도록 (E7i 보완 Step 4). 훅 순서 불변 — 이른 반환보다 앞 (E7d ① 교훈)
  useEffect(() => {
    setFindScope(null)
  }, [store.repoPath])

  if (!store.repoPath) {
    return <RepoPicker onOpen={() => void store.openRepository()} error={store.error} />
  }

  // 전량 ours 병합 마무리 — 변경 0개면 규칙 제안이 비므로 기본 문구를 준다 (품질 리뷰)
  const suggestion =
    status?.state === 'merging' && stagedCount === 0
      ? `${T.branch} ${T.merge}`
      : suggestCommitMessage(status?.changes ?? [])
  const repoName = store.repoPath.split('/').pop() ?? store.repoPath
  // 마지막 저장(HEAD)이 원격에 이미 백업됐는가 — 실행취소·메시지 고치기 확인창의 경고 병기 (판정 편차는 플랜 표)
  const headBackedUp = status !== null && isHeadBackedUp(status.branch)
  // 보관함 항목을 미리보기로 연 상태인가 — 상세 패널 문구를 보관함 맥락으로 분기한다 (품질 리뷰)
  const openDetail = store.commitDetail
  const shelfPreview =
    openDetail !== null && store.shelf.some((entry) => entry.hash === openDetail.hash)

  return (
    <div className="app">
      <header className={`app__header${compactHeader ? ' app__header--compact' : ''}`}>
        {/* E12 — 좌측 사이드 접기. 헤더 툴바에 두면 열이 접혀 트랙이 사라져도(app__left
            언마운트) 진입점이 화면에서 사라지지 않는다 — 헤더는 접힘과 무관하게 항상 그대로다.
            ⌘⌥1과 같은 동작(toggleLeftCollapsed) */}
        <Tooltip
          content={leftCollapsed ? '왼쪽 패널 펼치기 (⌘⌥1)' : '왼쪽 패널 접기 (⌘⌥1)'}
          summary={leftCollapsed ? '왼쪽 패널 펼치기' : '왼쪽 패널 접기'}
          describedBy={false}
        >
          <Button
            variant="ghost"
            size="sm"
            onPress={toggleLeftCollapsed}
            testId="left-collapse-toggle"
            aria-label={leftCollapsed ? '왼쪽 패널 펼치기' : '왼쪽 패널 접기'}
          >
            {leftCollapsed ? (
              <PanelLeftOpen size={14} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={14} aria-hidden="true" />
            )}
          </Button>
        </Tooltip>
        <div className="app__repo">
          <strong>{repoName}</strong>
          {/* E7h ③ — 전환 완료(성공 후에만) 검증용 testid. 기존엔 없었다(실독 편차) */}
          <Tooltip content={store.repoPath} summary={store.repoPath}>
            <span className="app__repo-path" data-testid="repo-path">
              {store.repoPath}
            </span>
          </Tooltip>
        </div>
        {status && (
          <div className="app__status">
            <BranchSwitcher
              branches={store.branches}
              currentName={status.branch.name}
              busy={store.busy}
              onSwitch={(name) => void store.switchBranch(name)}
              onCreate={() => {
                store.clearError()
                setBranchPrompt({ fromHash: null })
              }}
              onManage={() => {
                store.clearError()
                setManageOpen(true)
              }}
            />
            <Tooltip content={`${T.merge} (merge)`} summary={T.merge} describedBy={false}>
              <Button
                variant="ghost"
                size="sm"
                isDisabled={store.busy || status.state !== 'normal'}
                onPress={() => setMergePicker(true)}
                testId="merge-open"
                aria-label={T.merge}
              >
                <GitMerge size={13} aria-hidden="true" />{' '}
                <span className="app__btn-label">{T.merge}</span>
              </Button>
            </Tooltip>
            {status.state !== 'normal' && (
              <span className="app__state">
                <Pictogram kind="conflict" size={13} label="진행 중 작업" />
                {STATE_LABELS[status.state]}{' '}
                <span className="app__state-raw">{status.state}</span>
              </span>
            )}
            {status.branch.ahead !== null && status.branch.behind !== null && (
              <Badge>
                ↑{status.branch.ahead} ↓{status.branch.behind}
              </Badge>
            )}
          </div>
        )}
        <div className="app__actions">
          <Tooltip content={`${T.pull} (pull)`} summary={T.pull} describedBy={false}>
            <Button
              variant="ghost"
              size="sm"
              isDisabled={store.busy || status?.state !== 'normal'}
              onPress={() => void store.pullLatest()}
              testId="pull"
              aria-label={T.pull}
            >
              <DownloadCloud size={14} aria-hidden="true" />{' '}
              <span className="app__btn-label">{T.pull}</span>
            </Button>
          </Tooltip>
          <ShelfPopover
            shelf={store.shelf}
            busy={store.busy}
            onSave={() => void store.shelfSave()}
            onPreview={(hash) => void store.selectCommit(hash)}
            onRestore={(ref) => void store.shelfRestore(ref)}
            onDrop={(ref) => void store.shelfDrop(ref)}
          />
          <ReviewPopover
            status={store.hostingStatus}
            pulls={store.pulls}
            busy={store.busy}
            currentBranch={status?.branch.name ?? null}
            stateBlocked={status?.state !== 'normal'}
            onOpen={() => void store.refreshPulls()}
            onConnectGh={() => void store.connectGh()}
            onConnectToken={() => {
              store.clearError()
              setTokenPrompt(true)
            }}
            onDisconnect={() => void store.disconnectHosting()}
            onCreate={() => {
              store.clearError()
              setPullPrompt(true)
            }}
            onSelectPull={(number) => void store.openPullDetail(number)}
            onOpenPull={(number) => void store.openPull(number)}
          />
          <Tooltip content={`${T.push} (push)`} summary={T.push} describedBy={false}>
            <Button
              variant="ghost"
              size="sm"
              isDisabled={store.busy}
              onPress={() => void store.backup()}
              testId="backup"
              aria-label={T.push}
            >
              <CloudUpload size={14} aria-hidden="true" />{' '}
              <span className="app__btn-label">{T.push}</span>
            </Button>
          </Tooltip>
          <Tooltip content="새로고침" summary="새로고침" describedBy={false}>
            <Button
              variant="ghost"
              size="sm"
              isDisabled={store.busy}
              onPress={() => void store.refresh()}
              testId="refresh"
              aria-label="새로고침"
            >
              <RefreshCw size={13} aria-hidden="true" /> <span className="app__btn-label">새로고침</span>
            </Button>
          </Tooltip>
          <Tooltip content="터미널" summary="터미널" describedBy={false}>
            <Button
              variant="ghost"
              size="sm"
              onPress={toggleDock}
              testId="terminal-toggle"
              aria-label="터미널"
            >
              <Terminal size={13} aria-hidden="true" /> <span className="app__btn-label">터미널</span>
            </Button>
          </Tooltip>
          {/* E12 — 우측 사이드 접기. 좌측 토글과 대칭 위치(헤더 오른쪽 끝 쪽) */}
          <Tooltip
            content={rightCollapsed ? '오른쪽 패널 펼치기 (⌘⌥2)' : '오른쪽 패널 접기 (⌘⌥2)'}
            summary={rightCollapsed ? '오른쪽 패널 펼치기' : '오른쪽 패널 접기'}
            describedBy={false}
          >
            <Button
              variant="ghost"
              size="sm"
              onPress={toggleRightCollapsed}
              testId="right-collapse-toggle"
              aria-label={rightCollapsed ? '오른쪽 패널 펼치기' : '오른쪽 패널 접기'}
            >
              {rightCollapsed ? (
                <PanelRightOpen size={14} aria-hidden="true" />
              ) : (
                <PanelRightClose size={14} aria-hidden="true" />
              )}
            </Button>
          </Tooltip>
          <Button variant="ghost" size="sm" onPress={() => setSettingsOpen(true)} testId="settings-open">
            <Settings size={13} aria-hidden="true" />
          </Button>
        </div>
      </header>
      <SettingsDialog
        isOpen={settingsOpen}
        theme={theme}
        onChangeTheme={changeTheme}
        worktreeSelectAction={worktreeSelectAction}
        onChangeWorktreeSelectAction={changeWorktreeSelectAction}
        pullMode={store.pullMode}
        onChangePullMode={(mode) => store.setPullMode(mode)}
        autoFetch={autoFetch}
        onChangeAutoFetch={changeAutoFetch}
        onClose={() => setSettingsOpen(false)}
      />
      <AddWorktreeDialog
        isOpen={addWorktreeOpen}
        mainPath={store.worktrees.find((worktree) => worktree.isMain)?.path ?? store.repoPath ?? ''}
        branches={store.branchOverview?.locals ?? []}
        checkedOut={
          new Set(
            store.worktrees
              .map((worktree) => worktree.branch)
              .filter((branch): branch is string => branch !== null),
          )
        }
        errorText={addWorktreeOpen ? store.error : null}
        onSubmit={(path, branch, createBranch) => {
          void (async () => {
            if (await store.addWorktree(path, branch, createBranch)) setAddWorktreeOpen(false)
          })()
        }}
        onCancel={() => setAddWorktreeOpen(false)}
      />
      <ConfirmDialog
        isOpen={confirmingRemoveWorktree !== null}
        title={
          confirmingRemoveWorktree?.force === true
            ? `${T.commit} 안 된 변경이 있어요 — 그래도 지울까요?`
            : `${T.worktree}를 지울까요?`
        }
        confirmLabel={confirmingRemoveWorktree?.force === true ? '그래도 지우기' : '지우기'}
        onConfirm={() => {
          const target = confirmingRemoveWorktree
          setConfirmingRemoveWorktree(null)
          if (target === null) return
          void (async () => {
            // 미저장 변경이 있으면 엔진이 needsForce로 알린다 — 2단 확인 (removeBranch 관례)
            const needsForce = await store.removeWorktree(target.path, target.force)
            if (needsForce) {
              if (!target.force) setConfirmingRemoveWorktree({ path: target.path, force: true })
              return
            }
            // needsForce가 아니면 지우기 성공이거나 다른 오류(그 경우 guard가 store.error를 채운다) —
            // 실제로 성공했을 때만 그 워크트리의 터미널 그룹을 정리한다(store.removeWorktree는
            // 성공 여부 boolean을 직접 주지 않아 최신 스토어 상태로 판별한다 — E7h ④)
            if (useRepositoryStore.getState().error === null) setPurgeTerminalGroup(target.path)
          })()
        }}
        onCancel={() => setConfirmingRemoveWorktree(null)}
      >
        {confirmingRemoveWorktree?.force === true
          ? `그 폴더의 ${T.commit} 안 된 변경이 함께 사라져요. 되돌릴 수 없어요.`
          : `${T.worktree} 폴더가 디스크에서 지워져요. ${T.history}와 ${T.branch}는 그대로예요.`}
      </ConfirmDialog>
      {(status?.state === 'merging' ||
        status?.state === 'reverting' ||
        status?.state === 'cherry-picking' ||
        status?.state === 'rebasing' ||
        store.error !== null ||
        store.notice !== null) && (
        <div className="app__top-layer">
          {/* E7h ① — 좌측 탭바(z-41)와 아예 안 겹치게 스택을 좌측 열 오른쪽부터(패딩 20 + 열 폭 + gap 16) */}
          <div className="app__top-stack" style={{ left: columns.left + 36 }}>
            {(status?.state === 'merging' ||
              status?.state === 'reverting' ||
              status?.state === 'cherry-picking' ||
              status?.state === 'rebasing') && (
              <div className="app__merge-bar" data-testid="merge-bar">
                <Pictogram kind="conflict" size={14} label={OP_BAR[status.state].doing} />
                <span className="app__merge-text" data-testid="merge-remaining">
                  {`${OP_BAR[status.state].doing}${
                    status.state === 'rebasing' && store.rebaseProgress !== null
                      ? ` (${store.rebaseProgress.total}개 중 ${store.rebaseProgress.current}번째)`
                      : ''
                  } — ${
                    conflictCount > 0
                      ? `${T.conflict} ${conflictCount}개 남음. 붉은 ! 파일에서 한쪽을 고르고, 다 정리되면 ${
                          status.state === 'rebasing'
                            ? `계속하기로 다음 ${T.commit}으로 넘어가요`
                            : `${T.commit}으로 마무리해요`
                        }.`
                      : status.state === 'rebasing'
                        ? `${T.conflict} 0개 남음. 계속하기를 눌러 다음 ${T.commit}으로 넘어가요.`
                        : status.state !== 'merging' && stagedCount === 0
                          ? `${T.conflict} 0개 남음. 전부 내 것을 유지해서 바뀌는 내용이 없어요 — ${OP_BAR[status.state].abort}를 눌러 마무리해요.`
                          : `${T.conflict} 0개 남음. 이제 ${T.commit}으로 마무리해요.`
                  }`}
                </span>
                {status.state === 'rebasing' && conflictCount === 0 && (
                  <Button
                    variant="primary"
                    size="sm"
                    isDisabled={store.busy}
                    onPress={() => void store.continueRebase()}
                    testId="rebase-continue"
                  >
                    계속하기
                  </Button>
                )}
                <Button
                  variant="danger"
                  size="sm"
                  isDisabled={store.busy}
                  onPress={() => setConfirmingAbort(true)}
                  testId="merge-abort"
                >
                  {OP_BAR[status.state].abort}
                </Button>
              </div>
            )}
            {store.error && (
              <p className="app__error" role="alert" data-testid="error">
                {store.error}
              </p>
            )}
            {store.notice && (
              <p className="app__notice" role="status" data-testid="notice">
                {store.notice}
              </p>
            )}
          </div>
        </div>
      )}
      <main
        className={`app__main${noColumnTransition ? ' app__main--no-column-transition' : ''}`}
        style={{ gridTemplateColumns, gridTemplateRows }}
      >
        {/* 좌측 열 = [변경 | 실험 공간] 탭 (E7a) — 변경 탭은 기존 그대로(목록+저장 폼, E6a), 커밋 흐름 무변.
            빠른 전환은 헤더 스위처가 계속 담당하고, 탭은 관리 화면이다 (스펙: 이원화).
            E13 — 접혀도 언마운트하지 않는다(트랙만 0px, gridTemplateColumns와 짝) — 전환의
            시작점을 유지해야 grid-template-columns가 보간된다(E12 시절의 조건부 마운트 폐기) */}
        <div className="app__left">
          <div className="app__left-tabs" role="tablist" aria-label="왼쪽 패널 전환">
            <button
              type="button"
              role="tab"
              aria-selected={leftTab === 'changes'}
              className="app__left-tab"
              onClick={() => setLeftTab('changes')}
              data-testid="left-tab-changes"
            >
              변경{(status?.changes.length ?? 0) > 0 ? ` ${status?.changes.length}` : ''}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={leftTab === 'branches'}
              className="app__left-tab"
              onClick={() => setLeftTab('branches')}
              data-testid="left-tab-branches"
            >
              {T.branch}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={leftTab === 'worktrees'}
              className="app__left-tab"
              onClick={() => setLeftTab('worktrees')}
              data-testid="left-tab-worktrees"
            >
              {T.worktree}
            </button>
          </div>
          {leftTab === 'changes' ? (
            <>
              <ChangesPanel
                changes={status?.changes ?? []}
                selected={store.selected}
                busy={store.busy}
                findOpen={findScope === 'changes'}
                findNonce={findNonce}
                onFindClose={() => setFindScope(null)}
                onStage={(paths) => void store.stage(paths)}
                onUnstage={(paths) => void store.unstage(paths)}
                onDiscard={(trackedPaths, untrackedPaths) =>
                  void store.discard(trackedPaths, untrackedPaths)
                }
                onRemoveFile={(path) => void store.removeFile(path)}
                onSelect={(selected) => {
                  // E7h ⑥ — diff 파일이 바뀌면 이전 diff 대상 검색은 의미가 없다
                  if (findScope === 'diff') setFindScope(null)
                  void store.selectFile(selected)
                }}
              />
              <CommitForm
                stagedCount={stagedCount}
                busy={store.busy}
                suggestion={suggestion}
                allowEmpty={status?.state === 'merging'}
                onCommit={(message) => store.commit(message)}
              />
            </>
          ) : leftTab === 'branches' ? (
            <BranchesPanel
              lastFetchAt={store.lastFetchAt}
              onFetchRemotes={() => void store.fetchRemotes()}
              overview={store.branchOverview}
              compare={store.branchCompare}
              currentBranch={status?.branch.name ?? null}
              historyRef={store.historyRef}
              busy={store.busy}
              actionsDisabled={status?.state !== 'normal'}
              onCloseCompare={() => store.clearBranchCompare()}
              onAction={(action) => {
                switch (action.kind) {
                  case 'switch':
                    void store.switchBranch(action.name)
                    break
                  case 'branch-from':
                    store.clearError()
                    setBranchPrompt({ fromHash: action.hash })
                    break
                  case 'merge':
                    void store.mergeBranch(action.name)
                    break
                  case 'rebase':
                    setConfirmingRebase({ name: action.name })
                    break
                  case 'compare':
                    void store.compareBranch(action.name)
                    break
                  case 'update':
                    // 현재 공간은 기존 받아오기(pull)로 — 엔진 update는 비현재 전용 (스펙)
                    if (action.name === status?.branch.name) void store.pullLatest()
                    else void store.updateBranch(action.name)
                    break
                  case 'backup':
                    if (action.name === status?.branch.name) void store.backup()
                    else void store.backupBranch(action.name)
                    break
                  case 'rename':
                    store.clearError()
                    setRenamePrompt({ name: action.name })
                    break
                  case 'remove':
                    setConfirmingRemove({ name: action.name, force: false })
                    break
                  case 'checkout-remote':
                    void store.checkoutRemoteBranch(action.name)
                    break
                  case 'remove-remote':
                    setConfirmingRemoveRemote({ name: action.name })
                    break
                  case 'view':
                    void store.viewHistory(action.name)
                    break
                }
              }}
            />
          ) : leftTab === 'worktrees' ? (
            <WorktreesPanel
              worktrees={store.worktrees}
              currentPath={store.repoPath}
              activePath={activeWorktree?.cwd ?? null}
              home={home}
              headInfos={store.headInfos}
              onHoverWorktree={(path, headHash) => void store.loadHeadInfo(path, headHash)}
              busy={store.busy}
              onAction={(action) => {
                switch (action.kind) {
                  case 'select':
                    // 클릭의 기본 동작은 설정을 따른다 (우클릭엔 두 동작이 따로 있다 — 스펙)
                    if (worktreeSelectAction === 'switch-app') {
                      // E7h ③ — 앱 전환이 끝난 뒤 터미널 대상을 같이 바꾼다(먼저 바꾸면 시차·실패 시 어긋남)
                      void store.openWorktree(action.path).then((ok) => {
                        if (ok) setActiveWorktree({ cwd: action.path, label: action.label })
                      })
                    } else {
                      setActiveWorktree({ cwd: action.path, label: action.label })
                      setDockOpen(() => {
                        saveDockOpen(true)
                        return true
                      })
                    }
                    break
                  case 'terminal':
                    // 우클릭 "여기서 터미널 열기" — 설정 무관 항상 터미널
                    setActiveWorktree({ cwd: action.path, label: action.label })
                    setDockOpen(() => {
                      saveDockOpen(true)
                      return true
                    })
                    break
                  case 'open':
                    void store.openWorktree(action.path)
                    break
                  case 'reveal':
                    void store.revealWorktree(action.path)
                    break
                  case 'remove':
                    setConfirmingRemoveWorktree({ path: action.path, force: false })
                    break
                  case 'add':
                    store.clearError()
                    setAddWorktreeOpen(true)
                    break
                }
              }}
            />
          ) : null}
        </div>
        <div className="app__center" data-find-scope="diff">
          {store.conflictFile !== null ? (
            <ConflictPanel
              key={store.conflictFile.path}
              path={store.conflictFile.path}
              content={store.conflictFile.content}
              busy={store.busy}
              // cherry-picking은 merging 취급 — 상대 라벨 '가져온 것'이 체리픽(cherry-pick) 어휘와 일치한다 (E5b 설계 판단).
              // rebasing은 git의 ours/theirs가 뒤집힌다(내 것=새 기반) — 전용 mode로 라벨을 정직하게 (E7a)
              mode={
                status?.state === 'reverting'
                  ? 'reverting'
                  : status?.state === 'rebasing'
                    ? 'rebasing'
                    : 'merging'
              }
              onResolve={(choice) => void store.resolveConflict(store.conflictFile!.path, choice)}
              onMarkResolved={() => void store.markConflictResolved(store.conflictFile!.path)}
              onReload={() => store.reloadConflict(store.conflictFile!.path)}
              onChooseBlock={(blockIndex, choice) =>
                void store.chooseConflictBlock(blockIndex, choice)
              }
              onSaveText={(content) => store.saveConflictText(content)}
              onReset={() => void store.resetConflict()}
            />
          ) : (
            <DiffPanel
              path={
                store.diffLabel ??
                (store.commitFile !== null && store.commitDetail !== null
                  ? `${store.commitFile.path} — ${T.commit} ${store.commitDetail.shortHash}`
                  : store.selected?.change.path ?? null)
              }
              diff={store.diff}
              busy={store.busy}
              findOpen={findScope === 'diff'}
              findNonce={findNonce}
              onFindClose={() => setFindScope(null)}
              onClose={() =>
                store.commitFile !== null ? store.clearCommitFile() : store.clearSelection()
              }
            />
          )}
        </div>
        {/* 우측 열 폭 조절 손잡이 — 드래그로 조절, 더블클릭으로 기본값.
            E13 — 접혀도 언마운트하지 않는다(트랙만 0px, gridTemplateColumns와 짝) */}
        <div
          className="app__resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="타임라인 폭 조절"
          onPointerDown={startResize}
          onDoubleClick={resetResize}
          data-testid="column-resizer"
        />
        {/* 우측 열 — 평소엔 트리 전체, 커밋 클릭 시에만 하단에 상세가 열린다 (E6a 사용자 제안).
            리뷰(PR) 상세만 대화형 화면이라 기존의 우측 전체 전환을 유지한다 (사용자 동의).
            store 상태(commitDetail·CLEAR_SELECTIONS)는 무변 — 렌더 위치만 바꿨다.
            E13 — 접혀도 언마운트하지 않는다(트랙만 0px) */}
        <div
          className={`app__right${store.commitDetail !== null ? ' app__right--detail-open' : ''}`}
          // E7h ⑥ — 리뷰 상세가 열린 동안은 히스토리 스코프가 아니다(그 아래 commit-files
          // 래퍼가 자기 attribute로 더 구체적으로 잡아채므로, 여기선 그 경우만 비워둔다).
          // E13 — 접힌 동안도 스코프를 비운다(⌘F 핸들러가 leftCollapsedRef/rightCollapsedRef로
          // 한 번 더 거르지만, 속성 자체도 걸어 다른 소비자가 생겨도 안전하게)
          data-find-scope={!rightCollapsed && store.pullDetail === null ? 'history' : undefined}
        >
          {store.pullDetail !== null ? (
            <ReviewDetailPanel
              key={store.pullDetail.detail.number}
              view={store.pullDetail}
              busy={store.busy}
              onOpenBrowser={() => void store.openPull(store.pullDetail!.detail.number)}
              onBack={() => store.closePullDetail()}
              onComment={(body) => store.addPullComment(body)}
              onApprove={() => void store.approvePull()}
              onMerge={() => setConfirmingMerge(true)}
            />
          ) : (
            <>
              <HistoryPanel
                history={store.history}
                historyLimit={store.historyLimit}
                currentBranch={status?.branch.name ?? null}
                headHash={status?.headHash ?? null}
                localBranches={store.branches.map((branch) => branch.name)}
                selectedHash={store.commitDetail?.hash ?? null}
                busy={store.busy}
                actionsDisabled={status?.state !== 'normal'}
                historyRef={store.historyRef}
                findOpen={findScope === 'history'}
                findNonce={findNonce}
                onFindClose={() => setFindScope(null)}
                onSelect={(hash) => void store.selectCommit(hash)}
                onLoadMore={() => void store.loadMoreHistory()}
                onSearch={(query) => store.searchHistory(query)}
                onEnsureLoaded={(index) => store.ensureHistoryLoaded(index)}
                onLocateHead={() => void store.revealHead()}
                onAction={(action) => {
                  switch (action.kind) {
                    case 'switch':
                      void store.switchBranch(action.branch)
                      break
                    case 'branch-here':
                      store.clearError()
                      setBranchPrompt({ fromHash: action.hash })
                      break
                    case 'cherry-pick':
                      void store.cherryPickCommit(action.hash)
                      break
                    case 'revert':
                      void store.revertCommit(action.hash)
                      break
                    case 'undo':
                      setConfirmingUndo({ hash: action.hash })
                      break
                    case 'reword':
                      store.clearError()
                      setRewordPrompt({ hash: action.hash, subject: action.subject })
                      break
                    case 'tag':
                      store.clearError()
                      setTagPrompt({ hash: action.hash })
                      break
                  }
                }}
                onClearView={() => void store.clearHistoryView()}
              />
              {/* E11 — grid-template-rows가 0fr↔9fr로 열고 닫히려면 이 래퍼가 닫힌 동안에도
                  DOM에 남아 있어야 한다(그래야 처음 여는 순간도 애니메이션이 붙는다).
                  안은 그대로 조건부 마운트 — 가상 스크롤을 품은 CommitDetailPanel을 미리
                  올려두면(즉 항상 마운트) 얻는 이득이 없고(닫힌 동안 0fr·overflow:hidden이라
                  안 보이는데 유지비만 진다) 기존 E2E(commit-detail-panel 소멸 단언)도 깨진다 —
                  그래서 CommitDetailPanel은 계속 지연 마운트한다 */}
              <div
                className="app__right-detail"
                // E13 — 부모 app__right와 같은 이유로 접힌 동안은 스코프를 비운다
                data-find-scope={
                  !rightCollapsed && store.commitDetail !== null ? 'commit-files' : undefined
                }
              >
                {store.commitDetail !== null && (
                  <CommitDetailPanel
                    detail={store.commitDetail}
                    shelfPreview={shelfPreview}
                    selectedFile={store.commitFile}
                    busy={store.busy}
                    findOpen={findScope === 'commit-files'}
                    findNonce={findNonce}
                    onFindClose={() => setFindScope(null)}
                    onSelectFile={(file) => {
                      // E7h ⑥ — diff 파일이 바뀌면 이전 diff 대상 검색은 의미가 없다
                      if (findScope === 'diff') setFindScope(null)
                      void store.selectCommitFile(file)
                    }}
                    onRestoreFile={(file) =>
                      void store.restoreFileFromCommit(store.commitDetail!.hash, file.path)
                    }
                    onCompareFile={(file) => {
                      if (findScope === 'diff') setFindScope(null)
                      void store.compareFileWithWorktree(
                        store.commitDetail!.hash,
                        file.path,
                        file.origPath,
                      )
                    }}
                    onBack={() => store.clearCommit()}
                  />
                )}
              </div>
            </>
          )}
        </div>
        {/* E7b 터미널 도크 — 세션 유지를 위해 항상 마운트한다(언마운트 금지).
            E13 Task 3 — display:none 대신 행 트랙 자체가 0px↔dockHeight로 전환된다(gridTemplateRows,
            좌·우 열이 트랙을 유지하는 것과 같은 이유). 열 범위(dockGridColumn)·행 범위(dockGridRow)
            모두 트랙 수가 고정이라 상수다 */}
        {store.repoPath !== null && (
          <div className="app__dock" style={{ gridColumn: dockGridColumn, gridRow: dockGridRow }}>
            <TerminalDock
              repoPath={store.repoPath}
              theme={theme}
              activeWorktree={activeWorktree}
              open={dockOpen}
              height={dockHeight}
              purgeGroup={purgeTerminalGroup}
              onPurged={() => setPurgeTerminalGroup(null)}
              onResizeStart={startDockResize}
              onClose={toggleDock}
            />
          </div>
        )}
      </main>
      <PromptDialog
        isOpen={branchPrompt !== null}
        title={`새 ${T.branch} 만들기`}
        description={
          branchPrompt?.fromHash != null
            ? `우클릭한 ${T.commit} 시점에서 갈라져 나와요. 만들면 바로 그 ${T.branch}로 이동해요.`
            : `지금 위치에서 갈라져 나와요. 만들면 바로 그 ${T.branch}로 이동해요.`
        }
        label="이름"
        placeholder="예: try-new-design"
        submitLabel="만들고 이동"
        errorText={branchPrompt !== null ? store.error : null}
        onSubmit={(name) => {
          void (async () => {
            const fromHash = branchPrompt?.fromHash ?? null
            // 실패하면 다이얼로그를 유지해 입력을 보존한다 — 에러는 상단 배너로 (리뷰 반영)
            if (await store.createBranch(name, fromHash)) setBranchPrompt(null)
          })()
        }}
        onCancel={() => setBranchPrompt(null)}
      />
      <ListDialog
        isOpen={mergePicker}
        title={`어느 ${T.branch}를 ${T.merge}할까요?`}
        description={`고른 ${T.branch}의 ${T.commit} 내용을 지금 ${T.branch}로 가져와 ${T.merge}해요. ${T.commit} 안 된 변경이 ${T.conflict}하면 ${T.stash}에 넣고 진행해요.`}
        options={store.branches
          .filter((branch) => !branch.isCurrent)
          .map((branch) => ({ key: branch.name, label: branch.name }))}
        emptyText={`${T.merge}할 다른 ${T.branch}가 없어요.`}
        onSelect={(name) => {
          setMergePicker(false)
          void store.mergeBranch(name)
        }}
        onCancel={() => setMergePicker(false)}
      />
      <ManageBranchesDialog
        isOpen={manageOpen}
        branches={store.branches}
        busy={store.busy}
        errorText={store.error}
        onRename={(oldName, newName) => store.renameBranch(oldName, newName)}
        onRemove={async (name, force) => {
          const result = await store.removeBranch(name, force)
          if (result.usedByWorktree !== null) {
            setManageOpen(false)
            setConfirmingRemoveWithWorktree({ name, force, worktreePath: result.usedByWorktree })
            return false
          }
          return result.needsForce
        }}
        onClearError={() => store.clearError()}
        onCancel={() => setManageOpen(false)}
      />
      <PromptDialog
        isOpen={tokenPrompt}
        title="GitHub 토큰으로 연결"
        description="github.com → Settings → Developer settings → Personal access tokens에서 만들 수 있어요. 만든 토큰을 붙여넣어 주세요."
        label="토큰"
        placeholder="ghp_..."
        masked
        submitLabel="연결"
        errorText={tokenPrompt ? store.error : null}
        onSubmit={(token) => {
          void (async () => {
            // 실패하면 다이얼로그를 유지해 입력을 보존한다 — 에러는 인라인으로 (branchPrompt 관례)
            if (await store.connectToken(token)) setTokenPrompt(false)
          })()
        }}
        onCancel={() => setTokenPrompt(false)}
      />
      <PromptDialog
        isOpen={pullPrompt}
        title={`${T.pullRequest} 만들기`}
        description={`지금 ${T.branch}의 ${T.commit} 내용을 검토해 달라고 요청해요. 아직 ${T.push} 전이면 ${T.push}부터 자동으로 해요.`}
        label="제목"
        placeholder="예: 로그인 버튼 색 실험"
        submitLabel="요청 만들기"
        initialValue={store.history[0]?.subject ?? ''}
        errorText={pullPrompt ? store.error : null}
        onSubmit={(title) => {
          void (async () => {
            if (await store.createPull(title)) setPullPrompt(false)
          })()
        }}
        onCancel={() => setPullPrompt(false)}
      />
      <ConfirmDialog
        isOpen={confirmingAbort}
        title={
          status?.state === 'reverting'
            ? `${T.revert}를 취소할까요?`
            : status?.state === 'cherry-picking'
              ? `${T.cherryPick}을 취소할까요?`
              : status?.state === 'rebasing'
                ? `${T.rebase}를 취소할까요?`
                : `${T.merge}을 취소할까요?`
        }
        confirmLabel={
          status?.state === 'reverting'
            ? `${T.revert} 취소`
            : status?.state === 'cherry-picking'
              ? `${T.cherryPick} 취소`
              : status?.state === 'rebasing'
                ? `${T.rebase} 취소`
                : `${T.merge} 취소`
        }
        onConfirm={() => {
          setConfirmingAbort(false)
          if (status?.state === 'reverting') void store.abortRevert()
          else if (status?.state === 'cherry-picking') void store.abortCherryPick()
          else if (status?.state === 'rebasing') void store.abortRebase()
          else void store.abortMerge()
        }}
        onCancel={() => setConfirmingAbort(false)}
      >
        지금까지 고른 것을 되돌리고 이전 상태로 돌아가요.
      </ConfirmDialog>
      <PromptDialog
        isOpen={tagPrompt !== null}
        title={`${T.tag} 만들기`}
        description={`이 ${T.commit} 시점에 이름표(${T.tag})를 붙여요. ${T.history} 목록에 배지로 함께 보여요.`}
        label="태그 이름"
        placeholder="예: v1.0"
        submitLabel="만들기"
        errorText={tagPrompt !== null ? store.error : null}
        onSubmit={(name) => {
          void (async () => {
            const prompt = tagPrompt
            if (prompt === null) return
            // 실패하면 다이얼로그를 유지해 입력을 보존한다 — 에러는 인라인으로 (branchPrompt 관례)
            if (await store.createTag(name, prompt.hash)) setTagPrompt(null)
          })()
        }}
        onCancel={() => setTagPrompt(null)}
      />
      <ConfirmDialog
        isOpen={confirmingUndo !== null}
        title={`${T.undoCommit}할까요?`}
        confirmLabel={T.undoCommit}
        onConfirm={() => {
          const hash = confirmingUndo?.hash ?? null
          setConfirmingUndo(null)
          if (hash !== null) void store.undoLastCommit(hash)
        }}
        onCancel={() => setConfirmingUndo(null)}
      >
        {T.commit}만 취소하고 바뀐 내용은 그대로 남아요 — 왼쪽 변경 목록에서 다시 {T.commit}할 수 있어요.
        {headBackedUp && ` 이미 ${T.push}된 ${T.commit}이에요 — 취소하면 원격과 어긋나요.`}
      </ConfirmDialog>
      <PromptDialog
        isOpen={rewordPrompt !== null}
        title={`${T.commitMessage} 고치기`}
        description={`가장 최근 ${T.commit}의 메시지를 새 한 줄로 바꿔요. 본문이 있었다면 함께 이 한 줄로 바뀌어요.${
          headBackedUp ? ` 이미 ${T.push}된 ${T.commit}이에요 — 고치면 원격과 어긋나요.` : ''
        }`}
        label="메시지"
        placeholder="예: 로그인 버튼 색 수정"
        submitLabel="고치기"
        initialValue={rewordPrompt?.subject ?? ''}
        errorText={rewordPrompt !== null ? store.error : null}
        onSubmit={(message) => {
          void (async () => {
            const prompt = rewordPrompt
            if (prompt === null) return
            if (await store.rewordLastCommit(prompt.hash, message)) setRewordPrompt(null)
          })()
        }}
        onCancel={() => setRewordPrompt(null)}
      />
      <ConfirmDialog
        isOpen={confirmingMerge}
        title={`${T.pullRequest}를 ${T.merge}할까요?`}
        confirmLabel="병합하기"
        onConfirm={() => {
          setConfirmingMerge(false)
          void (async () => {
            // base 이름은 병합 전에 붙잡아 둔다 — 성공 후 제안 다이얼로그가 쓴다
            const base = store.pullDetail?.detail.baseBranch ?? null
            if (await store.mergePull()) setMergeFollowUp(base)
          })()
        }}
        onCancel={() => setConfirmingMerge(false)}
      >
        "{store.pullDetail?.detail.baseBranch}"에 {T.merge}돼요. 이 동작은 GitHub에서 일어나요.
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={mergeFollowUp !== null}
        title="기본 브랜치로 이동할까요?"
        confirmLabel="이동하고 가져오기"
        onConfirm={() => {
          const base = mergeFollowUp
          setMergeFollowUp(null)
          // 기존 안전망 그대로 — 전환(자동 보관)·받아오기(충돌 흐름)를 store 합성 액션이 잇는다 (통합 리뷰)
          if (base !== null) void store.syncAfterMerge(base)
        }}
        onCancel={() => setMergeFollowUp(null)}
      >
        병합 완료 — 기본 브랜치({mergeFollowUp})로 이동해 최신을 가져올까요? 나중에 해도 돼요.
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={confirmingRebase !== null}
        title={`"${confirmingRebase?.name}" 위로 ${T.rebase}할까요?`}
        confirmLabel={T.rebase}
        onConfirm={() => {
          const name = confirmingRebase?.name ?? null
          setConfirmingRebase(null)
          if (name !== null) void store.rebaseOnto(name)
        }}
        onCancel={() => setConfirmingRebase(null)}
      >
        지금 {T.branch}의 {T.commit}들을 그 위로 다시 쌓아요. 내용이 {T.conflict}하면 하나씩 해결하는 화면이
        열려요. 이미 {T.push}한 {T.branch}라면 원격과 어긋날 수 있어요.
      </ConfirmDialog>
      <PromptDialog
        isOpen={renamePrompt !== null}
        title={`${T.branch} 이름 바꾸기`}
        description={`이 ${T.branch}의 이름만 바뀌어요. ${T.commit} 내용은 그대로예요.`}
        label="새 이름"
        placeholder="예: feature/login"
        submitLabel="바꾸기"
        initialValue={renamePrompt?.name ?? ''}
        errorText={renamePrompt !== null ? store.error : null}
        onSubmit={(newName) => {
          void (async () => {
            const prompt = renamePrompt
            if (prompt === null) return
            // 실패하면 다이얼로그를 유지해 입력을 보존한다 — 에러는 인라인으로 (branchPrompt 관례)
            if (await store.renameBranch(prompt.name, newName)) setRenamePrompt(null)
          })()
        }}
        onCancel={() => setRenamePrompt(null)}
      />
      <ConfirmDialog
        isOpen={confirmingRemove !== null}
        title={
          confirmingRemove?.force === true
            ? `${T.merge}되지 않은 ${T.commit}이 있어요 — 그래도 지울까요?`
            : `"${confirmingRemove?.name}" ${T.branch}를 지울까요?`
        }
        confirmLabel={confirmingRemove?.force === true ? '그래도 지우기' : '지우기'}
        onConfirm={() => {
          const target = confirmingRemove
          setConfirmingRemove(null)
          if (target === null) return
          void (async () => {
            // 합쳐지지 않은 저장 → needsForce 2단 확인(ManageBranches 관례),
            // 워크트리가 쓰는 중 → 동반 삭제 확인 (E7h ⑤)
            const result = await store.removeBranch(target.name, target.force)
            if (result.usedByWorktree !== null) {
              setConfirmingRemoveWithWorktree({
                name: target.name,
                force: target.force,
                worktreePath: result.usedByWorktree,
              })
            } else if (result.needsForce && !target.force) {
              setConfirmingRemove({ name: target.name, force: true })
            }
          })()
        }}
        onCancel={() => setConfirmingRemove(null)}
      >
        {confirmingRemove?.force === true
          ? `이 ${T.branch}에만 있는 ${T.commit}은 함께 사라져요. 되돌릴 수 없어요.`
          : `다른 곳에 ${T.merge}된 ${T.commit}은 남아요. ${T.merge}되지 않은 ${T.commit}이 있으면 한 번 더 물어봐요.`}
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={confirmingRemoveWithWorktree !== null}
        title={`${T.worktree}가 이 ${T.branch}를 쓰는 중이에요 — 같이 지울까요?`}
        confirmLabel={`${T.worktree}도 지우고 계속`}
        onConfirm={() => {
          const target = confirmingRemoveWithWorktree
          setConfirmingRemoveWithWorktree(null)
          if (target === null) return
          void (async () => {
            // 워크트리 제거(미저장 변경은 기존 2단 확인 재사용) → 성공 시 브랜치 삭제 재시도 (E7h ⑤)
            const needsForce = await store.removeWorktree(target.worktreePath, false)
            if (needsForce) {
              setConfirmingRemoveWorktree({ path: target.worktreePath, force: true })
              return
            }
            // needsForce가 아니면 지우기 성공이거나 다른 오류 — 성공했을 때만 터미널 그룹을 정리한다
            // (confirmingRemoveWorktree onConfirm과 동일 판정 패턴 재사용 — Task 6/E7h ④)
            if (useRepositoryStore.getState().error === null) setPurgeTerminalGroup(target.worktreePath)
            const retry = await store.removeBranch(target.name, target.force)
            if (retry.needsForce && !target.force) {
              setConfirmingRemove({ name: target.name, force: true })
            }
          })()
        }}
        onCancel={() => setConfirmingRemoveWithWorktree(null)}
      >
        {`"${confirmingRemoveWithWorktree?.name}"은 ${T.worktree} "${
          confirmingRemoveWithWorktree?.worktreePath.split('/').pop() ?? ''
        }"(${confirmingRemoveWithWorktree?.worktreePath})가 펼쳐 쓰는 중이에요. ${T.worktree}를 지우면 그 폴더가 사라져요 — ${T.commit} 안 된 변경이 있으면 한 번 더 물어봐요.`}
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={confirmingRemoveRemote !== null}
        title={`원격에서 "${confirmingRemoveRemote?.name}"을 지울까요?`}
        confirmLabel="원격에서 지우기"
        onConfirm={() => {
          const name = confirmingRemoveRemote?.name ?? null
          setConfirmingRemoveRemote(null)
          if (name !== null) void store.removeRemoteBranch(name)
        }}
        onCancel={() => setConfirmingRemoveRemote(null)}
      >
        원격 저장소에서 지워져요 — 함께 쓰는 다른 사람에게도 영향이 있어요.
      </ConfirmDialog>
    </div>
  )
}
