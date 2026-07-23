import { describe, expect, it } from 'vitest'
import { silentExitNotice } from '../src/renderer/src/ui/terminal/silent-exit'

describe('silentExitNotice', () => {
  it('출력 없이 종료하면 쉘 설정 안내를 돌려준다 (exit code 무관 — 실측 2)', () => {
    expect(silentExitNotice(false)).toBe(
      '쉘이 바로 종료됐어요. 로그인 쉘($SHELL) 설정을 확인해 주세요.',
    )
  })

  it('출력이 있었던 세션의 종료는 정상 — 안내 없음', () => {
    expect(silentExitNotice(true)).toBeNull()
  })
})
