import { X } from 'lucide-react'
import type { FileDiff } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import './diff-panel.css'

interface DiffPanelProps {
  path: string | null
  diff: FileDiff | null
  /** in-flight selectFile이 clear를 덮어쓰는 레이스 방지 — busy 중엔 닫기도 잠근다 */
  busy: boolean
  onClose(): void
}

export function DiffPanel({ path, diff, busy, onClose }: DiffPanelProps) {
  if (!path || diff === null) {
    return (
      <Panel title="변경 내용" testId="diff-panel">
        <p className="diff-panel__empty">파일을 선택하면 무엇이 바뀌었는지 보여드려요</p>
      </Panel>
    )
  }
  const isEmpty = diff.hunks.length === 0 && !diff.isBinary
  return (
    <Panel
      title={path}
      accessory={
        <>
          <Badge tone="git">diff</Badge>
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
      ) : isEmpty ? (
        <p className="diff-panel__empty">변경 내용이 없어요</p>
      ) : (
        <div className="diff-panel__code">
          {diff.hunks.map((hunk, hunkIndex) => (
            <div key={hunkIndex} className="diff-hunk">
              <div className="diff-line diff-line--hunk">{hunk.header}</div>
              {hunk.lines.map((line, lineIndex) => (
                <div key={lineIndex} className={`diff-line diff-line--${line.kind}`}>
                  <span className="diff-line__no" aria-hidden="true">
                    {line.oldLine ?? ''}
                  </span>
                  <span className="diff-line__no" aria-hidden="true">
                    {line.newLine ?? ''}
                  </span>
                  <span className="diff-line__text">{line.text || ' '}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
