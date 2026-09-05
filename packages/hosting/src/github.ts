import { pullAdapter } from './pull.adapter'
import { pullTimelineAdapter, type PullComment } from './pull-timeline'

/** 리뷰 요청(pull request) 요약 — UI 목록과 생성 결과가 공유한다 */
export interface PullSummary {
  number: number
  title: string
  /** 리뷰를 요청한 실험 공간(head) */
  headBranch: string
  /** 합쳐질 대상 공간(base) */
  baseBranch: string
  /** 브라우저로 여는 주소(html_url) */
  url: string
  isDraft: boolean
}

export interface CreatePullInput {
  title: string
  head: string
  base: string
  body: string
}

/** 리뷰 요청 상세 — 상태 배지(열림/승인됨/병합됨)와 병합 후 안내가 쓴다 */
export interface PullDetail {
  number: number
  title: string
  state: 'open' | 'closed'
  merged: boolean
  url: string
  headBranch: string
  baseBranch: string
  body?: string
  isDraft?: boolean
  headSha?: string | null
  mergeable?: boolean | null
  mergeState?: string
  changedFiles?: number
  additions?: number
  deletions?: number
}

/** Hosting adapter의 GitHub 구현 표면 — 네임스페이스 객체 (main 프로세스 전용) */
export interface GitHubHosting {
  user: {
    /** 토큰 검증 겸 계정 확인 — GET /user */
    current(): Promise<{ login: string }>
  }
  repo: {
    /** 기본 공간(base) 이름 — GET /repos/{owner}/{repo}의 default_branch */
    defaultBranch(owner: string, repo: string): Promise<string>
  }
  pulls: {
    /** 열린 리뷰 요청 목록 — GET /repos/{owner}/{repo}/pulls?state=open */
    list(owner: string, repo: string): Promise<PullSummary[]>
    /** 리뷰 요청 생성 — 이미 있으면 GitHub 422를 친절 문구로 매핑해 던진다 */
    create(owner: string, repo: string, input: CreatePullInput): Promise<PullSummary>
    /** 상세 — GET /pulls/{n}. 밖에서 닫힘·삭제된 404는 친절 문구로 매핑한다 */
    get(owner: string, repo: string, number: number): Promise<PullDetail>
    /** 코멘트 타임라인 — 이슈 코멘트 + 리뷰 요약 병합·시간순(buildPullTimeline) */
    comments(owner: string, repo: string, number: number): Promise<PullComment[]>
    /** 답변 달기 — POST /issues/{n}/comments (빈 본문 거부는 IPC 책임) */
    addComment(owner: string, repo: string, number: number, body: string): Promise<void>
    /** 승인 — POST /pulls/{n}/reviews { event: APPROVE }. 자기 PR 422는 친절 문구로 */
    approve(owner: string, repo: string, number: number): Promise<void>
    /** 병합(병합 커밋 — 조상 기록 보존) — PUT /pulls/{n}/merge. 405·409는 친절 문구로 */
    merge(owner: string, repo: string, number: number, sha?: string): Promise<void>
  }
}

export interface GitHubHostingOptions {
  /** 테스트·E2E에서 mock 서버로 바꿔 끼운다 — 기본은 GitHub 공식 API */
  baseUrl?: string
  token: string
}

/** GitHub 에러를 일상어로(스펙 §5 문구 원칙) — 알 수 없는 실패만 상태 코드를 남긴다 */
function toFriendlyMessage(status: number, body: string): string {
  if (status === 401) return '연결이 만료됐어요. 다시 연결해 주세요.'
  if (status === 403 && /rate limit/i.test(body)) {
    return '요청이 너무 많았어요. 잠시 후 다시 시도해 주세요.'
  }
  if (status === 403) return 'GitHub이 요청을 거부했어요. 토큰 권한(repo)을 확인해 주세요.'
  if (status === 404) return 'GitHub에서 저장소를 찾을 수 없어요. 주소와 접근 권한을 확인해 주세요.'
  // GitHub는 "A pull request already exists for o:branch."를 errors[]에 담는다 — 본문 전체에서 찾는다
  if (status === 422 && body.includes('pull request already exists')) {
    return '이 브랜치의 풀 리퀘스트가 이미 있어요.'
  }
  return `GitHub 요청이 실패했어요. (HTTP ${status})`
}

export function createGitHubHosting({
  baseUrl = 'https://api.github.com',
  token,
}: GitHubHostingOptions): GitHubHosting {
  async function request(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    // 호출 맥락이 더 정확한 문구를 아는 상태 코드만 재정의한다(null이면 기본 매핑으로 폴백)
    mapError?: (status: number, text: string) => string | null,
  ): Promise<unknown> {
    let response: Response
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'git-gui',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      // DNS 실패·연결 거부 등 상태 코드가 없는 실패는 전부 네트워크 문제다
      throw new Error('인터넷 연결을 확인해 주세요.')
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(mapError?.(response.status, text) ?? toFriendlyMessage(response.status, text))
    }
    return response.json()
  }

  // 저장소 좌표는 remote URL에서 왔다 — URL 경로로 밀수되지 않게 세그먼트 단위로 인코딩한다
  async function readCollection(path: string): Promise<unknown[]> {
    const items: unknown[] = []
    for (let page = 1; page <= 100; page++) {
      const batch = (await request(
        'GET',
        page === 1 ? path : `${path}&page=${page}`,
        undefined,
        pullNotFound,
      )) as unknown[]
      if (!Array.isArray(batch)) throw new Error('GitHub 목록 응답을 읽지 못했어요.')
      items.push(...batch)
      if (batch.length < 100) return items
    }
    throw new Error(
      '리뷰 기록이 너무 많아 현재 상태를 확인하지 못했어요. GitHub에서 확인해 주세요.',
    )
  }

  const repoPath = (owner: string, repo: string): string =>
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`

  // PR 단위 경로의 404는 "저장소 없음"이 아니라 "리뷰 요청 없음"이다(밖에서 닫힘·삭제)
  const pullNotFound = (status: number): string | null =>
    status === 404 ? '풀 리퀘스트를 찾지 못했어요. 목록을 새로 열어 주세요.' : null

  return {
    user: {
      async current() {
        const raw = (await request('GET', '/user')) as { login: string }
        return { login: raw.login }
      },
    },
    repo: {
      async defaultBranch(owner, repo) {
        const raw = (await request('GET', repoPath(owner, repo))) as { default_branch: string }
        return raw.default_branch
      },
    },
    pulls: {
      async list(owner, repo) {
        const raw = (await request(
          'GET',
          `${repoPath(owner, repo)}/pulls?state=open&per_page=50`,
        )) as unknown[]
        return raw.map(pullAdapter.summary.from)
      },
      async create(owner, repo, input) {
        return pullAdapter.summary.from(
          await request('POST', `${repoPath(owner, repo)}/pulls`, input),
        )
      },
      async get(owner, repo, number) {
        return pullAdapter.detail.from(
          await request('GET', `${repoPath(owner, repo)}/pulls/${number}`, undefined, pullNotFound),
        )
      },
      async comments(owner, repo, number) {
        const [issueComments, reviews] = await Promise.all([
          readCollection(`${repoPath(owner, repo)}/issues/${number}/comments?per_page=100`),
          readCollection(`${repoPath(owner, repo)}/pulls/${number}/reviews?per_page=100`),
        ])
        return pullTimelineAdapter.item.toList(issueComments as unknown[], reviews as unknown[])
      },
      async addComment(owner, repo, number, body) {
        await request(
          'POST',
          `${repoPath(owner, repo)}/issues/${number}/comments`,
          { body },
          pullNotFound,
        )
      },
      async approve(owner, repo, number) {
        await request(
          'POST',
          `${repoPath(owner, repo)}/pulls/${number}/reviews`,
          { event: 'APPROVE' },
          (status, text) => {
            // 실 GitHub 422 본문의 errors[]에 이 문자열이 담긴다 — 부분 문자열로 매핑
            if (status === 422 && text.includes('Can not approve your own pull request')) {
              return '내가 만든 풀 리퀘스트는 스스로 승인할 수 없어요. 다른 사람의 승인을 기다려 주세요.'
            }
            return pullNotFound(status)
          },
        )
      },
      async merge(owner, repo, number, sha) {
        // 병합 커밋(merge commit) 고정 — 앱 철학: 조상 기록을 남긴다(squash·rebase 비목표)
        await request(
          'PUT',
          `${repoPath(owner, repo)}/pulls/${number}/merge`,
          { merge_method: 'merge', ...(sha ? { sha } : {}) },
          (status) => {
            if (status === 405) {
              return '아직 병합할 수 없어요. 충돌이나 진행 중인 검사가 있는지 브라우저에서 확인해 주세요.'
            }
            if (status === 409) return '풀 리퀘스트가 방금 바뀌었어요. 다시 열어 확인해 주세요.'
            return pullNotFound(status)
          },
        )
      },
    },
  }
}
