import type { BranchInfo, ChangeKind, FileChange } from '@git-gui/domain'

export interface ParsedStatus {
  branch: BranchInfo
  changes: FileChange[]
}

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
      return 'modified'
  }
}

/**
 * `git status --porcelain=v2 --branch -z` 출력을 파싱한다.
 * -z 모드: 레코드는 NUL로 구분되고, rename(2) 레코드는 경로 뒤 NUL 다음에 원본 경로가 온다.
 */
export function parseStatusV2(rawOutput: string): ParsedStatus {
  const tokens = rawOutput.split('\0').filter((t) => t.length > 0)
  const branch: BranchInfo = { name: null, upstream: null, ahead: 0, behind: 0 }
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
      const xy = parts[1]!
      changes.push({
        path: parts.slice(8).join(' '),
        origPath: null,
        staged: kindFromChar(xy[0]!),
        unstaged: kindFromChar(xy[1]!),
      })
    } else if (token.startsWith('2 ')) {
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <Xscore> <path> NUL <origPath>
      const parts = token.split(' ')
      const xy = parts[1]!
      i += 1
      changes.push({
        path: parts.slice(9).join(' '),
        origPath: tokens[i] ?? null,
        staged: kindFromChar(xy[0]!),
        unstaged: kindFromChar(xy[1]!),
      })
    } else if (token.startsWith('u ')) {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      const parts = token.split(' ')
      changes.push({
        path: parts.slice(10).join(' '),
        origPath: null,
        staged: null,
        unstaged: 'conflicted',
      })
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
