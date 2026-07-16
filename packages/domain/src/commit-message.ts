import type { ChangeKind, FileChange } from './repository'

const KIND_VERBS: Record<ChangeKind, string> = {
  modified: '수정',
  added: '추가',
  deleted: '삭제',
  renamed: '이름 변경',
  copied: '복사',
  typechange: '형식 변경',
  untracked: '추가',
  conflicted: '변경',
}

function basename(path: string): string {
  const index = path.lastIndexOf('/')
  return index >= 0 ? path.slice(index + 1) : path
}

/**
 * staged 변경으로 저장 메시지를 규칙 기반으로 제안한다 (스펙 8장).
 * staged가 없으면 빈 문자열 — 제안 없음. 빈 메시지로 저장하면 이 제안이 대신 들어간다.
 */
export function suggestCommitMessage(changes: FileChange[]): string {
  const stagedChanges = changes.filter((change) => change.staged !== null)
  if (stagedChanges.length === 0) return ''
  const first = stagedChanges[0]!
  const firstVerb = KIND_VERBS[first.staged!]
  if (stagedChanges.length === 1) return `${basename(first.path)} ${firstVerb}`
  const allSameKind = stagedChanges.every((change) => change.staged === first.staged)
  const verb = allSameKind ? firstVerb : '변경'
  return `${basename(first.path)} 외 ${stagedChanges.length - 1}개 ${verb}`
}
