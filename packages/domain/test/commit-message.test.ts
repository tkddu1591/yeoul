import { describe, expect, it } from 'vitest'
import type { FileChange } from '../src/repository'
import { suggestCommitMessage } from '../src/commit-message'

function staged(path: string, kind: FileChange['staged']): FileChange {
  return { path, origPath: null, staged: kind, unstaged: null }
}

function unstagedOnly(path: string): FileChange {
  return { path, origPath: null, staged: null, unstaged: 'modified' }
}

describe('suggestCommitMessage', () => {
  it('staged가 없으면 빈 문자열 — 제안 없음', () => {
    expect(suggestCommitMessage([])).toBe('')
    expect(suggestCommitMessage([unstagedOnly('a.ts')])).toBe('')
  })

  it('파일 1개: "파일명 동사" 형태', () => {
    expect(suggestCommitMessage([staged('app.txt', 'modified')])).toBe('app.txt 수정')
    expect(suggestCommitMessage([staged('login.css', 'added')])).toBe('login.css 추가')
    expect(suggestCommitMessage([staged('old.ts', 'deleted')])).toBe('old.ts 삭제')
    expect(suggestCommitMessage([staged('new.ts', 'renamed')])).toBe('new.ts 이름 변경')
  })

  it('중첩 경로는 파일명(basename)만 쓴다', () => {
    expect(suggestCommitMessage([staged('src/ui/Button.tsx', 'modified')])).toBe('Button.tsx 수정')
  })

  it('여러 파일, 같은 종류: "첫 파일 외 N개 동사"', () => {
    expect(
      suggestCommitMessage([staged('a.ts', 'modified'), staged('b.ts', 'modified')]),
    ).toBe('a.ts 외 1개 수정')
  })

  it('여러 파일, 종류 혼합: 동사는 "변경"', () => {
    expect(
      suggestCommitMessage([
        staged('a.ts', 'modified'),
        staged('b.ts', 'added'),
        staged('c.ts', 'deleted'),
      ]),
    ).toBe('a.ts 외 2개 변경')
  })

  it('unstaged 항목은 제안에 포함되지 않는다', () => {
    expect(
      suggestCommitMessage([staged('a.ts', 'modified'), unstagedOnly('b.ts')]),
    ).toBe('a.ts 수정')
  })
})
