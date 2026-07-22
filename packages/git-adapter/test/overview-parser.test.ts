import { describe, expect, it } from 'vitest'
import { parseOverview } from '../src/overview-parser'

const US = '\x1f'
const HASH_A = 'a'.repeat(40)
const HASH_B = 'b'.repeat(40)

/** 실측 1 포맷 — %(refname)%1f%(refname:short)%1f%(symref)%1f%(upstream:short)%1f%(upstream:track)%1f%(committerdate:unix)%1f%(objectname) */
function row(
  refname: string,
  short: string,
  symref: string,
  upstream: string,
  track: string,
  committedAt: string,
  hash: string,
): string {
  return [refname, short, symref, upstream, track, committedAt, hash].join(US)
}

describe('parseOverview', () => {
  it('로컬은 locals로, 원격은 remotes로 분류하고 현재 브랜치를 표시한다', () => {
    const raw = [
      row('refs/heads/main', 'main', '', 'origin/main', '', '100', HASH_A),
      row('refs/remotes/origin/main', 'origin/main', '', '', '', '100', HASH_A),
    ].join('\n')
    expect(parseOverview(raw, 'main')).toEqual({
      locals: [
        {
          name: 'main',
          isCurrent: true,
          upstream: 'origin/main',
          upstreamGone: false,
          ahead: 0,
          behind: 0,
          committedAt: 100,
          hash: HASH_A,
        },
      ],
      remotes: [{ remote: 'origin', name: 'origin/main' }],
    })
  })

  it('track "[ahead 1, behind 2]"를 숫자로 푼다 (한쪽만 있는 "[ahead 3]"도)', () => {
    const raw = [
      row('refs/heads/feature', 'feature', '', 'origin/feature', '[ahead 1, behind 2]', '100', HASH_A),
      row('refs/heads/solo', 'solo', '', 'origin/solo', '[ahead 3]', '100', HASH_B),
    ].join('\n')
    const { locals } = parseOverview(raw, null)
    expect(locals[0]).toMatchObject({ ahead: 1, behind: 2, upstreamGone: false })
    expect(locals[1]).toMatchObject({ ahead: 3, behind: 0 })
  })

  it('upstream이 없으면 ahead/behind는 null이다 (0/0으로 위장하지 않는다)', () => {
    const raw = row('refs/heads/nolink', 'nolink', '', '', '', '100', HASH_A)
    expect(parseOverview(raw, null).locals[0]).toMatchObject({
      upstream: null,
      ahead: null,
      behind: null,
      upstreamGone: false,
    })
  })

  it('[gone]은 upstreamGone으로 보존하고 ahead/behind는 null이다', () => {
    const raw = row('refs/heads/gonebr', 'gonebr', '', 'origin/gonebr', '[gone]', '100', HASH_A)
    expect(parseOverview(raw, null).locals[0]).toMatchObject({
      upstream: 'origin/gonebr',
      upstreamGone: true,
      ahead: null,
      behind: null,
    })
  })

  it('origin/HEAD 심볼릭 행(symref 비어 있지 않음 — 실측 1: short가 "origin")은 제외한다', () => {
    const raw = [
      row('refs/remotes/origin/HEAD', 'origin', 'refs/remotes/origin/main', '', '', '100', HASH_A),
      row('refs/remotes/origin/main', 'origin/main', '', '', '', '100', HASH_A),
    ].join('\n')
    expect(parseOverview(raw, null).remotes).toEqual([{ remote: 'origin', name: 'origin/main' }])
  })

  it('detached HEAD(현재 브랜치 null)면 isCurrent가 전부 false다', () => {
    const raw = row('refs/heads/main', 'main', '', '', '', '100', HASH_A)
    expect(parseOverview(raw, null).locals[0]!.isCurrent).toBe(false)
  })

  it('기형 행(필드 부족·숫자 아님)은 추측하지 않고 건너뛴다', () => {
    const raw = [
      'garbage-line',
      row('refs/heads/bad-time', 'bad-time', '', '', '', 'not-a-number', HASH_A),
      row('refs/heads/ok', 'ok', '', '', '', '100', HASH_A),
    ].join('\n')
    expect(parseOverview(raw, null).locals.map((b) => b.name)).toEqual(['ok'])
  })

  it('빈 입력이면 빈 개요다', () => {
    expect(parseOverview('', null)).toEqual({ locals: [], remotes: [] })
  })
})
