import { describe, expect, it } from 'vitest'
import { parseLog } from '../src/log-parser'

const US = '\x1f'

function record(
  hash: string,
  short: string,
  author: string,
  epoch: string,
  refs: string,
  parents: string,
  subject: string,
) {
  return [hash, short, author, epoch, refs, parents, subject].join(US)
}

describe('parseLog', () => {
  it('빈 출력이면 빈 배열', () => {
    expect(parseLog('')).toEqual([])
  })

  it('레코드를 CommitSummary로 변환한다', () => {
    const raw =
      record('a'.repeat(40), 'abc1234', '홍길동', '1752561600', '', 'b'.repeat(40), 'feat: 첫 커밋') +
      '\0'
    expect(parseLog(raw)).toEqual([
      {
        hash: 'a'.repeat(40),
        shortHash: 'abc1234',
        authorName: '홍길동',
        committedAt: 1752561600,
        refs: [],
        parents: ['b'.repeat(40)],
        subject: 'feat: 첫 커밋',
      },
    ])
  })

  it('refs — "HEAD -> "·"tag: " 접두사를 벗기고, detached의 단독 HEAD는 제외한다', () => {
    const raw =
      record('a'.repeat(40), 'aaaaaaa', 'A', '100', 'HEAD -> main, origin/main, tag: v1.0', '', 'x') +
      '\0' +
      record('b'.repeat(40), 'bbbbbbb', 'B', '100', 'HEAD', '', 'y') +
      '\0'
    const commits = parseLog(raw)
    expect(commits[0]?.refs).toEqual(['main', 'origin/main', 'v1.0'])
    expect(commits[1]?.refs).toEqual([])
  })

  it('refs — shallow clone의 pseudo-decoration grafted는 배지가 아니다', () => {
    const raw = record('a'.repeat(40), 'aaaaaaa', 'A', '100', 'grafted, HEAD -> main', '', 'x') + '\0'
    expect(parseLog(raw)[0]?.refs).toEqual(['main'])
  })

  it('parents — 공백 구분 해시를 배열로, root 커밋(빈 %P)은 빈 배열로', () => {
    const merge = record('a'.repeat(40), 'aaaaaaa', 'A', '100', '', `${'b'.repeat(40)} ${'c'.repeat(40)}`, 'merge') + '\0'
    const root = record('d'.repeat(40), 'ddddddd', 'D', '100', '', '', 'root') + '\0'
    expect(parseLog(merge)[0]?.parents).toEqual(['b'.repeat(40), 'c'.repeat(40)])
    expect(parseLog(root)[0]?.parents).toEqual([])
  })

  it('여러 레코드의 순서를 보존한다', () => {
    const raw =
      record('a'.repeat(40), 'aaaaaaa', 'A', '200', '', '', '두 번째') +
      '\0' +
      record('b'.repeat(40), 'bbbbbbb', 'B', '100', '', '', '첫 번째') +
      '\0'
    const commits = parseLog(raw)
    expect(commits.map((c) => c.subject)).toEqual(['두 번째', '첫 번째'])
  })

  it('subject에 필드 구분자가 섞여도 나머지를 subject로 합친다', () => {
    const raw = record('a'.repeat(40), 'abc1234', 'A', '100', '', '', `제목${US}에 구분자`) + '\0'
    expect(parseLog(raw)[0]?.subject).toBe(`제목${US}에 구분자`)
  })

  it('필드가 모자라거나 시간이 숫자가 아닌 기형 레코드는 건너뛴다', () => {
    const raw =
      ['broken', record('a'.repeat(40), 'abc1234', 'A', 'not-a-number', '', '', 'x')].join('\0') + '\0'
    expect(parseLog(raw)).toEqual([])
  })
})
