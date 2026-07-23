import { describe, expect, it } from 'vitest'
import { suggestWorktreePath } from '../src/renderer/src/components/worktree-path'

describe('suggestWorktreePath', () => {
  it('본체 옆에 "<저장소>-<브랜치슬러그>" 형태를 제안한다', () => {
    expect(suggestWorktreePath('/home/me/my-repo', 'feature/login')).toBe(
      '/home/me/my-repo-feature-login',
    )
  })

  it('슬래시·공백을 하이픈으로 바꾼다', () => {
    expect(suggestWorktreePath('/a/b/proj', 'fix/A B')).toBe('/a/b/proj-fix-A-B')
  })

  it('끝의 슬래시가 있어도 부모 기준으로 붙인다', () => {
    expect(suggestWorktreePath('/a/proj/', 'main')).toBe('/a/proj-main')
  })
})
