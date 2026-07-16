import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'
import type { DiffLine, FileDiff } from '@git-gui/domain'
import { buildDiffRows } from './diff-rows'
import './diff-panel.css'

interface DiffViewProps {
  diff: FileDiff
  view: 'unified' | 'split'
}

function UnifiedLine({ line }: { line: DiffLine }) {
  return (
    <div className={`diff-line diff-line--${line.kind}`}>
      <span className="diff-line__no" aria-hidden="true">
        {line.oldLine ?? ''}
      </span>
      <span className="diff-line__no" aria-hidden="true">
        {line.newLine ?? ''}
      </span>
      <span className="diff-line__text">{line.text || ' '}</span>
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
export function DiffView({ diff, view }: DiffViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const rows = buildDiffRows(diff.hunks, view)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 21,
    overscan: 20,
  })

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
    return <p className="diff-panel__empty">변경 내용이 없어요</p>
  }
  return (
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
              className="virtual-row"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {row.kind === 'hunk' ? (
                <div className="diff-line diff-line--hunk">{row.header}</div>
              ) : row.kind === 'line' ? (
                <UnifiedLine line={row.line} />
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
  )
}
