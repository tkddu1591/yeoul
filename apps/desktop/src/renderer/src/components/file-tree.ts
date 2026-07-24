/**
 * 커밋 상세 파일 목록의 depth 트리 (E7h ②) — 경로 `/` 세그먼트 기반, 입력 순서 보존.
 * branch-tree(E7g)와 같은 규칙의 파일판. 제네릭 — path를 가진 어떤 항목이든 받는다(커밋 파일·보관 파일).
 */
export interface FileTreeFolder<T extends { path: string }> {
  kind: 'folder'
  /** 전체 경로 접두 — 접기 키로 쓴다 (예: 'src/ui') */
  path: string
  name: string
  /** 하위 전체 파일 수(재귀) */
  count: number
  children: FileTreeNode<T>[]
}

export interface FileTreeLeaf<T extends { path: string }> {
  kind: 'file'
  item: T
}

export type FileTreeNode<T extends { path: string }> = FileTreeFolder<T> | FileTreeLeaf<T>

export type FileTreeRow<T extends { path: string }> =
  | { kind: 'folder'; path: string; name: string; count: number; depth: number }
  | { kind: 'file'; item: T; depth: number }

export function buildFileTree<T extends { path: string }>(files: T[]): FileTreeNode<T>[] {
  const root: FileTreeNode<T>[] = []
  const folders = new Map<string, FileTreeFolder<T>>()

  const folderFor = (prefix: string, name: string, parent: FileTreeNode<T>[]): FileTreeFolder<T> => {
    const existing = folders.get(prefix)
    if (existing !== undefined) return existing
    const folder: FileTreeFolder<T> = { kind: 'folder', path: prefix, name, count: 0, children: [] }
    folders.set(prefix, folder)
    parent.push(folder)
    return folder
  }

  for (const item of files) {
    const segments = item.path.split('/')
    let siblings = root
    let prefix = ''
    for (const segment of segments.slice(0, -1)) {
      prefix = prefix === '' ? segment : `${prefix}/${segment}`
      const folder = folderFor(prefix, segment, siblings)
      folder.count += 1
      siblings = folder.children
    }
    siblings.push({ kind: 'file', item })
  }
  return root
}

export function flattenFileTree<T extends { path: string }>(
  nodes: FileTreeNode<T>[],
  collapsed: ReadonlySet<string>,
): FileTreeRow<T>[] {
  const rows: FileTreeRow<T>[] = []
  const walk = (list: FileTreeNode<T>[], depth: number) => {
    for (const node of list) {
      if (node.kind === 'file') {
        rows.push({ kind: 'file', item: node.item, depth })
        continue
      }
      rows.push({ kind: 'folder', path: node.path, name: node.name, count: node.count, depth })
      if (!collapsed.has(node.path)) walk(node.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return rows
}
