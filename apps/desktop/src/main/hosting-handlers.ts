import { app, ipcMain, shell } from 'electron'
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
    // 해제 후 이전 목록의 주소가 남지 않게 — 재연결하면 목록에서 다시 채운다 (품질 리뷰)
    knownPullUrls.clear()
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
    // 전환·받아오기와 같은 기준 — 진행 중 작업(merging·reverting) 중에는 요청을 받지 않는다 (품질 리뷰)
    const repoStatus = await client.repo.status()
    if (repoStatus.state !== 'normal') {
      throw new Error('지금 진행 중인 작업(합치기·되돌리기)을 먼저 마무리한 뒤 요청해 주세요.')
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
