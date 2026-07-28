import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { cleanupScreens, electron } from './harness'
import { execGitOrThrow } from '@git-gui/git-process'

const APP_ROOT = join(__dirname, '..')

// 실패한 테스트만 마지막 화면(last-screen-N.png)이 남는다 — harness가 close 직전마다 찍은 것을 정리
test.afterEach(async ({}, testInfo) => {
  await cleanupScreens(testInfo)
})

/** mock GitHub — /user·/repos·/pulls + 코멘트·리뷰·병합 최소 구현. 쓰기를 메모리에 반영한다 */
interface MockPull {
  number: number
  title: string
  head: string
  base: string
  merged: boolean
  comments: Array<{ id: number; body: string; login: string; created_at: string }>
  reviews: Array<{ id: number; body: string; state: string; login: string; submitted_at: string }>
}

interface MockGitHub {
  url: string
  pulls: MockPull[]
  close(): Promise<void>
}

function toApiPull(pull: MockPull) {
  return {
    number: pull.number,
    title: pull.title,
    draft: false,
    html_url: `https://github.com/e2e/fixture/pull/${pull.number}`,
    head: { ref: pull.head },
    base: { ref: pull.base },
  }
}

function toApiPullDetail(pull: MockPull) {
  return { ...toApiPull(pull), state: pull.merged ? 'closed' : 'open', merged: pull.merged }
}

async function startMockGitHub(options: { rejectApprove?: boolean } = {}): Promise<MockGitHub> {
  const pulls: MockGitHub['pulls'] = []
  let nextId = 1000
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
    const readBody = (done: (raw: string) => void) => {
      let raw = ''
      req.on('data', (chunk: Buffer) => {
        raw += chunk.toString('utf8')
      })
      req.on('end', () => done(raw))
    }
    const pullOf = (segment: string | undefined) =>
      pulls.find((pull) => String(pull.number) === segment)
    if (req.method === 'GET' && path === '/user') {
      send(200, { login: 'e2e-user' })
      return
    }
    if (req.method === 'GET' && path === '/repos/e2e/fixture') {
      send(200, { default_branch: 'main' })
      return
    }
    if (req.method === 'GET' && path === '/repos/e2e/fixture/pulls') {
      // state=open 요청 — 병합된 것은 목록에서 뺀다
      send(200, pulls.filter((pull) => !pull.merged).map(toApiPull))
      return
    }
    if (req.method === 'POST' && path === '/repos/e2e/fixture/pulls') {
      readBody((raw) => {
        const input = JSON.parse(raw) as { title: string; head: string; base: string }
        if (pulls.some((pull) => pull.head === input.head)) {
          send(422, {
            message: 'Validation Failed',
            errors: [{ message: `A pull request already exists for e2e:${input.head}.` }],
          })
          return
        }
        const pull: MockPull = {
          number: pulls.length + 1,
          title: input.title,
          head: input.head,
          base: input.base,
          merged: false,
          comments: [],
          reviews: [],
        }
        pulls.push(pull)
        send(201, toApiPull(pull))
      })
      return
    }
    const detailMatch = /^\/repos\/e2e\/fixture\/pulls\/(\d+)$/.exec(path)
    if (req.method === 'GET' && detailMatch !== null) {
      const pull = pullOf(detailMatch[1])
      if (pull === undefined) {
        send(404, { message: 'Not Found' })
        return
      }
      send(200, toApiPullDetail(pull))
      return
    }
    const commentsMatch = /^\/repos\/e2e\/fixture\/issues\/(\d+)\/comments$/.exec(path)
    if (commentsMatch !== null) {
      const pull = pullOf(commentsMatch[1])
      if (pull === undefined) {
        send(404, { message: 'Not Found' })
        return
      }
      if (req.method === 'GET') {
        send(
          200,
          pull.comments.map((comment) => ({
            id: comment.id,
            user: { login: comment.login },
            body: comment.body,
            created_at: comment.created_at,
          })),
        )
        return
      }
      if (req.method === 'POST') {
        readBody((raw) => {
          const input = JSON.parse(raw) as { body: string }
          nextId += 1
          pull.comments.push({
            id: nextId,
            body: input.body,
            login: 'e2e-user',
            created_at: new Date().toISOString(),
          })
          send(201, { id: nextId })
        })
        return
      }
    }
    const reviewsMatch = /^\/repos\/e2e\/fixture\/pulls\/(\d+)\/reviews$/.exec(path)
    if (reviewsMatch !== null) {
      const pull = pullOf(reviewsMatch[1])
      if (pull === undefined) {
        send(404, { message: 'Not Found' })
        return
      }
      if (req.method === 'GET') {
        send(
          200,
          pull.reviews.map((review) => ({
            id: review.id,
            user: { login: review.login },
            body: review.body,
            state: review.state,
            submitted_at: review.submitted_at,
          })),
        )
        return
      }
      if (req.method === 'POST') {
        readBody(() => {
          if (options.rejectApprove === true) {
            // 실 GitHub 자기 PR 승인 응답 본문 — 이 부분 문자열로 친절 매핑된다
            send(422, {
              message: 'Unprocessable Entity',
              errors: ['Can not approve your own pull request'],
            })
            return
          }
          nextId += 1
          pull.reviews.push({
            id: nextId,
            body: '',
            state: 'APPROVED',
            login: 'e2e-user',
            submitted_at: new Date().toISOString(),
          })
          send(200, { id: nextId, state: 'APPROVED' })
        })
        return
      }
    }
    const mergeMatch = /^\/repos\/e2e\/fixture\/pulls\/(\d+)\/merge$/.exec(path)
    if (req.method === 'PUT' && mergeMatch !== null) {
      const pull = pullOf(mergeMatch[1])
      if (pull === undefined) {
        send(404, { message: 'Not Found' })
        return
      }
      readBody(() => {
        pull.merged = true
        send(200, { merged: true, message: 'Pull Request successfully merged' })
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
    await expect(window.getByTestId('notice')).toContainText('풀 리퀘스트 #1')
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

test('리뷰 요청 상세를 열어 코멘트를 확인하고 답변을 단다', async () => {
  const mock = await startMockGitHub()
  mock.pulls.push({
    number: 1,
    title: '로그인 버튼 색 실험',
    head: 'feature',
    base: 'main',
    merged: false,
    comments: [
      {
        id: 100,
        body: '버튼 색이 좋아요. 문구만 다듬어 주세요.',
        login: 'reviewer',
        created_at: '2026-07-20T09:00:00Z',
      },
    ],
    reviews: [],
  })
  const repo = await createGitHubFixtureRepo({ branch: 'feature', withUpstream: true })
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
    await window.getByTestId('review-pull-1').click()
    // 팝오버가 닫히고 우측 열이 리뷰 상세로 전환된다 — 제목·상태·타임라인
    await expect(window.getByTestId('review-detail-panel')).toContainText('#1 로그인 버튼 색 실험')
    await expect(window.getByTestId('review-detail-status')).toContainText('열림')
    await expect(window.getByTestId('review-detail-timeline')).toContainText(
      '버튼 색이 좋아요. 문구만 다듬어 주세요.',
    )
    // 답변 — 성공하면 서버 상태를 다시 읽어 타임라인에 반영된다
    await window.getByTestId('review-reply-input').fill('고마워요! 문구를 다듬었어요.')
    await window.getByTestId('review-reply-send').click()
    await expect(window.getByTestId('review-detail-timeline')).toContainText(
      '고마워요! 문구를 다듬었어요.',
    )
    // mock 상태에 실제 반영됐다
    expect(mock.pulls[0]!.comments).toHaveLength(2)
    expect(mock.pulls[0]!.comments[1]).toMatchObject({ body: '고마워요! 문구를 다듬었어요.' })
  } finally {
    await app.close()
    await mock.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('승인하면 승인됨 배지, 병합하면 병합됨 배지와 기본 공간 이동 제안이 뜬다', async () => {
  // mock은 타인 PR 시나리오 — 승인이 성공한다(자기 승인 거부는 다음 테스트)
  const mock = await startMockGitHub()
  mock.pulls.push({
    number: 1,
    title: '로그인 버튼 색 실험',
    head: 'feature',
    base: 'main',
    merged: false,
    comments: [],
    reviews: [],
  })
  const repo = await createGitHubFixtureRepo({ branch: 'feature', withUpstream: true })
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
    await window.getByTestId('review-pull-1').click()
    await expect(window.getByTestId('review-detail-status')).toContainText('열림')
    // 승인 → 상세 재조회로 '승인됨' 배지 + 타임라인의 승인 항목
    await window.getByTestId('review-approve').click()
    await expect(window.getByTestId('review-detail-status')).toContainText('승인됨')
    await expect(window.getByTestId('review-detail-timeline')).toContainText('승인했어요')
    expect(mock.pulls[0]!.reviews).toHaveLength(1)
    // 병합 — 확인창을 거친다
    await window.getByTestId('review-merge').click()
    await expect(window.getByRole('alertdialog')).toContainText('이 동작은 GitHub에서 일어나요.')
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId('review-detail-status')).toContainText('병합됨')
    expect(mock.pulls[0]!.merged).toBe(true)
    // 병합 후 기본 공간 이동 제안 — '나중에'(그만두기)를 고르면 안내 notice만 남는다.
    // 확인 경로(전환+받아오기)는 기존 smoke E2E가 커버하고, 여기서 실행하면 mock GitHub(가짜
    // 병합)와 로컬 픽스처(원격 네트워크 없음)의 정합이 깨진다 — 취소로 끝낸다(근거: 헤더)
    await expect(window.getByRole('alertdialog')).toContainText('기본 공간(main)으로 이동해')
    await window.getByTestId('confirm-cancel').click()
    await expect(window.getByTestId('notice')).toContainText('병합했어요')
  } finally {
    await app.close()
    await mock.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('내가 만든 리뷰 요청은 스스로 승인할 수 없다는 친절 에러를 보여준다', async () => {
  // mock이 실 GitHub의 자기 승인 422 본문을 그대로 돌려주는 모드
  const mock = await startMockGitHub({ rejectApprove: true })
  mock.pulls.push({
    number: 1,
    title: '로그인 버튼 색 실험',
    head: 'feature',
    base: 'main',
    merged: false,
    comments: [],
    reviews: [],
  })
  const repo = await createGitHubFixtureRepo({ branch: 'feature', withUpstream: true })
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
    await window.getByTestId('review-pull-1').click()
    await expect(window.getByTestId('review-detail-panel')).toBeVisible()
    await window.getByTestId('review-approve').click()
    await expect(window.getByTestId('error')).toContainText('스스로 승인할 수 없어요')
    // 상세는 열린 채 남는다 — 다른 사람의 승인을 기다리면 된다
    await expect(window.getByTestId('review-detail-status')).toContainText('열림')
  } finally {
    await app.close()
    await mock.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
