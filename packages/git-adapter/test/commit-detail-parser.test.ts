import { describe, expect, it } from 'vitest'
import { parseCommitMeta, parseNameStatus } from '../src/commit-detail-parser'

const US = '\x1f'

describe('parseCommitMeta', () => {
  it('%H %h %an %ct %P %s %b 필드를 CommitDetail 메타로 변환한다', () => {
    const raw = [
      'a'.repeat(40),
      'abc1234',
      '홍길동',
      '1752561600',
      `${'b'.repeat(40)} ${'c'.repeat(40)}`,
      '제목 한 줄',
      '본문 첫 줄\n본문 둘째 줄\n',
    ].join(US)
    expect(parseCommitMeta(raw)).toEqual({
      hash: 'a'.repeat(40),
      shortHash: 'abc1234',
      authorName: '홍길동',
      committedAt: 1752561600,
      parents: ['b'.repeat(40), 'c'.repeat(40)],
      subject: '제목 한 줄',
      body: '본문 첫 줄\n본문 둘째 줄',
    })
  })

  it('본문 없는 커밋 — body는 빈 문자열, root — parents는 빈 배열', () => {
    const raw = ['a'.repeat(40), 'abc1234', 'A', '100', '', '제목', ''].join(US)
    const meta = parseCommitMeta(raw)
    expect(meta.body).toBe('')
    expect(meta.parents).toEqual([])
  })

  it('본문에 필드 구분자가 섞여도 나머지를 본문으로 합친다', () => {
    const raw = ['a'.repeat(40), 'abc1234', 'A', '100', '', '제목', `본${US}문`].join(US)
    expect(parseCommitMeta(raw).body).toBe(`본${US}문`)
  })

  it('필드가 모자라거나 시간이 숫자가 아니면 에러를 던진다 — 추측하지 않는다', () => {
    expect(() => parseCommitMeta('broken')).toThrow()
    expect(() => parseCommitMeta(['a'.repeat(40), 'a', 'A', 'NaN', '', 's', ''].join(US))).toThrow()
  })
})

describe('parseNameStatus', () => {
  it('M/A/D를 CommitFileChange로 변환한다', () => {
    const raw = 'M\0a.txt\0A\0b.txt\0D\0c.txt\0'
    expect(parseNameStatus(raw)).toEqual([
      { path: 'a.txt', origPath: null, kind: 'modified' },
      { path: 'b.txt', origPath: null, kind: 'added' },
      { path: 'c.txt', origPath: null, kind: 'deleted' },
    ])
  })

  it('R100은 원래경로→새경로 순서다 — origPath에 원래 경로를 담는다', () => {
    const raw = 'R100\0old.txt\0new.txt\0'
    expect(parseNameStatus(raw)).toEqual([{ path: 'new.txt', origPath: 'old.txt', kind: 'renamed' }])
  })

  it('C(복사)·T(형식 변경)도 매핑하고, 알 수 없는 상태는 건너뛴다', () => {
    const raw = 'C75\0src.txt\0copy.txt\0T\0mode.txt\0X\0weird.txt\0'
    expect(parseNameStatus(raw)).toEqual([
      { path: 'copy.txt', origPath: 'src.txt', kind: 'copied' },
      { path: 'mode.txt', origPath: null, kind: 'typechange' },
    ])
  })

  it('빈 출력이면 빈 배열', () => {
    expect(parseNameStatus('')).toEqual([])
  })
})
