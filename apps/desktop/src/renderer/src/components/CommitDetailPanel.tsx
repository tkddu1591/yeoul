import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowLeft } from 'lucide-react'
import { useRef } from 'react'
import type { CommitDetail, CommitFileChange } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { KIND_GLYPHS, KIND_LABELS } from './change-kind'
import { formatRelativeTime } from './relative-time'
import './commit-detail-panel.css'
import './virtual.css'

interface CommitDetailPanelProps {
  detail: CommitDetail
  /** 상세 안에서 선택된 파일 — diff는 좌측 흐름과 동일하게 중앙 패널(공용 diff 슬롯)에 뜬다 */
  selectedFile: CommitFileChange | null
  busy: boolean
  onSelectFile(file: CommitFileChange): void
  onBack(): void
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

/**
 * 커밋 클릭 상세 (#6·3차 피드백) — 우측 열이 타임라인에서 이 패널로 전환된다:
 * 상단 파일 목록(가상), 하단 메시지. 파일을 누르면 diff는 중앙 패널에 뜬다.
 */
export function CommitDetailPanel({
  detail,
  selectedFile,
  busy,
  onSelectFile,
  onBack,
}: CommitDetailPanelProps) {
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
      title="저장 내용"
      accessory={
        <>
          <Badge tone="git">commit</Badge>
          <Badge tone="count">{detail.shortHash}</Badge>
          <Button
            variant="ghost"
            size="sm"
            isDisabled={busy}
            onPress={onBack}
            testId="commit-detail-back"
          >
            <ArrowLeft size={13} aria-hidden="true" /> 목록으로
          </Button>
        </>
      }
      testId="commit-detail-panel"
    >
      <div className="commit-detail__files-head">
        바뀐 파일 <span data-testid="commit-detail-file-count">{detail.files.length}</span>개
        {detail.files.length > 0
          ? ' — 누르면 가운데에 비교를 보여드려요'
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
    </Panel>
  )
}
