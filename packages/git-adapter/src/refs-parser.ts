import type { BranchSummary, ShelfEntry } from '@git-gui/domain'

const FIELD_SEPARATOR = '\x1f'

/**
 * `git for-each-ref refs/heads --format=%(refname:short)\x1f%(HEAD)\x1f%(committerdate:unix)\x1f%(upstream:short)`
 * 출력을 파싱한다. HEAD 마커는 현재 브랜치에서 '*', 아니면 공백. 기형 행은 건너뛴다.
 */
export function parseBranches(rawOutput: string): BranchSummary[] {
  const lines = rawOutput.split('\n').filter((line) => line !== '')
  const branches: BranchSummary[] = []
  for (const line of lines) {
    const fields = line.split(FIELD_SEPARATOR)
    if (fields.length < 4) continue
    const committedAt = Number(fields[2])
    if (!Number.isFinite(committedAt)) continue
    branches.push({
      name: fields[0]!,
      isCurrent: fields[1] === '*',
      committedAt,
      upstream: fields[3] === '' ? null : fields[3]!,
    })
  }
  return branches
}

/**
 * `git stash list --format=%gd%x1f%ct%x1f%gs` 출력을 파싱한다.
 * 메시지(%gs)는 git이 "On <branch>: <msg>"/"WIP on <branch>: …"로 만든 원문 그대로 둔다.
 */
export function parseShelf(rawOutput: string): ShelfEntry[] {
  const lines = rawOutput.split('\n').filter((line) => line !== '')
  const entries: ShelfEntry[] = []
  for (const line of lines) {
    const fields = line.split(FIELD_SEPARATOR)
    if (fields.length < 3) continue
    const savedAt = Number(fields[1])
    if (!Number.isFinite(savedAt)) continue
    entries.push({
      ref: fields[0]!,
      savedAt,
      // 메시지에 구분자가 섞이는 일은 없지만 방어적으로 나머지를 합친다
      message: fields.slice(2).join(FIELD_SEPARATOR),
    })
  }
  return entries
}
