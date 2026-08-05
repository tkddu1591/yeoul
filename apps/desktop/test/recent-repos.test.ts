import { describe, expect, it } from 'vitest'
import {
  pushRecentRepo,
  removeRecentRepo,
  RECENT_REPOS_MAX,
} from '../src/renderer/src/components/recent-repos'

describe('최근 저장소 목록', () => {
  it('RECENT_REPOS_MAX는 10 — 헤더 팝오버가 스크롤 없이 담기는 길이', () => {
    expect(RECENT_REPOS_MAX).toBe(10)
  })

  it('연 저장소가 맨 앞에 온다', () => {
    expect(pushRecentRepo(['/a', '/b'], '/c')).toEqual(['/c', '/a', '/b'])
  })

  it('이미 있던 것을 다시 열면 중복이 아니라 맨 앞으로 이동한다', () => {
    expect(pushRecentRepo(['/a', '/b', '/c'], '/c')).toEqual(['/c', '/a', '/b'])
  })

  it('맨 앞을 다시 열어도 그대로다', () => {
    expect(pushRecentRepo(['/a', '/b'], '/a')).toEqual(['/a', '/b'])
  })

  it('상한을 넘으면 가장 오래된 것부터 버린다', () => {
    const full = Array.from({ length: RECENT_REPOS_MAX }, (_, i) => `/repo-${i}`)
    const next = pushRecentRepo(full, '/new')
    expect(next).toHaveLength(RECENT_REPOS_MAX)
    expect(next[0]).toBe('/new')
    expect(next).not.toContain(`/repo-${RECENT_REPOS_MAX - 1}`)
  })

  it('원본을 바꾸지 않는다 — 설정 객체를 그대로 쓰는 호출부가 있다', () => {
    const original = ['/a', '/b']
    pushRecentRepo(original, '/c')
    expect(original).toEqual(['/a', '/b'])
  })

  it('없어진 경로를 뺀다', () => {
    expect(removeRecentRepo(['/a', '/b', '/c'], '/b')).toEqual(['/a', '/c'])
  })

  it('없는 것을 빼라고 해도 그대로다', () => {
    expect(removeRecentRepo(['/a'], '/zzz')).toEqual(['/a'])
  })
})
