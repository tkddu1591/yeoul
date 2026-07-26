import { describe, expect, it } from 'vitest'
import {
  shortenBranch,
  shortenParent,
  sourceChip,
  uniqueNames,
} from '../src/renderer/src/components/worktree-label'

const HOME = '/Users/me'

describe('shortenParent', () => {
  it('홈 바로 아래면 ~ 하나로 줄인다', () => {
    expect(shortenParent(`${HOME}/dataworks-frontend`, HOME)).toBe('~/')
  })

  it('깊은 경로는 앞을 버리고 뒤 조각을 살린다(구분되는 세션 폴더 보존)', () => {
    expect(shortenParent(`${HOME}/.claude/worktree/goofy-lalande/dataworks-frontend`, HOME)).toBe(
      '…/worktree/goofy-lalande/',
    )
  })

  it('홈 밖 경로는 ~ 축약 없이 뒤 조각을 살린다', () => {
    expect(shortenParent('/Volumes/ext/projects/repo-a/wt', HOME)).toBe('…/projects/repo-a/')
  })

  it('한 조각짜리 경로는 그대로 둔다', () => {
    expect(shortenParent('/repo', HOME)).toBe('/')
  })
})

describe('sourceChip', () => {
  it('홈 아래 dot 폴더는 그 이름이 출처다', () => {
    expect(sourceChip(`${HOME}/.claude/worktree/x/repo`, HOME)).toBe('.claude')
    expect(sourceChip(`${HOME}/.codex/worktree/x/repo`, HOME)).toBe('.codex')
  })

  it('홈 바로 아래는 "내 폴더"다', () => {
    expect(sourceChip(`${HOME}/dataworks-frontend`, HOME)).toBe('내 폴더')
  })

  it('홈 밖은 최상위 폴더 이름이다', () => {
    expect(sourceChip('/Volumes/ext/projects/repo', HOME)).toBe('Volumes')
  })
})

describe('uniqueNames', () => {
  it('겹치지 않으면 짧은 이름을 유지한다', () => {
    const names = uniqueNames([`${HOME}/alpha`, `${HOME}/beta`])
    expect(names.get(`${HOME}/alpha`)).toBe('alpha')
    expect(names.get(`${HOME}/beta`)).toBe('beta')
  })

  it('겹치면 구분되는 조상 폴더를 앞에 붙인다', () => {
    const a = `${HOME}/.claude/worktree/goofy/repo`
    const b = `${HOME}/.codex/worktree/pivot/repo`
    const names = uniqueNames([a, b])
    expect(names.get(a)).toBe('goofy/repo')
    expect(names.get(b)).toBe('pivot/repo')
  })

  it('조상 한 단계로도 안 갈리면 더 붙인다', () => {
    const a = `${HOME}/.claude/worktree/s/repo`
    const b = `${HOME}/.codex/worktree/s/repo`
    const names = uniqueNames([a, b])
    expect(names.get(a)).toBe('.claude/worktree/s/repo')
    expect(names.get(b)).toBe('.codex/worktree/s/repo')
  })
})

describe('shortenBranch', () => {
  it('짧으면 그대로 둔다', () => {
    expect(shortenBranch('main', 20)).toBe('main')
  })

  it('길면 앞을 생략해 뒤(구분 정보)를 살린다', () => {
    expect(shortenBranch('claude/dw-1051-work-review-final', 20)).toBe('…dw-1051-work-review')
  })

  it('네임스페이스가 없으면 잘린 꼬리 쪽에 표시를 남긴다', () => {
    const long = 'a-very-long-branch-name-without-any-namespace'
    const short = shortenBranch(long, 28)
    expect(short.endsWith('…')).toBe(true)
    expect(short.startsWith('…')).toBe(false)
    expect(short).toBe('a-very-long-branch-name-wit…')
  })
})
