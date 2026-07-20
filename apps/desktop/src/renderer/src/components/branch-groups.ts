import type { BranchSummary } from '@git-gui/domain'

export interface BranchFolder {
  /** '/' 앞 첫 조각 — 폴더 이름 */
  name: string
  branches: BranchSummary[]
}

export interface GroupedBranches {
  /** '/' 없는 브랜치 — 목록 맨 위에 그대로 나열 */
  loose: BranchSummary[]
  /** '/'가 있는 브랜치를 첫 조각으로 묶는다 — IntelliJ식 폴더 (피드백 5) */
  folders: BranchFolder[]
}

/** 입력 순서(최근 커밋순)를 유지한다 — 폴더 위치는 그 폴더 브랜치가 처음 등장한 곳 */
export function groupBranches(branches: BranchSummary[]): GroupedBranches {
  const loose: BranchSummary[] = []
  const folders: BranchFolder[] = []
  const byName = new Map<string, BranchFolder>()
  for (const branch of branches) {
    const slash = branch.name.indexOf('/')
    if (slash <= 0) {
      loose.push(branch)
      continue
    }
    const name = branch.name.slice(0, slash)
    let folder = byName.get(name)
    if (folder === undefined) {
      folder = { name, branches: [] }
      byName.set(name, folder)
      folders.push(folder)
    }
    folder.branches.push(branch)
  }
  return { loose, folders }
}

/** 폴더 안에서는 접두사를 뗀 나머지만 보여준다 — 전체 이름은 title·동작 키로 유지 */
export function branchDisplayName(name: string): string {
  const slash = name.indexOf('/')
  return slash <= 0 ? name : name.slice(slash + 1)
}
