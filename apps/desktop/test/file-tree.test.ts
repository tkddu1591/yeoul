import { describe, expect, it } from 'vitest'
import {
  buildFileTree,
  flattenFileTree,
  type FileTreeRow,
} from '../src/renderer/src/components/file-tree'

interface Item {
  path: string
}

const items = (...paths: string[]): Item[] => paths.map((path) => ({ path }))

const rowKinds = (rows: FileTreeRow<Item>[]) =>
  rows.map((row) => (row.kind === 'folder' ? `d${row.depth}:${row.path}` : `f${row.depth}:${row.item.path}`))

describe('buildFileTree + flattenFileTree', () => {
  it('경로 세그먼트로 다단 중첩 트리를 만들고 입력 순서를 보존한다', () => {
    const rows = flattenFileTree(
      buildFileTree(items('src/a.ts', 'src/ui/b.ts', 'README.md')),
      new Set(),
    )
    expect(rowKinds(rows)).toEqual([
      'd0:src',
      'f1:src/a.ts',
      'd1:src/ui',
      'f2:src/ui/b.ts',
      'f0:README.md',
    ])
  })

  it('폴더 count는 하위 전체 파일 수다', () => {
    const rows = flattenFileTree(
      buildFileTree(items('src/a.ts', 'src/ui/b.ts', 'src/ui/c.ts')),
      new Set(),
    )
    const src = rows[0]
    if (src.kind !== 'folder') throw new Error('folder expected')
    expect(src.count).toBe(3)
  })

  it('접힌 폴더의 하위 행은 평탄화에서 빠진다(중첩 폴더 포함)', () => {
    const tree = buildFileTree(items('src/a.ts', 'src/ui/b.ts', 'top.txt'))
    const rows = flattenFileTree(tree, new Set(['src']))
    expect(rowKinds(rows)).toEqual(['d0:src', 'f0:top.txt'])
  })

  it('루트 파일만 있으면 폴더 행이 없다', () => {
    const rows = flattenFileTree(buildFileTree(items('a.txt', 'b.txt')), new Set())
    expect(rowKinds(rows)).toEqual(['f0:a.txt', 'f0:b.txt'])
  })
})
