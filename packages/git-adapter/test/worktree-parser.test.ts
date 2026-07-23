import { describe, expect, it } from 'vitest'
import { parseWorktrees } from '../src/worktree-parser'

const NUL = '\0'
const HASH = 'a'.repeat(40)

/** 실측 A·B 형식 — 필드는 NUL 종결, 레코드 구분은 빈 필드(연속 NUL) */
function record(...fields: string[]): string {
  return fields.map((field) => field + NUL).join('') + NUL
}

describe('parseWorktrees', () => {
  it('본체(첫 항목)와 링크드를 담고 branch 접두를 벗긴다', () => {
    const raw =
      record('worktree /repo', `HEAD ${HASH}`, 'branch refs/heads/main') +
      record('worktree /repo-feat', `HEAD ${HASH}`, 'branch refs/heads/feature/login')
    expect(parseWorktrees(raw)).toEqual([
      { path: '/repo', isMain: true, branch: 'main', headHash: HASH, prunable: false, locked: false },
      {
        path: '/repo-feat',
        isMain: false,
        branch: 'feature/login',
        headHash: HASH,
        prunable: false,
        locked: false,
      },
    ])
  })

  it('detached는 branch가 null이다', () => {
    const raw = record('worktree /repo-d', `HEAD ${HASH}`, 'detached')
    expect(parseWorktrees(raw)[0]).toMatchObject({ branch: null, headHash: HASH })
  })

  it('prunable(사유 병기 형식 — 실측 B)을 표시한다', () => {
    const raw = record(
      'worktree /repo-gone',
      `HEAD ${HASH}`,
      'branch refs/heads/gone-branch',
      'prunable gitdir file points to non-existent location',
    )
    expect(parseWorktrees(raw)[0]).toMatchObject({ prunable: true, branch: 'gone-branch' })
  })

  it('locked(사유 유무 모두)을 표시한다', () => {
    const raw =
      record('worktree /a', `HEAD ${HASH}`, 'branch refs/heads/x', 'locked') +
      record('worktree /b', `HEAD ${HASH}`, 'branch refs/heads/y', 'locked 이유가 있음')
    const parsed = parseWorktrees(raw)
    expect(parsed[0]?.locked).toBe(true)
    expect(parsed[1]?.locked).toBe(true)
  })

  it('빈 입력이면 빈 배열이다', () => {
    expect(parseWorktrees('')).toEqual([])
  })

  it('worktree 필드가 없는 기형 레코드는 추측하지 않고 건너뛴다', () => {
    const raw = record(`HEAD ${HASH}`, 'branch refs/heads/x') + record('worktree /ok', `HEAD ${HASH}`, 'detached')
    expect(parseWorktrees(raw).map((worktree) => worktree.path)).toEqual(['/ok'])
  })
})
