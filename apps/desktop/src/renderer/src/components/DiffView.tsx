import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef, useState } from 'react'
import type { DiffHunk, DiffLine, FileDiff } from '@git-gui/domain'
import { buildDiffRows, type DiffRow } from './diff-rows'
import { FindBar } from './FindBar'
import { cycleIndex, matchIndices } from './find-matches'
import { T } from '../terms'
import './diff-panel.css'
import './virtual.css'

interface DiffViewProps {
  diff: FileDiff
  view: 'unified' | 'split'
  /** ⌘F로 diff 패널이 검색 대상으로 잡혔는가 (E7h ⑥) */
  findOpen: boolean
  /** 재⌘F마다 증가 — 같은 스코프 재검색 시 입력 재포커스 신호 (E7h ⑥ 보완) */
  findNonce: number
  onFindClose(): void
  hunkMode: 'stage' | 'unstage' | null
  onHunkAction(hunk: DiffHunk): void
  onLineAction(hunk: DiffHunk, lineIndex: number): void
}

/** 행 하나의 검색 대상 텍스트 — split은 좌우를 이어붙인다(가상 행 하나가 화면 한 줄이라 좌우 모두 검색된다) */
function rowText(row: DiffRow): string {
  if (row.kind === 'hunk') return row.hunk.header
  if (row.kind === 'line') return row.line.text
  return `${row.left?.text ?? ''} ${row.right?.text ?? ''}`
}

function UnifiedLine({
  line,
  actionLabel,
  onAction,
}: {
  line: DiffLine
  actionLabel: string | null
  onAction(): void
}) {
  return (
    <div className={`diff-line diff-line--${line.kind}`}>
      <span className="diff-line__no" aria-hidden="true">
        {line.oldLine ?? ''}
      </span>
      <span className="diff-line__no" aria-hidden="true">
        {line.newLine ?? ''}
      </span>
      <span className="diff-line__text">{line.text || ' '}</span>
      {actionLabel !== null && (
        <button type="button" className="diff-line__action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  )
}

function SplitCell({
  line,
  side,
  duplicate = false,
}: {
  line: DiffLine | null
  side: 'left' | 'right'
  /** 좌우에 같은 라인이 놓인 사본(context 등) — 오른쪽 사본은 스크린리더 중복 낭독을 막는다 */
  duplicate?: boolean
}) {
  if (line === null) {
    return <div className="diff-cell diff-cell--empty" aria-hidden="true" />
  }
  const lineNo = side === 'left' ? line.oldLine : line.newLine
  return (
    <div className={`diff-cell diff-line--${line.kind}`} aria-hidden={duplicate ? true : undefined}>
      <span className="diff-line__no" aria-hidden="true">
        {lineNo ?? ''}
      </span>
      <span className="diff-line__text">{line.text || ' '}</span>
    </div>
  )
}

/**
 * 구조화된 diff의 본문 렌더 — DiffPanel(작업 diff)과 CommitDetailPanel(커밋 diff)이 공유한다.
 * 행을 평탄화해 가상화한다 (#4) — 수십만 줄 diff에서도 DOM은 가시 범위만 유지된다.
 */
export function DiffView({
  diff,
  view,
  findOpen,
  findNonce,
  onFindClose,
  hunkMode,
  onHunkAction,
  onLineAction,
}: DiffViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const rows = buildDiffRows(diff.hunks, view)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 21,
    overscan: 20,
  })

  // E7h ⑥ — ⌘F 점프 검색. 이른 반환(바이너리·메타 전용·빈 diff)보다 앞(Rules of Hooks — E7d 교훈)
  const [findQuery, setFindQuery] = useState('')
  const [findPos, setFindPos] = useState(0)
  const findHits = findOpen ? matchIndices(rows.map(rowText), findQuery) : []
  const currentHit = findHits.length === 0 ? -1 : findHits[Math.min(findPos, findHits.length - 1)]!
  const moveFind = (delta: number) => {
    if (findHits.length === 0) return
    const nextPos = cycleIndex(Math.min(findPos, findHits.length - 1), delta, findHits.length)
    setFindPos(nextPos)
    virtualizer.scrollToIndex(findHits[nextPos]!, { align: 'center' })
  }

  if (diff.isBinary) {
    return <p className="diff-panel__empty">텍스트가 아닌 파일이라 내용 비교를 보여드릴 수 없어요</p>
  }
  if (diff.hunks.length === 0 && diff.meta.length > 0) {
    // 내용 변경 없는 메타 변경(권한 모드·rename 등) — 원문을 그대로 보여준다 (정보 손실 방지)
    return (
      <div className="diff-panel__code">
        {diff.meta.map((line, index) => (
          <div key={index} className="diff-line diff-line--note">
            <span className="diff-line__text">{line}</span>
          </div>
        ))}
      </div>
    )
  }
  if (diff.hunks.length === 0) {
    return <p className="diff-panel__empty">{T.diff}가 없어요</p>
  }
  return (
    <>
      {findOpen && (
        <FindBar
          query={findQuery}
          position={findHits.length === 0 ? -1 : Math.min(findPos, findHits.length - 1)}
          count={findHits.length}
          focusSignal={findNonce}
          placeholder="diff에서 찾기"
          onQuery={(q) => {
            setFindQuery(q)
            setFindPos(0)
            const hits = matchIndices(rows.map(rowText), q)
            if (hits.length > 0) virtualizer.scrollToIndex(hits[0]!, { align: 'center' })
          }}
          onNext={() => moveFind(1)}
          onPrev={() => moveFind(-1)}
          onClose={() => {
            setFindQuery('')
            onFindClose()
          }}
        />
      )}
      <div ref={scrollRef} className="virtual-scroll" data-testid={`diff-view-${view}`}>
        <div
          className="diff-panel__code"
          style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]!
            return (
              <div
                key={item.index}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className={`virtual-row${item.index === currentHit ? ' diff-row--find-hit' : ''}`}
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {row.kind === 'hunk' ? (
                  <div className="diff-line diff-line--hunk">
                    <span>{row.hunk.header}</span>
                    {hunkMode !== null && (
                      <button
                        type="button"
                        className="diff-hunk__action"
                        onClick={() => onHunkAction(row.hunk)}
                        data-testid={`diff-hunk-${hunkMode}`}
                      >
                        {hunkMode === 'stage' ? '이 hunk 올리기' : '이 hunk 내리기'}
                      </button>
                    )}
                  </div>
                ) : row.kind === 'line' ? (
                  <UnifiedLine
                    line={row.line}
                    actionLabel={
                      hunkMode !== null && (row.line.kind === 'add' || row.line.kind === 'del')
                        ? hunkMode === 'stage'
                          ? '이 줄 올리기'
                          : '이 줄 내리기'
                        : null
                    }
                    onAction={() => onLineAction(row.hunk, row.lineIndex)}
                  />
                ) : (
                  <div className="diff-split-row">
                    <SplitCell line={row.left} side="left" />
                    <SplitCell
                      line={row.right}
                      side="right"
                      duplicate={row.right !== null && row.left === row.right}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
