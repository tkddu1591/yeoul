import { useVirtualizer } from '@tanstack/react-virtual'
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { CommitDetail, CommitFileChange } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { ContextMenu } from '../ui/ContextMenu'
import { Panel } from '../ui/Panel'
import { Tooltip } from '../ui/Tooltip'
import { KIND_GLYPHS, KIND_LABELS } from './change-kind'
import { buildFileTree, flattenFileTree } from './file-tree'
import { FindBar } from './FindBar'
import { formatRelativeTime } from './relative-time'
import { T } from '../terms'
import './commit-detail-panel.css'
import './virtual.css'

interface CommitDetailPanelProps {
  detail: CommitDetail
  /** 보관함 미리보기로 열렸는가 — 제목·문구를 보관함 맥락으로 분기한다 (품질 리뷰) */
  shelfPreview: boolean
  /** 상세 안에서 선택된 파일 — diff는 좌측 흐름과 동일하게 중앙 패널(공용 diff 슬롯)에 뜬다 */
  selectedFile: CommitFileChange | null
  busy: boolean
  /** ⌘F로 이 패널이 검색 대상으로 잡혔는가 (E7h ⑥) */
  findOpen: boolean
  /** 재⌘F마다 증가 — 같은 스코프 재검색 시 입력 재포커스 신호 (E7h ⑥ 보완) */
  findNonce: number
  onFindClose(): void
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
  showDir,
  onSelect,
  onMenu,
}: {
  file: CommitFileChange
  isSelected: boolean
  busy: boolean
  /** 경로 흐림 표기 — 트리 모드는 폴더 행이 이미 경로를 보여주므로 false, 평면 모드(Task 8)는 true */
  showDir: boolean
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
    <Tooltip content={tooltip} summary={tooltip} describedBy={false}>
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
        aria-label={tooltip}
        data-testid={`commit-file-${file.path}`}
      >
        <span className="file-row__kind" aria-hidden="true">
          {KIND_GLYPHS[file.kind]}
        </span>
        <span className="file-row__name">
          <span className="file-row__base">{basename}</span>
          {showDir && directory && <span className="file-row__dir">{directory}</span>}
        </span>
      </button>
    </Tooltip>
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
  findOpen,
  findNonce,
  onFindClose,
  onSelectFile,
  onRestoreFile,
  onCompareFile,
  onBack,
}: CommitDetailPanelProps) {
  // 우클릭 메뉴·확인창 상태는 패널이 관리한다 (HistoryPanel·다이얼로그 관례)
  const [menu, setMenu] = useState<{ x: number; y: number; file: CommitFileChange } | null>(null)
  const [confirmingRestore, setConfirmingRestore] = useState<CommitFileChange | null>(null)
  // E7h ② — 파일 목록 depth 트리. 접기 상태는 로컬(커밋 전환 시 리셋 — 아래 effect)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  // E7h ⑥ — ⌘F 필터. 검색어가 있는 동안은 트리 대신 평면 매치 목록으로 바뀐다(findOpen이
  // 닫히거나 검색어를 비우면 collapsed는 건드리지 않았으므로 트리 상태가 그대로 돌아온다)
  const [findQuery, setFindQuery] = useState('')
  const filterActive = findOpen && findQuery !== ''
  const matched = filterActive
    ? detail.files.filter((file) => file.path.toLowerCase().includes(findQuery.toLowerCase()))
    : null
  const rows =
    matched !== null
      ? matched.map((item) => ({ kind: 'file' as const, item, depth: 0 }))
      : flattenFileTree(buildFileTree(detail.files), collapsed)
  // 대형 커밋(수천 파일)에서도 파일 목록은 가시 범위만 렌더한다 (#4)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 31,
    overscan: 10,
  })

  // E7h ② — 커밋 전환 시 접기 리셋. 이른 반환보다 앞(Rules of Hooks — E7d 교훈)
  useEffect(() => {
    setCollapsed(new Set())
  }, [detail.hash])

  const runRestore = () => {
    const file = confirmingRestore
    setConfirmingRestore(null)
    if (file !== null) onRestoreFile(file)
  }

  return (
    <Panel
      title={shelfPreview ? `${T.stash} 내용` : `${T.commit} 내용`}
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
      {findOpen && (
        <FindBar
          query={findQuery}
          position={matched === null || matched.length === 0 ? -1 : 0}
          count={matched?.length ?? 0}
          mode="filter"
          focusSignal={findNonce}
          placeholder="파일 이름 찾기"
          onQuery={setFindQuery}
          onNext={() => {}}
          onPrev={() => {}}
          onClose={() => {
            setFindQuery('')
            onFindClose()
          }}
        />
      )}
      <div className="commit-detail__files-head">
        바뀐 파일 <span data-testid="commit-detail-file-count">{detail.files.length}</span>개
        {detail.files.length > 0
          ? shelfPreview
            ? ' — 누르면 가운데에 비교를 보여드려요. 새로 만든 파일은 이 목록에 안 보여요 — 꺼내면 함께 돌아와요'
            : ' — 누르면 가운데에 비교를 보여드려요'
          : shelfPreview
            ? ` — 새로 만든 파일만 담긴 ${T.stash}예요. 여기 목록에는 안 보이지만, 꺼내면 그대로 돌아와요`
            : ` — 메시지만 남긴 ${T.commit}이에요`}
      </div>
      <div ref={scrollRef} className="virtual-scroll commit-detail__files">
        <ul
          className="changes-panel__list"
          style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]!
            return (
              <li
                key={row.kind === 'folder' ? `d:${row.path}` : row.item.path}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="virtual-row"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {row.kind === 'folder' ? (
                  <button
                    type="button"
                    className="commit-file-folder"
                    style={{ paddingLeft: `${8 + row.depth * 14}px` }}
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev)
                        if (next.has(row.path)) next.delete(row.path)
                        else next.add(row.path)
                        return next
                      })
                    }
                    aria-expanded={!collapsed.has(row.path)}
                    data-testid={`commit-folder-${row.path}`}
                  >
                    <span className="commit-file-folder__chev" aria-hidden="true">
                      {collapsed.has(row.path) ? '▸' : '▾'}
                    </span>
                    <span className="commit-file-folder__name">{row.name}</span>
                    <span className="commit-file-folder__count">{row.count}</span>
                  </button>
                ) : (
                  <div style={{ paddingLeft: `${row.depth * 14}px` }}>
                    <CommitFileRow
                      file={row.item}
                      isSelected={selectedFile?.path === row.item.path}
                      busy={busy}
                      showDir={matched !== null}
                      onSelect={() => onSelectFile(row.item)}
                      onMenu={(x, y) => setMenu({ x, y, file: row.item })}
                    />
                  </div>
                )}
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
            ` · ${T.merge}된 ${T.commit} — 파일 목록은 ${T.merge}되기 전 원래 줄기 기준이에요`}
        </p>
      </div>
      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            {
              key: 'restore-file',
              // 이 저장이 "지운" 파일은 그 시점 내용이 없다 — 숨기지 않고 사유와 함께 비활성 (E5a 후속).
              // 엔진의 '그 시점에는 이 파일이 없어요' 친절 거부는 심층 방어로 유지된다
              // E8 — checkoutFile은 삭제됨/스태시(꺼내)/일반 3변형이라 T.checkoutFile로 뭉치면
              // "꺼내"·"지금 코드에" 구분이 사라진다 — 문장 변형은 유지하고 어휘(체크아웃)만 통일
              label:
                menu.file.kind === 'deleted'
                  ? '이 파일만 체크아웃 — 그 시점에 지워진 파일이에요'
                  : shelfPreview
                    ? '이 파일만 꺼내 체크아웃'
                    : '이 파일만 지금 코드에 체크아웃',
              disabled: menu.file.kind === 'deleted',
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
        title={shelfPreview ? '이 파일만 꺼내 체크아웃할까요?' : '이 파일만 이 시점 내용으로 체크아웃할까요?'}
        confirmLabel="체크아웃"
        onConfirm={runRestore}
        onCancel={() => setConfirmingRestore(null)}
      >
        지금 파일이 이 시점 내용으로 바뀌어요. 미저장 변경은 {T.stash}에 넣어 드려요.
      </ConfirmDialog>
    </Panel>
  )
}
