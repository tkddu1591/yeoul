import { describe, expect, it } from 'vitest'
import { detectGhToken } from '../src/gh-token'

describe('detectGhToken', () => {
  it('gh가 토큰을 출력하면 개행을 벗겨 돌려준다', async () => {
    const runner = async (command: string, args: string[]) => {
      expect(command).toBe('gh')
      expect(args).toEqual(['auth', 'token'])
      return 'gho_abc123\n'
    }
    expect(await detectGhToken(runner)).toBe('gho_abc123')
  })

  it('gh가 없거나 실패하면(reject) 조용히 null이다', async () => {
    const runner = async () => {
      throw new Error('spawn gh ENOENT')
    }
    expect(await detectGhToken(runner)).toBeNull()
  })

  it('빈 출력도 null이다 — 빈 토큰으로 연결을 시도하지 않는다', async () => {
    expect(await detectGhToken(async () => '\n')).toBeNull()
  })
})
