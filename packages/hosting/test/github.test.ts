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
