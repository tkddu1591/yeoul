import { describe, expect, it } from 'vitest'
import { isHeadBackedUp } from '../src/renderer/src/components/backup-state'

describe('isHeadBackedUp', () => {
  it('upstream이 없으면 백업된 적이 없다', () => {
    expect(isHeadBackedUp({ name: 'main', upstream: null, ahead: null, behind: null })).toBe(false)
  })

  it('ahead 0이면 HEAD가 원격에 있다 — 경고 대상', () => {
    expect(isHeadBackedUp({ name: 'main', upstream: 'origin/main', ahead: 0, behind: 0 })).toBe(true)
  })

  it('ahead가 있으면 HEAD 자신은 아직 안 올라갔다', () => {
    expect(isHeadBackedUp({ name: 'main', upstream: 'origin/main', ahead: 2, behind: 0 })).toBe(false)
  })

  it('판정 불가(ahead null)는 보수적으로 백업됐다고 본다 — 경고를 놓치지 않는다', () => {
    expect(isHeadBackedUp({ name: 'main', upstream: 'origin/main', ahead: null, behind: null })).toBe(
      true,
    )
  })
})
