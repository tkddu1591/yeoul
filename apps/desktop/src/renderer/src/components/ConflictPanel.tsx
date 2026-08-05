import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, Check, CheckCheck, Download, PenLine, RotateCcw, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Panel } from '../ui/Panel'
import { buildConflictView, hasConflictMarkers } from './conflict-markers'
import { T } from '../terms'
import './conflict-panel.css'
import './virtual.css'

interface ConflictPanelProps {
  path: string
  content: string
  busy: boolean
  /**
   * 어느 흐름의 충돌인가 — merge는 "가져온 것", revert는 "되돌린 결과물"로 문구를 분기한다 (품질 리뷰).
   * rebase는 git의 ours/theirs가 뒤집힌다 — 초록(ours)=새 기반, 보라(theirs)=재배치 중인 내 저장 (E7a)
   */
  mode: 'merging' | 'reverting' | 'rebasing'
  /** 파일 전체 한쪽 확정 — ours=내 것 유지, theirs=가져온 것 사용 (빠른 길) */
  onResolve(choice: 'ours' | 'theirs'): void
  /** 확정(git add) — "고른 대로 확정"과 "직접 수정했어요"가 공유한다. 마커가 남아 있으면 확인창을 거친다 */
  onMarkResolved(): void
  /** 최신 파일 내용 재조회 — 외부 편집 후의 stale 검사(거짓 경고)를 막는다. 실패 시 null */
  onReload(): Promise<string | null>
  /** 블록 하나를 한쪽으로 — 파일에 즉시 반영된다(확정 아님, add하지 않는다) */
  onChooseBlock(blockIndex: number, choice: 'ours' | 'theirs'): void
  /** 자세히 보기에서 직접 수정한 결과 저장(확정 아님). 성공 여부를 반환한다 — 실패 시 초안 보존 */
  onSaveText(content: string): Promise<boolean>
  /** 처음부터 다시 — 겹침 표시를 되살린다(checkout -m). 확인창은 이 컴포넌트가 담당한다 */
  onReset(): void
  /** 이 패널로 떨어질 조회(가운데)가 진행 중인가 (E14a) */
  pending: boolean
}

/**
 * 충돌 해결 화면 (스펙 §7 2단 구조) — 기본은 하나씩 선택형: 겹침 블록마다 카드로
 * 양쪽을 나란히 보여 주고 한쪽을 고르면 파일에 즉시 반영된다(확정은 "고른 대로 확정"에서만).
 * "자세히 보기"는 합쳐진 결과(남은 마커 포함)를 직접 수정하는 상세 뷰의 단순화 버전이다.
 * 초록 = 내 것(HEAD), 보라 = 가져온 것(revert에서는 되돌린 결과물).
 */
export function ConflictPanel({
  path,
  content,
  busy,
  mode,
  onResolve,
  onMarkResolved,
  onReload,
  onChooseBlock,
  onSaveText,
  onReset,
  pending,
}: ConflictPanelProps) {
  const takenLabel =
    mode === 'reverting'
      ? '되돌린 결과물'
      : mode === 'rebasing'
        ? `${T.rebase} 중인 내 ${T.commit}`
        : '가져온 것'
  // rebase에서는 초록(ours)이 "내 것"이 아니라 새 기반이다 — 이름을 정직하게 바꾼다 (E7a)
  const mineLabel = mode === 'rebasing' ? '새 기반' : '내 것'
  const [confirmingMark, setConfirmingMark] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [view, setView] = useState<'cards' | 'edit'>('cards')
  const [draft, setDraft] = useState('')
  const items = buildConflictView(content)
  // 블록 카드의 아이템 위치 — "다음 겹침" 순환 점프·선택 후 자동 스크롤에 쓴다
  const blockItemIndexes = items.reduce<number[]>((acc, item, index) => {
    if (item.type === 'block') acc.push(index)
    return acc
  }, [])
  const blockCount = blockItemIndexes.length
  // 진행 표시 분모 — 연 시점의 블록 수. "처음부터 다시"·외부 편집으로 늘면 렌더 중 보정한다
  const [total, setTotal] = useState(blockCount)
  if (blockCount > total) setTotal(blockCount)
  const done = total - blockCount
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    // 카드(블록)는 줄보다 크게 추정한다 — 실제 높이는 measureElement가 잡는다
    estimateSize: (index) => (items[index]!.type === 'block' ? 132 : 21),
    overscan: 20,
  })
  const [jumpCursor, setJumpCursor] = useState(0)
  const jumpNext = () => {
    if (blockItemIndexes.length === 0) return
    virtualizer.scrollToIndex(blockItemIndexes[jumpCursor % blockItemIndexes.length]!, {
      align: 'center',
    })
    setJumpCursor(jumpCursor + 1)
  }
  // 블록을 고르면 반영된 내용이 prop으로 돌아온 뒤, 고른 위치 "이후"의 첫 미해결 블록으로
  // 스크롤한다 — 중간부터 골라도 맨 위로 끌려가지 않는다 (품질 리뷰). 남은 블록은 0부터
  // 재번호되므로, 옛 인덱스 k를 고르면 다음 미해결의 새 인덱스가 곧 k다
  const pendingScrollRef = useRef<number | null>(null)
  const chooseBlock = (blockIndex: number, choice: 'ours' | 'theirs') => {
    pendingScrollRef.current = blockIndex
    onChooseBlock(blockIndex, choice)
  }
  useEffect(() => {
    const from = pendingScrollRef.current
    if (from === null) return
    pendingScrollRef.current = null
    const after = items.findIndex((item) => item.type === 'block' && item.block.index >= from)
    const nextIndex = after >= 0 ? after : items.findIndex((item) => item.type === 'block')
    if (nextIndex >= 0) virtualizer.scrollToIndex(nextIndex, { align: 'center' })
    // 선택이 반영된 content 변화 시점에만. 빠진 의존성은 `items`·`virtualizer`.
    // items는 매 렌더 buildConflictView(content)가 새로 만드는 배열이라(:68) 넣으면 곧 "매 렌더"다 —
    // 이 effect는 pendingScrollRef를 1회 소비하는 계약이라, content가 반영되기 전 렌더에 끼어들면
    // 낡은 items로 엉뚱한 위치에 스크롤한 뒤 ref를 비워버린다. content가 items의 정본이라 [content]가
    // 옳은 표현이다.
    // virtualizer는 안정 참조다 — TanStack v3는 인스턴스를 useState로 한 번만 만든다
    // (react-virtual dist/esm/index.js:82). 플랜의 "매 렌더 새 참조"는 사실이 아니다.
    // E14c: 참조 안정화로는 안 풀린다 — items를 ref로 읽도록 바꿔야 지울 수 있는 자리다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])
  // 열 때 첫 겹침으로 — 진행 표시("1번째")와 화면이 어긋나지 않게 한다 (품질 리뷰).
  // key={path}로 파일마다 리마운트되므로 mount 1회면 충분하다
  useEffect(() => {
    const first = items.findIndex((item) => item.type === 'block')
    if (first >= 0) virtualizer.scrollToIndex(first, { align: 'center' })
    // 빠진 의존성은 `items`·`virtualizer`. items는 매 렌더 새 배열이라(:68) 넣으면 매 렌더
    // 실행이고, 그러면 "열 때 1회"가 "볼 때마다 첫 겹침으로 되감기"가 돼 사용자가 스크롤을
    // 할 수 없게 된다. virtualizer는 안정 참조라 무관하다(위 effect 주석 참조).
    // E14c: 마운트 1회라는 의도를 deps 배열로는 표현할 수 없다 — 참조 안정화로 풀리지 않고,
    // 초기 스크롤을 콜백 ref 같은 다른 자리로 옮겨야 지울 수 있다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const markResolved = () => {
    void (async () => {
      // 외부 편집기에서 마커를 지웠을 수 있다 — 열 때 읽은 내용이 아니라 최신 내용으로 검사한다 (거짓 경고 방지)
      const fresh = await onReload()
      if (fresh === null) return
      if (hasConflictMarkers(fresh)) setConfirmingMark(true)
      else onMarkResolved()
    })()
  }
  const openDetail = () => {
    void (async () => {
      // 외부 편집이 있었을 수 있다 — 최신 내용으로 편집을 시작한다 (markResolved와 동일 원칙)
      const fresh = await onReload()
      if (fresh === null) return
      setDraft(fresh)
      setView('edit')
    })()
  }

  return (
    <Panel
      title={`${path} — ${T.conflict} 해결`}
      titleHint="conflict"
      testId="conflict-panel"
      pending={pending}
    >
      {view === 'cards' ? (
        <>
          <p className="conflict-panel__hint">
            두 버전이 같은 곳을 다르게 고쳤어요. {T.conflict}마다 카드에서 한쪽을 골라 주세요 — 초록이{' '}
            <strong>{mineLabel}</strong>, 보라가 <strong>{takenLabel}</strong>이에요. 고르면 파일에 바로
            반영되지만, "고른 대로 확정"을 누르기 전에는 아무것도 확정되지 않아요. 선택하지 않은
            쪽도 사라지지 않고 {T.history}에 남아 있어요.
          </p>
          {/* 해결 버튼은 헤더가 아니라 전용 줄에 — 좁은 폭에서도 잘리지 않고 줄바꿈된다 (리뷰 실측) */}
          <div className="conflict-panel__actions">
            {blockCount > 0 ? (
              <span className="conflict-panel__progress" data-testid="conflict-progress">
                {T.conflict} {total}곳 중 {done + 1}번째
              </span>
            ) : (
              <span
                className="conflict-panel__progress conflict-panel__progress--done"
                data-testid="conflict-progress"
              >
                모두 골랐어요
              </span>
            )}
            {blockCount === 0 && (
              <Button
                variant="primary"
                size="sm"
                isDisabled={busy}
                onPress={markResolved}
                testId="conflict-confirm"
              >
                <CheckCheck size={13} aria-hidden="true" /> 고른 대로 확정
              </Button>
            )}
            <Button
              variant="neutral"
              className="conflict-panel__btn--mine"
              size="sm"
              isDisabled={busy}
              onPress={() => onResolve('ours')}
              testId="conflict-ours"
            >
              <User size={13} aria-hidden="true" /> {mineLabel} 유지
            </Button>
            <Button
              variant="neutral"
              className="conflict-panel__btn--branch"
              size="sm"
              isDisabled={busy}
              onPress={() => onResolve('theirs')}
              testId="conflict-theirs"
            >
              <Download size={13} aria-hidden="true" /> {takenLabel} 사용
            </Button>
            <Button
              variant="ghost"
              size="sm"
              isDisabled={busy}
              onPress={markResolved}
              testId="conflict-mark"
            >
              <Check size={13} aria-hidden="true" /> 직접 수정했어요
            </Button>
            <Button
              variant="ghost"
              size="sm"
              isDisabled={busy || blockCount === 0}
              onPress={jumpNext}
              testId="conflict-next"
            >
              <ArrowDown size={13} aria-hidden="true" /> 다음 {T.conflict} ({blockCount})
            </Button>
            <Button
              variant="ghost"
              size="sm"
              isDisabled={busy}
              onPress={openDetail}
              testId="conflict-detail-toggle"
            >
              <PenLine size={13} aria-hidden="true" /> 자세히 보기
            </Button>
            <Button
              variant="ghost"
              size="sm"
              isDisabled={busy}
              onPress={() => setConfirmingReset(true)}
              testId="conflict-reset"
            >
              <RotateCcw size={13} aria-hidden="true" /> 처음부터 다시
            </Button>
          </div>
          <div ref={scrollRef} className="virtual-scroll conflict-panel__scroll" data-testid="conflict-view">
            <div
              className="conflict-panel__code"
              style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
            >
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const item = items[virtualItem.index]!
                return (
                  <div
                    key={virtualItem.index}
                    ref={virtualizer.measureElement}
                    data-index={virtualItem.index}
                    className="virtual-row"
                    style={{ transform: `translateY(${virtualItem.start}px)` }}
                  >
                    {item.type === 'line' ? (
                      <div className="conflict-line conflict-line--context">
                        <span className="conflict-line__text">{item.text || ' '}</span>
                      </div>
                    ) : (
                      <div className="conflict-card" data-testid={`conflict-card-${item.block.index}`}>
                        <p className="conflict-card__title">
                          {done + item.block.index + 1}번째 {T.conflict} — 어느 쪽을 쓸까요?
                        </p>
                        <div className="conflict-card__sides">
                          <div className="conflict-card__side conflict-card__side--mine">
                            <span className="conflict-card__side-label">
                              <User size={12} aria-hidden="true" /> {mineLabel}
                            </span>
                            <pre className="conflict-card__code">
                              {item.block.ours.join('\n') || '(비어 있음)'}
                            </pre>
                            <Button
                              variant="neutral"
                              className="conflict-panel__btn--mine"
                              size="sm"
                              isDisabled={busy}
                              onPress={() => chooseBlock(item.block.index, 'ours')}
                              testId={`conflict-block-ours-${item.block.index}`}
                            >
                              이쪽 사용
                            </Button>
                          </div>
                          <div className="conflict-card__side conflict-card__side--branch">
                            <span className="conflict-card__side-label">
                              <Download size={12} aria-hidden="true" /> {takenLabel}
                            </span>
                            <pre className="conflict-card__code">
                              {item.block.theirs.join('\n') || '(비어 있음)'}
                            </pre>
                            <Button
                              variant="neutral"
                              className="conflict-panel__btn--branch"
                              size="sm"
                              isDisabled={busy}
                              onPress={() => chooseBlock(item.block.index, 'theirs')}
                              testId={`conflict-block-theirs-${item.block.index}`}
                            >
                              이쪽 사용
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="conflict-panel__hint">
            병합 결과를 직접 고칠 수 있어요. 남은 {T.conflict} 표시(&lt;&lt;&lt;&lt;&lt;&lt;&lt;)도
            그대로 보여요 — 표시 줄까지 지우고 원하는 내용만 남긴 뒤 저장해 주세요. 저장해도 확정은
            아니에요.
          </p>
          <div className="conflict-panel__actions">
            <Button
              variant="primary"
              size="sm"
              isDisabled={busy}
              onPress={() => {
                void (async () => {
                  // 저장이 거부되면(외부 비충돌화·용량 초과) 초안을 잃지 않게 편집 화면을 유지한다 (품질 리뷰)
                  if (await onSaveText(draft)) setView('cards')
                })()
              }}
              testId="conflict-edit-save"
            >
              <Check size={13} aria-hidden="true" /> 저장하고 선택형으로
            </Button>
            <Button
              variant="ghost"
              size="sm"
              isDisabled={busy}
              onPress={() => setView('cards')}
              testId="conflict-edit-cancel"
            >
              저장 없이 돌아가기
            </Button>
          </div>
          <textarea
            className="conflict-panel__editor"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            aria-label="병합 결과 직접 수정"
            data-testid="conflict-edit-text"
          />
        </>
      )}
      <ConfirmDialog
        isOpen={confirmingMark}
        title={`${T.conflict} 표시가 아직 남아 있어요`}
        confirmLabel="그래도 표시"
        onConfirm={() => {
          setConfirmingMark(false)
          onMarkResolved()
        }}
        onCancel={() => setConfirmingMark(false)}
      >
        파일에 {T.conflict} 표시(&lt;&lt;&lt;&lt;&lt;&lt;&lt;)가 그대로 있어요. 이대로 해결 표시하면 표시
        줄까지 저장돼요. 편집기에서 정리한 뒤 다시 시도하는 것을 권해요.
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={confirmingReset}
        title="처음부터 다시 고를까요?"
        confirmLabel="처음부터 다시"
        onConfirm={() => {
          setConfirmingReset(false)
          onReset()
        }}
        onCancel={() => setConfirmingReset(false)}
      >
        이 파일에서 지금까지 고른 것을 버리고 {T.conflict} 표시(&lt;&lt;&lt;&lt;&lt;&lt;&lt;)를
        되살려요. {T.history}와 다른 파일은 그대로예요.
      </ConfirmDialog>
    </Panel>
  )
}
