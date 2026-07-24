/**
 * 실험 공간 depth 트리 (E7g) — '/' 세그먼트 단위 접이식 트리의 순수 로직.
 * groupBranches(1단 납작 — 헤더 스위처가 계속 씀)와 별개다. 입력 순서(최근 커밋순)를 보존한다:
 * 폴더 위치는 그 폴더의 첫 등장 지점, 하위도 입력 순서대로.
 */
export type BranchTreeNode<T extends { name: string }> =
  | { kind: 'leaf'; name: string; path: string; branch: T }
  | { kind: 'folder'; name: string; path: string; count: number; children: BranchTreeNode<T>[] }

export interface BranchTreeRow<T extends { name: string }> {
  depth: number
  node: BranchTreeNode<T>
}

export function buildBranchTree<T extends { name: string }>(branches: T[]): BranchTreeNode<T>[] {
  const roots: BranchTreeNode<T>[] = []
  const folderByPath = new Map<string, Extract<BranchTreeNode<T>, { kind: 'folder' }>>()
  for (const branch of branches) {
    const segments = branch.name.split('/')
    let siblings = roots
    let path = ''
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i]!
      path = path === '' ? segment : `${path}/${segment}`
      let folder = folderByPath.get(path)
      if (folder === undefined) {
        folder = { kind: 'folder', name: segment, path, count: 0, children: [] }
        folderByPath.set(path, folder)
        siblings.push(folder)
      }
      folder.count += 1
      siblings = folder.children
    }
    const leafName = segments[segments.length - 1]!
    siblings.push({ kind: 'leaf', name: leafName, path: branch.name, branch })
  }
  return roots
}

/** 접힌 폴더(경로 집합) 아래를 걸러 depth를 매긴 행 목록으로 — 렌더는 이 배열만 순회한다 */
export function flattenBranchTree<T extends { name: string }>(
  nodes: BranchTreeNode<T>[],
  collapsed: ReadonlySet<string>,
  depth = 0,
): BranchTreeRow<T>[] {
  const rows: BranchTreeRow<T>[] = []
  for (const node of nodes) {
    rows.push({ depth, node })
    if (node.kind === 'folder' && !collapsed.has(node.path)) {
      rows.push(...flattenBranchTree(node.children, collapsed, depth + 1))
    }
  }
  return rows
}

/** 검색 중엔 트리 대신 평면 매치(전체 경로 표시) — 빈 질의는 null(트리 렌더로) (스펙) */
export function flatSearch<T extends { name: string }>(branches: T[], query: string): T[] | null {
  if (query === '') return null
  return branches.filter((branch) => branch.name.includes(query))
}
