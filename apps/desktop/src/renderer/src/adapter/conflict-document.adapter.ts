export interface ConflictDocument {
  path: string
  identity: string
  content: string
  mode: 'merging' | 'reverting' | 'rebasing'
  source: string
  target: string
}
function from(
  path: string,
  root: string,
  content: string,
  branch: string | null,
  mode: ConflictDocument['mode'],
): ConflictDocument {
  const marker = /^>>>>>>> (.+)$/m.exec(content)?.[1]
  return {
    path,
    identity: `${root}/${path}`,
    content,
    mode,
    source: mode === 'rebasing' ? '새 기반 (ours)' : `${branch ?? '현재 커밋'} (ours)`,
    target:
      mode === 'rebasing'
        ? `${marker ?? '적용 중인 커밋'} (theirs)`
        : `${marker ?? '상대 변경'} (theirs)`,
  }
}
export const conflictDocumentAdapter = { document: { from } }
