import { describe, expect, it } from 'vitest'
import type { CommitSummary } from '@git-gui/domain'
import { buildGraph } from '../src/renderer/src/components/history-graph'

function commit(hash: string, parents: string[]): CommitSummary {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    subject: hash,
    authorName: 'T',
    committedAt: 0,
    refs: [],
    parents,
  }
}

describe('buildGraph', () => {
  it('일직선 역사 — 전부 레인 0', () => {
    const rows = buildGraph([commit('c', ['b']), commit('b', ['a']), commit('a', [])])
    expect(rows.map((r) => r.nodeLane)).toEqual([0, 0, 0])
    expect(rows[2]!.forkLanes).toEqual([]) // root는 아래로 뻗는 선이 없다
    expect(rows.every((r) => r.laneCount === 1)).toBe(true)
  })

  it('다이아몬드(분기 후 병합) — 병합 행에서 두 레인이 열리고 공통 조상에서 수렴한다', () => {
    // m(merge: a,b) → a(r) → b(r) → r
    const rows = buildGraph([
      commit('m', ['a', 'b']),
      commit('a', ['r']),
      commit('b', ['r']),
      commit('r', []),
    ])
    expect(rows[0]!.nodeLane).toBe(0)
    expect(rows[0]!.forkLanes).toEqual([0, 1]) // 첫 부모는 제 레인, 둘째 부모는 새 레인
    expect(rows[1]!.passLanes).toEqual([1]) // a 행에서 b의 레인이 지나간다
    expect(rows[2]!.nodeLane).toBe(1)
    expect(rows[3]!.nodeLane).toBe(0)
    expect(rows[3]!.joinLanes).toEqual([1]) // r에서 두 갈래가 합쳐진다
    expect(rows[3]!.forkLanes).toEqual([])
  })

  it('둘째 부모가 이미 기다려지는 커밋이면 새 레인을 열지 않고 그 레인으로 fork한다', () => {
    // m2(c,b) → c(m1) → m1(a,b) → a(r) → b(r) → r  형태의 연속 병합
    const rows = buildGraph([
      commit('m2', ['c', 'b']),
      commit('c', ['m1']),
      commit('m1', ['a', 'b']),
      commit('a', ['r']),
      commit('b', ['r']),
      commit('r', []),
    ])
    // m1 행: 둘째 부모 b는 m2가 이미 lane1에서 기다림 — 새 레인 없이 lane1로 fork
    expect(rows[2]!.forkLanes).toEqual([0, 1])
    expect(rows[2]!.laneCount).toBe(2)
  })

  it('octopus(부모 3) — 레인 3개로 갈라진다', () => {
    const rows = buildGraph([
      commit('m', ['a', 'b', 'c']),
      commit('a', []),
      commit('b', []),
      commit('c', []),
    ])
    expect(rows[0]!.forkLanes).toEqual([0, 1, 2])
    expect(rows[0]!.laneCount).toBe(3)
  })

  it('서로 무관한 역사 두 줄(root 2개) — 두 번째 갈래는 빈 레인을 재사용한다', () => {
    const rows = buildGraph([
      commit('a', []),
      commit('x', []),
    ])
    expect(rows[0]!.nodeLane).toBe(0)
    expect(rows[1]!.nodeLane).toBe(0) // a가 root로 닫혀 레인 0이 비었으므로 재사용
  })

  it('잘린 목록 — 마지막 행의 부모가 화면 밖이면 fork 선이 남는다 (계속됨 표시)', () => {
    const rows = buildGraph([commit('b', ['a'])])
    expect(rows[0]!.forkLanes).toEqual([0])
  })
})
