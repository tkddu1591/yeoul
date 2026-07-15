import { Badge } from '../ui/Badge'
import { Panel } from '../ui/Panel'
import './diff-panel.css'

interface DiffPanelProps {
  path: string | null
  diffText: string
}

type LineTone = 'add' | 'del' | 'hunk' | 'meta' | 'context'

/** 표시용 라인 분류 — hunk 구조 해석(diff 모델)은 1단계에서 adapter가 맡는다 */
function lineTone(line: string): LineTone {
  if (
    line.startsWith('+++') ||
    line.startsWith('---') ||
    line.startsWith('diff ') ||
    line.startsWith('index ') ||
    line.startsWith('new file') ||
    line.startsWith('deleted file')
  ) {
    return 'meta'
  }
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'context'
}

export function DiffPanel({ path, diffText }: DiffPanelProps) {
  if (!path) {
    return (
      <Panel title="변경 내용" testId="diff-panel">
        <p className="diff-panel__empty">파일을 선택하면 무엇이 바뀌었는지 보여드려요</p>
      </Panel>
    )
  }
  const lines = diffText.length > 0 ? diffText.split('\n') : []
  return (
    <Panel title={path} accessory={<Badge tone="git">diff</Badge>} testId="diff-panel">
      {lines.length === 0 ? (
        <p className="diff-panel__empty">변경 내용이 없어요</p>
      ) : (
        <pre className="diff-panel__code">
          {lines.map((line, index) => (
            <span key={index} className={`diff-line diff-line--${lineTone(line)}`}>
              {line || ' '}
            </span>
          ))}
        </pre>
      )}
    </Panel>
  )
}
