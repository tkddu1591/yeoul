import { Columns2, Rows3, X } from 'lucide-react'
import { useState } from 'react'
import type { FileDiff } from '@git-gui/domain'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { DiffView } from './DiffView'
import { T } from '../terms'
import './diff-panel.css'

interface DiffPanelProps {
  path: string | null
  diff: FileDiff | null
  /** in-flight selectFile이 clear를 덮어쓰는 레이스 방지 — busy 중엔 닫기도 잠근다 */
  busy: boolean
  /** ⌘F로 이 패널이 검색 대상으로 잡혔는가 (E7h ⑥) */
  findOpen: boolean
  /** 재⌘F마다 증가 — 같은 스코프 재검색 시 입력 재포커스 신호 (E7h ⑥ 보완) */
  findNonce: number
  onFindClose(): void
  onClose(): void
}

export function DiffPanel({
  path,
  diff,
  busy,
  findOpen,
  findNonce,
  onFindClose,
  onClose,
}: DiffPanelProps) {
  const [view, setView] = useState<'unified' | 'split'>('unified')

  if (!path || diff === null) {
    return (
      <Panel title={T.diff} testId="diff-panel">
        <p className="diff-panel__empty">파일을 선택하면 무엇이 바뀌었는지 보여드려요</p>
      </Panel>
    )
  }
  return (
    <Panel
      title={path}
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
      {/* key=path — 파일 전환 시 스크롤 위치와 가상 측정 캐시를 리셋한다 (이전 파일 끝에서 열리는 것 방지) */}
      <DiffView
        key={path}
        diff={diff}
        view={view}
        findOpen={findOpen}
        findNonce={findNonce}
        onFindClose={onFindClose}
      />
    </Panel>
  )
}
