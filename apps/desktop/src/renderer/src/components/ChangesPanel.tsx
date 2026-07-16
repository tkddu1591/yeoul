import { CircleMinus, CirclePlus } from 'lucide-react'
import type { ChangeKind, FileChange } from '@git-gui/domain'
import type { SelectedFile } from '../store/repository-store'
import { Badge } from '../ui/Badge'
import { Panel } from '../ui/Panel'
import './changes-panel.css'

interface ChangesPanelProps {
  changes: FileChange[]
  selected: SelectedFile | null
  /** 작업 중에는 모든 버튼을 비활성화한다 — 연타로 git 작업이 겹치면 index.lock 충돌이 난다 */
  busy: boolean
  onStage(paths: string[]): void
  onUnstage(paths: string[]): void
  onSelect(selected: SelectedFile): void
}

/** 변경 종류의 한국어 라벨 — 색 단독으로 의미를 전달하지 않기 위해 tooltip/aria에 병행한다 */
const KIND_LABELS: Record<ChangeKind, string> = {
  modified: '수정됨',
  added: '추가됨',
  deleted: '삭제됨',
  renamed: '이름 변경',
  copied: '복사됨',
  typechange: '형식 변경',
  untracked: '새 파일',
  conflicted: '충돌',
}

interface FileRowProps {
  change: FileChange
  staged: boolean
  isSelected: boolean
  busy: boolean
  onSelect(): void
  onAction(): void
}

/** 색과 함께 쓰는 형태 신호 — 색약(적록)에서 modified/added 색이 수렴해도 글자로 구분된다 */
const KIND_GLYPHS: Record<ChangeKind, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
  untracked: 'U',
  conflicted: '!',
}

function FileRow({ change, staged, isSelected, busy, onSelect, onAction }: FileRowProps) {
  const kind = staged ? change.staged : change.unstaged
  const actionLabel = staged ? '내리기' : '올리기'
  const kindLabel = kind ? KIND_LABELS[kind] : ''
  // 이름 변경은 "무엇이었는지"가 핵심 정보 — 원래 경로를 툴팁에 병기한다
  const tooltip =
    kind === 'renamed' && change.origPath !== null
      ? `${change.origPath} → ${change.path} — ${kindLabel}`
      : `${change.path} — ${kindLabel}`
  // 좁은 열에서 파일명이 먼저 잘리지 않도록 디렉터리와 파일명을 분리해 디렉터리부터 축소한다
  const slashIndex = change.path.lastIndexOf('/')
  const directory = slashIndex >= 0 ? change.path.slice(0, slashIndex + 1) : ''
  const basename = slashIndex >= 0 ? change.path.slice(slashIndex + 1) : change.path
  return (
    <li className={`file-row${isSelected ? ' file-row--selected' : ''}`}>
      <button
        type="button"
        className={`file-row__main file-row__main--${kind ?? 'none'}`}
        disabled={busy}
        onClick={onSelect}
        title={tooltip}
        aria-label={tooltip}
        data-testid={`file-${staged ? 'staged' : 'unstaged'}-${change.path}`}
      >
        <span className="file-row__kind" aria-hidden="true">
          {kind ? KIND_GLYPHS[kind] : ''}
        </span>
        <span className="file-row__name">
          {directory && <span className="file-row__dir">{directory}</span>}
          <span className="file-row__base">{basename}</span>
        </span>
      </button>
      <button
        type="button"
        className="file-row__action"
        disabled={busy}
        onClick={onAction}
        aria-label={`${change.path} ${actionLabel}`}
        data-testid={`${staged ? 'unstage' : 'stage'}-${change.path}`}
      >
        {staged ? (
          <CircleMinus size={14} aria-hidden="true" />
        ) : (
          <CirclePlus size={14} aria-hidden="true" />
        )}
        {actionLabel}
      </button>
    </li>
  )
}

export function ChangesPanel({
  changes,
  selected,
  busy,
  onStage,
  onUnstage,
  onSelect,
}: ChangesPanelProps) {
  const stagedChanges = changes.filter((c) => c.staged !== null)
  const unstagedChanges = changes.filter((c) => c.unstaged !== null)

  return (
    <div className="changes-panel">
      <Panel
        title="지금 바뀐 것"
        accessory={
          <>
            <Badge tone="git">unstaged</Badge>
            <Badge tone="count">
              <span data-testid="unstaged-count">{unstagedChanges.length}</span>
            </Badge>
          </>
        }
      >
        {unstagedChanges.length === 0 ? (
          <p className="changes-panel__empty">바뀐 파일이 없어요</p>
        ) : (
          <ul className="changes-panel__list">
            {unstagedChanges.map((change) => (
              <FileRow
                key={`unstaged-${change.path}`}
                change={change}
                staged={false}
                isSelected={
                  selected !== null && !selected.staged && selected.change.path === change.path
                }
                busy={busy}
                onSelect={() => onSelect({ change, staged: false })}
                onAction={() => onStage([change.path])}
              />
            ))}
          </ul>
        )}
      </Panel>
      <Panel
        title="저장 예정"
        accessory={
          <>
            <Badge tone="git">staged</Badge>
            <Badge tone="count">
              <span data-testid="staged-count">{stagedChanges.length}</span>
            </Badge>
          </>
        }
      >
        {stagedChanges.length === 0 ? (
          <p className="changes-panel__empty">파일을 올리면 여기에 모여요</p>
        ) : (
          <ul className="changes-panel__list">
            {stagedChanges.map((change) => (
              <FileRow
                key={`staged-${change.path}`}
                change={change}
                staged
                isSelected={
                  selected !== null && selected.staged && selected.change.path === change.path
                }
                busy={busy}
                onSelect={() => onSelect({ change, staged: true })}
                onAction={() => onUnstage([change.path])}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
