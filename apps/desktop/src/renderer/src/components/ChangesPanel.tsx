import type { FileChange } from '@git-gui/domain'
import type { SelectedFile } from '../store/repository-store'

interface ChangesPanelProps {
  changes: FileChange[]
  selected: SelectedFile | null
  onStage(paths: string[]): void
  onUnstage(paths: string[]): void
  onSelect(selected: SelectedFile): void
}

export function ChangesPanel({ changes, selected, onStage, onUnstage, onSelect }: ChangesPanelProps) {
  const stagedChanges = changes.filter((c) => c.staged !== null)
  const unstagedChanges = changes.filter((c) => c.unstaged !== null)

  return (
    <div className="changes-panel">
      <section>
        <h2>저장 예정 (staged) — {stagedChanges.length}</h2>
        <ul>
          {stagedChanges.map((change) => (
            <li
              key={`staged-${change.path}`}
              className={selected?.staged && selected.change.path === change.path ? 'selected' : ''}
            >
              <button type="button" className="file" onClick={() => onSelect({ change, staged: true })}>
                {change.path} <em>{change.staged}</em>
              </button>
              <button type="button" onClick={() => onUnstage([change.path])}>
                내리기
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>작업 중 (unstaged) — {unstagedChanges.length}</h2>
        <ul>
          {unstagedChanges.map((change) => (
            <li
              key={`unstaged-${change.path}`}
              className={selected && !selected.staged && selected.change.path === change.path ? 'selected' : ''}
            >
              <button type="button" className="file" onClick={() => onSelect({ change, staged: false })}>
                {change.path} <em>{change.unstaged}</em>
              </button>
              <button type="button" onClick={() => onStage([change.path])}>
                올리기
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
