import type { BranchSummary } from '@git-gui/domain'

export interface BranchFolder<T extends { name: string } = BranchSummary> {
  /** '/' 앞 첫 조각 — 폴더 이름 */
  name: string
  branches: T[]
}

export interface GroupedBranches<T extends { name: string } = BranchSummary> {
  /** '/' 없는 브랜치 — 목록 맨 위에 그대로 나열 */
  loose: T[]
  /** '/'가 있는 브랜치를 첫 조각으로 묶는다 — IntelliJ식 폴더 (피드백 5) */
  folders: BranchFolder<T>[]
}

/**
 * 입력 순서(최근 커밋순)를 유지한다 — 폴더 위치는 그 폴더 브랜치가 처음 등장한 곳.
 * E7a: 패널(LocalBranchStatus)과 스위처(BranchSummary)가 공유하도록 name만 요구하는 제네릭으로 넓혔다
 */
export function groupBranches<T extends { name: string }>(branches: T[]): GroupedBranches<T> {
  const loose: T[] = []
  const folders: BranchFolder<T>[] = []
  const byName = new Map<string, BranchFolder<T>>()
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
