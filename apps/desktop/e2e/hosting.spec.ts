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
