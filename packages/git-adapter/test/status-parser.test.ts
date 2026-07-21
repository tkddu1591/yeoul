import { describe, expect, it } from 'vitest'
import { parseStatusV2 } from '../src/status-parser'

// git status --porcelain=v2 --branch -z 출력은 NUL(\0) 구분 레코드다
function raw(records: string[]): string {
  return records.join('\0') + '\0'
}

describe('parseStatusV2', () => {
  it('브랜치 헤더를 파싱한다', () => {
    const parsed = parseStatusV2(
      raw([
        '# branch.oid 1234567890abcdef',
        '# branch.head main',
        '# branch.upstream origin/main',
        '# branch.ab +2 -1',
      ]),
    )
    expect(parsed.branch).toEqual({ name: 'main', upstream: 'origin/main', ahead: 2, behind: 1 })
    expect(parsed.changes).toEqual([])
  })

  it('detached HEAD는 name이 null이다', () => {
    const parsed = parseStatusV2(raw(['# branch.oid abc', '# branch.head (detached)']))
    expect(parsed.branch.name).toBeNull()
  })

  it('일반 변경(1) 레코드를 staged/unstaged로 나눠 파싱한다', () => {
    const parsed = parseStatusV2(
      raw([
        '1 M. N... 100644 100644 100644 aaa bbb staged-only.ts',
        '1 .M N... 100644 100644 100644 aaa bbb unstaged-only.ts',
        '1 MM N... 100644 100644 100644 aaa bbb both.ts',
        '1 A. N... 000000 100644 100644 000 bbb new-staged.ts',
        '1 .D N... 100644 100644 000000 aaa bbb deleted.ts',
      ]),
    )
    expect(parsed.changes).toEqual([
      { path: 'staged-only.ts', origPath: null, staged: 'modified', unstaged: null },
      { path: 'unstaged-only.ts', origPath: null, staged: null, unstaged: 'modified' },
      { path: 'both.ts', origPath: null, staged: 'modified', unstaged: 'modified' },
      { path: 'new-staged.ts', origPath: null, staged: 'added', unstaged: null },
      { path: 'deleted.ts', origPath: null, staged: null, unstaged: 'deleted' },
    ])
  })

  it('공백이 포함된 파일명을 보존한다', () => {
    const parsed = parseStatusV2(raw(['1 .M N... 100644 100644 100644 aaa bbb my file.txt']))
    expect(parsed.changes[0]?.path).toBe('my file.txt')
  })

  it('rename(2) 레코드는 다음 토큰을 origPath로 읽는다', () => {
    const parsed = parseStatusV2(
      raw(['2 R. N... 100644 100644 100644 aaa bbb R100 new-name.ts', 'old-name.ts']),
    )
    expect(parsed.changes).toEqual([
      { path: 'new-name.ts', origPath: 'old-name.ts', staged: 'renamed', unstaged: null },
    ])
  })

  it('untracked(?) 레코드를 파싱한다', () => {
    const parsed = parseStatusV2(raw(['? new.txt']))
    expect(parsed.changes).toEqual([
      { path: 'new.txt', origPath: null, staged: null, unstaged: 'untracked' },
    ])
  })

  it('unmerged(u) 레코드는 conflicted로 표시한다', () => {
    const parsed = parseStatusV2(
      raw(['u UU N... 100644 100644 100644 100644 h1 h2 h3 conflict.ts']),
    )
    expect(parsed.changes).toEqual([
      { path: 'conflict.ts', origPath: null, staged: null, unstaged: 'conflicted' },
    ])
  })

  it('빈 출력이면 빈 결과를 반환한다', () => {
    const parsed = parseStatusV2('')
    expect(parsed.branch).toEqual({ name: null, upstream: null, ahead: null, behind: null })
    expect(parsed.changes).toEqual([])
  })

  it('upstream은 있지만 branch.ab가 없으면 ahead/behind는 null이다', () => {
    const parsed = parseStatusV2(
      raw(['# branch.oid abc', '# branch.head main', '# branch.upstream origin/main']),
    )
    expect(parsed.branch).toEqual({
      name: 'main',
      upstream: 'origin/main',
      ahead: null,
      behind: null,
    })
  })

  it('typechange와 copied를 파싱한다', () => {
    const parsed = parseStatusV2(
      raw([
        '1 .T N... 100644 100644 120000 aaa bbb link.ts',
        '2 C. N... 100644 100644 100644 aaa bbb C100 copy.ts',
        'orig.ts',
      ]),
    )
    expect(parsed.changes).toEqual([
      { path: 'link.ts', origPath: null, staged: null, unstaged: 'typechange' },
      { path: 'copy.ts', origPath: 'orig.ts', staged: 'copied', unstaged: null },
    ])
  })

  it('branch.oid를 headHash로 파싱한다', () => {
    const parsed = parseStatusV2(raw(['# branch.oid 1234567890abcdef', '# branch.head main']))
    expect(parsed.headHash).toBe('1234567890abcdef')
  })

  it('아직 저장이 없으면(initial) headHash가 null이다', () => {
    const parsed = parseStatusV2(raw(['# branch.oid (initial)', '# branch.head main']))
    expect(parsed.headHash).toBeNull()
  })

  it('필드가 모자란 기형 레코드는 추측하지 않고 건너뛴다', () => {
    const parsed = parseStatusV2(raw(['1 .M N... 100644', 'u UU N...']))
    expect(parsed.changes).toEqual([])
  })
})
