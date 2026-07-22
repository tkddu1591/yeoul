import type { BranchOverview, LocalBranchStatus, RemoteBranchRef } from '@git-gui/domain'

const FIELD_SEPARATOR = '\x1f'

/**
 * `%(upstream:track)` 해석 (실측 1): "[ahead 1, behind 2]" · "[ahead 3]" · "[behind 2]" ·
 * "[gone]"(원격이 지워짐) · ""(동기화 — upstream 없음과의 구분은 upstream 필드가 한다)
 */
function parseTrack(track: string): { ahead: number; behind: number; gone: boolean } {
  if (track === '[gone]') return { ahead: 0, behind: 0, gone: true }
  const ahead = /\bahead (\d+)/.exec(track)
  const behind = /\bbehind (\d+)/.exec(track)
  return {
    ahead: ahead ? Number(ahead[1]) : 0,
    behind: behind ? Number(behind[1]) : 0,
    gone: false,
  }
}

/**
 * `git for-each-ref refs/heads refs/remotes` 출력(줄 단위, 필드 US 구분)을 패널용 개요로 파싱한다.
 * - symref가 비어 있지 않은 행(origin/HEAD — 실측 1: short 이름이 "origin"으로 나온다)은 ref가 아니므로 제외
 * - refs/heads/* → locals, refs/remotes/* → remotes. 기형 행은 추측하지 않고 건너뛴다 (log-parser 관례)
 */
export function parseOverview(rawOutput: string, currentBranch: string | null): BranchOverview {
  const locals: LocalBranchStatus[] = []
  const remotes: RemoteBranchRef[] = []
  for (const line of rawOutput.split('\n')) {
    if (line === '') continue
    const fields = line.split(FIELD_SEPARATOR)
    if (fields.length < 7) continue
    const [refname, short, symref, upstream, track, committedAtRaw, hash] = fields as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
    if (symref !== '') continue
    const committedAt = Number(committedAtRaw)
    if (!Number.isFinite(committedAt)) continue
    if (refname.startsWith('refs/heads/')) {
      const { ahead, behind, gone } = parseTrack(track)
      const hasUpstream = upstream !== '' && !gone
      locals.push({
        name: short,
        isCurrent: short === currentBranch,
        upstream: upstream === '' ? null : upstream,
        upstreamGone: gone,
        ahead: hasUpstream ? ahead : null,
        behind: hasUpstream ? behind : null,
        committedAt,
        hash,
      })
    } else if (refname.startsWith('refs/remotes/')) {
      const slash = short.indexOf('/')
      if (slash <= 0) continue
      remotes.push({ remote: short.slice(0, slash), name: short })
    }
  }
  return { locals, remotes }
}
