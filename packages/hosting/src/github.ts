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
    return '이 실험 공간의 리뷰 요청이 이미 있어요.'
  }
  return `GitHub 요청이 실패했어요. (HTTP ${status})`
}

/** GitHub REST 응답의 pull 객체 — 우리가 쓰는 필드만 */
interface RawPull {
  number: number
  title: string
  draft?: boolean
  html_url: string
  head: { ref: string }
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

export function createGitHubHosting({
  baseUrl = 'https://api.github.com',
  token,
}: GitHubHostingOptions): GitHubHosting {
  async function request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
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
      throw new Error(toFriendlyMessage(response.status, text))
    }
    return response.json()
  }

  // 저장소 좌표는 remote URL에서 왔다 — URL 경로로 밀수되지 않게 세그먼트 단위로 인코딩한다
  const repoPath = (owner: string, repo: string): string =>
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`

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
        return raw.map(toPullSummary)
      },
      async create(owner, repo, input) {
        return toPullSummary(await request('POST', `${repoPath(owner, repo)}/pulls`, input))
      },
    },
  }
}
