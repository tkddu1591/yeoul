interface DiffPanelProps {
  path: string | null
  diffText: string
}

export function DiffPanel({ path, diffText }: DiffPanelProps) {
  if (!path) return <div className="diff-panel empty">파일을 선택하면 변경 내용이 보여요</div>
  return (
    <div className="diff-panel">
      <h2>{path}</h2>
      <pre>{diffText || '변경 내용이 없어요'}</pre>
    </div>
  )
}
