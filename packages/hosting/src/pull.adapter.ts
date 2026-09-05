import type { PullDetail, PullSummary } from './github'

/** GitHub REST 응답의 pull 객체 — 우리가 쓰는 필드만 */
interface RawPull {
  number: number
  title: string
  draft?: boolean
  html_url: string
  head: { ref: string; sha?: string }
  base: { ref: string }
}

function toPullSummary(raw: unknown): PullSummary {
  const pull = raw as RawPull
  return {
    number: pull.number,
    title: pull.title,
    headBranch: pull.head.ref,
    baseBranch: pull.base.ref,
    url: pull.html_url,
    isDraft: pull.draft === true,
  }
}

/** GitHub REST 응답의 pull 상세 — 우리가 쓰는 필드만 */
interface RawPullDetail extends RawPull {
  state: string
  merged?: boolean
  body?: string
  mergeable?: boolean | null
  mergeable_state?: string
  changed_files?: number
  additions?: number
  deletions?: number
}

function toPullDetail(raw: unknown): PullDetail {
  const pull = raw as RawPullDetail
  return {
    number: pull.number,
    title: pull.title,
    state: pull.state === 'closed' ? 'closed' : 'open',
    merged: pull.merged === true,
    body: pull.body ?? '',
    isDraft: pull.draft === true,
    headSha: pull.head.sha ?? null,
    mergeable: typeof pull.mergeable === 'boolean' ? pull.mergeable : null,
    mergeState: pull.mergeable_state ?? 'unknown',
    changedFiles: pull.changed_files ?? 0,
    additions: pull.additions ?? 0,
    deletions: pull.deletions ?? 0,
    url: pull.html_url,
    headBranch: pull.head.ref,
    baseBranch: pull.base.ref,
  }
}

export const pullAdapter = { summary: { from: toPullSummary }, detail: { from: toPullDetail } }
