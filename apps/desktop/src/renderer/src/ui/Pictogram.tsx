import type { ReactNode } from 'react'
import type { ChangeKind } from '@git-gui/domain'
import './pictogram.css'

export type ConceptKind = 'mine' | 'branch' | 'commit' | 'shelf' | 'backup' | 'conflict'

/** 개념별 고정 픽토그램 — 스펙 10장: 앱 전체에서 동일한 시각 정체성을 유지한다 */
const CONCEPT_PATHS: Record<ConceptKind, ReactNode> = {
  mine: (
    <>
      <path d="M12 3 v18" />
      <circle cx="12" cy="21" r="2.2" fill="currentColor" stroke="none" />
    </>
  ),
  branch: (
    <>
      <path d="M6 3 v18 M6 9 Q6 15 15 15" />
      <circle cx="18" cy="15" r="2.4" />
    </>
  ),
  commit: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2 v4 M12 18 v4" />
    </>
  ),
  shelf: <path d="M4 8 h16 v11 H4 z M9 8 V5 h6 v3" />,
  backup: (
    <path d="M7 17 Q3 17 3 13 Q3 9 7 9 Q8 5 12 5 Q16 5 17 9 Q21 9 21 13 Q21 17 17 17 M12 19 v-6 m0 0 l-2.5 2.5 M12 13 l2.5 2.5" />
  ),
  conflict: (
    <>
      <path d="M12 4 L21 19 H3 z M12 10 v3" />
      <circle cx="12" cy="16.6" r="1.15" fill="currentColor" stroke="none" />
    </>
  ),
}

interface PictogramProps {
  kind: ConceptKind
  /** 아이콘 크기(px). 배경 박스는 +10px */
  size?: number
  /** 의미 전달용이면 라벨 필수(접근성 — 아이콘 단독 의미 전달 금지). 순수 장식이면 생략 */
  label?: string
}

export function Pictogram({ kind, size = 18, label }: PictogramProps) {
  const box = size + 10
  return (
    <span
      className={`ui-pictogram ui-pictogram--${kind}`}
      style={{ width: box, height: box }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {CONCEPT_PATHS[kind]}
      </svg>
    </span>
  )
}

const CHANGE_LABELS: Record<ChangeKind, string> = {
  modified: '수정됨',
  added: '추가됨',
  deleted: '삭제됨',
  renamed: '이름 변경',
  copied: '복사됨',
  typechange: '형식 변경',
  untracked: '새 파일',
  conflicted: '충돌',
}

/** 변경 종류 = 색 점 + 짧은 라벨. 색 단독으로 의미를 전달하지 않는다(접근성) */
export function ChangeKindBadge({ kind }: { kind: ChangeKind }) {
  return (
    <span className={`ui-change-badge ui-change-badge--${kind}`}>
      <span className="ui-change-badge__dot" aria-hidden="true" />
      {CHANGE_LABELS[kind]}
    </span>
  )
}
