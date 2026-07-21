import { useVirtualizer } from '@tanstack/react-virtual'
import { X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { CommitDetail, CommitFileChange } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { ContextMenu } from '../ui/ContextMenu'
import { Panel } from '../ui/Panel'
import { KIND_GLYPHS, KIND_LABELS } from './change-kind'
import { formatRelativeTime } from './relative-time'
import './commit-detail-panel.css'
import './virtual.css'

interface CommitDetailPanelProps {
  detail: CommitDetail
  /** 보관함 미리보기로 열렸는가 — 제목·문구를 보관함 맥락으로 분기한다 (품질 리뷰) */
  shelfPreview: boolean
  /** 상세 안에서 선택된 파일 — diff는 좌측 흐름과 동일하게 중앙 패널(공용 diff 슬롯)에 뜬다 */
  selectedFile: CommitFileChange | null
  busy: boolean
  onSelectFile(file: CommitFileChange): void
  /** 우클릭 → "이 파일만 … 적용 (checkout)" — 확인창을 거친 뒤 호출된다 (E5a 피드백 1) */
  onRestoreFile(file: CommitFileChange): void
  /** 우클릭 → "지금 코드와 비교 (diff)" — 그 시점과 미저장 워크트리의 비교 (E5a 피드백 6) */
  onCompareFile(file: CommitFileChange): void
  onBack(): void
}

function CommitFileRow({
  file,
  isSelected,
  busy,
  onSelect,
  onMenu,
}: {
  file: CommitFileChange
  isSelected: boolean
  busy: boolean
  onSelect(): void
  onMenu(x: number, y: number): void
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
      onContextMenu={(event) => {
        event.preventDefault()
        onMenu(event.clientX, event.clientY)
      }}
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
 * 커밋 클릭 상세 (#6·3차 피드백 → E6a 하단 슬롯) — 트리 아래 45% 슬롯에 열린다(트리는 계속 보인다):
 * 상단 파일 목록(가상), 하단 메시지. 파일을 누르면 diff는 중앙 패널에 뜬다.
 * 파일 행 우클릭 — 이 파일만 적용(checkout)·지금 코드와 비교(diff) (E5a).
 * 보관함 미리보기도 이 패널을 재사용하므로 같은 메뉴가 생긴다 — 적용 라벨만 분기.
 */
export function CommitDetailPanel({
  detail,
  shelfPreview,
  selectedFile,
  busy,
  onSelectFile,
  onRestoreFile,
  onCompareFile,
  onBack,
}: CommitDetailPanelProps) {
  // 우클릭 메뉴·확인창 상태는 패널이 관리한다 (HistoryPanel·다이얼로그 관례)
  const [menu, setMenu] = useState<{ x: number; y: number; file: CommitFileChange } | null>(null)
  const [confirmingRestore, setConfirmingRestore] = useState<CommitFileChange | null>(null)
  // 대형 커밋(수천 파일)에서도 파일 목록은 가시 범위만 렌더한다 (#4)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: detail.files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 31,
    overscan: 10,
  })

  const runRestore = () => {
    const file = confirmingRestore
    setConfirmingRestore(null)
    if (file !== null) onRestoreFile(file)
  }

  return (
    <Panel
      title={shelfPreview ? '보관 내용' : '저장 내용'}
      accessory={
        <>
          {/* 해시 배지는 좁은 우측 열에서 잘려 겹친다(실측) — 해시는 아래 메시지 meta로 */}
          <Badge tone="git">{shelfPreview ? 'stash' : 'commit'}</Badge>
          <Button
            variant="ghost"
            size="sm"
            isDisabled={busy}
            onPress={onBack}
            testId="commit-detail-back"
          >
            <X size={13} aria-hidden="true" /> 닫기
          </Button>
        </>
      }
      testId="commit-detail-panel"
    >
      <div className="commit-detail__files-head">
        바뀐 파일 <span data-testid="commit-detail-file-count">{detail.files.length}</span>개
        {detail.files.length > 0
          ? shelfPreview
            ? ' — 누르면 가운데에 비교를 보여드려요. 새로 만든 파일은 이 목록에 안 보여요 — 꺼내면 함께 돌아와요'
            : ' — 누르면 가운데에 비교를 보여드려요'
          : shelfPreview
            ? ' — 새로 만든 파일만 담긴 보관이에요. 여기 목록에는 안 보이지만, 꺼내면 그대로 돌아와요'
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
                  onMenu={(x, y) => setMenu({ x, y, file })}
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
          {detail.shortHash} · {formatRelativeTime(detail.committedAt, Date.now())} ·{' '}
          {detail.authorName}
          {!shelfPreview &&
            detail.parents.length >= 2 &&
            ' · 병합된 저장 — 파일 목록은 합쳐지기 전 원래 줄기 기준이에요'}
        </p>
      </div>
      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            {
              key: 'restore-file',
              label: shelfPreview
                ? '이 파일만 꺼내 적용 (checkout)'
                : '이 파일만 지금 코드에 적용 (checkout)',
              onSelect: () => setConfirmingRestore(menu.file),
            },
            {
              key: 'compare-worktree',
              label: '지금 코드와 비교 (diff)',
              onSelect: () => onCompareFile(menu.file),
            },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      <ConfirmDialog
        isOpen={confirmingRestore !== null}
        title={shelfPreview ? '이 파일만 꺼내 적용할까요?' : '이 파일만 이 시점 내용으로 적용할까요?'}
        confirmLabel="적용"
        onConfirm={runRestore}
        onCancel={() => setConfirmingRestore(null)}
      >
        지금 파일이 이 시점 내용으로 바뀌어요. 미저장 변경은 보관함에 넣어 드려요.
      </ConfirmDialog>
    </Panel>
  )
}
