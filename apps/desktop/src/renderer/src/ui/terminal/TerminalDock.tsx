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
  // 아래 ResizeObserver가 관찰할 이 요소 자신의 DOM 참조 — 창 크기와 무관한 폭 변화(사이드
  // 접기)를 잡는 용도다(그 effect 주석 참조, E13 후속에서 세로→가로로 역할 정정)
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
    // open·groupKey 전이에만 반응한다. 빠진 의존성은 `sessions`·`activeWorktree`.
    // useTerminalSessions는 매 렌더 새 객체 리터럴을 반환하고(use-terminal-sessions.ts:239)
    // activateGroup 등 액션도 매 렌더 새 클로저라, `sessions`를 넣으면 이 effect가 렌더마다
    // 재실행된다 — activateGroup은 "그 그룹에 탭이 0개면 생성"인데 setTabs 반영 전 스냅숏을
    // 거듭 보게 되므로 위 주석의 이중 생성 함정이 무한히 열린 판이 된다.
    // activeWorktree는 create의 cwd·label로만 쓰이고 그 cwd가 곧 groupKey라 이미 추적된다.
    // E14c: 훅 반환을 안정화하면(액션을 ref/모듈로 고정하고 값만 상태로) 그대로 넣고 지울 수 있다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, groupKey])

  // 워크트리 지우기 성공 — App이 내려준 경로의 그룹 세션을 전부 정리하고 1회성 상태를 돌려준다 (E7h ④)
  useEffect(() => {
    if (purgeGroup === null) return
    sessions.closeGroup(purgeGroup)
    onPurged?.()
    // purgeGroup 전이에만. 빠진 의존성은 `sessions`·`onPurged` — 둘 다 렌더마다 새 참조다
    // (훅 반환 객체 / App이 인라인 화살표로 내려주는 콜백). 넣으면 App이 1회성 상태를 비우기
    // 전에 끼어드는 렌더에서 closeGroup·onPurged가 한 번 더 불린다 — 이 effect는 "1회 소비"가
    // 계약이라 재실행 자체가 계약 위반이다.
    // E14c: 훅 반환 + onPurged(App 쪽)를 함께 안정화해야 지울 수 있다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purgeGroup])

  // 높이·활성 탭이 바뀌면 활성 세션을 다시 맞춘다
  useEffect(() => {
    sessions.refitActive()
    // 빠진 의존성은 `sessions`(렌더마다 새 객체). 넣으면 크기가 그대로여도 렌더마다 fit이 돌고
    // 그때마다 terminalApi.resize IPC가 나간다 — 이 세 effect 중 유일하게 매 렌더 값을 쓰므로
    // (deps에 sessions.activeId가 있어) 클로저는 최신이다. 낭비만 문제다.
    // E14c: 훅 반환이 안정 참조가 되면 넣어도 무해해져 지울 수 있다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, sessions.activeId])

  // 창 폭이 바뀌면 도크 폭(중앙+우측 flex 트랙)도 따라 바뀐다 — 높이와 별개 축이라
  // 위 effect가 못 잡는다. 폰트·줄간격을 명시하기 시작해 FitAddon 셀 계산이 더 정밀해진
  // 만큼(E12), 폭이 바뀌었는데 refit을 안 하면 글자가 잘리거나 오른쪽에 빈 공간이 남는다(실측)
  useEffect(() => {
    const onResize = () => sessions.refitActive()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // 빠진 의존성은 `sessions`. 넣으면 렌더마다 리스너를 떼고 다시 단다.
    // **E14b 실측 경고 — 이 억제는 낭비가 아니라 버그를 덮고 있다:** []로 굳은 클로저가 잡은
    // sessions는 마운트 시점 것이고, refitActive는 그 렌더의 activeId(= 항상 null)를 읽는다.
    // 즉 지금 이 리스너는 아무 일도 하지 않는다 — 창 폭 변화 refit은 실제로는 동작하지 않는다
    // (탭 전환·높이 변화는 위 effect가 최신 클로저로 담당해서 터미널이 멀쩡해 보일 뿐이다).
    // E14c: 훅 반환을 안정화하고 의존성을 넣는 것이 곧 이 버그의 수정이다 — 억제를 지우는
    // 작업과 기능을 되살리는 작업이 같다. 의존성만 몰래 채우지 말고 실제로 refit이 도는지 확인할 것
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 도크 폭이 **창 크기 변화 없이** 바뀌는 경우를 잡는다 — 좌·우 사이드 접기(⌘⌥1/⌘⌥2)다.
  // 도크는 좌측 관리 존을 뺀 나머지 열 전부를 덮으므로(MAIN_DOCK_GRID_COLUMN) 좌측이 접히면
  // 도크가 그만큼 넓어지는데, 창 크기는 그대로라 위 'resize' 리스너가 못 잡는다.
  //
  // E13 후속 정정 — 이 자리에 원래 "도크 행 전환(open/close) 240ms 동안 이 요소의 높이가 매
  // 프레임 바뀌므로 그것을 추적한다"고 적혀 있었다. f523ed0 이후로는 **사실이 아니다**:
  // 이 요소(.terminal-dock)는 인라인 고정 높이(dockHeight)를 유지하고, 줄어드는 쪽은 부모
  // 클리퍼(.app__dock)다(실측: 행 트랙이 240↔0으로 오가는 내내 innerH는 240 고정). 즉 이
  // 옵저버가 실제로 잡는 것은 이제 **세로가 아니라 가로**뿐이다. 세로는 위의 height prop
  // effect가 담당한다(도크 높이 드래그·창 세로 축소 모두 그쪽 경로다)
  useEffect(() => {
    const el = dockRef.current
    if (el === null) return
    const observer = new ResizeObserver(() => sessions.refitActive())
    observer.observe(el)
    return () => observer.disconnect()
    // 빠진 의존성은 `sessions`. 넣으면 렌더마다 옵저버를 끊고 다시 만든다(observe 직후 콜백이
    // 1회 발화하므로 렌더마다 resize IPC도 따라 나간다).
    // 위 'resize' effect와 **같은 죽은 클로저 문제를 공유한다** — 마운트 시점 sessions를 잡아
    // refitActive의 activeId가 null로 굳어 있어, 사이드 접기로 도크 폭이 바뀌어도 실제 refit은
    // 일어나지 않는다(E14b 실측).
    // E14c: 훅 반환 안정화 + 의존성 채우기가 곧 수정이다. 지운 뒤 접기로 refit이 도는지 볼 것
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    // E13 후속(사용자 실측: "접을 때 텍스트가 뭉개진다") — 높이를 고정으로 준다(부모
    // .app__dock가 행 트랙 크기 그대로인 클리퍼, terminal-dock.css 주석 참조). height prop은
    // App.tsx의 dockHeight — 닫혀도(open=false) 이 값 자체는 0이 되지 않는, 항상 "펼친" 높이다
    // (App.tsx가 넘겨줄 때 열림 여부와 무관하게 그대로 넘긴다). data-testid="terminal-dock"은
    // 부모(.app__dock)로 옮겼다 — 이 요소는 이제 고정 높이라 자기 박스가 안 줄어들어서, 여기
    // 있으면 Playwright의 toBeHidden()이 닫혀도 거짓을 준다(예전에 고정 px를 쓰다 겪은 것과
    // 같은 함정, terminal-dock.css 주석 참조)
    <div className="terminal-dock" ref={dockRef} style={{ height }}>
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
