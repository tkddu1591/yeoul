import type { BranchInfo, ChangeKind, FileChange, RepositoryStatus } from '@git-gui/domain'

export type ParsedStatus = Pick<RepositoryStatus, 'branch' | 'changes'>

function kindFromChar(char: string): ChangeKind | null {
  switch (char) {
    case 'M':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'T':
      return 'typechange'
    case '.':
      return null
    default:
      // 실물 porcelain v2의 1/2 레코드에는 위 문자만 등장한다(충돌은 u 레코드 전담).
      // 미래 git이 새 문자를 도입하면 일단 modified로 표시된다 — 여기가 그 위장 지점이다.
      return 'modified'
  }
}

/**
 * `git status --porcelain=v2 --branch -z` 출력을 파싱한다.
 * -z 모드: 레코드는 NUL로 구분되고, rename(2) 레코드는 경로 뒤 NUL 다음에 원본 경로가 온다.
 * 필드 수가 모자란 기형 레코드는 추측해 채우지 않고 건너뛴다.
 */
export function parseStatusV2(rawOutput: string): ParsedStatus {
  const tokens = rawOutput.split('\0')
  if (tokens.length > 0 && tokens[tokens.length - 1] === '') tokens.pop()

  const branch: BranchInfo = { name: null, upstream: null, ahead: null, behind: null }
  const changes: FileChange[] = []

  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]!
    if (token.startsWith('# branch.head ')) {
      const value = token.slice('# branch.head '.length)
      branch.name = value === '(detached)' ? null : value
    } else if (token.startsWith('# branch.upstream ')) {
      branch.upstream = token.slice('# branch.upstream '.length)
    } else if (token.startsWith('# branch.ab ')) {
      const match = /\+(\d+) -(\d+)/.exec(token)
      if (match) {
        branch.ahead = Number(match[1])
        branch.behind = Number(match[2])
      }
    } else if (token.startsWith('1 ')) {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const parts = token.split(' ')
      if (parts.length >= 9) {
        const xy = parts[1]!
        changes.push({
          path: parts.slice(8).join(' '),
          origPath: null,
          staged: kindFromChar(xy[0]!),
          unstaged: kindFromChar(xy[1]!),
        })
      }
    } else if (token.startsWith('2 ')) {
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <Xscore> <path> NUL <origPath>
      const parts = token.split(' ')
      const origPath = tokens[i + 1]
      if (parts.length >= 10 && origPath !== undefined) {
        i += 1
        const xy = parts[1]!
        changes.push({
          path: parts.slice(9).join(' '),
          origPath,
          staged: kindFromChar(xy[0]!),
          unstaged: kindFromChar(xy[1]!),
        })
      }
    } else if (token.startsWith('u ')) {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      const parts = token.split(' ')
      if (parts.length >= 11) {
        changes.push({
          path: parts.slice(10).join(' '),
          origPath: null,
          staged: null,
          unstaged: 'conflicted',
        })
      }
    } else if (token.startsWith('? ')) {
      changes.push({
        path: token.slice(2),
        origPath: null,
        staged: null,
        unstaged: 'untracked',
      })
    }
    // '!'(ignored)와 '# branch.oid'는 이번 범위에서 무시한다
    i += 1
  }

  return { branch, changes }
}
