import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { electron, cleanupScreens } from './harness'
const appRoot = join(__dirname, '..')
function git(path: string, ...args: string[]) {
  return execFileSync('git', args, {
    cwd: path,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'yeoul-ux-')))
  const workspace = join(root, 'work'),
    profile = join(root, 'profile')
  await mkdir(profile, { recursive: true })
  for (const name of ['back', 'front']) {
    const path = join(workspace, name)
    await mkdir(path, { recursive: true })
    git(path, 'init', '-b', 'main')
    git(path, 'config', 'user.name', 'UX Test')
    git(path, 'config', 'user.email', 'ux@test.local')
    await writeFile(join(path, 'app.txt'), 'before\n')
    git(path, 'add', '.')
    git(path, 'commit', '-m', 'initial')
    await writeFile(join(path, 'app.txt'), 'after\n')
    await writeFile(join(path, 'notes.txt'), 'notes\n')
  }
  await writeFile(
    join(profile, 'settings.json'),
    JSON.stringify({
      autoFetch: false,
      windows: [
        {
          tabs: [{ repoPath: join(workspace, 'back'), workspacePath: workspace }],
          activeTab: 0,
          layout: {},
        },
      ],
    }),
  )
  return {
    root,
    workspace,
    profile,
    back: join(workspace, 'back'),
    front: join(workspace, 'front'),
  }
}
async function launch(profile: string) {
  return electron.launch({ args: [appRoot], env: { ...process.env, GIT_GUI_USER_DATA: profile } })
}
test.afterEach(async ({}, info) => cleanupScreens(info))
test('UX — 필터 범위·대상별 초안·커밋과 외부 변경이 통합 화면에 일치한다', async () => {
  const f = await fixture(),
    app = await launch(f.profile)
  try {
    const page = await app.firstWindow()
    await page.getByTestId('workspace-file-back-unstaged-app.txt').waitFor()
    await page.getByRole('button', { name: '변경 검색', exact: true }).click()
    await page.getByPlaceholder('저장소·워크트리·파일 검색').fill('notes.txt')
    await page.getByTestId('workspace-check-all').check()
    await expect(page.getByTestId('workspace-changes-toolbar')).toContainText('(2)')
    await page.getByTestId('workspace-stage-selected').click()
    await expect.poll(() => git(f.front, 'diff', '--cached', '--name-only')).toBe('notes.txt')
    expect(git(f.back, 'diff', '--cached', '--name-only')).toBe('notes.txt')
    await page.keyboard.press('Escape')
    await page.getByTestId('commit-message').fill('backend draft')
    await page.getByTestId('workspace-file-front-staged-notes.txt').click()
    await expect(page.getByTestId('commit-message')).toHaveValue('')
    await page.getByTestId('commit-message').fill('frontend draft')
    await page.getByTestId('left-tab-branches').click()
    await page.getByTestId('left-tab-changes').click()
    await expect(page.getByTestId('commit-message')).toHaveValue('frontend draft')
    await page.getByTestId('commit-button').click()
    await expect(page.getByTestId('workspace-file-front-staged-notes.txt')).toHaveCount(0, {
      timeout: 12000,
    })
    await expect(page.getByTestId('workspace-history-panel')).toContainText('frontend draft', {
      timeout: 12000,
    })
    await writeFile(join(f.back, 'external.txt'), 'created externally\n')
    await expect(page.getByTestId('workspace-file-back-unstaged-external.txt')).toBeVisible({
      timeout: 12000,
    })
    await page.getByTestId('workspace-file-back-staged-notes.txt').click()
    await expect(page.getByTestId('commit-message')).toHaveValue('backend draft')
  } finally {
    await app.close()
    await rm(f.root, { recursive: true, force: true })
  }
})
test('UX — 링크드 워크트리 변경을 선택·stage해도 본체로 이동하지 않는다', async () => {
  const f = await fixture(),
    tree = join(f.workspace, '.worktrees', 'back-feature')
  git(f.back, 'worktree', 'add', '-b', 'feature', tree)
  await writeFile(join(tree, 'only-here.txt'), 'worktree change\n')
  const app = await launch(f.profile)
  try {
    const page = await app.firstWindow()
    await page
      .getByTestId('workspace-file-back/worktrees/back-feature-unstaged-only-here.txt')
      .click()
    await expect(page.getByTestId('repo-path')).toHaveText(tree)
    await expect(page.getByTestId('header-branch')).toContainText('feature')
    await expect(page.getByTestId('commit-target')).toContainText('back-feature / feature')
    await page
      .getByTestId('workspace-check-back/worktrees/back-feature-unstaged-only-here.txt')
      .check()
    await page.getByTestId('workspace-stage-selected').click()
    await expect.poll(() => git(tree, 'diff', '--cached', '--name-only')).toBe('only-here.txt')
    expect(git(f.back, 'diff', '--cached', '--name-only')).toBe('')
    await expect(page.getByTestId('repo-path')).toHaveText(tree)
    await page.screenshot({ path: 'test-results/ux-worktree-fixed.png', animations: 'disabled' })
  } finally {
    await app.close()
    await rm(f.root, { recursive: true, force: true })
  }
})
test('UX — 통합 변경 가상화와 오래된 커밋 검색', async () => {
  const f = await fixture()
  for (let i = 0; i < 55; i++) git(f.back, 'commit', '--allow-empty', '-m', `entry ${i}`)
  for (let i = 0; i < 1500; i++) await writeFile(join(f.back, `bulk-${i}.txt`), 'x\n')
  const app = await launch(f.profile)
  try {
    const page = await app.firstWindow()
    await page.getByTestId('workspace-file-list').waitFor()
    await expect.poll(() => page.locator('.workspace-change-row').count()).toBeGreaterThan(0)
    expect(await page.locator('.workspace-change-row').count()).toBeLessThan(50)
    await expect(page.getByTestId('workspace-history-more')).toBeVisible()
    await page.getByRole('textbox', { name: '전체 커밋 검색' }).fill('initial')
    await page
      .getByTestId('workspace-history-panel')
      .getByRole('button', { name: '검색', exact: true })
      .click()
    await expect(page.getByTestId('workspace-history-panel')).toContainText('initial', {
      timeout: 12000,
    })
    await page.getByTestId('history-scope-current').click()
    await expect(page.getByTestId('history-panel')).toBeVisible()
    await page.getByTestId('changes-scope-current').click()
    await expect(page.getByTestId('discard-selected')).toBeVisible()
  } finally {
    await app.close()
    await rm(f.root, { recursive: true, force: true })
  }
})
test('UX — 좌우 diff에도 줄 스테이징과 대상 표시가 있다', async () => {
  const f = await fixture(),
    app = await launch(f.profile)
  try {
    const page = await app.firstWindow()
    await page.getByTestId('workspace-file-back-unstaged-app.txt').click()
    await page.getByTestId('diff-view-toggle').click()
    await expect(
      page.getByTestId('diff-view-split').getByRole('button', { name: '이 줄 올리기' }),
    ).toHaveCount(2)
    await expect(page.getByTestId('diff-comparison')).toContainText('back / main')
    await page
      .getByTestId('diff-view-split')
      .getByRole('button', { name: '이 줄 올리기' })
      .last()
      .click()
    await expect.poll(() => git(f.back, 'diff', '--cached')).toContain('+after')
    await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]!.setSize(960, 650))
    await page.screenshot({ path: 'test-results/ux-narrow-fixed.png', animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  } finally {
    await app.close()
    await rm(f.root, { recursive: true, force: true })
  }
})

test('UX — 일괄 작업 부분 실패 뒤 미완료 선택을 보존하고 재시도한다', async () => {
  const f = await fixture(),
    app = await launch(f.profile)
  try {
    const page = await app.firstWindow()
    await page.getByTestId('workspace-check-back-unstaged-app.txt').check()
    await page.getByTestId('workspace-check-front-unstaged-app.txt').check()
    await writeFile(join(f.front, '.git/index.lock'), 'held by another process')
    await page.getByTestId('workspace-stage-selected').click()
    await expect(page.getByTestId('workspace-batch-result')).toContainText('실패 1')
    expect(git(f.back, 'diff', '--cached', '--name-only')).toBe('app.txt')
    await expect(page.getByTestId('workspace-check-front-unstaged-app.txt')).toBeChecked()
    await rm(join(f.front, '.git/index.lock'))
    await page.getByTestId('workspace-stage-selected').click()
    await expect.poll(() => git(f.front, 'diff', '--cached', '--name-only')).toBe('app.txt')
    await expect(page.getByTestId('workspace-batch-result')).toContainText('실패 0')
  } finally {
    await app.close()
    await rm(f.root, { recursive: true, force: true })
  }
})

test('UX — 복제 중 상태와 중단이 실제 Git 프로세스에 연결된다', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'yeoul-clone-ux-')))
  const profile = join(root, 'profile'),
    destination = join(root, 'destination')
  await mkdir(profile)
  await mkdir(destination)
  await writeFile(join(profile, 'settings.json'), JSON.stringify({ autoFetch: false }))
  // A local server deliberately holds the Git discovery response until the client cancels.
  const server = createServer((_request, response) => {
    response.on('error', () => {})
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const app = await launch(profile)
  try {
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, destination)
    const page = await app.firstWindow()
    await page.getByTestId('clone-repo').click()
    await page.getByTestId('prompt-input').fill(`http://127.0.0.1:${port}/fixture`)
    await page.getByTestId('prompt-submit').click()
    await expect(page.getByTestId('onboarding-progress')).toContainText('clone')
    await expect(page.getByTestId('prompt-submit')).toBeDisabled()
    await page.getByTestId('prompt-cancel').click()
    await expect(page.getByRole('alert')).toContainText('복제를 중단했어요')
    await expect(page.getByTestId('onboarding-progress')).toHaveCount(0)
  } finally {
    await app.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
})

test('UX — 코드 글자 크기·목록 밀도·시스템 테마를 적용하고 저장한다', async () => {
  const f = await fixture(),
    app = await launch(f.profile)
  try {
    const page = await app.firstWindow()
    await page.getByTestId('workspace-file-back-unstaged-app.txt').click()
    await page.getByTestId('settings-open').click()
    await page.getByTestId('settings-cat-theme').click()
    await page.getByLabel('코드 글자 크기').selectOption('16')
    await page.getByLabel('통합 목록 간격').selectOption('compact')
    await page.getByRole('radio', { name: /시스템/ }).check()
    await page.getByTestId('settings-close').click()
    await expect(page.locator('.diff-panel__code')).toHaveCSS('font-size', '16px')
    await expect
      .poll(async () => JSON.parse(await readFile(join(f.profile, 'settings.json'), 'utf8')))
      .toMatchObject({ codeFontSize: 16, listDensity: 'compact', systemTheme: true })
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('html')).toHaveAttribute('data-color-mode', 'dark')
    await page.screenshot({ path: 'test-results/ux-dark-preferences.png', animations: 'disabled' })
  } finally {
    await app.close()
    await rm(f.root, { recursive: true, force: true })
  }
})

test('UX — 키보드가 빈 안내 행을 건너뛰고 Shift로 파일 범위를 선택한다', async () => {
  const f = await fixture()
  git(f.back, 'checkout', '--', 'app.txt')
  await rm(join(f.back, 'notes.txt'))
  const app = await launch(f.profile)
  try {
    const page = await app.firstWindow()
    const first = page
      .getByTestId('workspace-changes-back')
      .getByRole('button', { name: 'back 접기·펼치기' })
    await first.focus()
    await page.keyboard.press('ArrowDown')
    await expect(
      page
        .getByTestId('workspace-changes-front')
        .getByRole('button', { name: 'front 접기·펼치기' }),
    ).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('workspace-file-front-unstaged-app.txt')).toBeFocused()
    await page.keyboard.press('Space')
    await expect(page.getByTestId('workspace-check-front-unstaged-app.txt')).toBeChecked()
    await page.keyboard.press('Shift+End')
    await expect(page.getByTestId('workspace-check-front-unstaged-notes.txt')).toBeChecked()
    await expect(page.getByTestId('workspace-changes-toolbar')).toContainText('(2)')
    await page.keyboard.press('Shift+ArrowUp')
    await expect(page.getByTestId('workspace-check-front-unstaged-notes.txt')).not.toBeChecked()
    await expect(page.getByTestId('workspace-check-front-unstaged-app.txt')).toBeChecked()
  } finally {
    await app.close()
    await rm(f.root, { recursive: true, force: true })
  }
})

test('UX — 최근 작업에서 다시 열어도 여러 저장소의 작업 공간을 유지한다', async () => {
  const f = await fixture()
  let app = await launch(f.profile)
  try {
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, f.workspace)
    let page = await app.firstWindow()
    await expect(page.getByTestId('repo-path')).toHaveText(f.back)
    await page.keyboard.press('Meta+o')
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(f.profile, 'settings.json'), 'utf8'))
            .recentWorkspaceRoots?.[f.back],
      )
      .toBe(f.workspace)
    await app.close()
    const saved = JSON.parse(await readFile(join(f.profile, 'settings.json'), 'utf8'))
    await writeFile(
      join(f.profile, 'settings.json'),
      JSON.stringify({
        ...saved,
        windows: [{ tabs: [{ repoPath: null }], activeTab: 0, layout: {} }],
      }),
    )
    app = await launch(f.profile)
    page = await app.firstWindow()
    const recent = page.getByTestId(`repo-picker-recent-${f.back}`)
    await expect(recent).toContainText('작업 공간')
    await recent.click()
    await expect(page.getByTestId('workspace-path')).toHaveText(f.workspace)
    await expect(page.getByTestId('workspace-file-back-unstaged-app.txt')).toBeVisible()
    await expect(page.getByTestId('workspace-file-front-unstaged-app.txt')).toBeVisible()
    const originalId = await app.evaluate(
      ({ BaseWindow }) =>
        (
          BaseWindow.getAllWindows()[0]!.contentView.children.find((view) =>
            view.getVisible(),
          ) as Electron.WebContentsView
        ).webContents.id,
    )
    const pending = app.waitForEvent('window')
    await page.getByTestId('tab-add').click()
    const empty = await pending
    await empty.getByTestId(`repo-picker-recent-${f.back}`).click()
    await expect
      .poll(() =>
        app.evaluate(({ BaseWindow }) =>
          BaseWindow.getAllWindows()[0]!
            .contentView.children.filter((view) => view.getVisible())
            .map((view) => (view as Electron.WebContentsView).webContents.id),
        ),
      )
      .toEqual([originalId])
  } finally {
    await app.close()
    await rm(f.root, { recursive: true, force: true })
  }
})
