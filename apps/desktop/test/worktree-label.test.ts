import { describe, expect, it } from 'vitest'
import {
  shortenAbove,
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
    // E7j 보완 I-1 — 네임스페이스를 지운 뒤에도 길면 꼬리도 잘린다. 앞만 …로 표시하면
    // 실제 문자가 아닌 곳에서 끝난 것처럼 읽혀 양끝에 표시를 남기도록 갱신(편차 보고 대상)
    expect(shortenBranch('claude/dw-1051-work-review-final', 20)).toBe('…dw-1051-work-revie…')
  })

  it('네임스페이스가 없으면 잘린 꼬리 쪽에 표시를 남긴다', () => {
    const long = 'a-very-long-branch-name-without-any-namespace'
    const short = shortenBranch(long, 28)
    expect(short.endsWith('…')).toBe(true)
    expect(short.startsWith('…')).toBe(false)
    expect(short).toBe('a-very-long-branch-name-wit…')
  })

  it('네임스페이스를 지운 뒤에도 길면 꼬리에도 표시를 남긴다', () => {
    expect(shortenBranch('claude/dw-1051-work-review-final', 20)).toBe('…dw-1051-work-revie…')
  })
})

describe('shortenAbove', () => {
  // E7j 보완 편차: 플랜 예시값 '…/.claude/worktree/'는 함수 자체의 doc 주석 예시(~/.claude/worktree/)와
  // 모순된다 — rest.length(2)<=keep(2)라 tilde 분기가 맞는 실제 동작이라 doc 주석 값으로 갱신
  it('이름이 담은 조각 위쪽만 보여준다', () => {
    expect(shortenAbove(`${HOME}/.claude/worktree/goofy/repo`, HOME, 2)).toBe('~/.claude/worktree/')
  })

  it('이름이 리프 하나면 부모까지 보여준다', () => {
    expect(shortenAbove(`${HOME}/projects/repo`, HOME, 1)).toBe('~/projects/')
  })
})
