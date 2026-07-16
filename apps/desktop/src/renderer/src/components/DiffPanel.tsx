import { X } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { classifyLines } from './diff-lines'
import './diff-panel.css'

interface DiffPanelProps {
  path: string | null
  diffText: string
  onClose(): void
}

export function DiffPanel({ path, diffText, onClose }: DiffPanelProps) {
  if (!path) {
    return (
      <Panel title="변경 내용" testId="diff-panel">
        <p className="diff-panel__empty">파일을 선택하면 무엇이 바뀌었는지 보여드려요</p>
      </Panel>
    )
  }
  const lines = diffText.length > 0 ? diffText.split('\n') : []
  const tones = classifyLines(lines)
  return (
    <Panel
      title={path}
      accessory={
        <>
          <Badge tone="git">diff</Badge>
          {/* 가시 라벨 "닫기"가 접근 이름이 된다 — aria-label로 덮지 않는다 (WCAG 2.5.3) */}
          <Button variant="ghost" size="sm" onPress={onClose} testId="diff-close">
            <X size={13} aria-hidden="true" /> 닫기
          </Button>
        </>
      }
      testId="diff-panel"
    >
      {lines.length === 0 ? (
        <p className="diff-panel__empty">변경 내용이 없어요</p>
      ) : (
        <pre className="diff-panel__code">
          {lines.map((line, index) => (
            <span key={index} className={`diff-line diff-line--${tones[index]}`}>
              {line || ' '}
            </span>
          ))}
        </pre>
      )}
    </Panel>
  )
}
