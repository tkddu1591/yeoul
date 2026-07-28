import { describe, expect, it } from 'vitest'
import { T } from '../src/renderer/src/terms'

describe('용어 사전 (E8)', () => {
  it('모든 값이 비어 있지 않다', () => {
    for (const [key, value] of Object.entries(T)) {
      expect(value, `빈 값: ${key}`).not.toBe('')
    }
  })

  it('같은 라벨이 두 키에 붙지 않는다(툴팁·E2E 단언이 모호해진다)', () => {
    const values = Object.values(T)
    expect(new Set(values).size).toBe(values.length)
  })

  it('핵심 어휘가 개발자 표준이다', () => {
    expect(T.commit).toBe('커밋')
    expect(T.branch).toBe('브랜치')
    expect(T.stash).toBe('스태시')
    expect(T.merge).toBe('병합')
    expect(T.push).toBe('푸시')
    expect(T.conflict).toBe('충돌')
  })
})
