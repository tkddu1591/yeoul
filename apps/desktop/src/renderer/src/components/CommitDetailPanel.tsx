import { useVirtualizer } from '@tanstack/react-virtual'
import { Columns2, Rows3, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { CommitDetail, CommitFileChange, FileDiff } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { KIND_GLYPHS, KIND_LABELS } from './change-kind'
import { DiffView } from './DiffView'
import { formatRelativeTime } from './relative-time'
import './commit-detail-panel.css'
import './virtual.css'

interface CommitDetailPanelProps {
  detail: CommitDetail
  /** 상세 안에서 선택된 파일과 그 diff — 공용 diff 슬롯 */
  selectedFile: CommitFileChange | null
  diff: FileDiff | null
  busy: boolean
  onSelectFile(file: CommitFileChange): void
  onClose(): void
}

function CommitFileRow({
  file,
  isSelected,
  busy,
  onSelect,
}: {
  file: CommitFileChange
  isSelected: boolean
  busy: boolean
  onSelect(): void
}) {
  const kindLabel = KIND_LABELS[file.kind]
  const tooltip =
    file.kind === 'renamed' && file.origPath !== null
      ? `${file.origPath} → ${file.path} — ${kindLabel}`
      : `${file.path} — ${kindLabel}`
  const slashIndex = file.path.lastIndexOf('/')
  const directory = slashIndex >= 0 ? file.path.slice(0, slashIndex) : ''
  const basename = slashIndex >= 0 ? file.path.slice(slashIndex + 1) : file.path
  return (
    <button
      type="button"
      className={`file-row__main file-row__main--${file.kind} commit-file-row${
        isSelected ? ' commit-file-row--selected' : ''
      }`}
      disabled={busy}
      onClick={onSelect}
      title={tooltip}
      aria-label={tooltip}
      data-testid={`commit-file-${file.path}`}
    >
      <span className="file-row__kind" aria-hidden="true">
        {KIND_GLYPHS[file.kind]}
      </span>
      <span className="file-row__name">
        <span className="file-row__base">{basename}</span>
        {directory && <span className="file-row__dir">{directory}</span>}
      </span>
    </button>
  )
}

/** 커밋 클릭 상세 (#6) — 전체 메시지·변경 파일 목록·파일별 diff(첫 부모 기준) */
export function CommitDetailPanel({
  detail,
  selectedFile,
  diff,
  busy,
  onSelectFile,
  onClose,
}: CommitDetailPanelProps) {
  const [view, setView] = useState<'unified' | 'split'>('unified')
  // 대형 커밋(수천 파일)에서도 파일 목록은 가시 범위만 렌더한다 (#4)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: detail.files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 31,
    overscan: 10,
  })

  return (
    <Panel
      title={detail.subject}
      accessory={
        <>
          <Badge tone="git">commit</Badge>
          <Badge tone="count">{detail.shortHash}</Badge>
          {selectedFile !== null && (
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
          )}
          <Button
            variant="ghost"
            size="sm"
            isDisabled={busy}
            onPress={onClose}
            testId="commit-detail-close"
          >
            <X size={13} aria-hidden="true" /> 닫기
          </Button>
        </>
      }
      testId="commit-detail-panel"
    >
      <div className="commit-detail__message">
        <p className="commit-detail__subject" data-testid="commit-detail-subject">
          {detail.subject}
        </p>
        {detail.body !== '' && (
          <pre className="commit-detail__body" data-testid="commit-detail-body">
            {detail.body}
          </pre>
        )}
        <p className="commit-detail__meta">
          {formatRelativeTime(detail.committedAt, Date.now())} · {detail.authorName}
          {detail.parents.length >= 2 &&
            ' · 병합된 저장 — 파일 목록은 합쳐지기 전 원래 줄기 기준이에요'}
        </p>
      </div>
      <div className="commit-detail__files-head">
        바뀐 파일 <span data-testid="commit-detail-file-count">{detail.files.length}</span>개
        {detail.files.length > 0
          ? ' — 파일을 누르면 무엇이 바뀌었는지 보여드려요'
          : ' — 메시지만 남긴 저장이에요'}
      </div>
      <div ref={scrollRef} className="virtual-scroll commit-detail__files">
        <ul
          className="changes-panel__list"
          style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const file = detail.files[item.index]!
            return (
              <li
                key={file.path}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="virtual-row"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <CommitFileRow
                  file={file}
                  isSelected={selectedFile?.path === file.path}
                  busy={busy}
                  onSelect={() => onSelectFile(file)}
                />
              </li>
            )
          })}
        </ul>
      </div>
      {selectedFile !== null && diff !== null && (
        <div className="commit-detail__diff">
          {/* key — 파일 전환 시 스크롤 위치와 가상 측정 캐시를 리셋한다 */}
          <DiffView key={selectedFile.path} diff={diff} view={view} />
        </div>
      )}
    </Panel>
  )
}
