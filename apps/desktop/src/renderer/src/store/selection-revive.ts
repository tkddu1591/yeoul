import type { FileChange } from '@git-gui/domain'

/**
 * 갱신 후에도 같은 파일 diff를 유지할 수 있는가 (E7d ⑤ 순수부) —
 * 같은 경로·보던 쪽(staged/unstaged) 변경이 남아 있고 충돌로 바뀌지 않았을 때만 새 항목을 돌려준다.
 * 충돌 전환은 diff가 아니라 충돌 화면의 몫이라 자동 재선택하지 않는다
 */
export function findRevivableChange(
  changes: FileChange[],
  path: string,
  staged: boolean,
): FileChange | null {
  const match = changes.find((entry) => entry.path === path)
  if (match === undefined) return null
  if (match.staged === 'conflicted' || match.unstaged === 'conflicted') return null
  if (staged ? match.staged === null : match.unstaged === null) return null
  return match
}
