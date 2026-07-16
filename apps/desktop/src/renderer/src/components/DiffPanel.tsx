import { Columns2, Rows3, X } from 'lucide-react'
import { useState } from 'react'
import type { DiffLine, FileDiff } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { pairHunkLines } from './diff-split'
import './diff-panel.css'

interface DiffPanelProps {
  path: string | null
  diff: FileDiff | null
  /** in-flight selectFile이 clear를 덮어쓰는 레이스 방지 — busy 중엔 닫기도 잠근다 */
  busy: boolean
  onClose(): void
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

export function DiffPanel({ path, diff, busy, onClose }: DiffPanelProps) {
  const [view, setView] = useState<'unified' | 'split'>('unified')

  if (!path || diff === null) {
    return (
      <Panel title="변경 내용" testId="diff-panel">
        <p className="diff-panel__empty">파일을 선택하면 무엇이 바뀌었는지 보여드려요</p>
      </Panel>
    )
  }
  const hasHunks = diff.hunks.length > 0
  return (
    <Panel
      title={path}
      accessory={
        <>
          <Badge tone="git">diff</Badge>
          {/* 가시 라벨이 접근 이름이 된다 — aria-label로 덮지 않는다 (WCAG 2.5.3) */}
          <Button
            variant="ghost"
            size="sm"
            onPress={() => setView(view === 'unified' ? 'split' : 'unified')}
            testId="diff-view-toggle"
          >
            {view === 'unified' ? (
              <Columns2 size={13} aria-hidden="true" />
            ) : (
              <Rows3 size={13} aria-hidden="true" />
            )}
            {view === 'unified' ? '좌우 보기' : '한 줄 보기'}
          </Button>
          {/* 가시 라벨 "닫기"가 접근 이름이 된다 — aria-label로 덮지 않는다 (WCAG 2.5.3) */}
          <Button variant="ghost" size="sm" isDisabled={busy} onPress={onClose} testId="diff-close">
            <X size={13} aria-hidden="true" /> 닫기
          </Button>
        </>
      }
      testId="diff-panel"
    >
      {diff.isBinary ? (
        <p className="diff-panel__empty">텍스트가 아닌 파일이라 내용 비교를 보여드릴 수 없어요</p>
      ) : !hasHunks && diff.meta.length > 0 ? (
        // 내용 변경 없는 메타 변경(권한 모드 등) — 원문을 그대로 보여준다 (정보 손실 방지)
        <div className="diff-panel__code">
          {diff.meta.map((line, index) => (
            <div key={index} className="diff-line diff-line--note">
              <span className="diff-line__text">{line}</span>
            </div>
          ))}
        </div>
      ) : !hasHunks ? (
        <p className="diff-panel__empty">변경 내용이 없어요</p>
      ) : (
        <div className="diff-panel__code" data-testid={`diff-view-${view}`}>
          {diff.hunks.map((hunk, hunkIndex) => (
            <div key={hunkIndex} className="diff-hunk">
              <div className="diff-line diff-line--hunk">{hunk.header}</div>
              {view === 'unified'
                ? hunk.lines.map((line, lineIndex) => <UnifiedLine key={lineIndex} line={line} />)
                : pairHunkLines(hunk.lines).map((row, rowIndex) => (
                    <div key={rowIndex} className="diff-split-row">
                      <SplitCell line={row.left} side="left" />
                      <SplitCell
                        line={row.right}
                        side="right"
                        duplicate={row.right !== null && row.left === row.right}
                      />
                    </div>
                  ))}
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
