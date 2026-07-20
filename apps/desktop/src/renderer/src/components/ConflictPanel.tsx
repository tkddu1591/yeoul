import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, Check, Download, User } from 'lucide-react'
import { useRef, useState } from 'react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Panel } from '../ui/Panel'
import { hasConflictMarkers, parseConflictContent } from './conflict-markers'
import './conflict-panel.css'
import './virtual.css'

interface ConflictPanelProps {
  path: string
  content: string
  busy: boolean
  /** 한쪽 확정 — ours=내 것 유지, theirs=가져온 것 사용 */
  onResolve(choice: 'ours' | 'theirs'): void
  /** 직접 수정을 마쳤다고 표시 — 마커가 남아 있으면 확인창을 거친다 */
  onMarkResolved(): void
  /** 최신 파일 내용 재조회 — 외부 편집 후의 stale 마커 검사(거짓 경고)를 막는다. 실패 시 null */
  onReload(): Promise<string | null>
}

/**
 * 충돌 해결 화면 (스펙 A안+B) — 파일 단위로 한쪽을 고르거나, 외부에서 직접 수정한 뒤 해결 표시.
 * 초록 구간 = 내 것(HEAD), 보라 구간 = 가져온 것.
 */
export function ConflictPanel({
  path,
  content,
  busy,
  onResolve,
  onMarkResolved,
  onReload,
}: ConflictPanelProps) {
  const [confirmingMark, setConfirmingMark] = useState(false)
  const rows = parseConflictContent(content)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 21,
    overscan: 20,
  })
  // 겹침 블록 시작 인덱스 — "다음 겹침"으로 순환 점프한다
  const markerIndexes = rows.reduce<number[]>((acc, row, index) => {
    if (row.kind === 'marker-ours') acc.push(index)
    return acc
  }, [])
  const [jumpCursor, setJumpCursor] = useState(0)
  const jumpNext = () => {
    if (markerIndexes.length === 0) return
    virtualizer.scrollToIndex(markerIndexes[jumpCursor % markerIndexes.length]!, { align: 'center' })
    setJumpCursor(jumpCursor + 1)
  }
  const markResolved = () => {
    void (async () => {
      // 외부 편집기에서 마커를 지웠을 수 있다 — 열 때 읽은 내용이 아니라 최신 내용으로 검사한다 (거짓 경고 방지)
      const fresh = await onReload()
      if (fresh === null) return
      if (hasConflictMarkers(fresh)) setConfirmingMark(true)
      else onMarkResolved()
    })()
  }

  return (
    <Panel
      title={`${path} — 겹침 해결`}
      accessory={<Badge tone="git">conflict</Badge>}
      testId="conflict-panel"
    >
      <p className="conflict-panel__hint">
        초록 구간이 <strong>내 것</strong>, 보라 구간이 <strong>가져온 것</strong>이에요. 한쪽을
        고르면 파일 전체가 그쪽으로 정리돼요. 세밀하게 고치려면 편집기에서 직접 수정한 뒤 "직접
        수정했어요"를 눌러 주세요.
      </p>
      {/* 해결 버튼은 헤더가 아니라 전용 줄에 — 좁은 폭에서도 잘리지 않고 줄바꿈된다 (리뷰 실측) */}
      <div className="conflict-panel__actions">
        <Button
          variant="neutral"
          className="conflict-panel__btn--mine"
          size="sm"
          isDisabled={busy}
          onPress={() => onResolve('ours')}
          testId="conflict-ours"
        >
          <User size={13} aria-hidden="true" /> 내 것 유지
        </Button>
        <Button
          variant="neutral"
          className="conflict-panel__btn--branch"
          size="sm"
          isDisabled={busy}
          onPress={() => onResolve('theirs')}
          testId="conflict-theirs"
        >
          <Download size={13} aria-hidden="true" /> 가져온 것 사용
        </Button>
        <Button
          variant="ghost"
          size="sm"
          isDisabled={busy}
          onPress={markResolved}
          testId="conflict-mark"
        >
          <Check size={13} aria-hidden="true" /> 직접 수정했어요
        </Button>
        <Button
          variant="ghost"
          size="sm"
          isDisabled={busy || markerIndexes.length === 0}
          onPress={jumpNext}
          testId="conflict-next"
        >
          <ArrowDown size={13} aria-hidden="true" /> 다음 겹침 ({markerIndexes.length})
        </Button>
      </div>
      <div ref={scrollRef} className="virtual-scroll" data-testid="conflict-view">
        <div
          className="conflict-panel__code"
          style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]!
            return (
              <div
                key={item.index}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="virtual-row"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <div className={`conflict-line conflict-line--${row.kind}`}>
                  <span className="conflict-line__text">{row.text || ' '}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <ConfirmDialog
        isOpen={confirmingMark}
        title="겹침 표시가 아직 남아 있어요"
        confirmLabel="그래도 표시"
        onConfirm={() => {
          setConfirmingMark(false)
          onMarkResolved()
        }}
        onCancel={() => setConfirmingMark(false)}
      >
        파일에 겹침 표시(&lt;&lt;&lt;&lt;&lt;&lt;&lt;)가 그대로 있어요. 이대로 해결 표시하면 표시
        줄까지 저장돼요. 편집기에서 정리한 뒤 다시 시도하는 것을 권해요.
      </ConfirmDialog>
    </Panel>
  )
}
