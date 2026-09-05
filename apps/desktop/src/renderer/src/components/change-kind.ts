import type { ChangeKind } from '@git-gui/domain'

/** 변경 종류의 한국어 라벨 — 색 단독으로 의미를 전달하지 않기 위해 tooltip/aria에 병행한다 */
export const KIND_LABELS: Record<ChangeKind, string> = {
  modified: '수정됨',
  added: '추가됨',
  deleted: '삭제됨',
  renamed: '이름 변경',
  copied: '복사됨',
  typechange: '형식 변경',
  untracked: '새 파일',
  conflicted: '충돌',
}

/** 색과 함께 쓰는 형태 신호 — 색약(적록)에서 modified/added 색이 수렴해도 글자로 구분된다 */
export const KIND_GLYPHS: Record<ChangeKind, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
  untracked: 'U',
  conflicted: '!',
}

/** Theme-bound text colors; shape and accessible labels remain alongside color. */
export const KIND_CLASSES: Record<ChangeKind, string> = {
  modified: 'text-(--change-modified)',
  added: 'text-(--change-added)',
  deleted: 'text-(--change-deleted)',
  renamed: 'text-(--change-renamed)',
  copied: 'text-(--change-added)',
  typechange: 'text-(--change-modified)',
  untracked: 'text-(--change-untracked)',
  conflicted: 'text-(--concept-conflict)',
}
