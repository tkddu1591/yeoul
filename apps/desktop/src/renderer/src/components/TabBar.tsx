import { Plus, TriangleAlert, X } from 'lucide-react'
import type { TabInfo } from '@git-gui/ipc-contract'
import { tabLabels } from './tab-labels'
import './tab-bar.css'

interface TabBarProps {
  /** main이 push한 이 창의 탭 목록 — App이 구독해 내려준다 (TabBar는 window.gitApi를 모른다, E15b 규칙) */
  tabs: TabInfo[]
  onActivate(tabId: number): void
  onClose(tabId: number): void
  onAdd(): void
}

/**
 * 앱이 직접 그리는 탭바 (E15c) — 타이틀바를 겸한다 (스펙 §3 "두 줄").
 *
 * 탭 하나일 때도 그린다 (사용자 결정) — 숨기면 창 높이가 널뛴다.
 * 마크업 구조는 E12 터미널 알약 탭(terminal-dock__tab)의 관용구를 따른다:
 * 알약(span) 안에 이름 버튼 + 닫기 버튼 — 버튼 중첩 없이 각자 눌린다.
 */
export function TabBar({ tabs, onActivate, onClose, onAdd }: TabBarProps) {
  // i번째 라벨이 i번째 탭의 것 — 동명 저장소는 구분되는 부모까지 붙는다 (tab-labels.ts)
  const labels = tabLabels(tabs.map((tab) => tab.repoPath))
  return (
    <div className="tab-bar" data-testid="tab-bar" role="tablist" aria-label="저장소 탭">
      {tabs.map((tab, index) => (
        <span
          key={tab.id}
          className={`tab-bar__tab${tab.active ? ' tab-bar__tab--on' : ''}${tab.crashed ? ' tab-bar__tab--crashed' : ''}`}
        >
          {/* 죽음 표시 (E15e) — 이 탭바는 **산 형제** 렌더러가 그린다: 죽은 탭 자신은 아무것도
              못 그리므로(스펙 §1) 표시가 뜨는 곳은 언제나 이웃의 탭바다. 클릭(onActivate)이 곧
              복구다 — main의 tabs:activate가 크래시 탭이면 reload 후 세운다. 글리프는 이름
              버튼 안에 둔다: 표시를 보고 누르는 자리가 그대로 복구 버튼이어야 한다 */}
          <button
            type="button"
            role="tab"
            aria-selected={tab.active}
            className="tab-bar__name"
            data-testid={`tab-${tab.id}`}
            title={tab.crashed ? '응답 없음 — 누르면 다시 열어요' : undefined}
            aria-label={
              tab.crashed ? `${labels[index]} (응답 없음 — 누르면 다시 열어요)` : undefined
            }
            onClick={() => onActivate(tab.id)}
          >
            {tab.crashed ? (
              <TriangleAlert
                size={11}
                aria-hidden="true"
                className="tab-bar__crash"
                data-testid={`tab-crashed-${tab.id}`}
              />
            ) : null}
            {labels[index]}
          </button>
          <button
            type="button"
            className="tab-bar__close"
            aria-label={`${labels[index]} 탭 닫기`}
            data-testid={`tab-close-${tab.id}`}
            onClick={() => onClose(tab.id)}
          >
            <X size={11} aria-hidden="true" />
          </button>
        </span>
      ))}
      <button
        type="button"
        className="tab-bar__add"
        aria-label="새 탭"
        data-testid="tab-add"
        onClick={onAdd}
      >
        <Plus size={13} aria-hidden="true" />
      </button>
    </div>
  )
}
