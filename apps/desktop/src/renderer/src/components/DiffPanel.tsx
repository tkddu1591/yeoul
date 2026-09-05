import { Columns2, Rows3, X } from 'lucide-react'
import { useState } from 'react'
import type {
  DiffHunk,
  DiffOptions,
  FileDiff,
  HunkStageRequest,
  LineStageRequest,
} from '@git-gui/domain'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { ProductIcon } from '../ui/ProductIcon'
import { DiffView } from './DiffView'
import { T } from '../terms'
import './diff-panel.css'

interface DiffPanelProps {
  document: {
    path: string
    target?: string
    diff: FileDiff
    change: { path: string; options: DiffOptions } | null
  } | null
  /**
   * 쓰기(커밋·병합 등)가 도는 동안 닫기를 잠근다 — 그게 전부다.
   * 예전엔 "in-flight selectFile이 clear를 덮어쓰는 레이스 방지"도 겸했지만, 조회가 더는 busy를
   * 켜지 않으므로 그 역할은 성립하지 않는다. 경합은 이제 스토어에서 막는다 —
   * `clearSelection()`이 `invalidateReads()`로 진행 중인 조회를 무효화한다 (E14a 스펙 §2-4-2)
   */
  busy: boolean
  /** ⌘F로 이 패널이 검색 대상으로 잡혔는가 (E7h ⑥) */
  findOpen: boolean
  /** 재⌘F마다 증가 — 같은 스코프 재검색 시 입력 재포커스 신호 (E7h ⑥ 보완) */
  findNonce: number
  onFindClose(): void
  onClose(): void
  /** 이 패널로 떨어질 조회(가운데)가 진행 중인가 (E14a) */
  pending: boolean
  onStageHunk(request: HunkStageRequest): void
  onUnstageHunk(request: HunkStageRequest): void
  onStageLine(request: LineStageRequest): void
  onUnstageLine(request: LineStageRequest): void
}

export function DiffPanel({
  document,
  busy,
  findOpen,
  findNonce,
  onFindClose,
  onClose,
  pending,
  onStageHunk,
  onUnstageHunk,
  onStageLine,
  onUnstageLine,
}: DiffPanelProps) {
  const [view, setView] = useState<'unified' | 'split'>('unified')

  if (document === null) {
    return (
      <Panel title={T.diff} testId="diff-panel" pending={pending}>
        <div className="diff-panel__empty">
          <ProductIcon size={56} />
          <p>파일을 선택하면 무엇이 바뀌었는지 보여드려요</p>
        </div>
      </Panel>
    )
  }
  const { path, diff } = document
  return (
    <Panel
      title={path}
      pending={pending}
      accessory={
        <>
          {/* 가시 라벨이 접근 이름이 된다 — aria-label로 덮지 않는다 (WCAG 2.5.3) */}
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
          {/* 가시 라벨 "닫기"가 접근 이름이 된다 — aria-label로 덮지 않는다 (WCAG 2.5.3) */}
          <Button variant="ghost" size="sm" isDisabled={busy} onPress={onClose} testId="diff-close">
            <X size={13} aria-hidden="true" /> 닫기
          </Button>
        </>
      }
      testId="diff-panel"
    >
      <p
        className="m-0 border-b border-(--color-border) px-3 py-1 text-xs text-(--color-text-muted)"
        data-testid="diff-comparison"
      >
        {document.target} ·{' '}
        {document.change
          ? document.change.options.staged
            ? 'HEAD → 스테이지'
            : '스테이지 → 작업 트리'
          : '커밋 비교'}
      </p>
      {/* key=path — 파일 전환 시 스크롤 위치와 가상 측정 캐시를 리셋한다 (이전 파일 끝에서 열리는 것 방지) */}
      <DiffView
        key={path}
        diff={diff}
        view={view}
        findOpen={findOpen}
        findNonce={findNonce}
        onFindClose={onFindClose}
        hunkMode={
          document.change === null ? null : document.change.options.staged ? 'unstage' : 'stage'
        }
        onHunkAction={(hunk: DiffHunk) => {
          const change = document.change
          if (change === null) return
          const request = { path: change.path, options: change.options, hunk }
          if (change.options.staged) onUnstageHunk(request)
          else onStageHunk(request)
        }}
        onLineAction={(hunk: DiffHunk, lineIndex: number) => {
          const change = document.change
          if (change === null) return
          const request = { path: change.path, options: change.options, hunk, lineIndex }
          if (change.options.staged) onUnstageLine(request)
          else onStageLine(request)
        }}
      />
    </Panel>
  )
}
