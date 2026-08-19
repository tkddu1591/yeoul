import { useEffect, useRef, useState } from 'react'
import { Plus, TriangleAlert, X } from 'lucide-react'
import type { TabInfo } from '@git-gui/ipc-contract'
import { tabLabels } from './tab-labels'
import { dropIndexOf, exceedsDragThreshold, insertionIndexOf } from './tab-drag'
import './tab-bar.css'

interface TabBarProps {
  /** main이 push한 이 창의 탭 목록 — App이 구독해 내려준다 (TabBar는 window.gitApi를 모른다, E15b 규칙) */
  tabs: TabInfo[]
  onActivate(tabId: number): void
  onClose(tabId: number): void
  onAdd(): void
  /**
   * 드래그 드롭 (E15d) — screenX/screenY는 절대 스크린 좌표(clientX+window.screenX 보정 —
   * 실측 근거는 아래 릴리스 핸들러 주석), toIndex는 같은 탭바 안 드롭일 때의 자리.
   * 드롭이 어디였는지(제 탭바·다른 창·창 밖) 판정은 main 몫이라 여기서는 좌표만 올린다
   */
  onDragEnd(tabId: number, screenX: number, screenY: number, toIndex: number): void
}

/** 드래그 한 판의 장부 — 렌더와 무관한 포인터 궤적이라 ref에 산다 (pointerRef 관용구) */
interface DragGesture {
  pointerId: number
  tabId: number
  fromIndex: number
  startX: number
  startY: number
  /** 임계값(4px)을 넘어 드래그 모드에 들어갔는가 — 미만이면 클릭으로 남는다 */
  dragging: boolean
  /** ESC로 취소됐는가 — 이후 move·up을 전부 무시한다 (스펙 §2) */
  cancelled: boolean
}

/**
 * 앱이 직접 그리는 탭바 (E15c) — 타이틀바를 겸한다 (스펙 §3 "두 줄").
 *
 * 탭 하나일 때도 그린다 (사용자 결정) — 숨기면 창 높이가 널뛴다.
 * 마크업 구조는 E12 터미널 알약 탭(terminal-dock__tab)의 관용구를 따른다:
 * 알약(span) 안에 이름 버튼 + 닫기 버튼 — 버튼 중첩 없이 각자 눌린다.
 *
 * 드래그 (E15d) — 이름 버튼의 pointerdown에서 `setPointerCapture`를 걸어 이후 move·up이
 * 창 밖 좌표까지 이 버튼으로 온다(실측 — 스펙 §1의 설계 우회). 4px 임계값 미만은 기존
 * 클릭·⌥클릭 그대로다: 캡처를 걸어도 click은 캡처 요소에서 정상 발화한다(실측). 판정
 * (임계값·삽입 틈·드롭 자리)은 tab-drag.ts의 순수 함수 몫이고 여기는 이벤트 배선만 든다
 */
export function TabBar({ tabs, onActivate, onClose, onAdd, onDragEnd }: TabBarProps) {
  // i번째 라벨이 i번째 탭의 것 — 동명 저장소는 구분되는 부모까지 붙는다 (tab-labels.ts)
  const labels = tabLabels(tabs.map((tab) => tab.repoPath))

  const barRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragGesture | null>(null)
  // 드래그로 끝난 제스처의 pointerup 뒤에도 click이 캡처 요소에서 발화한다(실측) — 그 클릭이
  // 탭 전환으로 새면 드롭과 전환이 겹친다. 드래그였으면 다음 클릭 하나를 삼킨다
  const suppressClickRef = useRef(false)
  // 삽입선이 그려질 틈 번호(0..tabs.length) — null이면 드래그 중이 아니다. 렌더가 써야 해서 state
  const [insertion, setInsertion] = useState<number | null>(null)

  // ESC로 드래그 취소 (스펙 §2) — 드래그 중에만 창 리스너를 단다. 의존성은 "드래그 중인가"라는
  // 불리언이다 — insertion 값 자체를 걸면 틈이 바뀔 때마다 리스너를 떼었다 다시 단다
  const draggingNow = insertion !== null
  useEffect(() => {
    if (!draggingNow) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const gesture = dragRef.current
      // 장부에 취소만 적는다 — 캡처는 그대로 두고 이후 move·up이 장부를 보고 무시한다.
      // suppressClickRef는 이미 true라(드래그 모드 진입 시 적음) 버튼 위에서 놓아도 전환 안 된다
      if (gesture !== null) gesture.cancelled = true
      setInsertion(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [draggingNow])

  /** 탭 알약들의 중심 x — 삽입 틈 판정의 입력. 드래그 중에만 불려 측정 비용이 클릭 경로에 없다 */
  const tabMidpoints = (): number[] => {
    const bar = barRef.current
    if (bar === null) return []
    return [...bar.querySelectorAll('.tab-bar__tab')].map((pill) => {
      const rect = pill.getBoundingClientRect()
      return rect.left + rect.width / 2
    })
  }

  const onTabPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    tabId: number,
    index: number,
  ) => {
    // 주 버튼만 드래그다 — 우클릭·가운데 클릭은 캡처도 걸지 않아 기존 동작 무변
    if (event.button !== 0) return
    // 임계값 전에 미리 캡처한다 — 걸어도 클릭은 정상 발화하고(실측), 4px을 넘는 순간부터의
    // move가 이미 캡처 아래라 빠른 드래그에서 첫 구간을 잃지 않는다
    event.currentTarget.setPointerCapture(event.pointerId)
    suppressClickRef.current = false
    dragRef.current = {
      pointerId: event.pointerId,
      tabId,
      fromIndex: index,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      cancelled: false,
    }
  }

  const onTabPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const gesture = dragRef.current
    if (gesture === null || gesture.pointerId !== event.pointerId || gesture.cancelled) return
    if (!gesture.dragging) {
      // 4px 미만은 아직 클릭 후보다 — 아무것도 안 바꿔야 기존 클릭·⌥클릭이 무변이다
      if (!exceedsDragThreshold(event.clientX - gesture.startX, event.clientY - gesture.startY)) {
        return
      }
      gesture.dragging = true
      suppressClickRef.current = true
    }
    setInsertion(insertionIndexOf(tabMidpoints(), event.clientX))
  }

  const onTabPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const gesture = dragRef.current
    if (gesture === null || gesture.pointerId !== event.pointerId) return
    dragRef.current = null
    setInsertion(null)
    // 임계값 미만(클릭으로 남는다)·ESC 취소 — 드롭이 아니다
    if (!gesture.dragging || gesture.cancelled) return
    // 절대 스크린 좌표는 event.screenX가 아니라 clientX+window.screenX다 — CDP 합성(E2E)의
    // event.screenX는 창 상대로 오고(실측: 창 (360,84)에서 screenX===clientX), 실제 입력은
    // 뷰가 창 원점 전체 크기라(contentBounds==bounds 실측) 두 식이 같은 값이 된다
    onDragEnd(
      gesture.tabId,
      event.clientX + window.screenX,
      event.clientY + window.screenY,
      dropIndexOf(insertionIndexOf(tabMidpoints(), event.clientX), gesture.fromIndex),
    )
  }

  const onTabLostCapture = (event: React.PointerEvent<HTMLButtonElement>) => {
    // 정상 경로에서는 pointerup 처리가 장부를 이미 비운 뒤라 무해하다. 드래그 중 캡처를
    // 뜻밖에 잃으면(시스템 개입 등) 드롭 없이 조용히 접는다 — 삽입선이 남으면 안 된다
    const gesture = dragRef.current
    if (gesture === null || gesture.pointerId !== event.pointerId) return
    dragRef.current = null
    setInsertion(null)
  }

  return (
    <div ref={barRef} className="tab-bar" data-testid="tab-bar" role="tablist" aria-label="저장소 탭">
      {tabs.map((tab, index) => (
        <span
          key={tab.id}
          className={`tab-bar__tab${tab.active ? ' tab-bar__tab--on' : ''}${tab.crashed ? ' tab-bar__tab--crashed' : ''}${
            // 드롭 예상 위치 삽입선 (E15d) — 틈 i는 i번째 탭의 왼쪽, 마지막 틈만 끝 탭의 오른쪽
            insertion === index ? ' tab-bar__tab--insert-before' : ''
          }${insertion === tabs.length && index === tabs.length - 1 ? ' tab-bar__tab--insert-after' : ''}`}
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
            onPointerDown={(event) => onTabPointerDown(event, tab.id, index)}
            onPointerMove={onTabPointerMove}
            onPointerUp={onTabPointerUp}
            onLostPointerCapture={onTabLostCapture}
            onClick={() => {
              // 드래그로 끝난 제스처의 잔여 클릭은 전환이 아니다 (suppressClickRef 주석)
              if (suppressClickRef.current) {
                suppressClickRef.current = false
                return
              }
              onActivate(tab.id)
            }}
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
