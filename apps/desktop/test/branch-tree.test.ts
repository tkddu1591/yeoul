import { describe, expect, it } from 'vitest'
import { buildBranchTree, flattenBranchTree, flatSearch } from '../src/renderer/src/components/branch-tree'

const b = (name: string) => ({ name })

describe('buildBranchTree', () => {
  it('한 단 폴더 — 리프와 폴더가 입력 순서대로 공존한다', () => {
    const tree = buildBranchTree([b('main'), b('feature/login'), b('hotfix'), b('feature/signup')])
    expect(tree.map((node) => [node.kind, node.name])).toEqual([
      ['leaf', 'main'],
      ['folder', 'feature'],
      ['leaf', 'hotfix'],
    ])
    const feature = tree[1]!
    expect(feature.kind === 'folder' && feature.children.map((child) => child.name)).toEqual([
      'login',
      'signup',
    ])
  })

  it('다단 중첩 — a/b/c는 폴더 a > 폴더 b > 리프 c', () => {
    const tree = buildBranchTree([b('a/b/c'), b('a/b/d'), b('a/e')])
    const a = tree[0]!
    expect(a.kind).toBe('folder')
    if (a.kind !== 'folder') return
    expect(a.children.map((child) => [child.kind, child.name])).toEqual([
      ['folder', 'b'],
      ['leaf', 'e'],
    ])
    const ab = a.children[0]!
    expect(ab.kind === 'folder' && ab.children.map((child) => child.name)).toEqual(['c', 'd'])
  })

  it('리프 이름과 폴더 접두 공존(feat와 feat-x는 폴더가 아니다) — 세그먼트 단위로만 묶는다', () => {
    const tree = buildBranchTree([b('feat'), b('feat-x'), b('feat/y')])
    expect(tree.map((node) => [node.kind, node.name])).toEqual([
      ['leaf', 'feat'],
      ['leaf', 'feat-x'],
      ['folder', 'feat'],
    ])
  })

  it('폴더 count는 하위 리프 전체 수(다단 포함)', () => {
    const tree = buildBranchTree([b('a/b/c'), b('a/b/d'), b('a/e')])
    const a = tree[0]!
    expect(a.kind === 'folder' && a.count).toBe(3)
  })
})

describe('flattenBranchTree', () => {
  it('접힌 폴더의 하위는 행에서 빠지고 depth가 매겨진다', () => {
    const tree = buildBranchTree([b('main'), b('a/b/c'), b('a/e')])
    const open = flattenBranchTree(tree, new Set())
    expect(open.map((row) => [row.depth, row.node.kind, row.node.name])).toEqual([
      [0, 'leaf', 'main'],
      [0, 'folder', 'a'],
      [1, 'folder', 'b'],
      [2, 'leaf', 'c'],
      [1, 'leaf', 'e'],
    ])
    const collapsed = flattenBranchTree(tree, new Set(['a']))
    expect(collapsed.map((row) => row.node.name)).toEqual(['main', 'a'])
  })

  it('중간 폴더만 접으면 그 아래만 숨는다', () => {
    const tree = buildBranchTree([b('a/b/c'), b('a/e')])
    const rows = flattenBranchTree(tree, new Set(['a/b']))
    expect(rows.map((row) => row.node.name)).toEqual(['a', 'b', 'e'])
  })
})

describe('flatSearch', () => {
  it('검색은 평면 매치 — 전체 경로로 부분 일치', () => {
    const rows = flatSearch([b('main'), b('feature/login'), b('feature/signup')], 'log')
    expect(rows.map((row) => row.name)).toEqual(['feature/login'])
  })

  it('빈 질의는 전체를 평면으로 돌려주지 않는다(트리 렌더 몫) — null 반환', () => {
    expect(flatSearch([b('main')], '')).toBeNull()
  })
})
