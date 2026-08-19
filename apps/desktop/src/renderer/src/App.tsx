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
import type { TabInfo } from '@git-gui/ipc-contract'
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
import { RepoSwitcher } from './components/RepoSwitcher'
import { TabBar } from './components/TabBar'
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
  // E7c 활성 워크트리(터미널 대상) — renderer 로컬(재시작 시 앱이 연 곳으로 초기화, 영속 안 함).
  // 저장소가 바뀌면 비운다 — 아래 "저장소에 매인 로컬 상태" 한 자리에서 함께 (:396)
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
  // 위 1회성 신호를 비우는 **안정 콜백** — TerminalDock의 purge 이펙트가 deps에 넣는다(E14c).
  // 인라인 화살표면 렌더마다 새 참조라 이펙트가 헛돌므로, 안정 참조인 세터만 캡처한 함수를
  // 상태 lazy init으로 1회만 만든다(useCallback 지양 지침 — 성능 훅 대신 구조로 해결)
  const [clearPurgedTerminalGroup] = useState(() => () => setPurgeTerminalGroup(null))
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
    // 마운트 시 1회만 실행 — 바깥 값을 하나도 안 읽어 억제가 필요 없다 (E14b Task 7: 죽은 억제 삭제)
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

  // 같은 창 **다른** 탭의 레이아웃 조작을 받아 화면을 맞춘다 (E15c Task 7, 스펙 §4 — 접힘·폭·
  // 터미널은 창 단위다. 탭이 각자 webContents라 아무것도 안 하면 자연히 탭별이 된다).
  //
  // **적용은 저장 없는 raw setter만 부른다** — 메아리 차단의 렌더러 쪽 절반이다. 이 파일의
  // 사용자 조작 경로(toggleDock·toggleLeftCollapsed·키다운·드래그 onUp)는 전부 "setState + 명시적
  // save*" 짝 관용구라 저장이 setter에 붙어 있지 않다 — 그래서 적용 전용 경로를 따로 가르지 않고
  // setter만 부르면 이미 저장이 없다. 여기서 settingsApi.set(save*)을 부르면 main이 그 set을 또
  // 이웃에 push해(sender만 빠진다) 두 탭이 무한히 서로를 갱신한다(반증 실측 — 커밋 메시지).
  // 값은 발신 탭이 이미 클램프해 보냈지만 수신 창의 뷰포트로 한 번 더 클램프한다 — 같은 창이라
  // 같은 크기여야 맞지만, 클램프는 로드 경로(loadDockHeight 등)와 같은 방어다.
  // 구독은 이펙트, set은 콜백 안 — set-state-in-effect는 렌더 직후 동기 set만 잡는다(E14b,
  // tabs.onChanged와 같은 관용구)
  useEffect(() => {
    return window.settingsApi.onLayoutChanged((layout) => {
      if (layout.leftCollapsed !== undefined) setLeftCollapsed(layout.leftCollapsed)
      if (layout.rightCollapsed !== undefined) setRightCollapsed(layout.rightCollapsed)
      if (layout.rightWidth !== undefined) {
        setRightWidth(clampRightWidth(layout.rightWidth, window.innerWidth))
      }
      if (layout.terminalOpen !== undefined) setDockOpen(layout.terminalOpen)
      if (layout.terminalHeight !== undefined) {
        setDockHeight(clampDockHeight(layout.terminalHeight, window.innerHeight))
      }
    })
  }, [])

  // 상세 전환이 열 폭을 강제로 넓히면 중앙이 밀린다(피드백 4: 레이아웃 시프트) — 사용자가 정한
  // 폭은 존중하되, 중앙 diff 최소 폭(380px)이 깨지면 좌측→우측 순으로 함께 줄인다 (E6a 반응형)
  const columns = computeColumns(viewportWidth, rightWidth, {
    left: leftCollapsed,
    right: rightCollapsed,
  })
  // E13 후속(사용자 실측: "접힐 때 텍스트가 뭉개진다") — 접힌 트랙(columns.left/right)은 0이라
  // 그 값 그대로 안쪽 콘텐츠 폭에 쓰면 트랙을 따라 매 프레임 다시 흐르며 뭉개진다(버그의 원인).
  // 안쪽 콘텐츠는 항상 "지금 펼치면 몇 px일지"를 유지해야 한다 — 그 값을 구하는 두 갈래:
  // ① 접기 직전 값을 별도 상태로 기억해두기 ② 그 쪽만 펼쳤다고 가정해 computeColumns를 다시
  // 부르기. ②를 골랐다 — 창 크기·우측 드래그 폭이 접힌 동안 바뀌어도(예: 접은 채 창을 줄이면
  // 나중에 펼칠 폭도 좁아져야 맞다) 매번 최신값이고, 기억해 둘 상태·동기화할 effect가 따로
  // 필요 없다(정본이 하나 — computeColumns). 펼쳐진 동안은 이 값이 columns.left/right와
  // 정확히 같은 계산이라(반대쪽 접힘만 반영) 다른 열 폭 테스트(드래그·960px 최소 창)에 영향이 없다
  const leftExpandedWidth = computeColumns(viewportWidth, rightWidth, {
    left: false,
    right: rightCollapsed,
  }).left
  const rightExpandedWidth = computeColumns(viewportWidth, rightWidth, {
    left: leftCollapsed,
    right: false,
  }).right
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
    // 마운트 시 1회만 실행. 빠진 의존성은 `store`인데 넣을 수 없다 — App은 셀렉터 없이 스토어
    // 전체를 구독하고(:95 `useRepositoryStore()`) zustand 상태 객체는 set마다 새 참조라,
    // 넣으면 아무 스토어 변경에나 init()이 다시 돌아 무한 루프다.
    // E14c: 이 자리를 `useRepositoryStore((s) => s.init)`로 바꾸면(액션은 create 초기화 때
    // 1회만 정의돼 참조가 안정) 의존성에 그대로 넣고 이 억제를 지울 수 있다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // 실패해도 빈 문자열 유지 — 축약 없이 전체 경로가 보일 뿐 기능은 죽지 않는다 (E7j)
    void window.gitApi.repo.home().then(setHome).catch(() => {})
    // 마운트 시 1회만 실행 — window.gitApi는 전역, setHome은 안정이라 억제가 필요 없다
    // (E14b Task 7: 죽은 억제 삭제)
  }, [])

  // notice만 10초 뒤 자동으로 사라진다 — 에러·머지 바는 남는다 (E1d 후속). 새 notice가 오면
  // 값이 바뀌어 effect가 다시 걸리며 타이머가 리셋된다. 같은 문구가 연속으로 와도 guard가
  // 작업 시작마다 notice를 null로 비우므로 null→값 전이로 반드시 리셋된다
  useEffect(() => {
    if (store.notice === null) return
    const timer = window.setTimeout(() => store.clearNotice(), NOTICE_TTL_MS)
    return () => window.clearTimeout(timer)
    // 빠진 의존성은 `store`. 스토어 상태 객체는 set마다 새 참조라(App은 셀렉터 없이 전체 구독 — :95)
    // 넣으면 스토어가 갱신될 때마다 정리 함수가 타이머를 지우고 다시 걸어 10초가 처음부터 다시
    // 시작된다 — "notice 10초 자동 소멸"이 사실상 무한 연장된다.
    // E14c: 여기서 실제로 쓰는 건 clearNotice 하나뿐이고 zustand 액션이라 이미 참조가 안정하다 —
    // 셀렉터로 그것만 골라 받으면 의존성에 넣고 이 억제를 지울 수 있다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.notice])

  // E7h ⑥ — ⌘F 검색 대상 패널(마우스 위치의 data-find-scope, 없으면 diff)
  const [findScope, setFindScope] = useState<'history' | 'diff' | 'commit-files' | 'changes' | null>(
    null,
  )
  // ── 저장소에 매인 로컬 상태를 저장소가 바뀔 때 비운다 (E7i 보완 Step 4 · E14b · E15a 리뷰 ②) ──
  //
  // 왜 이펙트가 아닌가: set-state-in-effect는 lint 에러다 (E14b). "직전에 본 저장소를 함께
  // 기억했다가 렌더 중 비교"로 옮긴다 — 이펙트는 틀린 화면이 한 번 나간 뒤에 고치지만, 이 쪽은
  // 나가기 전에 끝난다(같은 컴포넌트를 향한 렌더 중 setState라 React가 공식으로 허용하는 패턴).
  //
  // 왜 { scope, repo } 한 묶음 상태가 아니라 상태 둘인가 (E14b 실측 편차): setFindScope를
  // repoPath를 클로저로 문 새 함수로 감싸면, 아래 ⌘F 키다운 리스너가 []로 마운트 시 1회만 등록되므로
  // **첫 렌더의 repoPath**를 영영 붙든다. 앱은 repoPath가 null인 채(RepoPicker) 마운트되므로 저장소를
  // 연 뒤 ⌘F를 누르면 repo가 null로 기록되고 비교가 매번 어긋나 찾기가 아예 안 열린다
  // (실측: ⌘F E2E 7건 전부 빨강). useState가 준 안정된 setter를 그대로 두면 그 함정이 없다.
  //
  // 왜 한 자리로 모았나 (E15a 리뷰 ②-b): E15a 전까지 이 규칙이 필요한 상태는 findScope와
  // activeWorktree 둘뿐이라 각자 비교를 들고 있었다. 그런데 ⌘O는 **모달 위에서도 돈다** —
  // 확인창은 `isOpen={x !== null}`로만 그려질 뿐 repoPath에 안 묶여 있어 전환 뒤에도 살아남고,
  // 그 안의 이름·해시·경로는 옛 저장소 것인데 확정하면 **새 저장소를 대상으로 실행된다**
  // (헤더 전환기는 모달 오버레이에 막히므로 이 경로는 ⌘O 전용이다). 대상이 17개로 늘어난 이상
  // 비교를 상태마다 두면 새 다이얼로그가 늘 때 빠뜨린다 — 비교는 하나, 목록만 는다.
  //
  // 여기 없는 것들은 **저장소에 안 매였다고 판단한 것**이다(전수):
  // - leftTab·leftCollapsed·rightCollapsed·rightWidth·dockOpen/dockHeight·theme — 뷰 선호.
  //   저장소를 바꿨다고 보던 탭·접힘·폭이 리셋되면 그게 더 놀랍다
  // - settingsOpen·worktreeSelectAction·autoFetch·home — 앱 전역 설정
  // - tokenPrompt — GitHub 토큰은 **계정 인증**이라 저장소 무관하다(hosting().connect.token은
  //   repoPath를 안 받는다). 전환했다고 붙여넣던 토큰을 날리면 안 된다
  // - purgeTerminalGroup — 터미널 그룹 정리 신호(1회성). 도크는 전환해도 살아 있고(E12),
  //   여기서 비우면 아직 도크가 소비하지 않은 정리가 유실된다
  const [boundRepo, setBoundRepo] = useState(store.repoPath)
  if (boundRepo !== store.repoPath) {
    setBoundRepo(store.repoPath)
    // 옛 저장소 기준 검색 상태 (E7i 보완 Step 4)
    setFindScope(null)
    // 옛 저장소의 워크트리를 가리킨 채 남으면 터미널 cwd·도크 라벨이 틀린다 (E15a)
    setActiveWorktree(null)
    // 옛 저장소의 해시·이름·경로를 물고 있는 확인창·입력창 (E15a 리뷰 ②-b)
    setBranchPrompt(null)
    setTagPrompt(null)
    setConfirmingUndo(null)
    setRewordPrompt(null)
    setConfirmingRebase(null)
    setRenamePrompt(null)
    setConfirmingRemove(null)
    setConfirmingRemoveWithWorktree(null)
    setConfirmingRemoveRemote(null)
    setConfirmingRemoveWorktree(null)
    setMergeFollowUp(null)
    // 페이로드는 없지만 "이 저장소에 대한 질문"이라 남으면 안 되는 것들 — 확정하면 새 저장소를
    // 대상으로 실행된다(confirmingAbort는 status?.state를 지금 스토어에서 읽어 abort*를 부른다)
    setConfirmingAbort(false)
    setMergePicker(false)
    setManageOpen(false)
    setAddWorktreeOpen(false)
    setPullPrompt(false)
    setConfirmingMerge(false)
  }
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

  // E15c 탭바 — 정본은 main의 레지스트리고 렌더러는 구독만 한다 (repo:changed 관용구).
  // 등록 즉시 현재 목록이 한 번 오고(preload가 tabs:list로 당겨온다) 이후 변경마다 push.
  // ref를 나란히 두는 이유: 아래 키다운 리스너가 []로 마운트 시 1회만 등록돼 상태를 클로저로
  // 물면 첫 렌더의 빈 목록을 영영 붙든다(E14b 실측 — 같은 함정에 ⌘F E2E 7건이 통째로 빨개졌다).
  // leftCollapsedRef와 같은 관용구 — 상태는 렌더 몫, ref는 리스너 몫
  const [tabs, setTabs] = useState<TabInfo[]>([])
  const tabsRef = useRef<TabInfo[]>([])
  useEffect(() => {
    // 구독 콜백 안의 set은 합법이다 (set-state-in-effect는 렌더 직후 동기 set만 잡는다)
    return window.gitApi.tabs.onChanged((list) => {
      tabsRef.current = list
      setTabs(list)
    })
  }, [])

  // ⌘`(맥)/Ctrl+` — 터미널 도크 토글 (E7b). 수정키 조합이라 입력 필드와 충돌하지 않는다.
  // ⌘F/Ctrl+F — 패널 검색 오버레이 열기 (E7h ⑥, 같은 훅에 이어 붙인다). 마우스가 올라간
  // 패널의 data-find-scope를 대상으로 삼는다 — 없으면 중앙 diff를 기본으로 한다
  // ⌘O/Ctrl+O — 다른 폴더 열기 (E15a). 헤더 전환기의 "다른 폴더 열기…"와 같은 동작이다
  // ⌘N/Ctrl+N — 저장소 없는 빈 새 창 (E15b)
  // ⌘T/⌘W/⌃Tab/⌘1..9 — 탭 (E15c). 각 분기의 터미널 가드 판단은 분기 주석에
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
      } else if ((event.metaKey || event.ctrlKey) && (event.key === 'o' || event.key === 'O')) {
        // ⌘O — 다른 폴더 열기 (E15a). Option 조합이 아니라 event.key로 충분하다(대문자는 ⇧⌘O)
        //
        // 터미널(xterm) 포커스면 가로채지 않는다 — 위 ⌘F와 **같은 줄, 같은 이유** (E15a 리뷰 ②).
        // 조건이 metaKey || ctrlKey라 macOS에서도 Ctrl+O가 잡히는데, 그건 도크 터미널에서
        // nano의 저장(Ctrl+O)이고 readline의 operate-and-get-next다. 이 가드가 없으면 그것들이
        // preventDefault()로 삼켜지고 대신 폴더 선택창이 뜬다 — 터미널 도크는 이 앱의 간판
        // 기능이다(E7b·E12)
        if (document.activeElement?.closest('.terminal-dock') !== null) return
        event.preventDefault()
        // 이 리스너는 []로 마운트 시 1회만 등록된다 — 렌더 시점의 `store`를 닫아 쓰면 **첫 렌더의**
        // 스토어를 영영 붙든다(E14b 실측: 같은 함정에 ⌘F E2E 7건이 통째로 빨개졌다).
        // getState()는 호출 시점의 스토어를 읽으므로 오래된 클로저가 생기지 않는다
        void useRepositoryStore.getState().openRepository()
      } else if ((event.metaKey || event.ctrlKey) && (event.key === 'n' || event.key === 'N')) {
        // ⌘N — 빈 새 창 (E15b). 터미널 가드는 위 ⌘O·⌘F와 **같은 줄, 같은 이유**다.
        // 조건이 metaKey || ctrlKey라 macOS에서도 Ctrl+N이 잡히는데, 그건 도크 터미널에서
        // readline의 next-history(아래 화살표와 같은 것)다 — 삼키면 히스토리 이동이 죽는다
        if (document.activeElement?.closest('.terminal-dock') !== null) return
        event.preventDefault()
        // 위 ⌘O가 getState()로 피한 오래된 클로저 문제가 여기엔 없다 — window.gitApi는 전역이다
        void window.gitApi.window.open(null)
      } else if ((event.metaKey || event.ctrlKey) && (event.key === 't' || event.key === 'T')) {
        // ⌘T — 새 빈 탭 (E15c). 터미널 가드는 위 ⌘O·⌘N과 **같은 줄, 같은 이유**다.
        // 조건이 metaKey || ctrlKey라 Ctrl+T도 잡히는데, 그건 도크 터미널에서 readline의
        // transpose-chars(글자 자리 바꾸기)다 — 삼키면 그 기능이 죽는다
        if (document.activeElement?.closest('.terminal-dock') !== null) return
        event.preventDefault()
        void window.gitApi.tabs.open(null)
      } else if ((event.metaKey || event.ctrlKey) && (event.key === 'w' || event.key === 'W')) {
        // ⌘W — 활성 탭 닫기 (E15c). 마지막 탭이면 창이 닫히는데 그 판단은 main이 한다
        // (tabs:close의 closeTab) — 렌더러는 활성 탭 id만 넘긴다.
        //
        // 터미널 가드 판단: macOS의 ⌘W 자체는 xterm이 pty로 보내지 않아 가로채도 안전하지만,
        // 조건이 metaKey || ctrlKey라 **Ctrl+W가 함께 잡힌다** — 그건 도크 터미널에서 readline의
        // unix-word-rubout(단어 지우기)로, 셸에서 아주 자주 쓰는 키다. 삼키면 단어 지우기 대신
        // 탭이 닫힌다(작업 중인 pty째) — ⌘O·⌘N과 같은 줄에 선다. 대가는 "터미널 포커스 중
        // ⌘W로 탭 닫기"가 안 되는 것뿐이고, 탭바 ×가 항상 있다
        if (document.activeElement?.closest('.terminal-dock') !== null) return
        event.preventDefault()
        const active = tabsRef.current.find((tab) => tab.active)
        if (active !== undefined) void window.gitApi.tabs.close(active.id)
      } else if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Tab') {
        // ⌃Tab/⌃⇧Tab — 다음/이전 탭 (E15c). 터미널 가드를 **걸지 않는 유일한 탭 단축키**다:
        // 터미널 에뮬레이터는 역사적으로 Ctrl+Tab을 Tab과 구분해 pty로 보낼 수 없어(제어문자
        // 표현이 없다) xterm.js도 그냥 버린다 — tmux 등에서 바인딩하려 해도 애초에 도달하지
        // 않는 키라 삼켜도 잃는 것이 없다(VS Code 내장 터미널도 Ctrl+Tab은 에디터가 가로챈다)
        event.preventDefault()
        const list = tabsRef.current
        const index = list.findIndex((tab) => tab.active)
        if (index !== -1 && list.length > 1) {
          const step = event.shiftKey ? list.length - 1 : 1
          void window.gitApi.tabs.activate(list[(index + step) % list.length]!.id)
        }
      } else if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        /^Digit[1-9]$/.test(event.code)
      ) {
        // ⌘1..9 — n번째 탭, 9는 마지막 탭(브라우저 관례) (E15c). ⌘⌥1/⌘⌥2(사이드 접기)는 위
        // 분기가 altKey로 먼저 잡는다 — 여기는 !altKey라 겹치지 않는다. event.code인 이유도
        // 그 분기와 같다(⌥ 조합에서 event.key가 특수문자로 바뀌는 macOS 실측).
        // 터미널 가드: Ctrl+숫자는 제어문자다(Ctrl+2=NUL·Ctrl+3=ESC·Ctrl+4..7=^\ ^] ^^ ^_) —
        // vi 사용자에게 Ctrl+3은 ESC 그 자체라 삼키면 안 된다 (⌘O·⌘N과 같은 줄)
        if (document.activeElement?.closest('.terminal-dock') !== null) return
        event.preventDefault()
        const list = tabsRef.current
        const n = Number(event.code.slice(5))
        const target = n === 9 ? list[list.length - 1] : list[n - 1]
        if (target !== undefined) void window.gitApi.tabs.activate(target.id)
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

  // E12 — 우측이 접힌 채 커밋 상세가 뜨면 죽은 클릭이다. E14b 전까지는 commitDetail이 채워지는
  // 순간을 이펙트로 공통으로 잡아 우측을 폈지만(set-state-in-effect), commitDetail을 null에서
  // 값으로 바꾸는 경로는 store.selectCommit 하나뿐이고 그 호출부가 아래 2곳뿐이라(실측) 호출부에서
  // 직접 편다 — 이펙트가 사라지고, 상세가 도착하기를 기다리지 않고 클릭 즉시 펴진다.
  // 호출부가 늘면 여기서 다시 중앙집중을 검토한다(플랜 Task 5의 (나)안: 스토어가 신호를 남긴다).

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
    // 빠진 의존성은 `store`. repoPath·autoFetch 전이에만 재구독해야 한다 — 스토어 상태 객체는
    // set마다 새 참조라(전체 구독 — :95) 넣으면 스토어가 갱신될 때마다 정리 함수가 10분
    // interval을 지우고 다시 걸어, 주기 새로고침이 영영 안 돈다(마운트 직후 1회 fetch만 반복).
    // E14c: 정작 쓰는 store.autoFetchRemotes는 zustand 액션이라 이미 안정 참조다 — 셀렉터로
    // 그 액션만 골라 받으면 의존성에 넣고 이 억제를 지울 수 있다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch, repoPathForFetch])

  // E7f 전체화면 전환 — 신호등이 숨는 동안 헤더의 신호등 패딩을 접는다 (body 클래스 — CSS 몫)
  useEffect(() => {
    return window.windowApi.onFullScreen((isFullScreen) => {
      document.body.classList.toggle('is-fullscreen', isFullScreen)
    })
  }, [])

  if (!store.repoPath) {
    return (
      // E15c — 빈 탭에도 탭바는 있다: 탭바가 곧 타이틀바라(드래그·신호등 자리) 없으면 창을
      // 움직일 수 없고, 다른 탭으로 돌아갈 길도 없다. .app으로 감싸 탭바+RepoPicker 두 층이
      // 저장소 화면과 같은 세로 구조(flex column, 100vh)를 갖는다
      <div className="app">
        <TabBar
          tabs={tabs}
          onActivate={(tabId) => void window.gitApi.tabs.activate(tabId)}
          onClose={(tabId) => void window.gitApi.tabs.close(tabId)}
          onAdd={() => void window.gitApi.tabs.open(null)}
          onDragEnd={(tabId, screenX, screenY, toIndex) =>
            void window.gitApi.tabs.dragEnd(tabId, screenX, screenY, toIndex)
          }
        />
        <RepoPicker
          onOpen={() => void store.openRepository()}
          recent={store.recentRepos}
          home={home}
          onOpenRecent={(path) => void store.openRepository(path)}
          error={store.error}
        />
      </div>
    )
  }

  // 전량 ours 병합 마무리 — 변경 0개면 규칙 제안이 비므로 기본 문구를 준다 (품질 리뷰)
  const suggestion =
    status?.state === 'merging' && stagedCount === 0
      ? `${T.branch} ${T.merge}`
      : suggestCommitMessage(status?.changes ?? [])
  // 마지막 저장(HEAD)이 원격에 이미 백업됐는가 — 실행취소·메시지 고치기 확인창의 경고 병기 (판정 편차는 플랜 표)
  const headBackedUp = status !== null && isHeadBackedUp(status.branch)
  // 보관함 항목을 미리보기로 연 상태인가 — 상세 패널 문구를 보관함 맥락으로 분기한다 (품질 리뷰)
  const openDetail = store.commitDetail
  const shelfPreview =
    openDetail !== null && store.shelf.some((entry) => entry.hash === openDetail.hash)

  return (
    <div className="app">
      {/* E15c — 탭바가 맨 위에서 타이틀바를 겸한다(스펙 §3 "두 줄"). 콜백만 내린다 —
          TabBar는 window.gitApi를 모른다 (E15b Task 5 확립 규칙) */}
      <TabBar
        tabs={tabs}
        onActivate={(tabId) => void window.gitApi.tabs.activate(tabId)}
        onClose={(tabId) => void window.gitApi.tabs.close(tabId)}
        onAdd={() => void window.gitApi.tabs.open(null)}
        onDragEnd={(tabId, screenX, screenY, toIndex) =>
          void window.gitApi.tabs.dragEnd(tabId, screenX, screenY, toIndex)
        }
      />
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
        {/* E15a — 저장소 이름 자리가 곧 전환기다. 저장소를 한 번 열면 다른 저장소로 바꿀 진입점이
            앱에 아예 없었다(아래 RepoPicker는 repoPath가 없을 때만 그려진다) */}
        <RepoSwitcher
          currentPath={store.repoPath}
          home={home}
          recent={store.recentRepos}
          busy={store.busy}
          onOpen={(path) => void store.openRepository(path)}
          onOpenInNewWindow={(path) => void store.openInNewWindow(path)}
          onOpenInNewTab={(path) => void store.openInNewTab(path)}
        />
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
            onPreview={(hash) => {
              void store.selectCommit(hash)
              // 보관함은 헤더에 있어 우측이 접힌 채로도 누를 수 있다 — 상세는 우측에 뜨니 펴 준다 (E14b)
              expandRightIfCollapsed()
            }}
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
            pending={store.reads.reviews > 0}
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
            시작점을 유지해야 grid-template-columns가 보간된다(E12 시절의 조건부 마운트 폐기).
            E13 후속(사용자 실측: "접힐 때 텍스트가 뭉개진다") — .app__left는 이제 순수
            클리퍼(트랙 폭 그대로)이고, 실제 탭바·패널은 안의 .app__left-inner가 펼친 폭
            (leftExpandedWidth)을 고정으로 유지한 채 담는다(layout.css 주석 참조).
            inert — 아래 app__dock 주석 참조(세 클리퍼 공통) */}
        <div className="app__left" inert={leftCollapsed} aria-hidden={leftCollapsed || undefined}>
          <div className="app__left-inner" style={{ width: leftExpandedWidth }}>
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
              pending={store.reads.left > 0}
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
                  case 'new-tab':
                    // "새 창에서 열기"의 탭 짝 (E15c) — 검증·실패 처리 경로는 아래 new-window와
                    // 같은 결이다(WindowOpenResult 재사용 — 계약서 tabs.open 주석)
                    void store.openInNewTab(action.path)
                    break
                  case 'new-window':
                    // 링크드 워크트리도 --show-toplevel이 그 워크트리 경로라 repo.open과 같은
                    // 검증(절대 경로 + rev-parse)을 그대로 통과한다 (E15a 실측 매트릭스).
                    // 실패(워크트리 폴더가 사라진 경우 등)도 스토어가 배너로 옮긴다 (E15b 리뷰 I-2)
                    void store.openInNewWindow(action.path)
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
              pending={store.reads.center > 0}
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
              pending={store.reads.center > 0}
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
            E13 — 접혀도 언마운트하지 않는다(트랙만 0px).
            E13 후속(사용자 실측: "접힐 때 텍스트가 뭉개진다") — .app__right는 이제 순수
            클리퍼(트랙 폭 그대로)이고, 실제 트리·상세는 안의 .app__right-inner가 펼친 폭
            (rightExpandedWidth)을 고정으로 유지한 채 담는다. 오른쪽 끝에 고정(justify-content:
            flex-end, layout.css)해 왼쪽(중앙쪽)부터 잘려 나가 오른쪽으로 슬라이드 아웃하는
            모양을 낸다.
            inert — 아래 app__dock 주석 참조(세 클리퍼 공통) */}
        <div
          className="app__right"
          inert={rightCollapsed}
          aria-hidden={rightCollapsed || undefined}
          // E7h ⑥ — 리뷰 상세가 열린 동안은 히스토리 스코프가 아니다(그 아래 commit-files
          // 래퍼가 자기 attribute로 더 구체적으로 잡아채므로, 여기선 그 경우만 비워둔다).
          // E13 — 접힌 동안도 스코프를 비운다(⌘F 핸들러가 leftCollapsedRef/rightCollapsedRef로
          // 한 번 더 거르지만, 속성 자체도 걸어 다른 소비자가 생겨도 안전하게)
          data-find-scope={!rightCollapsed && store.pullDetail === null ? 'history' : undefined}
        >
          <div
            className={`app__right-inner${store.commitDetail !== null ? ' app__right-inner--detail-open' : ''}`}
            style={{ width: rightExpandedWidth }}
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
              pending={store.reads.right > 0}
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
                pending={store.reads.right > 0}
                actionsDisabled={status?.state !== 'normal'}
                historyRef={store.historyRef}
                findOpen={findScope === 'history'}
                findNonce={findNonce}
                onFindClose={() => setFindScope(null)}
                onSelect={(hash) => {
                  void store.selectCommit(hash)
                  // 이 목록은 우측 안이라 접힌 동안은 inert — 닿을 수 없다. 그래도 같은 규칙을
                  // 두 호출부에 나란히 두어, 우측 밖으로 옮겨져도 죽은 클릭이 안 되게 한다 (E14b)
                  expandRightIfCollapsed()
                }}
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
                    pending={store.reads.right > 0}
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
        </div>
        {/* E7b 터미널 도크 — 세션 유지를 위해 항상 마운트한다(언마운트 금지).
            E13 Task 3 — display:none 대신 행 트랙 자체가 0px↔dockHeight로 전환된다(gridTemplateRows,
            좌·우 열이 트랙을 유지하는 것과 같은 이유). 열 범위(dockGridColumn)·행 범위(dockGridRow)
            모두 트랙 수가 고정이라 상수다.
            E13 후속(사용자 실측: "접힐 때 텍스트가 뭉개진다") — .app__dock가 클리퍼(행 트랙
            그대로)라 data-testid="terminal-dock"을 여기로 옮겼다(TerminalDock.tsx의 안쪽
            .terminal-dock에서 이전 — 그쪽은 이제 고정 높이라 자기 박스가 안 줄어든다, 아래
            TerminalDock 주석·terminal-dock.css 참조). Playwright의 toBeHidden()/toBeVisible()이
            이 요소를 봐야 실제로 접혔는지 정확히 잡는다.

            E13 후속(적대적 리뷰 BLOCKING) — 세 클리퍼(.app__dock/.app__left/.app__right) 공통으로
            접힌 동안 inert를 건다. E13이 "전환의 시작점을 남기려고" 조건부 마운트·display:none을
            폐기하면서, 박스만 0px일 뿐 **포커스는 그대로 들어가는** 상태를 만들었다. 마우스는
            overflow:hidden이 히트 테스트까지 잘라 안전하지만 키보드는 아니다 — 리뷰 실측: 도크를
            닫은 채 body에서 Tab 15번이면 숨은 .xterm-helper-textarea에 포커스가 앉고 거기 친 글자가
            **살아 있는 pty에서 실제로 실행됐다**(다시 열면 스크롤백에 남아 있다). 접힌 사이드도
            각각 21개가 포커스 가능했다.
            inert를 고른 이유: ① 레이아웃 효과가 0이라 240ms 전환을 전혀 건드리지 않는다
            ② 언마운트가 아니라 E7b의 "접어도 터미널 세션이 산다"가 그대로다 ③ 박스 크기를 바꾸지
            않아 Playwright의 toBeHidden()/toBeVisible()도 그대로 동작한다.
            aria-hidden을 함께 거는 이유: inert는 포커스·클릭·텍스트 선택을 막지만 스크린리더
            노출까지 규격상 보장하지는 않는다(브라우저별 편차) — 둘을 같이 건다. false 대신
            undefined로 지우는 것은 aria-hidden="false"가 "명시적으로 노출"이라는 별개 의미를
            갖기 때문이다. React 19라 inert는 boolean prop 그대로 쓴다(false면 속성이 안 붙는다) */}
        {store.repoPath !== null && (
          <div
            className="app__dock"
            data-testid="terminal-dock"
            inert={!dockOpen}
            aria-hidden={!dockOpen || undefined}
            style={{ gridColumn: dockGridColumn, gridRow: dockGridRow }}
          >
            <TerminalDock
              repoPath={store.repoPath}
              theme={theme}
              activeWorktree={activeWorktree}
              open={dockOpen}
              height={dockHeight}
              purgeGroup={purgeTerminalGroup}
              onPurged={clearPurgedTerminalGroup}
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
