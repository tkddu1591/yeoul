import type { FileChange } from '@git-gui/domain'
import type { SelectedFile } from '../store/repository-store'

interface ChangesPanelProps {
  changes: FileChange[]
  selected: SelectedFile | null
  /** 작업 중에는 모든 버튼을 비활성화한다 — 연타로 git 작업이 겹치면 index.lock 충돌이 난다 */
  busy: boolean
  onStage(paths: string[]): void
  onUnstage(paths: string[]): void
  onSelect(selected: SelectedFile): void
}

export function ChangesPanel({ changes, selected, busy, onStage, onUnstage, onSelect }: ChangesPanelProps) {
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
              <button
                type="button"
                className="file"
                disabled={busy}
                onClick={() => onSelect({ change, staged: true })}
              >
                {change.path} <em>{change.staged}</em>
              </button>
              <button type="button" disabled={busy} onClick={() => onUnstage([change.path])}>
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
              <button
                type="button"
                className="file"
                disabled={busy}
                onClick={() => onSelect({ change, staged: false })}
              >
                {change.path} <em>{change.unstaged}</em>
              </button>
              <button type="button" disabled={busy} onClick={() => onStage([change.path])}>
                올리기
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
