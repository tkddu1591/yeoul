# E3a 호스팅 연결 + 리뷰 요청(PR) 생성·목록 구현 계획 (스펙 §9 전반부·§5 문구 원칙·§11 E3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub와 연결(gh CLI 자동 감지 또는 토큰 붙여넣기)하고, 헤더 "리뷰" 팝오버에서 현재 실험 공간의 리뷰 요청(pull request)을 만들고 열린 목록을 보며 클릭으로 브라우저에서 연다. 코멘트·승인·병합은 E3b.

**Architecture(핵심 결정 — 변경 불가):** 새 패키지 `packages/hosting`이 Hosting adapter(GitHub 구현)를 담는다 — 의존성 없이 전역 fetch(Node 22), **main 프로세스에서만 실행**되어 네트워크·토큰이 renderer에 노출되지 않는다. 토큰은 `safeStorage.encryptString` → base64로 settings.json의 `hosting.github.token`에 저장하고, **renderer에는 login명만 간다**(settings getSync가 hosting 필드를 걷어낸다). GitHub 저장소 판정은 origin remote URL 파싱(`parseRemoteUrl`)이 정본. `hosting:pull-create`는 main에서 현재 브랜치·기본 공간을 검사하고 upstream이 없으면 기존 `sync.push`(백업)를 먼저 실행한다. E2E는 `GIT_GUI_GITHUB_API`(baseUrl 오버라이드)·`GIT_GUI_E2E_GH_TOKEN`(토큰 사전 주입) env + 테스트 안에서 띄우는 node:http mock GitHub 서버로 실 네트워크 없이 검증한다.

**Tech Stack:** 기존과 동일 (신규 외부 의존성 없음 — hosting 패키지는 전역 fetch·node:http(테스트)만 사용).

**실측으로 확정한 동작 (probe 저장소 + 로컬 실행):**

- **E2E 픽스처의 upstream 성립 조건(이 플랜의 미끄러운 지점 — 해결책 (ii) 채택 근거):** origin URL을 GitHub 형태(`https://github.com/e2e/fixture.git`)로 두고 `git config branch.<name>.remote origin` + `git config branch.<name>.merge refs/heads/<name>`만 설정하면 **`git rev-parse --abbrev-ref --symbolic-full-name @{upstream}`은 exit 128로 실패한다**(unknown revision — remote-tracking ref 부재). 여기에 **`git update-ref refs/remotes/origin/<name> HEAD`를 더하면 exit 0**으로 해석되고, `git status --porcelain=v2 --branch`가 **네트워크 접근 없이 `# branch.ab +0 -0`을 계산한다**(로컬 ref끼리 비교). 따라서 pull-create의 upstream 검사(`hasUpstream === true`)가 성립해 **push 경로를 건너뛰고**, 만약 회귀로 push가 실행되면 GitHub https URL로의 실 push가 실패해 테스트가 시끄럽게 죽는다(무해 통과 없음). 프로덕션 경로는 전혀 변형하지 않는다. push 경로 자체는 단위 테스트에서 로컬 bare remote(`createFixtureRepoWithRemote`)로 커버한다.
- 기준선 실측: **253 tests PASS**(`pnpm test` 실행 확인), **E2E 29**(smoke.spec.ts `^test(` 계수).
- lucide-react 1.24.0(설치본) 아이콘 실측: `git-pull-request`·`key`·`terminal`·`unplug`·`external-link` 존재, GitHub 브랜드 아이콘은 없음 → gh 연결 버튼은 `Terminal` 아이콘 사용.
- `@types/node` 22는 전역 `fetch`/`Response` 타입을 제공한다(base tsconfig lib ES2022 + types node로 충분).

**알려진 한계(의도적):**

- 리뷰 요청 본문(body)은 빈 문자열 — 제목만 입력받는다(본문 편집은 E3b 후보).
- upstream이 이미 있으나 원격보다 앞선(ahead>0) 상태에서는 push를 추가로 하지 않는다 — 아키텍처 확정 문구("upstream 없으면 push")를 따르며, 자동 백업 확대는 후속 노트로.
- 기본 공간 비활성의 UI 판정은 `main`·`master` 이름 휴리스틱(빠른 안내)이고, **확정 거부는 main 프로세스가 GitHub API의 default_branch를 실제 조회해 수행**한다(비표준 기본 공간 이름도 안전).
- `GIT_GUI_E2E_GH_TOKEN` env 주입 토큰은 연결 해제로 지워지지 않는다(E2E 전용 경로 — 프로덕션은 env 미설정).

---

## 파일 구조

```
packages/hosting/package.json                                # 새 패키지 (생성)
packages/hosting/tsconfig.json                               # (생성)
packages/hosting/vitest.config.ts                            # (생성)
packages/hosting/src/index.ts                                # 배럴 (생성)
packages/hosting/src/remote-url.ts                           # parseRemoteUrl (생성)
packages/hosting/src/github.ts                               # createGitHubHosting·PullSummary (생성)
packages/hosting/src/gh-token.ts                             # detectGhToken (생성)
packages/hosting/test/remote-url.test.ts                     # +6 (생성)
packages/hosting/test/github.test.ts                         # mock http 왕복 +9 (생성)
packages/hosting/test/gh-token.test.ts                       # +3 (생성)
tsconfig.base.json                                           # paths 추가 (수정)
packages/domain/src/repository.ts                            # SyncBranchStatus (수정)
packages/git-adapter/src/client.ts                           # sync.branchStatus·remoteUrl (수정)
packages/git-adapter/test/client.test.ts                     # +4 (수정)
packages/ipc-contract/src/index.ts                           # PersistedSettings·HostingApi·채널 (수정)
packages/ipc-contract/package.json                           # @git-gui/hosting 의존성 (수정)
packages/ipc-contract/test/settings.test.ts                  # +3 (수정)
apps/desktop/package.json                                    # @git-gui/hosting 의존성 (수정)
apps/desktop/src/main/settings.ts                            # 토큰 저장·getSync 차단 (전면 개편)
apps/desktop/src/main/git-handlers.ts                        # assert 2개 export (수정)
apps/desktop/src/main/hosting-handlers.ts                    # IPC 핸들러 7개 (생성)
apps/desktop/src/main/index.ts                               # 배선 (수정)
apps/desktop/src/preload/index.ts                            # hostingApi 브리지 (수정)
apps/desktop/src/renderer/src/env.d.ts                       # window.hostingApi (수정)
apps/desktop/src/renderer/src/store/repository-store.ts      # hostingStatus·pulls·액션 7개 (수정)
apps/desktop/src/renderer/src/components/ReviewPopover.tsx   # 리뷰 팝오버 (생성)
apps/desktop/src/renderer/src/components/review-popover.css  # (생성)
apps/desktop/src/renderer/src/App.tsx                        # 배선 + 다이얼로그 2개 (수정)
apps/desktop/e2e/hosting.spec.ts                             # E2E 3건 + mock 서버 (생성)
README.md                                                    # 현재 상태 갱신 (수정)
```

---

### Task 1: packages/hosting 스캐폴드 + parseRemoteUrl (순수 함수)

**Files:**
- Create: `packages/hosting/package.json`, `packages/hosting/tsconfig.json`, `packages/hosting/vitest.config.ts`, `packages/hosting/src/index.ts`, `packages/hosting/src/remote-url.ts`
- Modify: `tsconfig.base.json`
- Test: `packages/hosting/test/remote-url.test.ts`

- [ ] **Step 1: 패키지 스캐폴드**

`packages/hosting/package.json` 생성:

```json
{
  "name": "@git-gui/hosting",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit" }
}
```

`packages/hosting/tsconfig.json` 생성:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/hosting/vitest.config.ts` 생성:

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } })
```

`packages/hosting/src/index.ts` 생성:

```ts
export * from './remote-url'
```

`tsconfig.base.json`의 paths에서 다음 행을 교체 — 기존:

```json
      "@git-gui/git-adapter": ["packages/git-adapter/src/index.ts"],
```

교체:

```json
      "@git-gui/git-adapter": ["packages/git-adapter/src/index.ts"],
      "@git-gui/hosting": ["packages/hosting/src/index.ts"],
```

Run: `pnpm install`
Expected: 성공 (새 workspace 패키지 등록 — 의존성 없음)

- [ ] **Step 2: 실패하는 테스트 (Red)**

`packages/hosting/test/remote-url.test.ts` 생성:

```ts
import { describe, expect, it } from 'vitest'
import { parseRemoteUrl } from '../src/remote-url'

describe('parseRemoteUrl', () => {
  it('https — .git이 있어도 없어도 같은 좌표다', () => {
    expect(parseRemoteUrl('https://github.com/octo/hello.git')).toEqual({
      host: 'github.com',
      owner: 'octo',
      repo: 'hello',
    })
    expect(parseRemoteUrl('https://github.com/octo/hello')).toEqual({
      host: 'github.com',
      owner: 'octo',
      repo: 'hello',
    })
  })

  it('scp형 ssh — git@github.com:octo/hello.git', () => {
    expect(parseRemoteUrl('git@github.com:octo/hello.git')).toEqual({
      host: 'github.com',
      owner: 'octo',
      repo: 'hello',
    })
  })

  it('ssh:// 형태 — 포트·사용자 정보를 허용한다', () => {
    expect(parseRemoteUrl('ssh://git@github.com:22/octo/hello.git')).toEqual({
      host: 'github.com',
      owner: 'octo',
      repo: 'hello',
    })
  })

  it('호스트 대소문자는 소문자로 정규화하고 owner/repo 표기는 보존한다', () => {
    expect(parseRemoteUrl('https://GitHub.COM/Octo/Hello.git')).toEqual({
      host: 'github.com',
      owner: 'Octo',
      repo: 'Hello',
    })
  })

  it('비GitHub 호스트도 좌표는 파싱된다 — GitHub 여부는 호출자가 host로 판정한다', () => {
    expect(parseRemoteUrl('https://gitlab.com/team/proj.git')).toEqual({
      host: 'gitlab.com',
      owner: 'team',
      repo: 'proj',
    })
  })

  it('로컬 경로·빈 문자열·이해할 수 없는 형태는 null이다', () => {
    expect(parseRemoteUrl('/tmp/git-gui-e2e-remote-abc')).toBeNull()
    expect(parseRemoteUrl('')).toBeNull()
    expect(parseRemoteUrl('https://github.com/only-owner')).toBeNull()
    expect(parseRemoteUrl('not a url')).toBeNull()
  })
})
```

- [ ] **Step 3: 실패 확인 (Red 실증)**

Run: `npx vitest run packages/hosting/test/remote-url.test.ts`
Expected: FAIL — `Failed to resolve import "../src/remote-url"` (모듈 없음)

- [ ] **Step 4: 구현**

`packages/hosting/src/remote-url.ts` 생성:

```ts
/** 원격 저장소 좌표 — host는 소문자로 정규화한다. owner/repo 표기는 원문 보존(표시용) */
export interface RemoteRepoRef {
  host: string
  owner: string
  repo: string
}

// https://github.com/o/r(.git) — 사용자 정보·포트 허용 (https://user@host:8443/o/r.git)
const HTTPS_PATTERN = /^https?:\/\/(?:[^/@]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/
// ssh://git@github.com(:22)/o/r(.git)
const SSH_PATTERN = /^ssh:\/\/(?:[^/@]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/
// scp형 — git@github.com:o/r(.git). 콜론 뒤가 경로다
const SCP_PATTERN = /^[^@/]+@([^:/]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/

/**
 * remote URL에서 { host, owner, repo }를 뽑는다 — GitHub 여부 판정은 호출자가 host로 한다.
 * 로컬 경로·bare 경로·이해할 수 없는 형태는 null (리뷰 기능이 조용히 꺼진다).
 */
export function parseRemoteUrl(url: string): RemoteRepoRef | null {
  for (const pattern of [HTTPS_PATTERN, SSH_PATTERN, SCP_PATTERN]) {
    const match = pattern.exec(url.trim())
    if (match !== null) {
      return { host: match[1]!.toLowerCase(), owner: match[2]!, repo: match[3]! }
    }
  }
  return null
}
```

- [ ] **Step 5: 통과 확인 + 게이트**

Run: `npx vitest run packages/hosting/test/remote-url.test.ts`
Expected: PASS (6 tests)

Run: `pnpm test && pnpm typecheck`
Expected: **259 tests** PASS (253 + 6) + typecheck 전부 Done (hosting 포함 6 프로젝트)

- [ ] **Step 6: Commit**

```bash
git add packages/hosting tsconfig.base.json pnpm-lock.yaml
git commit -m "feat(hosting): 새 패키지 — parseRemoteUrl (https·ssh·scp형, 호스트 정규화)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: createGitHubHosting — fetch 왕복 + 친절 에러 매핑 (node:http mock)

**Files:**
- Create: `packages/hosting/src/github.ts`
- Modify: `packages/hosting/src/index.ts`
- Test: `packages/hosting/test/github.test.ts`

- [ ] **Step 1: 실패하는 테스트 (Red)**

`packages/hosting/test/github.test.ts` 생성 (mock 서버 fixture로 **실전 fetch 왕복** — 각 메서드 + 에러 매핑 전부):

```ts
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createGitHubHosting } from '../src/github'

interface Recorded {
  method: string
  url: string
  headers: IncomingHttpHeaders
  body: string
}

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          // undici(fetch)의 keep-alive 소켓이 close 콜백을 지연시킨다 — 강제로 끊는다
          server.closeAllConnections()
          server.close(resolve)
        }),
    ),
  )
})

/** 실전 fetch 왕복 — 정해진 상태·본문으로 응답하며 요청을 기록하는 1회용 mock GitHub */
async function startMock(
  status: number,
  body: unknown,
): Promise<{ baseUrl: string; requests: Recorded[] }> {
  const requests: Recorded[] = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8')
    })
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: raw })
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { baseUrl: `http://127.0.0.1:${port}`, requests }
}

const PULL_FIXTURE = {
  number: 7,
  title: '로그인 버튼 색 실험',
  draft: false,
  html_url: 'https://github.com/octo/hello/pull/7',
  head: { ref: 'feature' },
  base: { ref: 'main' },
}

describe('createGitHubHosting', () => {
  it('user.current — GET /user에 인증·버전·UA 헤더를 싣고 login을 돌려준다', async () => {
    const mock = await startMock(200, { login: 'octocat' })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 'tok-1' })
    expect(await hosting.user.current()).toEqual({ login: 'octocat' })
    const request = mock.requests[0]!
    expect(request.method).toBe('GET')
    expect(request.url).toBe('/user')
    expect(request.headers.authorization).toBe('Bearer tok-1')
    expect(request.headers.accept).toBe('application/vnd.github+json')
    expect(request.headers['x-github-api-version']).toBe('2022-11-28')
    expect(request.headers['user-agent']).toBe('git-gui')
  })

  it('repo.defaultBranch — GET /repos/{o}/{r}의 default_branch를 돌려준다', async () => {
    const mock = await startMock(200, { default_branch: 'main' })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    expect(await hosting.repo.defaultBranch('octo', 'hello')).toBe('main')
    expect(mock.requests[0]!.url).toBe('/repos/octo/hello')
  })

  it('pulls.list — 열린 리뷰 요청을 요약으로 매핑한다', async () => {
    const mock = await startMock(200, [PULL_FIXTURE])
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    expect(await hosting.pulls.list('octo', 'hello')).toEqual([
      {
        number: 7,
        title: '로그인 버튼 색 실험',
        headBranch: 'feature',
        baseBranch: 'main',
        url: 'https://github.com/octo/hello/pull/7',
        isDraft: false,
      },
    ])
    expect(mock.requests[0]!.url).toBe('/repos/octo/hello/pulls?state=open&per_page=50')
  })

  it('pulls.create — POST 본문을 그대로 싣고 생성 결과를 매핑한다', async () => {
    const mock = await startMock(201, PULL_FIXTURE)
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    const created = await hosting.pulls.create('octo', 'hello', {
      title: '로그인 버튼 색 실험',
      head: 'feature',
      base: 'main',
      body: '',
    })
    expect(created.number).toBe(7)
    const request = mock.requests[0]!
    expect(request.method).toBe('POST')
    expect(JSON.parse(request.body)).toEqual({
      title: '로그인 버튼 색 실험',
      head: 'feature',
      base: 'main',
      body: '',
    })
  })

  it('401 — 연결 만료 문구로 매핑한다', async () => {
    const mock = await startMock(401, { message: 'Bad credentials' })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 'stale' })
    await expect(hosting.user.current()).rejects.toThrow('연결이 만료됐어요. 다시 연결해 주세요.')
  })

  it('403 rate limit — 잠시 후 재시도 문구로 매핑한다', async () => {
    const mock = await startMock(403, { message: 'API rate limit exceeded for user.' })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    await expect(hosting.pulls.list('octo', 'hello')).rejects.toThrow(
      '요청이 너무 많았어요. 잠시 후 다시 시도해 주세요.',
    )
  })

  it('422 already exists — 이미 있다는 문구로 매핑한다 (GitHub는 errors[]에 담는다)', async () => {
    const mock = await startMock(422, {
      message: 'Validation Failed',
      errors: [{ message: 'A pull request already exists for octo:feature.' }],
    })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    await expect(
      hosting.pulls.create('octo', 'hello', { title: 't', head: 'feature', base: 'main', body: '' }),
    ).rejects.toThrow('이 실험 공간의 리뷰 요청이 이미 있어요.')
  })

  it('네트워크 실패(연결 거부) — 인터넷 확인 문구로 매핑한다', async () => {
    // 서버를 즉시 닫아 그 포트로의 연결이 거부되게 한다
    const mock = await startMock(200, {})
    await new Promise((resolve) => servers.pop()!.close(resolve))
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    await expect(hosting.user.current()).rejects.toThrow('인터넷 연결을 확인해 주세요.')
  })

  it('그 밖의 실패는 상태 코드를 남긴다', async () => {
    const mock = await startMock(500, { message: 'boom' })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    await expect(hosting.user.current()).rejects.toThrow('GitHub 요청이 실패했어요. (HTTP 500)')
  })
})
```

- [ ] **Step 2: 실패 확인 (Red 실증)**

Run: `npx vitest run packages/hosting/test/github.test.ts`
Expected: FAIL — `Failed to resolve import "../src/github"` (모듈 없음)

- [ ] **Step 3: 구현**

`packages/hosting/src/github.ts` 생성:

```ts
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
```

`packages/hosting/src/index.ts` 전체를 다음으로 교체:

```ts
export * from './remote-url'
export * from './github'
```

- [ ] **Step 4: 통과 확인 + 게이트**

Run: `npx vitest run packages/hosting/test/github.test.ts`
Expected: PASS (9 tests)

Run: `pnpm test && pnpm typecheck`
Expected: **268 tests** PASS (259 + 9) + typecheck 전부 Done

- [ ] **Step 5: Commit**

```bash
git add packages/hosting
git commit -m "feat(hosting): createGitHubHosting — user/repo/pulls + 친절 에러 매핑 (mock http 실왕복 테스트)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: detectGhToken — gh CLI 자동 감지

**Files:**
- Create: `packages/hosting/src/gh-token.ts`
- Modify: `packages/hosting/src/index.ts`
- Test: `packages/hosting/test/gh-token.test.ts`

- [ ] **Step 1: 실패하는 테스트 (Red)**

`packages/hosting/test/gh-token.test.ts` 생성:

```ts
import { describe, expect, it } from 'vitest'
import { detectGhToken } from '../src/gh-token'

describe('detectGhToken', () => {
  it('gh가 토큰을 출력하면 개행을 벗겨 돌려준다', async () => {
    const runner = async (command: string, args: string[]) => {
      expect(command).toBe('gh')
      expect(args).toEqual(['auth', 'token'])
      return 'gho_abc123\n'
    }
    expect(await detectGhToken(runner)).toBe('gho_abc123')
  })

  it('gh가 없거나 실패하면(reject) 조용히 null이다', async () => {
    const runner = async () => {
      throw new Error('spawn gh ENOENT')
    }
    expect(await detectGhToken(runner)).toBeNull()
  })

  it('빈 출력도 null이다 — 빈 토큰으로 연결을 시도하지 않는다', async () => {
    expect(await detectGhToken(async () => '\n')).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인 (Red 실증)**

Run: `npx vitest run packages/hosting/test/gh-token.test.ts`
Expected: FAIL — `Failed to resolve import "../src/gh-token"` (모듈 없음)

- [ ] **Step 3: 구현**

`packages/hosting/src/gh-token.ts` 생성:

```ts
import { execFile } from 'node:child_process'

export type CommandRunner = (command: string, args: string[]) => Promise<string>

/** execFile 얇은 래퍼 — 명령이 없거나 exit != 0이면 reject */
const defaultRunner: CommandRunner = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 5_000 }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })

/**
 * gh CLI가 로그인돼 있으면 그 토큰을 돌려준다 — 없거나 로그인 전이면 null (조용히).
 * gh는 git이 아니므로 git-process의 env 격리는 쓰지 않는다.
 */
export async function detectGhToken(runner: CommandRunner = defaultRunner): Promise<string | null> {
  try {
    const token = (await runner('gh', ['auth', 'token'])).trim()
    return token === '' ? null : token
  } catch {
    return null
  }
}
```

`packages/hosting/src/index.ts` 전체를 다음으로 교체:

```ts
export * from './remote-url'
export * from './github'
export * from './gh-token'
```

- [ ] **Step 4: 통과 확인 + 게이트**

Run: `pnpm test && pnpm typecheck`
Expected: **271 tests** PASS (268 + 3) + typecheck 전부 Done

- [ ] **Step 5: Commit**

```bash
git add packages/hosting
git commit -m "feat(hosting): detectGhToken — gh CLI 토큰 자동 감지 (실패는 조용히 null)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 엔진 — sync.branchStatus·sync.remoteUrl (리뷰 요청 전 검사용)

**Files:**
- Modify: `packages/domain/src/repository.ts`, `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts`

- [ ] **Step 1: 실패하는 테스트 (Red)**

`packages/git-adapter/test/client.test.ts`에서 push 관련 테스트 구간(`'push — push.default=matching이어도 현재 브랜치만 올린다'` 테스트의 닫는 `})` **뒤**)에 추가:

```ts
  it('sync.branchStatus — 현재 브랜치와 upstream 유무를 알려준다', async () => {
    const { repo } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    expect(await client.sync.branchStatus()).toEqual({ branch: 'main', hasUpstream: false })
    // 첫 백업(push -u) 뒤에는 upstream이 생긴다 — 로컬 bare remote로 실왕복
    await client.sync.push()
    expect(await client.sync.branchStatus()).toEqual({ branch: 'main', hasUpstream: true })
  })

  it('sync.branchStatus — detached HEAD면 branch null이다', async () => {
    const repo = await createFixtureRepo()
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await execGitOrThrow(['checkout', '--detach', head], { cwd: repo })
    expect(await createGitClient(repo).sync.branchStatus()).toEqual({
      branch: null,
      hasUpstream: false,
    })
  })

  it('sync.remoteUrl — 백업 대상 remote(origin 우선)의 URL을 돌려준다', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    expect(await createGitClient(repo).sync.remoteUrl()).toBe(remote)
  })

  it('sync.remoteUrl — remote가 없으면 null이다', async () => {
    const repo = await createFixtureRepo()
    expect(await createGitClient(repo).sync.remoteUrl()).toBeNull()
  })
```

- [ ] **Step 2: 실패 확인 (Red 실증)**

Run: `npx vitest run packages/git-adapter/test/client.test.ts --testNamePattern "branchStatus|remoteUrl"`
Expected: 4 FAIL — `client.sync.branchStatus is not a function` / `client.sync.remoteUrl is not a function`

- [ ] **Step 3: 구현**

(a) `packages/domain/src/repository.ts`의 `RemoveBranchResult` 인터페이스(파일 끝) **뒤**에 추가:

```ts

/** 리뷰 요청(PR) 전 검사용 — 현재 브랜치와 원격 연결(upstream) 여부 */
export interface SyncBranchStatus {
  /** detached HEAD면 null */
  branch: string | null
  hasUpstream: boolean
}
```

(b) `packages/git-adapter/src/client.ts`의 domain import에서 다음 행을 교체 — 기존:

```ts
  type SwitchResult,
} from '@git-gui/domain'
```

교체:

```ts
  type SwitchResult,
  type SyncBranchStatus,
} from '@git-gui/domain'
```

(c) `GitClient` 인터페이스 sync 블록의 `pull(): Promise<PullResult>` 행 **뒤**에 추가:

```ts
    /** 현재 브랜치 이름과 upstream 유무 — 리뷰 요청(PR) 전 검사용. detached면 branch null */
    branchStatus(): Promise<SyncBranchStatus>
    /** 백업 대상 remote(origin 우선 — push와 동일 규칙)의 URL. remote가 없으면 null */
    remoteUrl(): Promise<string | null>
```

(d) 구현부 sync 블록의 `pull()` 구현 닫는 `},` **뒤**(sync 객체의 닫는 `},` 앞)에 추가:

```ts
      async branchStatus() {
        const cwd = await topLevel()
        const branch = await execGit(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd })
        if (branch.exitCode !== 0) return { branch: null, hasUpstream: false }
        // 실측: branch.<name>.remote/merge 설정만으로는 해석되지 않고, remote-tracking ref까지
        // 있어야 exit 0이다 — "원격에 실제로 올라간 적 있음"을 뜻해 리뷰 요청 전 검사에 맞다
        const upstream = await execGit(
          ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
          { cwd },
        )
        return { branch: branch.stdout.trim(), hasUpstream: upstream.exitCode === 0 }
      },
      async remoteUrl() {
        const cwd = await topLevel()
        const remotes = await execGitOrThrow(['remote'], { cwd })
        const remoteNames = remotes.stdout
          .trim()
          .split('\n')
          .filter((name) => name !== '')
        if (remoteNames.length === 0) return null
        // push와 동일 규칙 — origin 우선, 없으면 (git remote 출력 = 알파벳순) 첫 remote
        const target = remoteNames.includes('origin') ? 'origin' : remoteNames[0]!
        const url = await execGit(['remote', 'get-url', target], { cwd })
        return url.exitCode === 0 ? url.stdout.trim() : null
      },
```

- [ ] **Step 4: 통과 확인 + 게이트**

Run: `pnpm test && pnpm typecheck`
Expected: **275 tests** PASS (271 + 4) + typecheck 전부 Done

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/repository.ts packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(adapter): sync.branchStatus·remoteUrl — 리뷰 요청 전 브랜치·upstream·원격 검사

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 설정 — PersistedSettings sanitize 확장 + main 토큰 저장(safeStorage)

**Files:**
- Modify: `packages/ipc-contract/src/index.ts`, `apps/desktop/src/main/settings.ts`
- Test: `packages/ipc-contract/test/settings.test.ts`

- [ ] **Step 1: 실패하는 테스트 (Red)**

`packages/ipc-contract/test/settings.test.ts`의 import 행을 교체 — 기존:

```ts
import { sanitizeSettings } from '../src/index'
```

교체:

```ts
import { sanitizePersistedSettings, sanitizeSettings } from '../src/index'
```

파일 끝에 추가:

```ts

describe('sanitizePersistedSettings', () => {
  it('renderer 필드에 더해 hosting.github(token·login)을 통과시킨다', () => {
    expect(
      sanitizePersistedSettings({
        theme: 'dark',
        hosting: { github: { token: 'enc-base64', login: 'octocat', evil: 'x' } },
      }),
    ).toEqual({ theme: 'dark', hosting: { github: { token: 'enc-base64', login: 'octocat' } } })
  })

  it('hosting이 잘못된 형태면 조용히 버린다', () => {
    expect(sanitizePersistedSettings({ hosting: 'yes' })).toEqual({})
    expect(sanitizePersistedSettings({ hosting: { github: { token: 42 } } })).toEqual({})
    expect(sanitizePersistedSettings({ hosting: { github: [] } })).toEqual({})
  })

  it('sanitizeSettings(renderer 표면)는 hosting을 걷어낸다 — 토큰은 renderer로 가지 않는다', () => {
    expect(sanitizeSettings({ theme: 'light', hosting: { github: { token: 'enc' } } })).toEqual({
      theme: 'light',
    })
  })
})
```

- [ ] **Step 2: 실패 확인 (Red 실증)**

Run: `npx vitest run packages/ipc-contract/test/settings.test.ts`
Expected: FAIL — `does not provide an export named 'sanitizePersistedSettings'`

- [ ] **Step 3: contract 구현**

`packages/ipc-contract/src/index.ts`의 `sanitizeSettings` 함수 닫는 `}` **뒤**, `/** preload가 노출하는 설정 표면 …` 주석 **앞**에 추가:

```ts

/**
 * 디스크(settings.json)에만 존재하는 확장 설정 — main 전용.
 * hosting.github.token은 safeStorage 암호문(base64)이며, getSync 응답은 sanitizeSettings로
 * renderer 표면 필드만 추리므로 renderer에는 토큰이 절대 전달되지 않는다.
 */
export interface PersistedSettings extends AppSettings {
  hosting?: { github?: { token?: string; login?: string } }
}

/** 디스크 파일용 방어 — renderer 표면 sanitize에 hosting.github(token·login)을 더한다 */
export function sanitizePersistedSettings(value: unknown): PersistedSettings {
  const settings: PersistedSettings = sanitizeSettings(value)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return settings
  const hosting = (value as { hosting?: unknown }).hosting
  if (typeof hosting !== 'object' || hosting === null || Array.isArray(hosting)) return settings
  const github = (hosting as { github?: unknown }).github
  if (typeof github !== 'object' || github === null || Array.isArray(github)) return settings
  const candidate = github as { token?: unknown; login?: unknown }
  const clean: { token?: string; login?: string } = {}
  if (typeof candidate.token === 'string') clean.token = candidate.token
  if (typeof candidate.login === 'string') clean.login = candidate.login
  if (clean.token !== undefined || clean.login !== undefined) settings.hosting = { github: clean }
  return settings
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run packages/ipc-contract/test/settings.test.ts`
Expected: PASS (6 tests — 기존 3 + 신규 3)

- [ ] **Step 5: main settings.ts 전면 개편 (토큰 저장·getSync 차단)**

`apps/desktop/src/main/settings.ts` 전체를 다음으로 교체:

```ts
import { app, ipcMain, safeStorage } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  sanitizePersistedSettings,
  sanitizeSettings,
  SETTINGS_CHANNELS,
  type PersistedSettings,
} from '@git-gui/ipc-contract'

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function loadSettings(): PersistedSettings {
  try {
    return sanitizePersistedSettings(JSON.parse(readFileSync(settingsPath(), 'utf8')))
  } catch {
    // 첫 실행·깨진 파일 — 빈 설정에서 시작한다 (설정은 전부 선택적)
    return {}
  }
}

// renderer 설정과 토큰 저장(hosting-handlers)이 같은 파일을 쓴다 — 모듈 상태로 일원화한다
let settings: PersistedSettings | null = null

function current(): PersistedSettings {
  settings ??= loadSettings()
  return settings
}

function save(next: PersistedSettings): void {
  settings = next
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(next))
}

export function registerSettingsHandlers(): void {
  ipcMain.on(SETTINGS_CHANNELS.getSync, (event) => {
    // renderer 표면 필드만 추린다 — hosting(토큰)은 renderer로 절대 보내지 않는다
    event.returnValue = sanitizeSettings(current())
  })
  ipcMain.handle(SETTINGS_CHANNELS.set, (_event, partial: unknown) => {
    // renderer 입력도 표면 sanitize만 병합한다 — renderer가 hosting(토큰)을 쓸 수 없다
    save({ ...current(), ...sanitizeSettings(partial) })
  })
}

/** GitHub 토큰 복호화 — safeStorage 불가·복호화 실패는 "토큰 없음"으로 취급한다 (재연결 안내는 UI 몫) */
export function readGitHubToken(): string | null {
  const stored = current().hosting?.github?.token
  if (stored === undefined || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return null
  }
}

/** 연결 시 함께 저장해 둔 계정 이름 — status 조회가 네트워크 없이 응답하게 한다 */
export function readGitHubLogin(): string | null {
  return current().hosting?.github?.login ?? null
}

export function saveGitHubConnection(token: string, login: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('이 컴퓨터에서는 토큰을 안전하게 저장할 수 없어요.')
  }
  const encrypted = safeStorage.encryptString(token).toString('base64')
  save({ ...current(), hosting: { github: { token: encrypted, login } } })
}

export function clearGitHubConnection(): void {
  const { hosting: _hosting, ...rest } = current()
  save(rest)
}
```

- [ ] **Step 6: 게이트 + Commit**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build`
Expected: **278 tests** PASS (275 + 3) + typecheck 전부 Done + build 성공

```bash
git add packages/ipc-contract/src/index.ts packages/ipc-contract/test/settings.test.ts apps/desktop/src/main/settings.ts
git commit -m "feat(desktop): 설정 — safeStorage 토큰 저장·PersistedSettings sanitize (renderer에는 토큰 차단)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: IPC — HostingApi 계약·main hosting-handlers·preload 배선

**Files:**
- Modify: `packages/ipc-contract/src/index.ts`, `packages/ipc-contract/package.json`, `apps/desktop/package.json`, `apps/desktop/src/main/git-handlers.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/src/env.d.ts`
- Create: `apps/desktop/src/main/hosting-handlers.ts`

- [ ] **Step 1: 의존성**

(a) `packages/ipc-contract/package.json`의 dependencies를 교체 — 기존:

```json
  "dependencies": {
    "@git-gui/domain": "workspace:*"
  }
```

교체:

```json
  "dependencies": {
    "@git-gui/domain": "workspace:*",
    "@git-gui/hosting": "workspace:*"
  }
```

(b) `apps/desktop/package.json`의 dependencies에서 다음 행을 교체 — 기존:

```json
    "@git-gui/git-process": "workspace:*",
```

교체:

```json
    "@git-gui/git-process": "workspace:*",
    "@git-gui/hosting": "workspace:*",
```

Run: `pnpm install`
Expected: 성공

- [ ] **Step 2: contract — HostingApi·채널**

(a) `packages/ipc-contract/src/index.ts` 상단 import를 교체 — 기존:

```ts
export type { DiffOptions } from '@git-gui/domain'
```

교체:

```ts
export type { DiffOptions } from '@git-gui/domain'
export type { PullSummary } from '@git-gui/hosting'

import type { PullSummary } from '@git-gui/hosting'
```

(b) `CHANNELS` const 닫는 `} as const` **뒤**, `/**` (AppSettings 주석) **앞**에 추가:

```ts

/** 호스팅 연결 상태 — 토큰 자체는 절대 renderer로 오지 않는다(login만) */
export interface HostingStatus {
  connected: boolean
  /** 연결된 GitHub 계정 이름 — 미연결이면 null */
  login: string | null
  /** origin remote가 GitHub이면 그 좌표, 아니면(비GitHub·remote 없음) null */
  repo: { owner: string; repo: string } | null
  /** gh CLI 로그인 토큰을 감지했는가 — 미연결 화면의 [gh로 연결] 노출 여부 */
  ghAvailable: boolean
}

/**
 * 호스팅(리뷰 요청) API 표면 — 네트워크·토큰은 전부 main 프로세스에서만 다룬다.
 * repoPath 신뢰 규칙은 GitApi와 동일(main의 allowlist).
 */
export interface HostingApi {
  /** 연결 상태 — 저장된 login이 있으면 네트워크 없이 응답한다. 실패해도 던지지 않고 미연결로 응답 */
  status(repoPath: string): Promise<HostingStatus>
  connect: {
    /** gh CLI 토큰으로 연결 — 감지·검증(user.current) 성공 시에만 저장하고 login 반환 */
    gh(): Promise<string>
    /** 붙여넣은 토큰으로 연결 — 검증 성공 시에만 저장하고 login 반환 */
    token(token: string): Promise<string>
  }
  /** 연결 해제 — 저장된 토큰을 지운다 */
  disconnect(): Promise<void>
  pulls: {
    /** 열린 리뷰 요청 목록 */
    list(repoPath: string): Promise<PullSummary[]>
    /** 리뷰 요청 생성 — main이 브랜치·기본 공간을 검사하고 upstream 없으면 백업(push) 후 생성한다 */
    create(repoPath: string, input: { title: string; body: string }): Promise<PullSummary>
    /** 리뷰 요청을 브라우저로 연다 — URL은 main이 보관한 목록에서만 찾는다(임의 URL 열기 금지) */
    open(repoPath: string, number: number): Promise<void>
  }
}

export const HOSTING_API_KEY = 'hostingApi' as const

export const HOSTING_CHANNELS = {
  status: 'hosting:status',
  connectGh: 'hosting:connect-gh',
  connectToken: 'hosting:connect-token',
  disconnect: 'hosting:disconnect',
  pullsList: 'hosting:pulls-list',
  pullCreate: 'hosting:pull-create',
  pullOpen: 'hosting:pull-open',
} as const
```

- [ ] **Step 3: git-handlers의 assert 2개 export**

`apps/desktop/src/main/git-handlers.ts`에서 두 곳을 교체 — 기존:

```ts
function assertAllowedRepo(repoPath: unknown): string {
```

교체:

```ts
export function assertAllowedRepo(repoPath: unknown): string {
```

기존:

```ts
function assertString(value: unknown): string {
```

교체:

```ts
export function assertString(value: unknown): string {
```

- [ ] **Step 4: main hosting-handlers**

`apps/desktop/src/main/hosting-handlers.ts` 생성:

```ts
import { ipcMain, shell } from 'electron'
import { createGitClient } from '@git-gui/git-adapter'
import {
  createGitHubHosting,
  detectGhToken,
  parseRemoteUrl,
  type GitHubHosting,
  type PullSummary,
} from '@git-gui/hosting'
import { HOSTING_CHANNELS, type HostingStatus } from '@git-gui/ipc-contract'
import { assertAllowedRepo, assertString } from './git-handlers'
import {
  clearGitHubConnection,
  readGitHubLogin,
  readGitHubToken,
  saveGitHubConnection,
} from './settings'

/** 개발·E2E에서 mock 서버로 바꿔 끼운다 — 프로덕션 기본은 GitHub 공식 API */
function baseUrl(): string {
  return process.env.GIT_GUI_GITHUB_API || 'https://api.github.com'
}

/** E2E 토큰 사전 주입 — 연결 다이얼로그 없이 로그인 상태로 시작한다 (GIT_GUI_E2E_REPO와 동일 관례) */
function currentToken(): string | null {
  return process.env.GIT_GUI_E2E_GH_TOKEN || readGitHubToken()
}

function hosting(token: string): GitHubHosting {
  return createGitHubHosting({ baseUrl: baseUrl(), token })
}

/** env 주입 토큰(E2E)은 settings에 login이 없다 — 첫 status에서 확인해 프로세스 안에 기억한다 */
let memoLogin: string | null = null

/** gh 감지 결과 메모 — status 호출마다 gh 프로세스를 띄우지 않는다 */
let ghTokenPromise: Promise<string | null> | null = null
function ghToken(): Promise<string | null> {
  ghTokenPromise ??= detectGhToken()
  return ghTokenPromise
}

/** main이 보관한 PR 주소 — renderer가 보낸 번호로만 찾는다 (임의 URL 열기 금지) */
const knownPullUrls = new Map<string, string>()
// 경로에는 공백이 흔하다("git gui") — 경로에 나올 수 없는 NUL(\u0000)로 구분해 키 모호성을 없앤다
const pullUrlKey = (repoPath: string, number: number): string => `${repoPath}\u0000${number}`
function rememberPulls(repoPath: string, pulls: PullSummary[]): void {
  for (const pull of pulls) knownPullUrls.set(pullUrlKey(repoPath, pull.number), pull.url)
}

/** 백업 대상 remote가 GitHub이면 좌표를 돌려준다 — origin URL 파싱이 정본 */
async function gitHubRepoRef(repoPath: string): Promise<{ owner: string; repo: string } | null> {
  const url = await createGitClient(repoPath).sync.remoteUrl()
  if (url === null) return null
  const parsed = parseRemoteUrl(url)
  if (parsed === null || parsed.host !== 'github.com') return null
  return { owner: parsed.owner, repo: parsed.repo }
}

/** 토큰 검증(user.current) 성공 시에만 저장한다 — 두 연결 경로(gh·PAT)가 공유 */
async function verifyAndSave(token: string): Promise<string> {
  const { login } = await hosting(token).user.current()
  saveGitHubConnection(token, login)
  memoLogin = login
  return login
}

function assertPullInput(value: unknown): { title: string; body: string } {
  const candidate = value as { title?: unknown; body?: unknown } | null
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof candidate.title !== 'string' ||
    candidate.title.trim() === '' ||
    typeof candidate.body !== 'string'
  ) {
    throw new Error('잘못된 요청 형식이에요.')
  }
  return { title: candidate.title, body: candidate.body }
}

function assertPullNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('잘못된 요청 형식이에요.')
  }
  return value
}

export function registerHostingHandlers(): void {
  ipcMain.handle(
    HOSTING_CHANNELS.status,
    async (_event, repoPath: unknown): Promise<HostingStatus> => {
      const path = assertAllowedRepo(repoPath)
      // 상태 조회는 던지지 않는다 — 어떤 실패도 "미연결/비GitHub"으로 응답해 첫 화면을 막지 않는다
      const repo = await gitHubRepoRef(path).catch(() => null)
      const ghAvailable = (await ghToken()) !== null
      const token = currentToken()
      if (token === null) return { connected: false, login: null, repo, ghAvailable }
      let login = readGitHubLogin() ?? memoLogin
      if (login === null) {
        // env 주입(E2E) 등 login 미저장 토큰 — 1회 확인해 기억한다. 실패하면 미연결로
        try {
          login = (await hosting(token).user.current()).login
          memoLogin = login
        } catch {
          return { connected: false, login: null, repo, ghAvailable }
        }
      }
      return { connected: true, login, repo, ghAvailable }
    },
  )

  ipcMain.handle(HOSTING_CHANNELS.connectGh, async () => {
    // 다이얼로그 시점의 최신 상태로 다시 감지한다 (그 사이 gh login 했을 수 있다)
    ghTokenPromise = null
    const token = await ghToken()
    if (token === null) {
      throw new Error('gh CLI 로그인을 찾지 못했어요. 토큰으로 연결해 주세요.')
    }
    return verifyAndSave(token)
  })

  ipcMain.handle(HOSTING_CHANNELS.connectToken, async (_event, token: unknown) => {
    const trimmed = assertString(token).trim()
    if (trimmed === '') throw new Error('토큰을 입력해 주세요.')
    try {
      return await verifyAndSave(trimmed)
    } catch (cause) {
      // 첫 연결의 401은 "만료"가 아니라 잘못 붙여넣은 토큰이다 — 상황에 맞는 문구로 바꾼다
      if (cause instanceof Error && cause.message.includes('연결이 만료됐어요')) {
        throw new Error('토큰이 맞지 않아요. 새로 만든 토큰인지, 전부 복사했는지 확인해 주세요.')
      }
      throw cause
    }
  })

  ipcMain.handle(HOSTING_CHANNELS.disconnect, () => {
    clearGitHubConnection()
    memoLogin = null
  })

  ipcMain.handle(HOSTING_CHANNELS.pullsList, async (_event, repoPath: unknown) => {
    const path = assertAllowedRepo(repoPath)
    const token = currentToken()
    if (token === null) throw new Error('GitHub와 연결한 뒤 이용할 수 있어요.')
    const repo = await gitHubRepoRef(path)
    if (repo === null) throw new Error('이 저장소의 원격(origin)은 GitHub가 아니에요.')
    const pulls = await hosting(token).pulls.list(repo.owner, repo.repo)
    rememberPulls(path, pulls)
    return pulls
  })

  ipcMain.handle(HOSTING_CHANNELS.pullCreate, async (_event, repoPath: unknown, input: unknown) => {
    const path = assertAllowedRepo(repoPath)
    const { title, body } = assertPullInput(input)
    const token = currentToken()
    if (token === null) throw new Error('GitHub와 연결한 뒤 이용할 수 있어요.')
    const repo = await gitHubRepoRef(path)
    if (repo === null) throw new Error('이 저장소의 원격(origin)은 GitHub가 아니에요.')
    const client = createGitClient(path)
    const branch = await client.sync.branchStatus()
    if (branch.branch === null) {
      throw new Error('지금은 실험 공간이 아닌 시점에 있어요. 실험 공간으로 이동한 뒤 요청해 주세요.')
    }
    const api = hosting(token)
    // 기본 공간 판정은 GitHub의 default_branch가 정본 — UI의 main·master 추정은 빠른 안내일 뿐
    const base = await api.repo.defaultBranch(repo.owner, repo.repo)
    if (branch.branch === base) {
      throw new Error(
        `"${base}"는 모두가 함께 쓰는 기본 공간이에요. 실험 공간(branch)을 만들어 요청해 주세요.`,
      )
    }
    // 원격에 이 실험 공간이 없으면 리뷰 대상이 없다 — 기존 백업(push) 흐름으로 먼저 올린다
    if (!branch.hasUpstream) await client.sync.push()
    const pull = await api.pulls.create(repo.owner, repo.repo, {
      title,
      head: branch.branch,
      base,
      body,
    })
    rememberPulls(path, [pull])
    return pull
  })

  ipcMain.handle(HOSTING_CHANNELS.pullOpen, async (_event, repoPath: unknown, number: unknown) => {
    const path = assertAllowedRepo(repoPath)
    const url = knownPullUrls.get(pullUrlKey(path, assertPullNumber(number)))
    // main이 목록·생성에서 보관한 주소만 연다 — renderer가 만든 임의 URL은 여기 없다 (https 재확인은 심층 방어)
    if (url === undefined || !url.startsWith('https://')) {
      throw new Error('리뷰 요청 주소를 찾지 못했어요. 리뷰 목록을 다시 열어 주세요.')
    }
    await shell.openExternal(url)
  })
}
```

- [ ] **Step 5: main 배선**

`apps/desktop/src/main/index.ts`에서 두 곳을 교체 — 기존:

```ts
import { registerGitHandlers } from './git-handlers'
import { registerSettingsHandlers } from './settings'
```

교체:

```ts
import { registerGitHandlers } from './git-handlers'
import { registerHostingHandlers } from './hosting-handlers'
import { registerSettingsHandlers } from './settings'
```

기존:

```ts
    registerGitHandlers()
    registerSettingsHandlers()
```

교체:

```ts
    registerGitHandlers()
    registerSettingsHandlers()
    registerHostingHandlers()
```

- [ ] **Step 6: preload 브리지**

`apps/desktop/src/preload/index.ts`의 상단 import 2행을 교체 — 기존:

```ts
import type { AppSettings, DiffOptions, GitApi, SettingsApi } from '@git-gui/ipc-contract'
import { CHANNELS, GIT_API_KEY, SETTINGS_API_KEY, SETTINGS_CHANNELS } from '@git-gui/ipc-contract'
```

교체:

```ts
import type { AppSettings, DiffOptions, GitApi, HostingApi, SettingsApi } from '@git-gui/ipc-contract'
import {
  CHANNELS,
  GIT_API_KEY,
  HOSTING_API_KEY,
  HOSTING_CHANNELS,
  SETTINGS_API_KEY,
  SETTINGS_CHANNELS,
} from '@git-gui/ipc-contract'
```

`contextBridge.exposeInMainWorld(GIT_API_KEY, api)` 행 **뒤**에 추가:

```ts

const hostingApi: HostingApi = {
  status: (repoPath) => ipcRenderer.invoke(HOSTING_CHANNELS.status, repoPath),
  connect: {
    gh: () => ipcRenderer.invoke(HOSTING_CHANNELS.connectGh),
    token: (token) => ipcRenderer.invoke(HOSTING_CHANNELS.connectToken, token),
  },
  disconnect: () => ipcRenderer.invoke(HOSTING_CHANNELS.disconnect),
  pulls: {
    list: (repoPath) => ipcRenderer.invoke(HOSTING_CHANNELS.pullsList, repoPath),
    create: (repoPath, input) => ipcRenderer.invoke(HOSTING_CHANNELS.pullCreate, repoPath, input),
    open: (repoPath, number) => ipcRenderer.invoke(HOSTING_CHANNELS.pullOpen, repoPath, number),
  },
}

contextBridge.exposeInMainWorld(HOSTING_API_KEY, hostingApi)
```

- [ ] **Step 7: renderer 타입**

`apps/desktop/src/renderer/src/env.d.ts` 전체를 다음으로 교체:

```ts
import type { GitApi, HostingApi, SettingsApi } from '@git-gui/ipc-contract'

declare global {
  interface Window {
    gitApi: GitApi
    hostingApi: HostingApi
    settingsApi: SettingsApi
  }
}

export {}
```

- [ ] **Step 8: 게이트 + Commit**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build`
Expected: 278 tests + typecheck 전부 Done + build 성공

```bash
git add packages/ipc-contract apps/desktop/package.json apps/desktop/src/main apps/desktop/src/preload apps/desktop/src/renderer/src/env.d.ts pnpm-lock.yaml
git commit -m "feat(ipc): hosting 채널 7개 — 연결(gh·토큰)·상태·리뷰 요청 목록/생성/열기 (토큰은 main 전용)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: store — hostingStatus·pulls + 액션 7개

**Files:**
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`

- [ ] **Step 1: import·접근자**

(a) domain import 블록(닫는 `} from '@git-gui/domain'` 행) **뒤**에 추가:

```ts
import type { HostingStatus, PullSummary } from '@git-gui/ipc-contract'
```

(b) `const git = () => window.gitApi` 행을 교체:

```ts
const git = () => window.gitApi
const hosting = () => window.hostingApi
```

- [ ] **Step 2: 상태 필드**

`RepositoryStore` 인터페이스의 `/** 안내 배너 … */` 주석 **앞**(즉 `conflictFile: … | null` 행 뒤)에 추가:

```ts
  /** GitHub 연결 상태 — git 스냅샷과 독립된 네트워크 상태. 토큰은 오지 않는다(login만) */
  hostingStatus: HostingStatus | null
  /** 열린 리뷰 요청 목록 — 리뷰 팝오버를 열 때·생성 후 갱신된다 */
  pulls: PullSummary[]
```

- [ ] **Step 3: 액션 시그니처**

인터페이스의 `backup(): Promise<void>` 행 **뒤**에 추가:

```ts
  /** 열린 리뷰 요청 목록 갱신 — 팝오버를 열 때. 미연결·비GitHub이면 조용히 무시 */
  refreshPulls(): Promise<void>
  /** gh CLI 토큰으로 연결 — 성공 여부 반환 */
  connectGh(): Promise<boolean>
  /** 붙여넣은 토큰으로 연결 — 실패 시 다이얼로그 유지·입력 보존을 위해 성공 여부 반환 */
  connectToken(token: string): Promise<boolean>
  /** GitHub 연결 해제 — 저장된 토큰을 지운다 */
  disconnectHosting(): Promise<void>
  /** 리뷰 요청 생성(빈 본문) — 성공 시 notice 안내 + 목록·스냅샷 갱신. 성공 여부 반환 */
  createPull(title: string): Promise<boolean>
  /** 리뷰 요청을 브라우저로 연다 — 주소는 main이 보관한 목록에서만 */
  openPull(number: number): Promise<void>
```

- [ ] **Step 4: 초기값**

store 초기값의 `busy: false,` 행을 교체:

```ts
  busy: false,
  hostingStatus: null,
  pulls: [],
```

- [ ] **Step 5: 스냅샷 지점에 hosting 상태 동승**

(a) `init()`의 set 호출을 교체 — 기존:

```ts
      set({ repoPath: initial, ...(await fetchSnapshot(initial, get().historyLimit)) })
```

교체 (status 핸들러는 던지지 않는 설계라 guard 안에서 안전하다):

```ts
      set({
        repoPath: initial,
        hostingStatus: await hosting().status(initial),
        ...(await fetchSnapshot(initial, get().historyLimit)),
      })
```

(b) `openRepository()`의 set 호출을 교체 — 기존:

```ts
      set({
        repoPath: path,
        historyLimit: HISTORY_LIMIT,
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(path, HISTORY_LIMIT)),
      })
```

교체:

```ts
      set({
        repoPath: path,
        historyLimit: HISTORY_LIMIT,
        hostingStatus: await hosting().status(path),
        pulls: [],
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(path, HISTORY_LIMIT)),
      })
```

(c) `refresh()`의 set 호출을 교체 — 기존:

```ts
      set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
```

교체:

```ts
      set({
        ...CLEAR_SELECTIONS,
        hostingStatus: await hosting().status(repoPath),
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
      })
```

- [ ] **Step 6: 액션 구현**

`backup()` 구현의 닫는 `},` **뒤**(스토어 객체 닫는 `}))` 앞)에 추가:

```ts

  async refreshPulls() {
    const { repoPath, hostingStatus } = get()
    if (!repoPath || hostingStatus === null || !hostingStatus.connected || hostingStatus.repo === null) {
      return
    }
    await guard(set, get, async () => {
      set({ pulls: await hosting().pulls.list(repoPath) })
    })
  },

  async connectGh() {
    const { repoPath } = get()
    if (!repoPath) return false
    return guard(set, get, async () => {
      const login = await hosting().connect.gh()
      set({
        hostingStatus: await hosting().status(repoPath),
        notice: `@${login} 계정으로 GitHub와 연결했어요.`,
      })
    })
  },

  async connectToken(token) {
    const { repoPath } = get()
    if (!repoPath) return false
    return guard(set, get, async () => {
      const login = await hosting().connect.token(token)
      set({
        hostingStatus: await hosting().status(repoPath),
        notice: `@${login} 계정으로 GitHub와 연결했어요.`,
      })
    })
  },

  async disconnectHosting() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await hosting().disconnect()
      set({
        hostingStatus: await hosting().status(repoPath),
        pulls: [],
        notice: 'GitHub 연결을 해제했어요.',
      })
    })
  },

  async createPull(title) {
    const { repoPath } = get()
    if (!repoPath) return false
    return guard(set, get, async () => {
      const pull = await hosting().pulls.create(repoPath, { title, body: '' })
      // 백업(push)이 함께 일어났을 수 있다 — 리뷰 목록과 git 스냅샷(ahead/behind)을 함께 갱신한다
      set({
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        pulls: await hosting().pulls.list(repoPath),
        notice: `리뷰 요청 #${pull.number}을 만들었어요. 리뷰 팝오버에서 볼 수 있어요.`,
      })
    })
  },

  async openPull(number) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await hosting().pulls.open(repoPath, number)
    })
  },
```

- [ ] **Step 7: 게이트 + Commit**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build`
Expected: 278 tests + typecheck 전부 Done + build 성공

```bash
git add apps/desktop/src/renderer/src/store/repository-store.ts
git commit -m "feat(desktop): store — hosting 상태·리뷰 요청 액션 (guard 직렬화, 스냅샷과 독립)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: UI — ReviewPopover + App 배선 + 다이얼로그 2개

**Files:**
- Create: `apps/desktop/src/renderer/src/components/ReviewPopover.tsx`, `apps/desktop/src/renderer/src/components/review-popover.css`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/electron.vite.config.ts` (구현 중 실측 추기 — 누락 시 main이 hosting을 external로 두고 ESM 해석하다 `ERR_MODULE_NOT_FOUND`로 창이 안 떠 E2E 전멸)

**Step 0 (추기): electron-vite exclude** — main의 externalizeDepsPlugin exclude에 `'@git-gui/hosting'`을 기존 워크스페이스 패키지들과 같은 자리에 추가한다:

```ts
  main: { plugins: [externalizeDepsPlugin({ exclude: ['@git-gui/domain', '@git-gui/git-adapter', '@git-gui/git-process', '@git-gui/hosting', '@git-gui/ipc-contract'] })] },
```

- [ ] **Step 1: ReviewPopover.tsx 생성**

```tsx
import { ExternalLink, GitPullRequest, Key, Terminal, Unplug } from 'lucide-react'
import { useState } from 'react'
import { Dialog, DialogTrigger, Popover } from 'react-aria-components'
import type { HostingStatus, PullSummary } from '@git-gui/ipc-contract'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import './review-popover.css'

interface ReviewPopoverProps {
  status: HostingStatus | null
  pulls: PullSummary[]
  busy: boolean
  /** 현재 실험 공간 이름 — 기본 공간(main·master) 추정 비활성에 쓴다. 확정 검사는 main 프로세스 */
  currentBranch: string | null
  /** 팝오버를 열 때 — 목록을 새로 불러온다 */
  onOpen(): void
  onConnectGh(): void
  /** 토큰 붙여넣기 다이얼로그 열기 — 다이얼로그 자체는 App이 관리한다 */
  onConnectToken(): void
  onDisconnect(): void
  /** 리뷰 요청 제목 다이얼로그 열기 — 다이얼로그 자체는 App이 관리한다 */
  onCreate(): void
  /** 리뷰 요청을 브라우저로 — 주소는 main이 보관한 목록에서만 찾는다 */
  onOpenPull(number: number): void
}

/** 리뷰 (스펙 §9 E3a) — GitHub 연결과 리뷰 요청(pull request) 생성·목록. ShelfPopover 패턴 */
export function ReviewPopover({
  status,
  pulls,
  busy,
  currentBranch,
  onOpen,
  onConnectGh,
  onConnectToken,
  onDisconnect,
  onCreate,
  onOpenPull,
}: ReviewPopoverProps) {
  // 다이얼로그를 여는 동작은 팝오버를 닫고 시작한다 — 모달과 팝오버의 포커스 경합을 피한다
  const [open, setOpen] = useState(false)
  const openDialog = (action: () => void) => {
    setOpen(false)
    action()
  }
  // 기본 공간 추정(main·master) — UI는 빠른 안내만, 확정 거부는 main이 default_branch를 실제 조회해 한다
  const isDefaultBranch = currentBranch === 'main' || currentBranch === 'master'
  return (
    <DialogTrigger
      isOpen={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) onOpen()
      }}
    >
      <Button variant="ghost" size="sm" testId="review-open">
        <GitPullRequest size={13} aria-hidden="true" /> 리뷰 <Badge tone="git">PR</Badge>
      </Button>
      <Popover className="review-popover">
        <Dialog className="review-popover__dialog" aria-label="리뷰 요청">
          {status === null || !status.connected ? (
            <>
              <p className="review-popover__empty">
                GitHub와 연결하면 리뷰 요청 (pull request)을 만들고 볼 수 있어요.
              </p>
              <div className="review-popover__buttons">
                {status?.ghAvailable === true && (
                  <Button
                    variant="neutral"
                    size="sm"
                    isDisabled={busy}
                    onPress={() => openDialog(onConnectGh)}
                    testId="review-connect-gh"
                  >
                    <Terminal size={13} aria-hidden="true" /> gh로 연결
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  isDisabled={busy}
                  onPress={() => openDialog(onConnectToken)}
                  testId="review-connect-token"
                >
                  <Key size={13} aria-hidden="true" /> 토큰으로 연결
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="review-popover__head">
                <span data-testid="review-login">@{status.login}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  isDisabled={busy}
                  onPress={onDisconnect}
                  testId="review-disconnect"
                >
                  <Unplug size={13} aria-hidden="true" /> 연결 해제
                </Button>
              </div>
              {status.repo === null ? (
                <p className="review-popover__empty">
                  이 저장소의 원격(origin)이 GitHub가 아니에요. GitHub 저장소를 백업(push) 대상으로
                  연결하면 리뷰 요청을 만들 수 있어요.
                </p>
              ) : (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    isDisabled={busy || isDefaultBranch}
                    onPress={() => openDialog(onCreate)}
                    testId="review-create"
                  >
                    <GitPullRequest size={13} aria-hidden="true" /> 이 실험 공간 리뷰 요청하기
                  </Button>
                  {isDefaultBranch && (
                    <p className="review-popover__reason" data-testid="review-create-reason">
                      "{currentBranch}"는 모두가 함께 쓰는 기본 공간이에요. 실험 공간(branch)을
                      만들어 요청해 주세요.
                    </p>
                  )}
                  {pulls.length === 0 ? (
                    <p className="review-popover__empty">열린 리뷰 요청이 없어요.</p>
                  ) : (
                    <ul className="review-popover__list">
                      {pulls.map((pull) => (
                        <li key={pull.number} className="review-popover__row">
                          <button
                            type="button"
                            className="review-popover__pull"
                            title="브라우저에서 열기"
                            onClick={() => onOpenPull(pull.number)}
                            data-testid={`review-pull-${pull.number}`}
                          >
                            <span className="review-popover__pull-title">
                              #{pull.number} {pull.title}
                              {pull.isDraft && <Badge>초안</Badge>}
                            </span>
                            <span className="review-popover__pull-branch">{pull.headBranch}</span>
                            <ExternalLink size={12} aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  )
}
```

- [ ] **Step 2: review-popover.css 생성** (shelf-popover.css 관례 — 토큰만 사용)

```css
.review-popover {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-2);
  width: 380px;
}
.review-popover__dialog {
  outline: none;
  padding: var(--space-3);
}
.review-popover__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  font-size: var(--text-sm);
  font-weight: 600;
  margin-bottom: var(--space-2);
}
.review-popover__empty {
  margin: 0;
  padding: var(--space-4) 0;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  text-align: center;
}
.review-popover__buttons {
  display: flex;
  justify-content: center;
  gap: var(--space-2);
  padding-bottom: var(--space-2);
}
.review-popover__reason {
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.review-popover__list {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
  max-height: 280px;
  overflow-y: auto;
}
.review-popover__row {
  border-top: 1px solid var(--color-border);
}
.review-popover__pull {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  /* 버튼화(브라우저로 열기) — 기본 버튼 모양을 지우고 행처럼 보이게 (shelf-popover__meta 관례) */
  background: none;
  border: 0;
  margin: 0;
  padding: var(--space-2) 4px;
  text-align: left;
  cursor: pointer;
  border-radius: var(--radius-sm);
  color: inherit;
  font-size: var(--text-sm);
}
.review-popover__pull:hover {
  background: var(--color-surface-sunken);
}
.review-popover__pull-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.review-popover__pull-branch {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
}
```

- [ ] **Step 3: App.tsx 배선**

(a) import에서 다음 행을 교체 — 기존:

```tsx
import { RepoPicker } from './components/RepoPicker'
import { ShelfPopover } from './components/ShelfPopover'
```

교체:

```tsx
import { RepoPicker } from './components/RepoPicker'
import { ReviewPopover } from './components/ReviewPopover'
import { ShelfPopover } from './components/ShelfPopover'
```

(b) `const [confirmingAbort, setConfirmingAbort] = useState(false)` 행 **뒤**에 추가:

```tsx

  // 리뷰(호스팅) 다이얼로그 — 토큰 붙여넣기·리뷰 요청 제목 (팝오버는 닫고 연다)
  const [tokenPrompt, setTokenPrompt] = useState(false)
  const [pullPrompt, setPullPrompt] = useState(false)
```

(c) 헤더의 ShelfPopover 블록을 교체 — 기존:

```tsx
          <ShelfPopover
            shelf={store.shelf}
            busy={store.busy}
            onSave={() => void store.shelfSave()}
            onPreview={(hash) => void store.selectCommit(hash)}
            onRestore={(ref) => void store.shelfRestore(ref)}
            onDrop={(ref) => void store.shelfDrop(ref)}
          />
```

교체:

```tsx
          <ShelfPopover
            shelf={store.shelf}
            busy={store.busy}
            onSave={() => void store.shelfSave()}
            onPreview={(hash) => void store.selectCommit(hash)}
            onRestore={(ref) => void store.shelfRestore(ref)}
            onDrop={(ref) => void store.shelfDrop(ref)}
          />
          <ReviewPopover
            status={store.hostingStatus}
            pulls={store.pulls}
            busy={store.busy}
            currentBranch={status?.branch.name ?? null}
            onOpen={() => void store.refreshPulls()}
            onConnectGh={() => void store.connectGh()}
            onConnectToken={() => {
              store.clearError()
              setTokenPrompt(true)
            }}
            onDisconnect={() => void store.disconnectHosting()}
            onCreate={() => {
              store.clearError()
              setPullPrompt(true)
            }}
            onOpenPull={(number) => void store.openPull(number)}
          />
```

(d) `<ConfirmDialog` 중 `isOpen={confirmingAbort}` 블록 **앞**(`<ManageBranchesDialog … />` 닫는 `/>` 뒤)에 추가:

```tsx
      <PromptDialog
        isOpen={tokenPrompt}
        title="GitHub 토큰으로 연결"
        description="github.com → Settings → Developer settings → Personal access tokens에서 만들 수 있어요. 만든 토큰을 붙여넣어 주세요."
        label="토큰"
        placeholder="ghp_..."
        submitLabel="연결"
        errorText={tokenPrompt ? store.error : null}
        onSubmit={(token) => {
          void (async () => {
            // 실패하면 다이얼로그를 유지해 입력을 보존한다 — 에러는 인라인으로 (branchPrompt 관례)
            if (await store.connectToken(token)) setTokenPrompt(false)
          })()
        }}
        onCancel={() => setTokenPrompt(false)}
      />
      <PromptDialog
        isOpen={pullPrompt}
        title="리뷰 요청 만들기"
        description="지금 실험 공간의 저장 내용을 검토해 달라고 요청해요. 아직 백업(push) 전이면 백업부터 자동으로 해요."
        label="제목"
        placeholder="예: 로그인 버튼 색 실험"
        submitLabel="요청 만들기"
        initialValue={store.history[0]?.subject ?? ''}
        errorText={pullPrompt ? store.error : null}
        onSubmit={(title) => {
          void (async () => {
            if (await store.createPull(title)) setPullPrompt(false)
          })()
        }}
        onCancel={() => setPullPrompt(false)}
      />
```

- [ ] **Step 4: 게이트 (기존 E2E 회귀 확인 포함)**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: 278 tests + typecheck 전부 Done + build + **E2E 29 passed** (기존 회귀 없음 — 기존 testId 불변)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src
git commit -m "feat(desktop): 리뷰 팝오버 — GitHub 연결(gh·토큰)·리뷰 요청 생성·목록·브라우저 열기

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: E2E 3건 — mock GitHub 서버 + GitHub origin 픽스처

**Files:**
- Create: `apps/desktop/e2e/hosting.spec.ts`

- [ ] **Step 1: 스펙 파일 생성**

`apps/desktop/e2e/hosting.spec.ts` 생성:

```ts
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { execGitOrThrow } from '@git-gui/git-process'

const APP_ROOT = join(__dirname, '..')

/** mock GitHub — /user·/repos·/pulls 최소 구현. POST를 메모리에 반영해 목록에 나타난다 */
interface MockGitHub {
  url: string
  pulls: Array<{ number: number; title: string; head: string; base: string }>
  close(): Promise<void>
}

function toApiPull(pull: { number: number; title: string; head: string; base: string }) {
  return {
    number: pull.number,
    title: pull.title,
    draft: false,
    html_url: `https://github.com/e2e/fixture/pull/${pull.number}`,
    head: { ref: pull.head },
    base: { ref: pull.base },
  }
}

async function startMockGitHub(): Promise<MockGitHub> {
  const pulls: MockGitHub['pulls'] = []
  const server: Server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.headers.authorization !== 'Bearer e2e-token') {
      send(401, { message: 'Bad credentials' })
      return
    }
    const path = (req.url ?? '/').split('?')[0]!
    if (req.method === 'GET' && path === '/user') {
      send(200, { login: 'e2e-user' })
      return
    }
    if (req.method === 'GET' && path === '/repos/e2e/fixture') {
      send(200, { default_branch: 'main' })
      return
    }
    if (req.method === 'GET' && path === '/repos/e2e/fixture/pulls') {
      send(200, pulls.map(toApiPull))
      return
    }
    if (req.method === 'POST' && path === '/repos/e2e/fixture/pulls') {
      let raw = ''
      req.on('data', (chunk: Buffer) => {
        raw += chunk.toString('utf8')
      })
      req.on('end', () => {
        const input = JSON.parse(raw) as { title: string; head: string; base: string }
        if (pulls.some((pull) => pull.head === input.head)) {
          send(422, {
            message: 'Validation Failed',
            errors: [{ message: `A pull request already exists for e2e:${input.head}.` }],
          })
          return
        }
        const pull = {
          number: pulls.length + 1,
          title: input.title,
          head: input.head,
          base: input.base,
        }
        pulls.push(pull)
        send(201, toApiPull(pull))
      })
      return
    }
    send(404, { message: 'Not Found' })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    pulls,
    close: () =>
      new Promise<void>((resolve) => {
        // 앱 종료 후에도 keep-alive 소켓이 남아 close가 지연될 수 있다 — 강제로 끊는다
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

/**
 * GitHub origin 픽스처 — origin URL은 GitHub 형태(파싱은 origin URL이 정본)지만 네트워크는 없다.
 * 실측 근거: branch.<name>.remote/merge 설정만으로는 @{upstream}이 해석되지 않고(exit 128),
 * update-ref로 refs/remotes/origin/<name>을 만들어야 exit 0 + status의 branch.ab(+0 -0)가
 * 네트워크 없이 성립한다 → pull-create가 push를 건너뛴다(upstream 있음 경로). 회귀로 push가
 * 실행되면 GitHub https URL로의 실 push가 실패해 테스트가 시끄럽게 죽는다(무해 통과 없음).
 */
async function createGitHubFixtureRepo(options: {
  branch: string
  withUpstream: boolean
}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'git-gui-e2e-gh-'))
  await execGitOrThrow(['init', '--initial-branch=main'], { cwd: dir })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: dir })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: dir })
  await writeFile(join(dir, 'app.txt'), 'v1\n')
  await execGitOrThrow(['add', '-A'], { cwd: dir })
  await execGitOrThrow(['commit', '-m', 'init'], { cwd: dir })
  await execGitOrThrow(['remote', 'add', 'origin', 'https://github.com/e2e/fixture.git'], {
    cwd: dir,
  })
  if (options.branch !== 'main') {
    await execGitOrThrow(['checkout', '-b', options.branch], { cwd: dir })
    await writeFile(join(dir, 'feat.txt'), 'f\n')
    await execGitOrThrow(['add', '-A'], { cwd: dir })
    await execGitOrThrow(['commit', '-m', '실험 작업'], { cwd: dir })
  }
  if (options.withUpstream) {
    await execGitOrThrow(['config', `branch.${options.branch}.remote`, 'origin'], { cwd: dir })
    await execGitOrThrow(
      ['config', `branch.${options.branch}.merge`, `refs/heads/${options.branch}`],
      { cwd: dir },
    )
    await execGitOrThrow(['update-ref', `refs/remotes/origin/${options.branch}`, 'HEAD'], {
      cwd: dir,
    })
  }
  return dir
}

test('토큰 연결 상태에서 리뷰 요청을 만들고 목록에서 본다', async () => {
  const mock = await startMockGitHub()
  const repo = await createGitHubFixtureRepo({ branch: 'feature', withUpstream: true })
  // 실제 프로필의 settings.json(진짜 토큰일 수 있음)을 읽지 않도록 userData를 격리한다
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: {
      ...process.env,
      GIT_GUI_E2E_REPO: repo,
      GIT_GUI_USER_DATA: userData,
      GIT_GUI_GITHUB_API: mock.url,
      GIT_GUI_E2E_GH_TOKEN: 'e2e-token',
    },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('review-open').click()
    // env 주입 토큰 — 연결 다이얼로그 없이 로그인 상태로 시작한다 (login은 mock /user에서 1회 확인)
    await expect(window.getByTestId('review-login')).toHaveText('@e2e-user')
    await window.getByTestId('review-create').click()
    // 제목 기본값 = 현재 실험 공간의 최근 저장 제목
    await expect(window.getByTestId('prompt-input')).toHaveValue('실험 작업')
    await window.getByTestId('prompt-submit').click()
    await expect(window.getByTestId('notice')).toContainText('리뷰 요청 #1')
    // mock 상태에 실제 반영됐다 — upstream이 있어 push는 건너뛰었다(실행됐다면 실 push 실패로 죽는다)
    expect(mock.pulls).toHaveLength(1)
    expect(mock.pulls[0]).toMatchObject({ title: '실험 작업', head: 'feature', base: 'main' })
    // 다시 열면 목록에 #1이 보인다 (mock 상태 반영)
    await window.getByTestId('review-open').click()
    await expect(window.getByTestId('review-pull-1')).toContainText('실험 작업')
  } finally {
    await app.close()
    await mock.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('기본 공간(main)에서는 리뷰 요청 버튼이 비활성이고 실험 공간에서 활성된다', async () => {
  const mock = await startMockGitHub()
  const repo = await createGitHubFixtureRepo({ branch: 'main', withUpstream: false })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: {
      ...process.env,
      GIT_GUI_E2E_REPO: repo,
      GIT_GUI_USER_DATA: userData,
      GIT_GUI_GITHUB_API: mock.url,
      GIT_GUI_E2E_GH_TOKEN: 'e2e-token',
    },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('review-open').click()
    await expect(window.getByTestId('review-create')).toBeDisabled()
    await expect(window.getByTestId('review-create-reason')).toContainText('기본 공간')
    await window.keyboard.press('Escape')
    // 실험 공간을 만들어 이동하면 활성된다 (버튼 활성만 확인 — 생성은 (a)가 커버)
    await window.getByTestId('header-branch').click()
    await window.getByTestId('branch-new').click()
    await window.getByTestId('prompt-input').fill('exp-1')
    await window.getByTestId('prompt-submit').click()
    await expect(window.getByTestId('header-branch')).toContainText('exp-1')
    await window.getByTestId('review-open').click()
    await expect(window.getByTestId('review-create')).toBeEnabled()
  } finally {
    await app.close()
    await mock.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('미연결 안내가 보이고 잘못된 토큰은 친절한 에러로 거부된다', async () => {
  const mock = await startMockGitHub()
  const repo = await createGitHubFixtureRepo({ branch: 'main', withUpstream: false })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  // 토큰 미주입 — 미연결 상태로 시작한다
  const app = await electron.launch({
    args: [APP_ROOT],
    env: {
      ...process.env,
      GIT_GUI_E2E_REPO: repo,
      GIT_GUI_USER_DATA: userData,
      GIT_GUI_GITHUB_API: mock.url,
    },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('review-open').click()
    await expect(window.getByText('GitHub와 연결하면')).toBeVisible()
    await window.getByTestId('review-connect-token').click()
    await window.getByTestId('prompt-input').fill('wrong-token')
    await window.getByTestId('prompt-submit').click()
    // mock이 401 — 첫 연결 맥락의 친절 문구로 거부되고 다이얼로그는 입력을 보존한 채 남는다
    await expect(window.getByTestId('prompt-error')).toContainText('토큰이 맞지 않아요')
    await expect(window.getByTestId('prompt-input')).toHaveValue('wrong-token')
  } finally {
    await app.close()
    await mock.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: 실행 확인**

Run: `cd apps/desktop && pnpm e2e`
Expected: **32 passed** (기존 29 + 신규 3)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/e2e/hosting.spec.ts
git commit -m "test(e2e): 리뷰 요청 3건 — mock GitHub 서버·GitHub origin 픽스처(upstream 사전 성립)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9-보완: 품질 리뷰 5건 (실측 반영)

품질 리뷰(실렌더·보안 실측)가 잡은 결함:

- **(Important 2) 패키징 앱 env 토큰 유출 경로** — `baseUrl()`이 `app.isPackaged` 게이트 없이 env를 신뢰해, 패키징 앱을 `GIT_GUI_GITHUB_API=http://attacker`로 실행하면 저장 토큰이 복호화되어 공격자 서버로 전송된다. `GIT_GUI_E2E_GH_TOKEN`도 동일 게이트 대상. → `!app.isPackaged` 조건.
- **(Important 1) 960px 헤더 36px 가로 오버플로** — 리뷰 버튼(99px)이 단독 원인(실측). → 좁은 창에서 원어 배지(리뷰 PR·받아오기 pull·백업 push)를 접는다.
- **(Minor 3) 오프라인 목록 실패가 "없어요"로 위장** — 실패와 빈 목록을 구분(null 상태).
- **(Minor 4) merging/reverting 중 리뷰 요청 무가드** — 전환·받아오기와 같은 기준으로 UI 비활성+사유 + 핸들러 친절 거부(이중 방어).
- **(Minor 6) disconnect가 knownPullUrls 미정리 + connectGh 첫 연결 401이 "만료" 문구** — 정리·재문구.

**Files:**
- Modify: `apps/desktop/src/main/hosting-handlers.ts`
- Modify: `apps/desktop/src/renderer/src/components/ReviewPopover.tsx` (+`review-popover.css`)
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`
- Modify: `apps/desktop/src/renderer/src/App.tsx`

- [ ] **Step 1: hosting-handlers.ts**

(a) import 교체 — `import { ipcMain, shell } from 'electron'` →

```ts
import { app, ipcMain, shell } from 'electron'
```

(b) baseUrl·currentToken 블록 교체 — 기존:

```ts
/** 개발·E2E에서 mock 서버로 바꿔 끼운다 — 프로덕션 기본은 GitHub 공식 API */
function baseUrl(): string {
  return process.env.GIT_GUI_GITHUB_API || 'https://api.github.com'
}

/** E2E 토큰 사전 주입 — 연결 다이얼로그 없이 로그인 상태로 시작한다 (GIT_GUI_E2E_REPO와 동일 관례) */
function currentToken(): string | null {
  return process.env.GIT_GUI_E2E_GH_TOKEN || readGitHubToken()
}
```

교체:

```ts
/** 개발·E2E에서 mock 서버로 바꿔 끼운다 — 패키징된 앱에서는 env 주입을 무시한다
    (env로 baseUrl을 바꾸면 저장된 토큰이 임의 서버로 전송된다 — 품질 리뷰) */
function baseUrl(): string {
  if (!app.isPackaged && process.env.GIT_GUI_GITHUB_API) return process.env.GIT_GUI_GITHUB_API
  return 'https://api.github.com'
}

/** E2E 토큰 사전 주입 — 패키징된 앱에서는 무시한다 (GIT_GUI_E2E_REPO와 동일 관례) */
function currentToken(): string | null {
  if (!app.isPackaged && process.env.GIT_GUI_E2E_GH_TOKEN) return process.env.GIT_GUI_E2E_GH_TOKEN
  return readGitHubToken()
}
```

(c) disconnect 핸들러 교체:

```ts
  ipcMain.handle(HOSTING_CHANNELS.disconnect, () => {
    clearGitHubConnection()
    memoLogin = null
    // 해제 후 이전 목록의 주소가 남지 않게 — 재연결하면 목록에서 다시 채운다 (품질 리뷰)
    knownPullUrls.clear()
  })
```

(d) connectGh의 `return verifyAndSave(token)` 줄 교체:

```ts
    try {
      return await verifyAndSave(token)
    } catch (cause) {
      // 첫 연결의 401은 "만료"가 아니다 — gh 토큰이 더는 유효하지 않은 상황 (품질 리뷰)
      if (cause instanceof Error && cause.message.includes('연결이 만료됐어요')) {
        throw new Error(
          'gh 로그인이 더는 유효하지 않아요. 터미널에서 gh auth login 후 다시 시도해 주세요.',
        )
      }
      throw cause
    }
```

(e) pullCreate 핸들러의 `branch.branch === null` 거부 블록 **바로 뒤**에 추가:

```ts
    // 전환·받아오기와 같은 기준 — 진행 중 작업(merging·reverting) 중에는 요청을 받지 않는다 (품질 리뷰)
    const repoStatus = await client.repo.status()
    if (repoStatus.state !== 'normal') {
      throw new Error('지금 진행 중인 작업(합치기·되돌리기)을 먼저 마무리한 뒤 요청해 주세요.')
    }
```

- [ ] **Step 2: ReviewPopover.tsx**

(a) props에 추가(`currentBranch` 항목 뒤):

```ts
  /** 진행 중 작업(merging·reverting) — 요청 버튼을 비활성하고 사유를 보여준다 (품질 리뷰) */
  stateBlocked: boolean
```

(b) `pulls` prop 타입 교체:

```ts
  /** 열린 리뷰 요청 — null이면 마지막 조회 실패(빈 목록으로 위장하지 않는다 — 품질 리뷰) */
  pulls: PullSummary[] | null
```

(c) 구조 분해에 `stateBlocked` 추가, 트리거 버튼에 className:

```tsx
      <Button variant="ghost" size="sm" className="review-popover__trigger" testId="review-open">
        <GitPullRequest size={13} aria-hidden="true" /> 리뷰 <Badge tone="git">PR</Badge>
      </Button>
```

(d) 요청 버튼·사유 교체 — `isDisabled={busy || isDefaultBranch}`를 `isDisabled={busy || isDefaultBranch || stateBlocked}`로, `isDefaultBranch && (…)` 사유 블록 **뒤**에 추가:

```tsx
                  {stateBlocked && (
                    <p className="review-popover__reason" data-testid="review-create-blocked">
                      지금 진행 중인 작업(합치기·되돌리기)을 먼저 마무리한 뒤 요청할 수 있어요.
                    </p>
                  )}
```

(e) 목록 분기 교체 — `{pulls.length === 0 ? (` 삼항을:

```tsx
                  {pulls === null ? (
                    <p className="review-popover__empty">
                      리뷰 요청 목록을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 열어 주세요.
                    </p>
                  ) : pulls.length === 0 ? (
                    <p className="review-popover__empty">열린 리뷰 요청이 없어요.</p>
                  ) : (
```

(기존 `<ul>` 블록과 닫는 `)}`는 그대로.)

- [ ] **Step 3: review-popover.css 끝에 추가**

```css
/* 960px 최소 창에서 헤더 한 줄 보장(E1c) — 좁은 창에서는 원어 배지를 접는다
   (품질 리뷰 실측: 리뷰 버튼 추가로 36px 가로 오버플로) */
@media (max-width: 1180px) {
  .review-popover__trigger .ui-badge,
  .app__actions .ui-badge--git {
    display: none;
  }
}
```

- [ ] **Step 4: store**

(a) 상태 타입 교체 — `pulls: PullSummary[]` 인터페이스 항목을:

```ts
  /** 열린 리뷰 요청 — null이면 마지막 조회 실패(빈 목록으로 위장하지 않는다 — 품질 리뷰) */
  pulls: PullSummary[] | null
```

(b) refreshPulls의 guard 내부 교체:

```ts
    await guard(set, get, async () => {
      try {
        set({ pulls: await hosting().pulls.list(repoPath) })
      } catch (cause) {
        // 실패를 빈 목록("없어요")으로 위장하지 않는다 — null은 "못 불러왔어요" 표시 (품질 리뷰)
        set({ pulls: null })
        throw cause
      }
    })
```

- [ ] **Step 5: App.tsx** — ReviewPopover 호출의 `currentBranch=` 줄 뒤에 추가:

```tsx
            stateBlocked={status?.state !== 'normal'}
```

- [ ] **Step 6: 실렌더·검증 5건** — (1) 960×800 `document.documentElement.scrollWidth === 960`(오버플로 0)·헤더 한 줄, (2) merging(충돌) 중 요청 버튼 비활성+사유 표시, (3) mock 서버 내린 상태에서 팝오버 → "목록을 불러오지 못했어요" (빈 목록 문구 아님), (4) 연결 해제 직후 이전 목록 항목 열기 시 친절 거부(재현 가능하면 — 목록이 비어 있으면 코드 검토로 갈음), (5) isPackaged 게이트는 dev에서 `app.isPackaged === false`라 기존 E2E 경로가 유지됨을 게이트로 검증(코드 검토 + E2E 32 통과가 곧 증명). (1)이 배지 접기로도 오버플로가 남으면 **NEEDS_CONTEXT**.

- [ ] **Step 7: 게이트** — 루트 `pnpm test`(**278**) + typecheck(6 Done) + build + E2E 전체(**32 passed**) 전부 exit 0

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src
git commit -m "fix(desktop): 품질 리뷰 — env 게이트(isPackaged)·960px 배지 접기·목록 실패 구분·진행 중 가드·해제 정리

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: 최종 게이트 + 공식 스크린샷 3장 + README

- [ ] **Step 1: 전체 게이트**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: **278 tests + typecheck 전부 Done(6 프로젝트) + build + E2E 32 passed** — 전부 exit 0

- [ ] **Step 2: 스크린샷 3장** (1440×900, `apps/desktop/test-results/` + scratchpad 사본. **생성 후 playwright/e2e 재실행 금지** — playwright가 test-results를 청소한다)

임시 스펙 `apps/desktop/e2e/shots.spec.ts`를 만든다 (**커밋 금지 — 촬영 후 삭제**). mock 서버·픽스처는 hosting.spec.ts와 동일 코드를 복사한다(임시 파일이라 중복 허용):

```ts
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { execGitOrThrow } from '@git-gui/git-process'

const APP_ROOT = join(__dirname, '..')

function toApiPull(pull: { number: number; title: string; head: string; base: string }) {
  return {
    number: pull.number,
    title: pull.title,
    draft: false,
    html_url: `https://github.com/e2e/fixture/pull/${pull.number}`,
    head: { ref: pull.head },
    base: { ref: pull.base },
  }
}

async function startMockGitHub(): Promise<{ url: string; close(): Promise<void> }> {
  const pulls: Array<{ number: number; title: string; head: string; base: string }> = []
  const server: Server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.headers.authorization !== 'Bearer e2e-token') {
      send(401, { message: 'Bad credentials' })
      return
    }
    const path = (req.url ?? '/').split('?')[0]!
    if (req.method === 'GET' && path === '/user') {
      send(200, { login: 'e2e-user' })
      return
    }
    if (req.method === 'GET' && path === '/repos/e2e/fixture') {
      send(200, { default_branch: 'main' })
      return
    }
    if (req.method === 'GET' && path === '/repos/e2e/fixture/pulls') {
      send(200, pulls.map(toApiPull))
      return
    }
    if (req.method === 'POST' && path === '/repos/e2e/fixture/pulls') {
      let raw = ''
      req.on('data', (chunk: Buffer) => {
        raw += chunk.toString('utf8')
      })
      req.on('end', () => {
        const input = JSON.parse(raw) as { title: string; head: string; base: string }
        const pull = {
          number: pulls.length + 1,
          title: input.title,
          head: input.head,
          base: input.base,
        }
        pulls.push(pull)
        send(201, toApiPull(pull))
      })
      return
    }
    send(404, { message: 'Not Found' })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        // 앱 종료 후에도 keep-alive 소켓이 남아 close가 지연될 수 있다 — 강제로 끊는다
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

async function createGitHubFixtureRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'git-gui-shot-'))
  await execGitOrThrow(['init', '--initial-branch=main'], { cwd: dir })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: dir })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: dir })
  await writeFile(join(dir, 'app.txt'), 'v1\n')
  await execGitOrThrow(['add', '-A'], { cwd: dir })
  await execGitOrThrow(['commit', '-m', 'init'], { cwd: dir })
  await execGitOrThrow(['remote', 'add', 'origin', 'https://github.com/e2e/fixture.git'], {
    cwd: dir,
  })
  await execGitOrThrow(['checkout', '-b', 'feature'], { cwd: dir })
  await writeFile(join(dir, 'feat.txt'), 'f\n')
  await execGitOrThrow(['add', '-A'], { cwd: dir })
  await execGitOrThrow(['commit', '-m', '로그인 버튼 색 실험'], { cwd: dir })
  await execGitOrThrow(['config', 'branch.feature.remote', 'origin'], { cwd: dir })
  await execGitOrThrow(['config', 'branch.feature.merge', 'refs/heads/feature'], { cwd: dir })
  await execGitOrThrow(['update-ref', 'refs/remotes/origin/feature', 'HEAD'], { cwd: dir })
  return dir
}

test('E3a 공식 스크린샷 3장', async () => {
  const mock = await startMockGitHub()
  const repo = await createGitHubFixtureRepo()
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-shot-userdata-'))
  // 1) 미연결 팝오버 — 토큰 없이
  const first = await electron.launch({
    args: [APP_ROOT],
    env: {
      ...process.env,
      GIT_GUI_E2E_REPO: repo,
      GIT_GUI_USER_DATA: userData,
      GIT_GUI_GITHUB_API: mock.url,
    },
  })
  let window = await first.firstWindow()
  await first.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.setSize(1440, 900)
  })
  await window.getByTestId('review-open').click()
  await expect(window.getByTestId('review-connect-token')).toBeVisible()
  await window.screenshot({ path: 'test-results/e3a-connect.png' })
  await first.close()
  // 2) 생성 notice + 3) 목록 — 토큰 주입 상태로 재실행
  const second = await electron.launch({
    args: [APP_ROOT],
    env: {
      ...process.env,
      GIT_GUI_E2E_REPO: repo,
      GIT_GUI_USER_DATA: userData,
      GIT_GUI_GITHUB_API: mock.url,
      GIT_GUI_E2E_GH_TOKEN: 'e2e-token',
    },
  })
  window = await second.firstWindow()
  await second.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.setSize(1440, 900)
  })
  await window.getByTestId('review-open').click()
  await expect(window.getByTestId('review-login')).toHaveText('@e2e-user')
  await window.getByTestId('review-create').click()
  await expect(window.getByTestId('prompt-input')).toHaveValue('로그인 버튼 색 실험')
  await window.getByTestId('prompt-submit').click()
  await expect(window.getByTestId('notice')).toContainText('리뷰 요청 #1')
  await window.screenshot({ path: 'test-results/e3a-created.png' })
  await window.getByTestId('review-open').click()
  await expect(window.getByTestId('review-pull-1')).toBeVisible()
  await window.screenshot({ path: 'test-results/e3a-pulls.png' })
  await second.close()
  await mock.close()
})
```

Run (Step 1 게이트의 build 산출물을 그대로 사용 — 다시 build하지 않는다):

```bash
cd apps/desktop && npx playwright test e2e/shots.spec.ts
```

Expected: 1 passed. 촬영물 확인·사본·정리:

```bash
ls apps/desktop/test-results/e3a-connect.png apps/desktop/test-results/e3a-created.png apps/desktop/test-results/e3a-pulls.png
cp apps/desktop/test-results/e3a-connect.png apps/desktop/test-results/e3a-created.png apps/desktop/test-results/e3a-pulls.png "<temporary-scratchpad>/"
rm apps/desktop/e2e/shots.spec.ts
```

각 장의 확인 포인트: (a) `e3a-connect.png` — 리뷰 팝오버 미연결 상태(안내 문구 + [토큰으로 연결], gh 감지 머신이면 [gh로 연결]도), (b) `e3a-created.png` — notice "리뷰 요청 #1을 만들었어요…", (c) `e3a-pulls.png` — 연결 헤더(@e2e-user·연결 해제) + 목록 #1(제목·feature 브랜치 배지·바깥 링크 아이콘). **이후 playwright/e2e를 다시 실행하지 않는다.**

- [ ] **Step 3: README "현재 상태" 갱신**

`README.md`의 다음 구간을 교체 — 기존:

```
0단계(기반)와 E0·E1(쉬운 모드 — 실험 공간·보관함·합치기)이 동작합니다
```

교체:

```
0단계(기반)와 E0·E1·E2·E3a(쉬운 모드 — 실험 공간·보관함·합치기·충돌 카드·리뷰 요청)가 동작합니다
```

기존:

```
백업(push), 저장 메시지 자동 제안 — 디자인 토큰
```

교체:

```
백업(push), 저장 메시지 자동 제안, GitHub 연결(gh CLI 감지·토큰 붙여넣기, safeStorage 암호화 저장)과 리뷰 요청(pull request) 만들기·열린 목록·브라우저 열기 — 디자인 토큰
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README — E3a GitHub 연결·리뷰 요청 생성·목록 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10-보완: 통합 리뷰 1건 — rename 뒤 옛 upstream 잔존

통합 리뷰 실측: `git branch -m`은 config의 merge ref(옛 이름)를 유지해, push된 브랜치를 rename하면 `@{upstream}`이 **옛 이름으로 여전히 해석**된다. 그 결과 ① pull-create가 push를 건너뛰고 원격에 없는 head로 PR을 시도(실 GitHub 422 — 비개발자 회복 불가), ② 백업(push)도 평범한 push가 원어 에러로 죽는다(E1 후속 노트로 이관했던 기존 문제 — 같은 뿌리). **수정: upstream "이름"을 노출하고, 현재 브랜치명과 어긋나면 push를 `-u <remote> HEAD` 재연결 경로로 태운다** — 두 문제가 한 번에 닫힌다.

**Files:**
- Modify: `packages/domain/src/repository.ts` (SyncBranchStatus.upstream)
- Modify: `packages/git-adapter/src/client.ts` (branchStatus·push)
- Test: `packages/git-adapter/test/client.test.ts` (신규 2건 + 기존 단언 3곳 갱신)
- Modify: `apps/desktop/src/main/hosting-handlers.ts` (pull-create 건너뛰기 조건)

- [ ] **Step 1: 테스트 Red** — `client.test.ts`:

(a) 기존 `'sync.branchStatus — 현재 브랜치와 upstream 유무를 알려준다'`의 단언 2곳 교체:

```ts
    expect(await client.sync.branchStatus()).toEqual({ branch: 'main', hasUpstream: false, upstream: null })
```

```ts
    expect(await client.sync.branchStatus()).toEqual({ branch: 'main', hasUpstream: true, upstream: 'origin/main' })
```

(b) 기존 `'sync.branchStatus — detached HEAD면 branch null이다'`의 단언 교체:

```ts
    expect(await createGitClient(repo).sync.branchStatus()).toEqual({
      branch: null,
      hasUpstream: false,
      upstream: null,
    })
```

(c) detached 테스트 **뒤**에 신규 2건 추가:

```ts
  it('branchStatus — 이름 바꾼 브랜치는 옛 upstream 이름이 그대로 남는다 (잔존 감지용)', async () => {
    const { repo } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.branches.create('feature', null)
    await client.branches.switch('feature')
    await client.sync.push()
    await client.branches.rename('feature', 'feature-2')
    // git branch -m은 merge ref(옛 이름)를 유지한다 — upstream이 여전히 옛 이름으로 해석된다 (통합 리뷰 실측)
    expect(await client.sync.branchStatus()).toEqual({
      branch: 'feature-2',
      hasUpstream: true,
      upstream: 'origin/feature',
    })
  })

  it('push — 이름 바꾼 브랜치는 옛 upstream을 무시하고 새 이름으로 다시 연결하며 올린다', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.branches.create('feature', null)
    await client.branches.switch('feature')
    await client.sync.push()
    await client.branches.rename('feature', 'feature-2')

    await client.sync.push()
    const upstream = await execGitOrThrow(
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
      { cwd: repo },
    )
    expect(upstream.stdout.trim()).toBe('origin/feature-2')
    const remoteBranches = await execGitOrThrow(['branch', '--format=%(refname:short)'], {
      cwd: remote,
    })
    expect(remoteBranches.stdout).toContain('feature-2')
  })
```

Run: `pnpm --filter @git-gui/git-adapter test` → **수정 2건 + 신규 2건 FAIL 확인**(upstream 필드 부재·rename 후 push 원어 에러).

- [ ] **Step 2: domain** — `SyncBranchStatus` 교체:

```ts
export interface SyncBranchStatus {
  /** detached HEAD면 null */
  branch: string | null
  hasUpstream: boolean
  /** upstream 짧은 이름(예: origin/feature) — rename 뒤 옛 이름 잔존 감지에 쓴다. 없으면 null */
  upstream: string | null
}
```

- [ ] **Step 3: 어댑터**

(a) `branchStatus` 전체 교체:

```ts
      async branchStatus() {
        const cwd = await topLevel()
        const branch = await execGit(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd })
        if (branch.exitCode !== 0) return { branch: null, hasUpstream: false, upstream: null }
        // 실측: branch.<name>.remote/merge 설정만으로는 해석되지 않고, remote-tracking ref까지
        // 있어야 exit 0이다 — "원격에 실제로 올라간 적 있음"을 뜻해 리뷰 요청 전 검사에 맞다
        const upstream = await execGit(
          ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
          { cwd },
        )
        const upstreamName = upstream.exitCode === 0 ? upstream.stdout.trim() : null
        return {
          branch: branch.stdout.trim(),
          hasUpstream: upstreamName !== null,
          upstream: upstreamName,
        }
      },
```

(b) `push` 전체 교체:

```ts
      async push() {
        const cwd = await topLevel()
        const remotes = await execGitOrThrow(['remote'], { cwd })
        const remoteNames = remotes.stdout
          .trim()
          .split('\n')
          .filter((name) => name !== '')
        if (remoteNames.length === 0) {
          throw new Error('백업할 원격 저장소가 없어요. 먼저 원격 저장소를 연결해 주세요.')
        }
        // 사용자 직관대로 origin을 우선하고, 없으면 (git remote 출력 = 알파벳순) 첫 remote
        const targetRemote = remoteNames.includes('origin') ? 'origin' : remoteNames[0]!
        const branch = await execGit(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd })
        const upstream = await execGit(
          ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
          { cwd },
        )
        // upstream이 "현재 이름과 같은" 원격 브랜치일 때만 평범한 push —
        // rename 뒤에는 옛 이름의 upstream이 남아(git branch -m이 merge ref 유지 — 통합 리뷰 실측)
        // 평범한 push가 원어 에러로 죽는다. 그 경우 아래의 -u 재연결 경로로 태운다
        if (
          upstream.exitCode === 0 &&
          branch.exitCode === 0 &&
          upstream.stdout.trim().endsWith(`/${branch.stdout.trim()}`)
        ) {
          // push.default=matching 같은 사용자 전역 설정이 다른 브랜치까지 올리지 않게 고정한다
          await execGitOrThrow(['-c', 'push.default=simple', 'push'], { cwd })
          return
        }
        // 아직 커밋이 없으면 올릴 것이 없다 — 원문 git 에러 대신 읽히는 메시지로
        const head = await execGit(['rev-parse', '-q', '--verify', 'HEAD'], { cwd })
        if (head.exitCode !== 0) {
          throw new Error('아직 저장된 시점이 없어요. 먼저 저장(commit)한 뒤 백업해 주세요.')
        }
        // detached HEAD에서는 올릴 브랜치가 없다 — 원문 git 에러 대신 읽히는 메시지로
        if (branch.exitCode !== 0) {
          throw new Error('지금은 브랜치가 아닌 시점에 있어요. 브랜치로 이동한 뒤 백업해 주세요.')
        }
        // 첫 백업(또는 이름이 어긋난 upstream 재연결) — 현재 브랜치를 remote에 연결하며 올린다.
        // --end-of-options: 대시로 시작하는 remote 이름이 플래그로 해석되는 것을 차단
        await execGitOrThrow(['push', '-u', '--end-of-options', targetRemote, 'HEAD'], { cwd })
      },
```

- [ ] **Step 4: hosting-handlers** — pull-create의 push 건너뛰기 블록 교체. 기존:

```ts
    // 원격에 이 실험 공간이 없으면 리뷰 대상이 없다 — 기존 백업(push) 흐름으로 먼저 올린다
    if (!branch.hasUpstream) await client.sync.push()
```

교체:

```ts
    // 원격에 이 실험 공간이 없으면 리뷰 대상이 없다 — 기존 백업(push) 흐름으로 먼저 올린다.
    // rename 뒤에는 옛 이름의 upstream이 남는다(통합 리뷰 실측) — 이름이 같을 때만 건너뛴다
    const upstreamMatches =
      branch.upstream !== null && branch.upstream.endsWith(`/${branch.branch}`)
    if (!upstreamMatches) await client.sync.push()
```

- [ ] **Step 5: Green + 게이트** — `pnpm --filter @git-gui/git-adapter test` 전체 PASS → 루트 `pnpm test`(**280**: 278+2) + typecheck(6 Done) + build + E2E 전체(**32 passed**)

- [ ] **Step 6: 실기동 확인** — mock 서버 + 로컬 bare pushurl 픽스처: push된 브랜치 rename → ① 리뷰 요청 → bare에 새 이름 브랜치 push 도달 + mock PR의 head=새 이름, ② 백업 버튼 → 성공(원어 에러 없음 — E1 이관 항목 해소 확인).

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src packages/git-adapter apps/desktop/src/main/hosting-handlers.ts
git commit -m "fix: 통합 리뷰 — rename 뒤 옛 upstream 무시(push -u 재연결·리뷰 요청 head 정합)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 검증 게이트 요약

| 시점 | 기대치 |
| --- | --- |
| 기준선 (5bde036, 실측) | **253 tests + E2E 29** |
| Task 1 후 | +6 (parseRemoteUrl) → **259 tests** |
| Task 2 후 | +9 (GitHub fetch 왕복·에러 매핑) → **268 tests** |
| Task 3 후 | +3 (detectGhToken) → **271 tests** |
| Task 4 후 | +4 (branchStatus·remoteUrl) → **275 tests** |
| Task 5 후 | +3 (sanitizePersistedSettings) → **278 tests** + build |
| Task 6 후 | 278 tests + build |
| Task 7 후 | 278 tests + build |
| Task 8 후 | 278 tests + build + **E2E 29** (기존 회귀 없음) |
| Task 9 후 | **E2E 32** (+3) |
| 최종 (Task 10) | **278 tests + typecheck 전부 Done(6 프로젝트) + build + E2E 32** — 전부 exit 0 + 스크린샷 3장 + README |

(수치가 어긋나면 이 표를 갱신한다 — 본질은 "전부 PASS + 신규 테스트 실존 + Red 실증 수행".)

## 스펙 요구 커버리지 (§9 전반부 + 확정 아키텍처 1~9)

| 요구 | 구현 지점 |
| --- | --- |
| Hosting adapter 계층(§9 "호스팅 API 차이 흡수") | packages/hosting — 인터페이스(GitHubHosting) + GitHub 구현 (Task 1~3) |
| 파서 순수 함수 + 단위 테스트(.git 유무·대소문자·비GitHub) | parseRemoteUrl + 6 tests (Task 1) |
| baseUrl 주입·mock 서버 fetch 실왕복·에러 매핑 전부 | createGitHubHosting + 9 tests (Task 2) |
| 토큰 취득 2경로(gh 자동 감지·PAT) + user.current 검증 후에만 저장 | detectGhToken (Task 3) + verifyAndSave (Task 6) |
| safeStorage 암호화 저장·복호화 실패는 토큰 없음 | settings.ts read/saveGitHubConnection (Task 5) |
| renderer에 토큰 절대 미노출(login만) | getSync가 sanitizeSettings로 hosting 제거 + 테스트 고정 (Task 5), HostingStatus는 login만 (Task 6) |
| env 주입(GIT_GUI_GITHUB_API·GIT_GUI_E2E_GH_TOKEN) | hosting-handlers baseUrl()·currentToken() (Task 6) + E2E env (Task 9) |
| IPC 6채널 + 인자 unknown 검증 | HOSTING_CHANNELS(+pull-open) + assert* (Task 6) |
| pull-create: 브랜치 확인·기본 공간 친절 거부·upstream 없으면 기존 push | hosting-handlers pullCreate + sync.branchStatus (Task 4·6) |
| 헤더 "리뷰" 버튼(Badge PR)·팝오버(ShelfPopover 패턴) | ReviewPopover (Task 8) |
| 미연결: 안내 문구 + gh(감지 시)/토큰 연결(PromptDialog·가이드 문구·IME 가드) | ReviewPopover 미연결 뷰 + App tokenPrompt (Task 8) |
| 연결됨: @login·연결 해제·비GitHub 안내·요청 버튼(main 비활성+이유)·목록·클릭 브라우저 열기 | ReviewPopover 연결 뷰 + openPull(main 보관 URL만) (Task 6·8) |
| 생성: 제목 기본값=최근 커밋 제목, 성공 notice "#N…", 이미 있으면 친절 에러 | App pullPrompt(initialValue=history[0].subject) + createPull notice + 422 매핑 (Task 2·7·8) |
| 문구 일상어+원어 병기(§5) | "리뷰 요청 (pull request)"·"실험 공간(branch)" 등 전 문구 (Task 6~8) |
| store: hostingStatus·pulls·액션, guard 직렬화, 스냅샷 독립·busy 공유 | repository-store (Task 7) |
| E2E 3건(mock 서버·env 주입·픽스처 upstream 사전 성립) | hosting.spec.ts (Task 9) |
| 최종 게이트 + 스크린샷 3장 + README | Task 10 |

## 후속 노트 (E3a 이후 이관 후보)

- **E3b(§9 후반부):** 코멘트 확인·답변, 승인, 병합 — 이번 범위 제외. PullSummary에 필요한 필드(리뷰 상태 등)는 그때 확장한다.
- **upstream은 있으나 ahead>0인 상태의 리뷰 요청:** 지금은 push를 추가로 하지 않아 원격에 안 올라간 저장이 리뷰에서 빠질 수 있다 — "생성 전 항상 백업" 또는 ahead 감지 안내를 검토(아키텍처 확정 문구는 "upstream 없으면 push"까지만).
- **토큰 401을 status/pulls에서 만났을 때의 재연결 유도:** 지금은 에러 배너 문구("연결이 만료됐어요")뿐 — 팝오버가 자동으로 미연결 화면 + 재연결 버튼으로 전환되는 UX 검토.
- **PAT 입력 마스킹:** PromptDialog는 평문 Input — password 타입 옵션 확장 검토(토큰이 화면에 보인다).
- **기본 공간 이름 캐시:** UI 비활성 판정이 main·master 휴리스틱 — hosting:status에 default_branch를 캐시해 정확 판정하는 개선(네트워크 시점 설계 필요).
- **pulls 페이지네이션:** per_page=50 초과 목록은 잘린다 — E3b에서 페이징.
- **GitHub Enterprise:** parseRemoteUrl은 host를 이미 돌려준다 — 사용자 지정 호스트 + baseUrl 설정 UI가 생기면 판정만 바꾸면 된다.
- **disconnect와 GIT_GUI_E2E_GH_TOKEN:** env 주입 토큰은 해제로 지워지지 않는다(E2E 전용 경로 — 프로덕션 무관).
- **gh 감지 시점:** ghAvailable은 프로세스당 1회 메모(연결 시도 시 재감지) — 앱 실행 중 gh login한 경우 status 표시가 낡을 수 있다(연결 버튼은 재감지하므로 동작은 정상). (통합 리뷰 Minor 2 동일 지적)
- (통합 리뷰 Minor) 연결 상태에서 첫 팝오버 열기 순간 목록 도착 전 "없어요"가 잠깐 보인다 — 로딩 상태 구분 검토.
- (통합 리뷰 Minor) refreshPulls가 guard 경유라 팝오버 열기만으로 기존 배너가 지워진다 — 앱 전반 guard 관례와 일관되나 기록.
- (해소 기록) E1c 후속 노트의 "현재 브랜치 rename 후 백업 upstream 불일치 원어 에러"는 Task 10-보완의 push `-u` 재연결로 해소됐다.
