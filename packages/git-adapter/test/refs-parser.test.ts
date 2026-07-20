import { describe, expect, it } from 'vitest'
import { parseBranches, parseShelf } from '../src/refs-parser'

const US = '\x1f'

describe('parseBranches', () => {
  it('for-each-ref 출력에서 이름·현재 여부·시각·upstream을 읽는다', () => {
    const raw =
      [`feat/x${US} ${US}1784279934${US}`, `main${US}*${US}1784279935${US}origin/main`].join('\n') +
      '\n'
    expect(parseBranches(raw)).toEqual([
      { name: 'feat/x', isCurrent: false, committedAt: 1784279934, upstream: null },
      { name: 'main', isCurrent: true, committedAt: 1784279935, upstream: 'origin/main' },
    ])
  })

  it('빈 출력이면 빈 배열, 기형 행은 건너뛴다', () => {
    expect(parseBranches('')).toEqual([])
    expect(parseBranches(`broken\nmain${US}*${US}not-a-number${US}\n`)).toEqual([])
  })
})

describe('parseShelf', () => {
  it('stash list 출력에서 ref·시각·해시·메시지를 읽는다', () => {
    const hashA = 'a'.repeat(40)
    const hashB = 'b'.repeat(40)
    const raw =
      [
        `stash@{0}${US}1784279940${US}${hashA}${US}On main: 전환 자동 보관`,
        `stash@{1}${US}1784279930${US}${hashB}${US}WIP on side: abc1234 subject`,
      ].join('\n') + '\n'
    expect(parseShelf(raw)).toEqual([
      { ref: 'stash@{0}', savedAt: 1784279940, hash: hashA, message: 'On main: 전환 자동 보관' },
      { ref: 'stash@{1}', savedAt: 1784279930, hash: hashB, message: 'WIP on side: abc1234 subject' },
    ])
  })

  it('메시지에 구분자가 섞여도 나머지를 메시지로 합친다', () => {
    const raw = `stash@{0}${US}100${US}${'c'.repeat(40)}${US}메시지${US}에 구분자\n`
    expect(parseShelf(raw)[0]?.message).toBe(`메시지${US}에 구분자`)
  })

  it('빈 출력이면 빈 배열', () => {
    expect(parseShelf('')).toEqual([])
  })
})
