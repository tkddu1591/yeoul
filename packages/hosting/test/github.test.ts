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

/** 경로별 응답 mock — pulls.comments처럼 한 호출이 두 경로를 왕복할 때 쓴다 */
async function startMockRouter(
  routes: Record<string, { status: number; body: unknown }>,
): Promise<{ baseUrl: string; requests: Recorded[] }> {
  const requests: Recorded[] = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8')
    })
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: raw })
      const key = `${req.method} ${(req.url ?? '/').split('?')[0]}`
      const route = routes[key] ?? { status: 404, body: { message: 'Not Found' } }
      res.writeHead(route.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(route.body))
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

const DETAIL_FIXTURE = { ...PULL_FIXTURE, state: 'open', merged: false }

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

  it('pulls.get — 상세를 매핑한다 (열림)', async () => {
    const mock = await startMock(200, DETAIL_FIXTURE)
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    expect(await hosting.pulls.get('octo', 'hello', 7)).toEqual({
      number: 7,
      title: '로그인 버튼 색 실험',
      state: 'open',
      merged: false,
      url: 'https://github.com/octo/hello/pull/7',
      headBranch: 'feature',
      baseBranch: 'main',
    })
    expect(mock.requests[0]!.method).toBe('GET')
    expect(mock.requests[0]!.url).toBe('/repos/octo/hello/pulls/7')
  })

  it('pulls.get — 병합된 리뷰 요청은 state closed·merged true다', async () => {
    const mock = await startMock(200, { ...DETAIL_FIXTURE, state: 'closed', merged: true })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    const detail = await hosting.pulls.get('octo', 'hello', 7)
    expect(detail.state).toBe('closed')
    expect(detail.merged).toBe(true)
  })

  it('pulls.get 404 — 리뷰 요청을 찾지 못했다는 문구로 매핑한다 (저장소 404 문구가 아니다)', async () => {
    const mock = await startMock(404, { message: 'Not Found' })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    await expect(hosting.pulls.get('octo', 'hello', 7)).rejects.toThrow(
      '리뷰 요청을 찾지 못했어요. 목록을 새로 열어 주세요.',
    )
  })

  it('pulls.comments — 이슈 코멘트·리뷰 두 경로를 왕복해 시간순으로 병합한다', async () => {
    const mock = await startMockRouter({
      'GET /repos/octo/hello/issues/7/comments': {
        status: 200,
        body: [
          {
            id: 1,
            user: { login: 'octo' },
            body: '먼저 남긴 질문',
            created_at: '2026-07-20T10:00:00Z',
          },
        ],
      },
      'GET /repos/octo/hello/pulls/7/reviews': {
        status: 200,
        body: [
          {
            id: 2,
            user: { login: 'reviewer' },
            body: '',
            state: 'APPROVED',
            submitted_at: '2026-07-20T11:00:00Z',
          },
        ],
      },
    })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    expect(await hosting.pulls.comments('octo', 'hello', 7)).toEqual([
      { id: 1, author: 'octo', body: '먼저 남긴 질문', createdAt: 1784541600, kind: 'comment', state: null },
      { id: 2, author: 'reviewer', body: '', createdAt: 1784545200, kind: 'review', state: 'approved' },
    ])
    const urls = mock.requests.map((request) => request.url).sort()
    expect(urls).toEqual([
      '/repos/octo/hello/issues/7/comments?per_page=100',
      '/repos/octo/hello/pulls/7/reviews?per_page=100',
    ])
  })

  it('pulls.comments 404 — 리뷰 요청을 찾지 못했다는 문구로 매핑한다', async () => {
    const mock = await startMock(404, { message: 'Not Found' })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    await expect(hosting.pulls.comments('octo', 'hello', 7)).rejects.toThrow(
      '리뷰 요청을 찾지 못했어요. 목록을 새로 열어 주세요.',
    )
  })

  it('pulls.addComment — POST /issues/{n}/comments에 본문을 싣는다', async () => {
    const mock = await startMock(201, { id: 10 })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    await hosting.pulls.addComment('octo', 'hello', 7, '확인했어요. 감사합니다!')
    const request = mock.requests[0]!
    expect(request.method).toBe('POST')
    expect(request.url).toBe('/repos/octo/hello/issues/7/comments')
    expect(JSON.parse(request.body)).toEqual({ body: '확인했어요. 감사합니다!' })
  })

  it('pulls.approve — POST /pulls/{n}/reviews에 event APPROVE를 싣는다', async () => {
    const mock = await startMock(200, { id: 11, state: 'APPROVED' })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    await hosting.pulls.approve('octo', 'hello', 7)
    const request = mock.requests[0]!
    expect(request.method).toBe('POST')
    expect(request.url).toBe('/repos/octo/hello/pulls/7/reviews')
    expect(JSON.parse(request.body)).toEqual({ event: 'APPROVE' })
  })

  it('pulls.approve 422 자기 승인 — 스스로 승인할 수 없다는 문구로 매핑한다', async () => {
    // 실 GitHub 응답 본문 — errors[]에 이 문자열이 담긴다
    const mock = await startMock(422, {
      message: 'Unprocessable Entity',
      errors: ['Can not approve your own pull request'],
    })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    await expect(hosting.pulls.approve('octo', 'hello', 7)).rejects.toThrow(
      '내가 만든 리뷰 요청은 스스로 승인할 수 없어요. 다른 사람의 승인을 기다려 주세요.',
    )
  })

  it('pulls.merge — PUT /pulls/{n}/merge에 merge_method merge를 싣는다 (병합 커밋)', async () => {
    const mock = await startMock(200, { merged: true, message: 'Pull Request successfully merged' })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    await hosting.pulls.merge('octo', 'hello', 7)
    const request = mock.requests[0]!
    expect(request.method).toBe('PUT')
    expect(request.url).toBe('/repos/octo/hello/pulls/7/merge')
    expect(JSON.parse(request.body)).toEqual({ merge_method: 'merge' })
  })

  it('pulls.merge 405 — 아직 병합할 수 없다는 문구로 매핑한다 (충돌·검사 진행)', async () => {
    const mock = await startMock(405, { message: 'Pull Request is not mergeable' })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    await expect(hosting.pulls.merge('octo', 'hello', 7)).rejects.toThrow(
      '아직 병합할 수 없어요. 겹침(충돌)이나 진행 중인 검사가 있는지 브라우저에서 확인해 주세요.',
    )
  })

  it('pulls.merge 409 — 리뷰 요청이 방금 바뀌었다는 문구로 매핑한다 (head 경합)', async () => {
    const mock = await startMock(409, { message: 'Head branch was modified' })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    await expect(hosting.pulls.merge('octo', 'hello', 7)).rejects.toThrow(
      '리뷰 요청이 방금 바뀌었어요. 다시 열어 확인해 주세요.',
    )
  })
})
