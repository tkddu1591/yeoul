import { Plus, X } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '../Button'
import { useTerminalSessions } from './use-terminal-sessions'
import type { Theme } from '../theme'
import './terminal-dock.css'

interface TerminalDockProps {
  repoPath: string | null
  /** 앱 테마 — xterm 팔레트가 따라간다 (E7d ③) */
  theme: Theme
  /** 활성 워크트리(터미널 대상) — 새 세션이 이 폴더에서 열리고 탭 라벨에 이름이 병기된다 (E7c) */
  activeWorktree: { cwd: string; label: string } | null
  /** 도크가 보이는가 — 접힘은 숨김일 뿐 언마운트가 아니다(세션 유지 — 스펙) */
  open: boolean
  height: number
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
  onResizeStart,
  onClose,
}: TerminalDockProps) {
  const sessions = useTerminalSessions(repoPath, theme)

  // 처음 "열릴 때" 세션을 만든다 — 앱 시작만으로 쉘을 스폰하지 않는다. 열릴 때마다 크기를 다시 맞춘다
  useEffect(() => {
    if (!open) return
    if (sessions.tabs.length === 0) void sessions.create(activeWorktree ?? undefined)
    else sessions.refitActive()
    // open 전이에만 반응한다 — sessions는 렌더마다 새 참조
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 높이·활성 탭이 바뀌면 활성 세션을 다시 맞춘다
  useEffect(() => {
    sessions.refitActive()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, sessions.activeId])

  return (
    <div className="terminal-dock" style={{ height }} data-testid="terminal-dock">
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
          {sessions.tabs.map((tab) => (
            <span
              key={tab.sessionId}
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
        <span className="terminal-dock__hint">{repoPath?.split('/').pop() ?? ''}</span>
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
      </div>
    </div>
  )
}
