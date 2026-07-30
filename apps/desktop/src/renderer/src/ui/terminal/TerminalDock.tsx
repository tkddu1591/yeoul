import { Plus, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Button } from '../Button'
import { Tooltip } from '../Tooltip'
import { useTerminalSessions } from './use-terminal-sessions'
import type { Theme } from '../theme'
import './terminal-dock.css'

interface TerminalDockProps {
  repoPath: string | null
  /** 앱 테마 — xterm 팔레트가 따라간다 (E7d ③) */
  theme: Theme
  /** 활성 워크트리(터미널 대상) — 새 세션이 이 폴더에서 열린다. 이름은 도크 헤더에 표시된다
     (E7c, 탭 라벨 병기는 E12에서 폐지) */
  activeWorktree: { cwd: string; label: string } | null
  /** 도크가 보이는가 — 접힘은 숨김일 뿐 언마운트가 아니다(세션 유지 — 스펙) */
  open: boolean
  height: number
  /** 워크트리 지우기 성공 직후 App이 내려주는 그 경로 — 1회성. 소비하면 onPurged로 돌려준다 (E7h ④) */
  purgeGroup?: string | null
  onPurged?(): void
  /** 세로 드래그 시작 — 클램프·영속은 App 소유 (column-resize 관례) */
  onResizeStart(event: React.PointerEvent<HTMLDivElement>): void
  onClose(): void
}

/** 하단 터미널 도크 (E7b) — 렌더 전용. 세션 로직은 useTerminalSessions가 소유한다 */
export function TerminalDock({
  repoPath,
  theme,
  activeWorktree,
  open,
  height,
  purgeGroup = null,
  onPurged,
  onResizeStart,
  onClose,
}: TerminalDockProps) {
  const sessions = useTerminalSessions(repoPath, theme)
  // 도크 행 전환(open/close, E13 Task 3) 중 ResizeObserver가 관찰할 이 요소 자신의 DOM 참조
  const dockRef = useRef<HTMLDivElement | null>(null)
  // 현재 그룹 키 — 워크트리별 터미널 탭 묶음의 기준 (E7h ④). repoPath가 null이면 도크 자체가 비활성
  const groupKey = activeWorktree?.cwd ?? repoPath
  // 빈 상태 오버레이는 지금 보이는 탭 기준 (E12)
  const activeTab = sessions.tabs.find((tab) => tab.sessionId === sessions.activeId) ?? null

  // 도크가 열려 있는 상태에서 열리거나(open) 그룹이 바뀌면(groupKey) 그 그룹을 활성화한다 —
  // 기억된 탭 복원, 없으면 자동 1개 생성. 그룹에 활성 탭이 이미 있으면(재열림, 그룹 불변) refit만 한다.
  // (주의: open·groupKey를 별개의 두 effect로 나누면 — 워크트리 행을 닫힌 도크에서 클릭하듯
  // 두 값이 "같은 렌더"에서 동시에 바뀌는 경로에서 — 둘 다 같은 "탭 0개" 스냅숏을 보고 각자
  // activateGroup을 호출해 세션이 두 개 생기는 함정이 있다(실측). 하나의 effect로 합쳐 막는다)
  useEffect(() => {
    if (!open || groupKey === null) return
    const groupTabs = sessions.tabs.filter((tab) => tab.groupKey === groupKey)
    if (groupTabs.length === 0) void sessions.activateGroup(groupKey, activeWorktree ?? undefined)
    else if (groupTabs.some((tab) => tab.sessionId === sessions.activeId)) sessions.refitActive()
    else void sessions.activateGroup(groupKey, activeWorktree ?? undefined)
    // open·groupKey 전이에만 반응한다 — sessions는 렌더마다 새 참조
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, groupKey])

  // 워크트리 지우기 성공 — App이 내려준 경로의 그룹 세션을 전부 정리하고 1회성 상태를 돌려준다 (E7h ④)
  useEffect(() => {
    if (purgeGroup === null) return
    sessions.closeGroup(purgeGroup)
    onPurged?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purgeGroup])

  // 높이·활성 탭이 바뀌면 활성 세션을 다시 맞춘다
  useEffect(() => {
    sessions.refitActive()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, sessions.activeId])

  // 창 폭이 바뀌면 도크 폭(중앙+우측 flex 트랙)도 따라 바뀐다 — 높이와 별개 축이라
  // 위 effect가 못 잡는다. 폰트·줄간격을 명시하기 시작해 FitAddon 셀 계산이 더 정밀해진
  // 만큼(E12), 폭이 바뀌었는데 refit을 안 하면 글자가 잘리거나 오른쪽에 빈 공간이 남는다(실측)
  useEffect(() => {
    const onResize = () => sessions.refitActive()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // E13 Task 3 — 도크 행이 grid-template-rows 전환(App.tsx)으로 열고 닫히는 240ms 내내 이
  // 요소 자신의 실제 박스 크기가 매 프레임 바뀐다(.terminal-dock이 height:100%로 부모 행
  // 트랙을 그대로 따라간다, terminal-dock.css). 위 'resize'(창 폭) 리스너는 창 크기 자체가
  // 그대로인 이 전환을 못 잡는다 — ResizeObserver로 이 요소의 실제 크기 변화를 프레임마다
  // 관찰해 refit한다. 전환이 끝나 크기가 dockHeight에 정확히 도달하는 마지막 콜백이 최종
  // 정착 크기도 함께 잡아준다(별도 transitionend 처리가 필요 없다)
  useEffect(() => {
    const el = dockRef.current
    if (el === null) return
    const observer = new ResizeObserver(() => sessions.refitActive())
    observer.observe(el)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="terminal-dock" ref={dockRef} data-testid="terminal-dock">
      <div
        className="terminal-dock__bar"
        onPointerDown={onResizeStart}
        role="separator"
        aria-orientation="horizontal"
        aria-label="터미널 높이 조절"
        data-testid="terminal-resizer"
      >
        <span className="terminal-dock__label">터미널</span>
        <div className="terminal-dock__tabs" onPointerDown={(event) => event.stopPropagation()}>
          {sessions.tabs
            .filter((tab) => tab.groupKey === groupKey)
            .map((tab) => (
              // E12 — 탭은 번호만 보여준다. 이 워크트리에서 어느 폴더가 열렸는지는 이제
              // 탭마다 반복하는 라벨이 아니라 호버 툴팁(cwd)으로 옮겼다 — 정보는 그대로,
              // 반복은 없앤다(도크 헤더가 이미 지금 보는 워크트리를 보여준다)
              <Tooltip key={tab.sessionId} content={tab.groupKey} summary={tab.groupKey}>
                <span
                  className={`terminal-dock__tab${
                    tab.sessionId === sessions.activeId ? ' terminal-dock__tab--on' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="terminal-dock__tab-name"
                    onClick={() => sessions.select(tab.sessionId)}
                  >
                    {tab.title}
                    {tab.exited ? ' (종료)' : ''}
                  </button>
                  <button
                    type="button"
                    className="terminal-dock__tab-close"
                    aria-label={`${tab.title} 닫기`}
                    onClick={() => sessions.close(tab.sessionId)}
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                </span>
              </Tooltip>
            ))}
          <Button
            variant="ghost"
            size="sm"
            onPress={() => void sessions.create(activeWorktree ?? undefined)}
            testId="terminal-new-tab"
          >
            <Plus size={13} aria-hidden="true" />
          </Button>
        </div>
        {/* E12 — 탭에서 뺀 워크트리 이름이 여기로 옮겨왔다. 지금 보고 있는 워크트리가 곧 이
            탭들의 대상이라 헤더에 한 번만 있으면 충분하다(activeWorktree가 없으면 본체 저장소) */}
        <span className="terminal-dock__hint">
          {activeWorktree?.label ?? repoPath?.split('/').pop() ?? ''}
        </span>
        <div onPointerDown={(event) => event.stopPropagation()}>
          <Button variant="ghost" size="sm" onPress={onClose} testId="terminal-close">
            <X size={13} aria-hidden="true" /> 접기
          </Button>
        </div>
      </div>
      {sessions.error !== null && (
        <p className="terminal-dock__error" role="alert" data-testid="terminal-error">
          {sessions.error}
        </p>
      )}
      <div className="terminal-dock__body" data-testid="terminal-body">
        {sessions.tabs.map((tab) => (
          <div
            key={tab.sessionId}
            className="terminal-dock__view"
            style={{ display: tab.sessionId === sessions.activeId ? 'block' : 'none' }}
            ref={(element) => sessions.attach(tab.sessionId, element)}
          />
        ))}
        {/* E12 — 새 탭의 빈 화면 안내. 셸에 문자를 넣지 않는 순수 오버레이(pointer-events: none)라
            터미널 포커스·입력을 절대 가로채지 않는다. 첫 입력·첫 출력 중 먼저 오는 것에 꺼진다
            (useTerminalSessions.dismissHint) */}
        {activeTab?.hintVisible === true && (
          <p className="terminal-dock__hint-overlay" data-testid="terminal-empty-hint">
            {activeWorktree?.label ?? repoPath?.split('/').pop() ?? ''} · {activeTab.groupKey}
          </p>
        )}
      </div>
    </div>
  )
}
