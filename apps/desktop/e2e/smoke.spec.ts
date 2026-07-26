import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { cleanupScreens, electron } from './harness'
import { execGitOrThrow } from '@git-gui/git-process'

// cwd에 의존하지 않도록 앱 루트를 절대 경로로 지정한다
const APP_ROOT = join(__dirname, '..')

// 실패한 테스트만 마지막 화면(last-screen-N.png)이 남는다 — harness가 close 직전마다 찍은 것을 정리
test.afterEach(async ({}, testInfo) => {
  await cleanupScreens(testInfo)
})

async function createRepoWithChange(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'git-gui-e2e-'))
  await execGitOrThrow(['init', '--initial-branch=main'], { cwd: dir })
  // 앱이 수행하는 commit도 저장소 로컬 identity를 쓰도록 설정한다 —
  // 머신 전역 gitconfig에 의존하지 않는 hermetic 픽스처 (클린 CI에서도 동작)
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: dir })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: dir })
  await writeFile(join(dir, 'app.txt'), 'v1\n')
  await execGitOrThrow(['add', '-A'], { cwd: dir })
  await execGitOrThrow(['commit', '-m', 'init'], { cwd: dir })
  await writeFile(join(dir, 'app.txt'), 'v2\n')
  return dir
}

/** GIT_SCENARIOS fixture 원칙 — 로컬 bare remote로 백업(push)을 검증한다 */
async function addBareRemote(repo: string): Promise<string> {
  const remote = await mkdtemp(join(tmpdir(), 'git-gui-e2e-remote-'))
  await execGitOrThrow(['init', '--bare', '--initial-branch=main'], { cwd: remote })
  await execGitOrThrow(['remote', 'add', 'origin', remote], { cwd: repo })
  return remote
}

/**
 * 겹침 블록 2개짜리 충돌 픽스처 — 떨어진 두 변경(사이 context 5줄)이어야 블록이 2개 생긴다.
 * 인접한 변경은 git이 한 블록으로 합쳐 버린다(실측). 합치기 실행은 각 테스트가 앱에서 한다.
 */
async function createTwoBlockConflictRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'git-gui-e2e-'))
  await execGitOrThrow(['init', '--initial-branch=main'], { cwd: dir })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: dir })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: dir })
  await writeFile(join(dir, 'app.txt'), 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n')
  await execGitOrThrow(['add', '-A'], { cwd: dir })
  await execGitOrThrow(['commit', '-m', 'init'], { cwd: dir })
  await execGitOrThrow(['checkout', '-b', 'rival'], { cwd: dir })
  await writeFile(join(dir, 'app.txt'), 'rival-top\ntwo\nthree\nfour\nfive\nsix\nrival-bottom\n')
  await execGitOrThrow(['commit', '-am', 'rival'], { cwd: dir })
  await execGitOrThrow(['checkout', 'main'], { cwd: dir })
  await writeFile(join(dir, 'app.txt'), 'mine-top\ntwo\nthree\nfour\nfive\nsix\nmine-bottom\n')
  await execGitOrThrow(['commit', '-am', 'mine'], { cwd: dir })
  return dir
}

/** 대상 요소 중심에 마우스를 올리고 ⌘F를 눌러 그 스코프의 FindBar를 연다 (E7h ⑥ — hover 라우팅) */
async function hoverAndCmdF(window: Page, selector: string): Promise<void> {
  const box = (await window.locator(selector).boundingBox())!
  await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await window.keyboard.press('Meta+f')
}

test('열기 → stage → commit → 역사 반영 → 백업', async () => {
  const repo = await createRepoWithChange()
  const remote = await addBareRemote(repo)
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()

    // E2E 창 비간섭(E6a) — 창은 숨긴 채 CDP로만 조작한다. 회귀하면 e2e마다 작업 화면을 가린다.
    // GIT_GUI_E2E_SHOW=1(로컬 디버깅 opt-out — E6b)은 의도적으로 보이므로 이 가드만 건너뛴다
    if (process.env.GIT_GUI_E2E_SHOW !== '1') {
      expect(
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible()),
      ).toBe(false)
    }

    // 변경 파일과 기존 역사(init)가 보인다
    await expect(window.getByTestId('file-unstaged-app.txt')).toBeVisible()
    await expect(window.getByTestId('history-count')).toHaveText('1')
    await window.screenshot({ path: 'test-results/app-initial.png' })

    // stage
    await window.getByTestId('check-unstaged-app.txt').click()
    await window.getByTestId('stage-selected').click()
    await expect(window.getByTestId('staged-count')).toHaveText('1')
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')

    // diff 확인 — 좌우 보기 토글과 선택 해제
    await window.getByTestId('file-staged-app.txt').click()
    await expect(window.getByTestId('diff-view-unified')).toBeVisible()
    await window.getByTestId('diff-view-toggle').click()
    await expect(window.getByTestId('diff-view-split')).toBeVisible()
    await window.getByTestId('diff-close').click()
    await expect(window.getByTestId('diff-panel')).toContainText('파일을 선택하면')

    // commit (명시 메시지)
    await window.getByTestId('commit-message').fill('e2e: 첫 저장')
    await window.getByTestId('commit-button').click()
    await expect(window.getByTestId('staged-count')).toHaveText('0')
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')

    // 역사에 반영
    await expect(window.getByTestId('history-count')).toHaveText('2')
    await expect(window.getByTestId('history-list')).toContainText('e2e: 첫 저장')

    // 실제 커밋 검증
    const log = await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: repo })
    expect(log.stdout.trim()).toBe('e2e: 첫 저장')

    // 백업 — 원격(bare)에 실제로 올라갔는지 + upstream 연결로 ahead/behind 표시
    await window.getByTestId('backup').click()
    await expect(window.getByText('↑0 ↓0')).toBeVisible()
    const remoteLog = await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: remote })
    expect(remoteLog.stdout.trim()).toBe('e2e: 첫 저장')

    await window.screenshot({ path: 'test-results/app-after-commit.png' })
  } finally {
    // 단언이 실패해도 Electron 프로세스와 임시 저장소를 정리한다
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(remote, { recursive: true, force: true })
  }
})

test('빈 메시지로 저장하면 규칙 기반 제안이 대신 들어간다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()

    await window.getByTestId('check-unstaged-app.txt').click()
    await window.getByTestId('stage-selected').click()
    await expect(window.getByTestId('staged-count')).toHaveText('1')

    // 제안이 placeholder로 보이고, 빈 채로 저장하면 그 문구로 저장된다는 안내가 뜬다
    await expect(window.getByTestId('commit-message')).toHaveAttribute(
      'placeholder',
      'app.txt 수정',
    )
    await expect(window.getByTestId('commit-hint')).toBeVisible()

    // 메시지를 입력하지 않고 저장 — 제안이 커밋 메시지가 된다
    await window.getByTestId('commit-button').click()
    await expect(window.getByTestId('staged-count')).toHaveText('0')
    const log = await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: repo })
    expect(log.stdout.trim()).toBe('app.txt 수정')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('체크박스로 여러 파일을 한 번에 올린다', async () => {
  const repo = await createRepoWithChange()
  await writeFile(join(repo, 'notes.txt'), 'memo\n')
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('unstaged-count')).toHaveText('2')
    await window.getByTestId('check-all-unstaged').click()
    await window.getByTestId('stage-selected').click()
    await expect(window.getByTestId('staged-count')).toHaveText('2')
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('이름이 바뀐 파일을 내려도 반쪽(삭제)이 남지 않는다', async () => {
  const repo = await createRepoWithChange()
  // v2 수정을 되돌려 내용을 HEAD와 같게 만든다 — 그래야 mv가 exact rename(R100)으로 감지된다
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['mv', 'app.txt', 'renamed.txt'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('staged-count')).toHaveText('1')
    await window.getByTestId('check-all-staged').click()
    await window.getByTestId('unstage-selected').click()
    // origPath 없이 내리면 옛 경로의 삭제가 staged에 잔존한다(반쪽 rename 커밋 위험)
    await expect(window.getByTestId('staged-count')).toHaveText('0')
    await expect(window.getByTestId('unstaged-count')).toHaveText('2')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('변경 목록 가상화 — 1500개 파일에서 DOM은 가시 범위만 유지하고 일괄 스테이징은 전체에 적용된다', async () => {
  const repo = await createRepoWithChange()
  // 저장소 루트에 미추적 파일 1500개 — 행 수 폭발 상황을 재현한다
  await Promise.all(
    Array.from({ length: 1500 }, (_, i) =>
      writeFile(join(repo, `bulk-${String(i).padStart(4, '0')}.txt`), `${i}\n`),
    ),
  )
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('unstaged-count')).toHaveText('1501')
    // 가상화 — 렌더된 행 수는 가시 범위 + overscan 수준이어야 한다.
    // 하한(> 0)이 없으면 컨테이너 부재/오타 시 count 0으로 공허하게 통과한다 — 함께 고정
    const rendered = await window.locator('[data-testid="file-scroll-unstaged"] .file-row').count()
    expect(rendered).toBeGreaterThan(0)
    expect(rendered).toBeLessThan(120)
    // 체크는 데이터 기반 — 화면 밖 행까지 전체에 적용된다
    await window.getByTestId('check-all-unstaged').click()
    await window.getByTestId('stage-selected').click()
    await expect(window.getByTestId('staged-count')).toHaveText('1501', { timeout: 30000 })
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('커밋을 누르면 트리 아래에 상세가 열리고 파일 diff는 가운데에 뜬다', async () => {
  const repo = await createRepoWithChange()
  // 본문 있는 커밋을 하나 더 쌓는다 — 상세에서 본문 표시를 검증한다
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(
    ['commit', '-m', '두 번째 저장', '-m', '자세한 설명 줄'],
    { cwd: repo },
  )
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-count')).toHaveText('2')
    // 최신 커밋 클릭 → 트리는 그대로 보이고 우측 하단에만 상세가 열린다 (E6a)
    await window.locator('[data-testid^="history-item-"]').first().click()
    await expect(window.getByTestId('commit-detail-panel')).toBeVisible()
    await expect(window.getByTestId('history-panel')).toBeVisible()
    // 클릭한 저장 행은 선택 하이라이트(aria-current)로 표시된다
    await expect(window.locator('[data-testid^="history-item-"]').first()).toHaveAttribute(
      'aria-current',
      'true',
    )
    await expect(window.getByTestId('commit-detail-subject')).toHaveText('두 번째 저장')
    await expect(window.getByTestId('commit-detail-body')).toHaveText('자세한 설명 줄')
    await expect(window.getByTestId('commit-detail-file-count')).toHaveText('1')
    // 파일 클릭 → 좌측 흐름과 동일하게 중앙 diff에 뜬다 (v1 → v2 수정)
    await window.getByTestId('commit-file-app.txt').click()
    await expect(window.getByTestId('diff-view-unified')).toContainText('v2')
    await expect(window.getByTestId('diff-panel')).toContainText('저장')
    // 닫기 → 하단 상세가 닫히고 트리가 전체 높이로 복귀한다
    await window.getByTestId('commit-detail-back').click()
    await expect(window.getByTestId('commit-detail-panel')).toHaveCount(0)
    await expect(window.getByTestId('history-panel')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('스크롤 끝에서 저장 역사를 더 불러온다 (50개 제한 해제)', async () => {
  const repo = await createRepoWithChange()
  for (let i = 0; i < 60; i += 1) {
    await execGitOrThrow(['commit', '--allow-empty', '-m', `bulk ${i}`], { cwd: repo })
  }
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-count')).toHaveText('50+')
    // 하단 상세가 열려 트리 높이가 줄어든 상태에서도 가상 스크롤·더 불러오기가 정상 동작한다 (E6a)
    await window.locator('[data-testid^="history-item-"]').first().click()
    await expect(window.getByTestId('commit-detail-panel')).toBeVisible()
    // 히스토리 스크롤을 끝까지 내리면 다음 페이지를 불러온다 (⑩)
    await window.getByTestId('history-scroll').evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await expect(window.getByTestId('history-count')).toHaveText('61')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('선택한 파일의 변경을 확인창을 거쳐 취소한다 — 새 파일은 삭제된다', async () => {
  const repo = await createRepoWithChange()
  await writeFile(join(repo, 'temp.txt'), 'temp\n')
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('unstaged-count')).toHaveText('2')
    await window.getByTestId('check-all-unstaged').click()
    await window.getByTestId('discard-selected').click()
    // 그만두기 — 아무 일도 일어나지 않고 체크는 유지된다
    await window.getByTestId('confirm-cancel').click()
    await expect(window.getByTestId('unstaged-count')).toHaveText('2')
    // 다시 열어 변경 취소 — tracked는 복원, untracked(temp.txt)는 삭제
    await window.getByTestId('discard-selected').click()
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('우측 열 폭을 드래그로 조절하고 재시작해도 기억한다', async () => {
  const repo = await createRepoWithChange()
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const env = { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData }
  const app = await electron.launch({ args: [APP_ROOT], env })
  let widened = 0
  try {
    const window = await app.firstWindow()
    const before = (await window.getByTestId('history-panel').boundingBox())!.width
    const handle = (await window.getByTestId('column-resizer').boundingBox())!
    await window.mouse.move(handle.x + 3, handle.y + 200)
    await window.mouse.down()
    await window.mouse.move(handle.x - 120, handle.y + 200, { steps: 5 })
    await window.mouse.up()
    widened = (await window.getByTestId('history-panel').boundingBox())!.width
    expect(widened).toBeGreaterThan(before + 80)
  } finally {
    await app.close()
  }
  // 재시작 — 같은 userData면 폭이 복원되어야 한다 (파일 영속화)
  const second = await electron.launch({ args: [APP_ROOT], env })
  try {
    const window = await second.firstWindow()
    const restored = (await window.getByTestId('history-panel').boundingBox())!.width
    expect(Math.abs(restored - widened)).toBeLessThan(2)
  } finally {
    await second.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('960px 최소 창에서 중앙 diff 폭이 380px 이상으로 보장된다 (반응형 열)', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.setSize(960, 800)
    })
    // 리사이즈 이벤트가 renderer에 닿아 열 폭이 재계산될 때까지 기다린 뒤 잰다
    await expect.poll(() => window.evaluate(() => window.innerWidth)).toBe(960)
    await window.getByTestId('file-unstaged-app.txt').click()
    await expect(window.getByTestId('diff-view-unified')).toBeVisible()
    // 중앙(diff) ≥ 380px — computeColumns가 좌·우를 함께 줄여 만든 보장 (E2 후속 노트 해소)
    expect((await window.getByTestId('diff-panel').boundingBox())!.width).toBeGreaterThanOrEqual(378)
    // 좌·우 열은 줄되 살아 있다 — 저장 폼(좌측 하단)·타임라인이 함께 보인다
    await expect(window.getByTestId('commit-button')).toBeVisible()
    expect(
      (await window.getByTestId('history-panel').boundingBox())!.width,
    ).toBeGreaterThanOrEqual(200)
    // 하단 상세가 열려도 중앙 보장은 유지된다
    await window.locator('[data-testid^="history-item-"]').first().click()
    await expect(window.getByTestId('commit-detail-panel')).toBeVisible()
    expect((await window.getByTestId('diff-panel').boundingBox())!.width).toBeGreaterThanOrEqual(378)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('테마를 설정 모달에서 전환하고 재시작해도 기억한다 (E7d ⑦ 이관)', async () => {
  const repo = await createRepoWithChange()
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const env = { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData }
  const app = await electron.launch({ args: [APP_ROOT], env })
  let flipped: string | undefined
  try {
    const window = await app.firstWindow()
    // firstWindow는 React 마운트 전에 반환될 수 있다 — UI가 뜬 뒤 테마를 읽는다 (실측 레이스)
    await expect(window.getByTestId('settings-open')).toBeVisible()
    // 헤더 토글은 설정으로 이관되어 없다 (E7d ⑦)
    await expect(window.getByTestId('theme-toggle')).toHaveCount(0)
    const initial = await window.evaluate(() => document.documentElement.dataset.theme)
    expect(['light', 'dark']).toContain(initial)
    await window.getByTestId('settings-open').click()
    await window.getByTestId('settings-cat-theme').click()
    await window
      .getByTestId(initial === 'dark' ? 'settings-theme-light' : 'settings-theme-dark')
      .click()
    flipped = await window.evaluate(() => document.documentElement.dataset.theme)
    expect(flipped).not.toBe(initial)
  } finally {
    await app.close()
  }
  // 재시작 — 같은 userData면 선택한 테마가 초기값이 된다 (파일 영속화)
  const second = await electron.launch({ args: [APP_ROOT], env })
  try {
    const window = await second.firstWindow()
    await expect(window.getByTestId('settings-open')).toBeVisible()
    const restored = await window.evaluate(() => document.documentElement.dataset.theme)
    expect(restored).toBe(flipped)
  } finally {
    await second.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('실험 공간을 만들고 바로 이동한다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('header-branch').click()
    await window.getByTestId('branch-new').click()
    await window.getByTestId('prompt-input').fill('exp-1')
    await window.getByTestId('prompt-submit').click()
    await expect(window.getByTestId('header-branch')).toContainText('exp-1')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('전환이 막히면 변경을 보관함에 자동 보관하고 이동한다', async () => {
  const repo = await createRepoWithChange()
  // 대상 브랜치의 app.txt가 다르도록 — 전환이 막히는 조건을 만든다
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'other'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'other\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'other side'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'mine\n')
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('unstaged-count')).toHaveText('1')
    await window.getByTestId('header-branch').click()
    await window.getByTestId('branch-item-other').click()
    await expect(window.getByTestId('header-branch')).toContainText('other')
    await expect(window.getByTestId('notice')).toContainText('보관함')
    await expect(window.getByTestId('shelf-count')).toHaveText('1')
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('우클릭한 저장 시점에서 실험 공간을 만든다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '두 번째 저장'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-count')).toHaveText('2')
    // 가장 오래된(root) 커밋에서 갈라진다
    await window.locator('[data-testid^="history-item-"]').last().click({ button: 'right' })
    await window.getByTestId('context-branch-here').click()
    await window.getByTestId('prompt-input').fill('from-root')
    await window.getByTestId('prompt-submit').click()
    await expect(window.getByTestId('header-branch')).toContainText('from-root')
    // 전체 그래프(--all) — root로 이동해도 main의 커밋까지 2개가 그대로 보인다 (E5b)
    await expect(window.getByTestId('history-count')).toHaveText('2')
    // "지금 여기"는 이동한 root 커밋 행을 따라온다
    const rootHash = (
      await execGitOrThrow(['rev-list', '--max-parents=0', 'HEAD'], { cwd: repo })
    ).stdout.trim()
    await expect(window.getByTestId(`history-item-${rootHash}`)).toContainText('지금 여기')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('변경을 보관함에 넣었다 꺼낸다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('unstaged-count')).toHaveText('1')
    await window.getByTestId('shelf-open').click()
    await window.getByTestId('shelf-save').click()
    await expect(window.getByTestId('shelf-count')).toHaveText('1')
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')
    // 팝오버는 스냅샷 갱신 후에도 열린 채 유지된다(실측 — underlay가 재클릭을 막는다). 바로 꺼낸다
    await window.getByTestId('shelf-restore-stash@{0}').click()
    await expect(window.getByTestId('unstaged-count')).toHaveText('1')
    await expect(window.getByTestId('shelf-count')).toHaveText('0')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('팝오버·입력 다이얼로그가 ESC로 닫힌다 (포커스가 body로 빠진 뒤에도)', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    // (1) 보관함 팝오버 — 보관하기(busy 비활성화 사이클)로 포커스가 body로 떨어진 상태의 ESC (E1a 잔여 재현)
    await window.getByTestId('shelf-open').click()
    await window.getByTestId('shelf-save').click()
    await expect(window.getByTestId('shelf-count')).toHaveText('1')
    await window.keyboard.press('Escape')
    await expect(window.getByTestId('shelf-save')).toHaveCount(0)
    // (2) PromptDialog — 입력에 포커스가 있어도 ESC로 닫힌다 (E3b 리뷰 재현: TextField 기본 전파 차단)
    await window.locator('[data-testid^="history-item-"]').first().click({ button: 'right' })
    await window.getByTestId('context-tag-here').click()
    await expect(window.getByTestId('prompt-input')).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(window.getByTestId('prompt-input')).toHaveCount(0)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('보관함 항목을 클릭하면 담긴 내용을 미리 보여준다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('shelf-open').click()
    await window.getByTestId('shelf-save').click()
    await expect(window.getByTestId('shelf-count')).toHaveText('1')
    await window.getByTestId('shelf-preview-stash@{0}').click()
    // 팝오버가 닫히고 우측이 커밋 상세로 전환된다 — 담긴 파일이 보인다
    await expect(window.getByTestId('commit-detail-panel')).toBeVisible()
    await expect(window.getByTestId('commit-detail-panel')).toContainText('보관 내용')
    await expect(window.getByTestId('commit-detail-panel')).toContainText(
      '새로 만든 파일은 이 목록에 안 보여요',
    )
    await expect(window.getByTestId('commit-file-app.txt')).toBeVisible()
    // 뒤로 가면 타임라인으로 복귀
    await window.getByTestId('commit-detail-back').click()
    await expect(window.getByTestId('commit-detail-panel')).toHaveCount(0)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('다른 실험 공간을 합친다 (빨리 감기)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'exp'], { cwd: repo })
  await writeFile(join(repo, 'exp.txt'), 'e\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'exp work'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    // 전체 그래프(--all) — 합치기 전에도 exp의 커밋이 함께 보인다 (E5b)
    await expect(window.getByTestId('history-count')).toHaveText('2')
    await window.getByTestId('merge-open').click()
    await window.getByTestId('list-option-exp').click()
    await expect(window.getByTestId('notice')).toContainText('모두 가져왔어요')
    await expect(window.getByTestId('history-count')).toHaveText('2')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('겹치면 충돌 화면에서 한쪽을 고르고 저장하기로 마무리한다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'rival'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'rival\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'rival'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'mine\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'mine'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('merge-open').click()
    await window.getByTestId('list-option-rival').click()
    // 충돌 상태 — 머지 바와 ! 파일
    await expect(window.getByTestId('merge-bar')).toContainText('겹침 1개 남음')
    await window.getByTestId('file-unstaged-app.txt').click()
    await expect(window.getByTestId('conflict-view')).toContainText('rival')
    await window.getByTestId('conflict-theirs').click()
    // 해소 — 머지 바 0개, staged로 이동
    await expect(window.getByTestId('merge-bar')).toContainText('겹침 0개 남음')
    await expect(window.getByTestId('staged-count')).toHaveText('1')
    // 저장하기 = 병합 마무리
    await window.getByTestId('commit-message').fill('합치기 마무리')
    await window.getByTestId('commit-button').click()
    await expect(window.getByTestId('merge-bar')).toHaveCount(0)
    await expect(window.getByTestId('history-count')).toHaveText('4')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('겹침을 전부 내 것으로 정리해도 저장하기로 합치기를 마무리할 수 있다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'rival'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'rival\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'rival'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'mine\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'mine'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('merge-open').click()
    await window.getByTestId('list-option-rival').click()
    await expect(window.getByTestId('merge-bar')).toContainText('겹침 1개 남음')
    await window.getByTestId('file-unstaged-app.txt').click()
    await window.getByTestId('conflict-ours').click()
    // 전량 내 것 — 변경 0개지만 병합 커밋으로 마무리할 수 있어야 한다 (데드엔드 방지)
    await expect(window.getByTestId('merge-bar')).toContainText('겹침 0개 남음')
    await expect(window.getByTestId('commit-button')).toContainText('합치기 마무리')
    await expect(window.getByTestId('commit-button')).toBeEnabled()
    await window.getByTestId('commit-button').click()
    await expect(window.getByTestId('merge-bar')).toHaveCount(0)
    await expect(window.getByTestId('history-count')).toHaveText('4')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('합치기를 취소하면 이전 상태로 돌아온다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'rival'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'rival\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'rival'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'mine\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'mine'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('merge-open').click()
    await window.getByTestId('list-option-rival').click()
    await expect(window.getByTestId('merge-bar')).toBeVisible()
    await window.getByTestId('merge-abort').click()
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId('merge-bar')).toHaveCount(0)
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')
    await expect(window.getByTestId('notice')).toContainText('취소')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('저장 안 된 변경이 겹치면 보관함에 넣고 합친다 (스마트 병합)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'exp'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'from exp\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'exp change'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'uncommitted\n')
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('unstaged-count')).toHaveText('1')
    await window.getByTestId('merge-open').click()
    await window.getByTestId('list-option-exp').click()
    await expect(window.getByTestId('notice')).toContainText('보관함')
    await expect(window.getByTestId('shelf-count')).toHaveText('1')
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('원격의 새 저장을 받아온다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const remote = await addBareRemote(repo)
  await execGitOrThrow(['push', '-u', 'origin', 'main'], { cwd: repo })
  const other = await mkdtemp(join(tmpdir(), 'git-gui-e2e-other-'))
  await execGitOrThrow(['clone', remote, other], { cwd: tmpdir() })
  await execGitOrThrow(['config', 'user.name', 'Other'], { cwd: other })
  await execGitOrThrow(['config', 'user.email', 'o@test.local'], { cwd: other })
  await writeFile(join(other, 'from-other.txt'), 'o\n')
  await execGitOrThrow(['add', '-A'], { cwd: other })
  await execGitOrThrow(['commit', '-m', '원격 저장'], { cwd: other })
  await execGitOrThrow(['push'], { cwd: other })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-count')).toHaveText('1')
    await window.getByTestId('pull').click()
    await expect(window.getByTestId('notice')).toContainText('받아왔어요')
    await expect(window.getByTestId('history-count')).toHaveText('2')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(other, { recursive: true, force: true })
    await rm(remote, { recursive: true, force: true })
  }
})

test('저장을 되돌리는 새 저장을 만든다 (revert)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '두 번째 저장'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-count')).toHaveText('2')
    await window.locator('[data-testid^="history-item-"]').first().click({ button: 'right' })
    await window.getByTestId('context-revert').click()
    await expect(window.getByTestId('notice')).toContainText('되돌리는 새 저장')
    await expect(window.getByTestId('history-count')).toHaveText('3')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('되돌리기가 겹치면 상태 바에서 취소할 수 있다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'v2'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'v3\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'v3'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    // v2(가운데 저장)를 되돌리면 v3와 겹친다
    await window.locator('[data-testid^="history-item-"]').nth(1).click({ button: 'right' })
    await window.getByTestId('context-revert').click()
    await expect(window.getByTestId('merge-bar')).toContainText('저장 되돌리는 중')
    // 전부 내 것을 유지하면 바뀌는 내용이 없다 — 저장하기 대신 취소로 마무리하도록 안내한다
    await window.getByTestId('file-unstaged-app.txt').click()
    await window.getByTestId('conflict-ours').click()
    await expect(window.getByTestId('merge-bar')).toContainText('되돌리기 취소를 눌러 마무리해요')
    // 되돌리는 중에는 우클릭 되돌리기가 비활성 — 이중 실행을 막는다 (통합 리뷰)
    await window.locator('[data-testid^="history-item-"]').first().click({ button: 'right' })
    await expect(window.getByTestId('context-revert')).toBeDisabled()
    await window.keyboard.press('Escape')
    await window.getByTestId('merge-abort').click()
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId('merge-bar')).toHaveCount(0)
    await expect(window.getByTestId('notice')).toContainText('되돌리기를 취소')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('실험 공간 이름을 바꾼다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['branch', 'old-name'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('header-branch').click()
    await window.getByTestId('branch-manage').click()
    await window.getByTestId('manage-rename-old-name').click()
    await window.getByTestId('prompt-input').fill('new-name')
    await window.getByTestId('prompt-submit').click()
    await expect(window.getByTestId('manage-rename-new-name')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('합쳐지지 않은 실험 공간은 두 번 확인 후에만 지워진다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'doomed'], { cwd: repo })
  await writeFile(join(repo, 'd.txt'), 'd\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'doomed work'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('header-branch').click()
    await window.getByTestId('branch-manage').click()
    await window.getByTestId('manage-remove-doomed').click()
    await window.getByTestId('confirm-accept').click()
    // 합쳐지지 않은 저장 — 1차와 구분되는 강제 확인창(제목)이 이어진다
    await expect(window.getByText('아직 합쳐지지 않은 저장이 있어요')).toBeVisible()
    // 강제 확인창으로 이름 스코프해 클릭 — 퇴장 즉시화(E3b) 이후에도 견고하다
    await window
      .getByRole('alertdialog', { name: '아직 합쳐지지 않은 저장이 있어요' })
      .getByTestId('confirm-accept')
      .click()
    await expect(window.getByTestId('manage-remove-doomed')).toHaveCount(0)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('겹침 두 곳을 카드에서 하나씩 골라 확정하고 저장하기로 마무리한다', async () => {
  const repo = await createTwoBlockConflictRepo()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('merge-open').click()
    await window.getByTestId('list-option-rival').click()
    await expect(window.getByTestId('merge-bar')).toContainText('겹침 1개 남음')
    await window.getByTestId('file-unstaged-app.txt').click()
    await expect(window.getByTestId('conflict-progress')).toHaveText('겹침 2곳 중 1번째')
    // 1번째 겹침은 내 것 — 반영되면 남은 블록이 파일 기준 다시 0번이 된다
    await window.getByTestId('conflict-block-ours-0').click()
    await expect(window.getByTestId('conflict-progress')).toHaveText('겹침 2곳 중 2번째')
    await window.getByTestId('conflict-block-theirs-0').click()
    await expect(window.getByTestId('conflict-progress')).toHaveText('모두 골랐어요')
    // 확정 전에는 여전히 겹침(unmerged) 파일이다 — add는 확정 버튼에서만
    await expect(window.getByTestId('merge-bar')).toContainText('겹침 1개 남음')
    await window.getByTestId('conflict-confirm').click()
    await expect(window.getByTestId('merge-bar')).toContainText('겹침 0개 남음')
    await expect(window.getByTestId('staged-count')).toHaveText('1')
    // 저장하기 = 병합 마무리 (부모 2)
    await window.getByTestId('commit-message').fill('겹침 정리해서 합치기')
    await window.getByTestId('commit-button').click()
    await expect(window.getByTestId('merge-bar')).toHaveCount(0)
    expect(await readFile(join(repo, 'app.txt'), 'utf8')).toBe(
      'mine-top\ntwo\nthree\nfour\nfive\nsix\nrival-bottom\n',
    )
    const parents = await execGitOrThrow(['log', '-1', '--format=%P'], { cwd: repo })
    expect(parents.stdout.trim().split(' ')).toHaveLength(2)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('선택형 일부 선택 → 자세히 보기 직접 수정 → 선택 유지 (E-004)', async () => {
  const repo = await createTwoBlockConflictRepo()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('merge-open').click()
    await window.getByTestId('list-option-rival').click()
    await window.getByTestId('file-unstaged-app.txt').click()
    await window.getByTestId('conflict-block-ours-0').click()
    await expect(window.getByTestId('conflict-progress')).toHaveText('겹침 2곳 중 2번째')
    await window.getByTestId('conflict-detail-toggle').click()
    // 선택형에서 고른 것이 결과에 유지된 채로 열린다 — 남은 겹침 표시도 그대로 (E-004)
    await expect(window.getByTestId('conflict-edit-text')).toHaveValue(/mine-top/)
    await expect(window.getByTestId('conflict-edit-text')).toHaveValue(/<<<<<<</)
    await window
      .getByTestId('conflict-edit-text')
      .fill('mine-top\ntwo\nthree\nfour\nfive\nsix\nhand-merged\n')
    await window.getByTestId('conflict-edit-save').click()
    // 선택형으로 복귀 — 직접 수정이 반영되어 남은 겹침이 없다
    await expect(window.getByTestId('conflict-progress')).toHaveText('모두 골랐어요')
    await expect(window.getByTestId('conflict-view')).toContainText('hand-merged')
    await window.getByTestId('conflict-confirm').click()
    await expect(window.getByTestId('staged-count')).toHaveText('1')
    expect(await readFile(join(repo, 'app.txt'), 'utf8')).toBe(
      'mine-top\ntwo\nthree\nfour\nfive\nsix\nhand-merged\n',
    )
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('일부만 고르고 재시작해도 고른 결과와 남은 겹침이 복원된다', async () => {
  const repo = await createTwoBlockConflictRepo()
  const env = { ...process.env, GIT_GUI_E2E_REPO: repo }
  const app = await electron.launch({ args: [APP_ROOT], env })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('merge-open').click()
    await window.getByTestId('list-option-rival').click()
    await window.getByTestId('file-unstaged-app.txt').click()
    await window.getByTestId('conflict-block-ours-0').click()
    await expect(window.getByTestId('conflict-progress')).toHaveText('겹침 2곳 중 2번째')
  } finally {
    await app.close()
  }
  // 재실행 — 선택은 파일에, 합치는 중 상태는 MERGE_HEAD에 있어 그대로 복원된다 (스펙 §7 공통 원칙)
  const second = await electron.launch({ args: [APP_ROOT], env })
  try {
    const window = await second.firstWindow()
    await expect(window.getByTestId('merge-bar')).toContainText('겹침 1개 남음')
    await window.getByTestId('file-unstaged-app.txt').click()
    // 남은 블록 1개부터 이어서 — 앞서 고른 mine-top은 일반 줄로 남아 있다
    await expect(window.getByTestId('conflict-progress')).toHaveText('겹침 1곳 중 1번째')
    await expect(window.getByTestId('conflict-view')).toContainText('mine-top')
    await expect(window.getByTestId('conflict-card-1')).toHaveCount(0)
  } finally {
    await second.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('처음부터 다시를 누르면 겹침 표시가 되살아난다', async () => {
  const repo = await createTwoBlockConflictRepo()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('merge-open').click()
    await window.getByTestId('list-option-rival').click()
    await window.getByTestId('file-unstaged-app.txt').click()
    await window.getByTestId('conflict-block-ours-0').click()
    await expect(window.getByTestId('conflict-progress')).toHaveText('겹침 2곳 중 2번째')
    await window.getByTestId('conflict-reset').click()
    await window.getByTestId('confirm-accept').click()
    // 마커 재생성(실측: 라벨은 ours/theirs) — 카드 2개와 진행 표시가 처음으로 돌아온다
    await expect(window.getByTestId('conflict-progress')).toHaveText('겹침 2곳 중 1번째')
    await expect(window.getByTestId('conflict-card-1')).toBeVisible()
    expect(await readFile(join(repo, 'app.txt'), 'utf8')).toContain('<<<<<<<')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('커밋 상세에서 파일 우클릭 — 이 파일만 그 시점 내용으로 적용한다 (미저장 변경은 보관함으로)', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('unstaged-count')).toHaveText('1')
    // init 커밋(v1) 상세를 열고 파일 행을 우클릭한다
    await window.locator('[data-testid^="history-item-"]').first().click()
    await window.getByTestId('commit-file-app.txt').click({ button: 'right' })
    await window.getByTestId('context-restore-file').click()
    // 확인창 — 자동 보관 안내를 담는다
    await expect(window.getByRole('alertdialog')).toContainText('보관함에 넣어 드려요')
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId('notice')).toContainText('저장 예정에 올려뒀어요')
    await expect(window.getByTestId('notice')).toContainText('보관함')
    // dirty였던 v2는 보관함으로 +1, 디스크는 그 시점(v1) 내용 — 실측
    await expect(window.getByTestId('shelf-count')).toHaveText('1')
    expect(await readFile(join(repo, 'app.txt'), 'utf8')).toBe('v1\n')
    // 적용 결과가 HEAD와 같아 변경 목록은 비고, 파괴 작업 관례대로 하단 상세가 닫힌다 (E6a)
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')
    await expect(window.getByTestId('commit-detail-panel')).toHaveCount(0)
    await expect(window.getByTestId('history-panel')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('좌측 파일 우클릭 — 올리기(stage)와 파일 삭제(delete)', async () => {
  const repo = await createRepoWithChange()
  await writeFile(join(repo, 'junk.txt'), 'j\n')
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('unstaged-count')).toHaveText('2')
    // 올리기 (stage) — staged 목록으로 이동한다
    await window.getByTestId('file-unstaged-app.txt').click({ button: 'right' })
    await window.getByTestId('context-stage-file').click()
    await expect(window.getByTestId('staged-count')).toHaveText('1')
    await expect(window.getByTestId('unstaged-count')).toHaveText('1')
    // 파일 삭제 (delete) — "되돌릴 수 없어요" 확인창을 거쳐 행과 디스크가 함께 사라진다
    await window.getByTestId('file-unstaged-junk.txt').click({ button: 'right' })
    await window.getByTestId('context-remove-file').click()
    await expect(window.getByRole('alertdialog')).toContainText('되돌릴 수 없어요')
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')
    expect(existsSync(join(repo, 'junk.txt'))).toBe(false)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('커밋 상세에서 지금 코드와 비교 — 중앙 diff 제목이 비교로 구분된다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.locator('[data-testid^="history-item-"]').first().click()
    await window.getByTestId('commit-file-app.txt').click({ button: 'right' })
    await window.getByTestId('context-compare-worktree').click()
    // 부모 대비 제목("— 저장 <hash>")이 아니라 비교 제목이 뜬다
    await expect(window.getByTestId('diff-panel')).toContainText('app.txt — 지금 코드와 비교')
    // 커밋 시점(v1)과 커밋 안 된 워크트리(v2)의 차이가 그대로 보인다 (피드백 6)
    await expect(window.getByTestId('diff-view-unified')).toContainText('v2')
    // 상세(파일 목록)는 열린 채 유지된다 — 다른 파일을 이어서 비교할 수 있다
    await expect(window.getByTestId('commit-detail-panel')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('히스토리 전체 그래프 — 다른 실험 공간·원격(☁)이 함께 보이고 "지금 여기"가 나를 따라온다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const remote = await addBareRemote(repo)
  await execGitOrThrow(['push', '-u', 'origin', 'main'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'other'], { cwd: repo })
  await writeFile(join(repo, 'other.txt'), 'o\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'other 저장'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  // 보관함(stash) 커밋은 전체 그래프에 나타나면 안 된다 — 픽스처에 하나 심는다 (검출력 변이 대상)
  await writeFile(join(repo, 'app.txt'), 'dirty\n')
  await execGitOrThrow(['stash', 'push', '-u', '-m', '픽스처 보관'], { cwd: repo })
  const mainHash = (await execGitOrThrow(['rev-parse', 'main'], { cwd: repo })).stdout.trim()
  const otherHash = (await execGitOrThrow(['rev-parse', 'other'], { cwd: repo })).stdout.trim()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    // main(=origin/main 동일 해시 dedup) 1개 + other 1개 — stash WIP 커밋은 제외된다
    await expect(window.getByTestId('history-count')).toHaveText('2')
    await expect(window.getByTestId('history-list')).not.toContainText('픽스처 보관')
    // 원격 배지 — origin/은 ☁ 접두로 로컬과 구분된다 (피드백 3)
    await expect(window.getByTestId('history-list')).toContainText('☁ origin/main')
    // "지금 여기"는 index 0(최신 행 = other)이 아니라 HEAD(main) 행에 붙는다 (피드백 4)
    await expect(window.getByTestId(`history-item-${mainHash}`)).toContainText('지금 여기')
    await expect(window.getByTestId(`history-item-${otherHash}`)).not.toContainText('지금 여기')
    // 전환하면 마커가 따라온다 — 목록은 그대로 전체
    await window.getByTestId('header-branch').click()
    await window.getByTestId('branch-item-other').click()
    await expect(window.getByTestId('header-branch')).toContainText('other')
    await expect(window.getByTestId('history-count')).toHaveText('2')
    await expect(window.getByTestId(`history-item-${otherHash}`)).toContainText('지금 여기')
    await expect(window.getByTestId(`history-item-${mainHash}`)).not.toContainText('지금 여기')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(remote, { recursive: true, force: true })
  }
})

test('이 저장만 가져오기 (cherry-pick) — 성공과 충돌·취소', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  // 깔끔히 가져올 수 있는 저장(새 파일)과 겹치는 저장(app.txt 수정)을 각각 다른 공간에 만든다
  await execGitOrThrow(['checkout', '-b', 'feature'], { cwd: repo })
  await writeFile(join(repo, 'feature.txt'), 'f\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '기능 저장'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'rival', 'main'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'rival\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'rival 저장'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'mine\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'mine 저장'], { cwd: repo })
  const featureHash = (await execGitOrThrow(['rev-parse', 'feature'], { cwd: repo })).stdout.trim()
  const rivalHash = (await execGitOrThrow(['rev-parse', 'rival'], { cwd: repo })).stdout.trim()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-count')).toHaveText('4')
    // (1) 깔끔한 가져오기 — 새 저장이 생기고 파일이 도착한다
    await window.getByTestId(`history-item-${featureHash}`).click({ button: 'right' })
    await window.getByTestId('context-cherry-pick').click()
    await expect(window.getByTestId('notice')).toContainText('가져와 새 저장을 만들었어요')
    await expect(window.getByTestId('history-count')).toHaveText('5')
    expect(await readFile(join(repo, 'feature.txt'), 'utf8')).toBe('f\n')
    // (2) 겹치는 가져오기 — cherry-picking 상태 바가 뜨고 취소로 돌아온다
    await window.getByTestId(`history-item-${rivalHash}`).click({ button: 'right' })
    await window.getByTestId('context-cherry-pick').click()
    await expect(window.getByTestId('merge-bar')).toContainText('저장 가져오는 중')
    await expect(window.getByTestId('merge-abort')).toHaveText('가져오기 취소')
    await window.getByTestId('merge-abort').click()
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId('merge-bar')).toHaveCount(0)
    await expect(window.getByTestId('notice')).toContainText('가져오기를 취소')
    await expect(window.getByTestId('history-count')).toHaveText('5')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('태그 만들기 (tag) — 배지로 나타난다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.locator('[data-testid^="history-item-"]').first().click({ button: 'right' })
    await window.getByTestId('context-tag-here').click()
    await window.getByTestId('prompt-input').fill('v1.0')
    await window.getByTestId('prompt-submit').click()
    await expect(window.getByTestId('notice')).toContainText('태그를 만들었어요')
    // 태그는 --all 그래프의 decorate 배지로 자동 반영된다 (실측 9) — 🏷 접두로 로컬·원격과 구분 (E6b)
    await expect(window.getByTestId('history-list')).toContainText('🏷 v1.0')
    const tags = await execGitOrThrow(['tag', '--list'], { cwd: repo })
    expect(tags.stdout.trim()).toBe('v1.0')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('notice 안내는 10초 뒤 자동으로 사라진다 (에러·머지 바와 달리)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-count')).toHaveText('1')
    // 가짜 시계 — 10초를 실제로 기다리지 않는다 (플랜 실측 3: Electron 페이지에서 clock 동작 확인)
    await window.clock.install()
    await window.locator('[data-testid^="history-item-"]').first().click({ button: 'right' })
    await window.getByTestId('context-tag-here').click()
    await window.getByTestId('prompt-input').fill('v-auto')
    await window.getByTestId('prompt-submit').click()
    await expect(window.getByTestId('notice')).toContainText('태그를 만들었어요')
    await window.clock.fastForward(10_500)
    await expect(window.getByTestId('notice')).toHaveCount(0)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('저장 실행취소 (undo)와 메시지 고치기 (amend)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '두 번째 저장'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-count')).toHaveText('2')
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')
    // HEAD가 아닌 행에서는 실행취소·메시지 고치기가 사유와 함께 비활성이다
    await window.locator('[data-testid^="history-item-"]').last().click({ button: 'right' })
    await expect(window.getByTestId('context-undo-last')).toBeDisabled()
    await expect(window.getByTestId('context-reword')).toBeDisabled()
    await window.keyboard.press('Escape')
    // 실행취소 — 확인창은 내용이 남는다는 안내를 담는다
    await window.locator('[data-testid^="history-item-"]').first().click({ button: 'right' })
    await window.getByTestId('context-undo-last').click()
    await expect(window.getByRole('alertdialog')).toContainText('바뀐 내용은 그대로 남아요')
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId('history-count')).toHaveText('1')
    // 취소된 저장의 내용(v2)이 변경 목록으로 돌아왔다 — 유실 없음
    await expect(window.getByTestId('unstaged-count')).toHaveText('1')
    expect(await readFile(join(repo, 'app.txt'), 'utf8')).toBe('v2\n')
    // 메시지 고치기 — 남은 HEAD(init)의 제목이 초기값으로 채워진다
    await window.locator('[data-testid^="history-item-"]').first().click({ button: 'right' })
    await window.getByTestId('context-reword').click()
    await expect(window.getByTestId('prompt-input')).toHaveValue('init')
    await window.getByTestId('prompt-input').fill('고친 첫 저장')
    await window.getByTestId('prompt-submit').click()
    await expect(window.getByTestId('history-list')).toContainText('고친 첫 저장')
    const log = await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: repo })
    expect(log.stdout.trim()).toBe('고친 첫 저장')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('커밋이 삭제한 파일은 "이 파일만 적용"이 사유와 함께 비활성이다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['rm', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '파일 정리 저장'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-count')).toHaveText('2')
    // 삭제 커밋(최신) 상세 — app.txt는 kind=deleted로 나온다
    await window.locator('[data-testid^="history-item-"]').first().click()
    await expect(window.getByTestId('commit-detail-panel')).toBeVisible()
    await window.getByTestId('commit-file-app.txt').click({ button: 'right' })
    await expect(window.getByTestId('context-restore-file')).toBeDisabled()
    await expect(window.getByTestId('context-restore-file')).toContainText('지워진 파일이에요')
    // 비교(diff)는 계속 살아 있다 — 지워진 내용도 확인할 수 있다
    await expect(window.getByTestId('context-compare-worktree')).toBeEnabled()
    await window.keyboard.press('Escape')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('실험 공간 탭 — 목록·상태 배지·검색 (E7a)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const remote = await addBareRemote(repo)
  await execGitOrThrow(['push', '-u', 'origin', 'main'], { cwd: repo })
  await execGitOrThrow(['branch', 'feature/login'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-branches').click()
    await expect(window.getByTestId('branches-panel')).toBeVisible()
    // E7g: 상태는 칩 텍스트 대신 아이콘(➤)·Tooltip(data-tooltip)·인라인 ↑↓로 표시된다 (E7j 전환)
    await expect(window.getByTestId('branch-row-main')).toHaveAttribute('data-tooltip', /지금 여기/)
    await expect(
      window.getByTestId('branch-row-main').locator('.branch-row__ahead, .branch-row__behind'),
    ).toHaveCount(0)
    await expect(window.getByTestId('branch-row-feature/login')).toHaveAttribute(
      'data-tooltip',
      /아직 원격과 연결 안 됨/,
    )
    await expect(window.getByTestId('branch-row-origin/main')).toBeVisible()
    // 검색 — login만 남는다
    await window.getByTestId('branches-search').fill('login')
    await expect(window.getByTestId('branch-row-main')).toHaveCount(0)
    await expect(window.getByTestId('branch-row-feature/login')).toBeVisible()
    // 변경 탭 복귀 — 저장 폼이 그대로다 (커밋 흐름 무변)
    await window.getByTestId('left-tab-changes').click()
    await expect(window.getByTestId('commit-button')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(remote, { recursive: true, force: true })
  }
})

test('실험 공간 탭 — 우클릭 이동(checkout)에 현재 표시가 따라온다 (E7a)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'sidework'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-branches').click()
    await window.getByTestId('branch-row-sidework').click({ button: 'right' })
    await window.getByTestId('context-switch').click()
    // E7g: "지금 여기"는 Tooltip(data-tooltip) — 행 텍스트는 아이콘(➤) (E7j 전환)
    await expect(window.getByTestId('branch-row-sidework')).toHaveAttribute('data-tooltip', /지금 여기/)
    const current = await execGitOrThrow(['branch', '--show-current'], { cwd: repo })
    expect(current.stdout.trim()).toBe('sidework')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('실험 공간 탭 — 지금과 비교가 양방향 전용 저장을 보여준다 (E7a)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'rival'], { cwd: repo })
  await writeFile(join(repo, 'rival.txt'), 'r\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '상대 전용 저장'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  await writeFile(join(repo, 'mine.txt'), 'm\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '내 전용 저장'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-branches').click()
    await window.getByTestId('branch-row-rival').click({ button: 'right' })
    await window.getByTestId('context-compare').click()
    await expect(window.getByTestId('branch-compare-view')).toContainText('상대 전용 저장')
    await expect(window.getByTestId('branch-compare-view')).toContainText('내 전용 저장')
    await window.getByTestId('branch-compare-back').click()
    await expect(window.getByTestId('branches-list')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('재배치(rebase) — 충돌 → 새 기반/내 저장 선택 → 계속하기 → 완료 (E7a)', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'git-gui-e2e-'))
  await execGitOrThrow(['init', '--initial-branch=main'], { cwd: repo })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: repo })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'base\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'init'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'topic'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'topic\n')
  await execGitOrThrow(['commit', '-am', 'topic 저장'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'main\n')
  await execGitOrThrow(['commit', '-am', 'main 저장'], { cwd: repo })
  await execGitOrThrow(['checkout', 'topic'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-branches').click()
    await window.getByTestId('branch-row-main').click({ button: 'right' })
    await window.getByTestId('context-rebase').click()
    await window.getByRole('button', { name: '재배치 (rebase)' }).click()
    // 충돌 — 4겸용 상태 바 + 진행 표시(실측 2: msgnum/end)
    await expect(window.getByTestId('merge-bar')).toContainText('저장 재배치 중 (1개 중 1번째)')
    // 변경 탭의 ! 파일에서 해결 — rebase 라벨 반전(초록=새 기반, 보라=재배치 중인 내 저장)
    await window.getByTestId('left-tab-changes').click()
    await window.getByTestId('file-unstaged-app.txt').click()
    await expect(window.getByTestId('conflict-panel')).toBeVisible()
    await expect(window.getByTestId('conflict-ours')).toContainText('새 기반 유지')
    await window.getByTestId('conflict-theirs').click()
    await expect(window.getByTestId('merge-bar')).toContainText('겹침 0개 남음')
    await window.getByTestId('rebase-continue').click()
    await expect(window.getByTestId('notice')).toContainText('재배치를 마쳤어요')
    await expect(window.getByTestId('merge-bar')).toHaveCount(0)
    // 재배치 성립 — topic의 부모가 main이고 내 저장 내용이 남았다
    const parent = await execGitOrThrow(['rev-parse', 'topic^'], { cwd: repo })
    const main = await execGitOrThrow(['rev-parse', 'main'], { cwd: repo })
    expect(parent.stdout.trim()).toBe(main.stdout.trim())
    expect(await readFile(join(repo, 'app.txt'), 'utf8')).toBe('topic\n')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('실험 공간 탭 — 비현재 공간을 원격 최신으로 업데이트한다 (E7a)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const remote = await addBareRemote(repo)
  await execGitOrThrow(['push', '-u', 'origin', 'main'], { cwd: repo })
  await execGitOrThrow(['push', 'origin', 'main:old'], { cwd: repo })
  await execGitOrThrow(['branch', '--track', 'old', 'origin/old'], { cwd: repo })
  // 다른 클론이 old를 앞세운다 — 로컬 old는 뒤처진(ff 가능) 상태
  const other = await mkdtemp(join(tmpdir(), 'git-gui-e2e-other-'))
  await execGitOrThrow(['clone', remote, other], { cwd: tmpdir() })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: other })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: other })
  await execGitOrThrow(['checkout', 'old'], { cwd: other })
  await writeFile(join(other, 'o.txt'), 'o\n')
  await execGitOrThrow(['add', '-A'], { cwd: other })
  await execGitOrThrow(['commit', '-m', 'other old'], { cwd: other })
  await execGitOrThrow(['push'], { cwd: other })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-branches').click()
    await window.getByTestId('branch-row-old').click({ button: 'right' })
    await window.getByTestId('context-update').click()
    await expect(window.getByTestId('notice')).toContainText('원격 최신으로 업데이트했어요')
    // E7g: "동기화됨" 칩 대신 침묵(인라인 ↑↓ 배지가 없음)이 신호
    await expect(
      window.getByTestId('branch-row-old').locator('.branch-row__ahead, .branch-row__behind'),
    ).toHaveCount(0)
    const localOld = await execGitOrThrow(['rev-parse', 'old'], { cwd: repo })
    const remoteOld = await execGitOrThrow(['rev-parse', 'old'], { cwd: remote })
    expect(localOld.stdout.trim()).toBe(remoteOld.stdout.trim())
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(remote, { recursive: true, force: true })
    await rm(other, { recursive: true, force: true })
  }
})

test('실험 공간 탭 — 원격 공간을 내 공간으로 가져온다(추적 checkout) (E7a)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const remote = await addBareRemote(repo)
  await execGitOrThrow(['push', '-u', 'origin', 'main'], { cwd: repo })
  // 원격에만 있는 공간 — push refspec으로 만들면 로컬 remote-tracking ref도 함께 생긴다
  await execGitOrThrow(['push', 'origin', 'main:incoming'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-branches').click()
    await window.getByTestId('branch-row-origin/incoming').click({ button: 'right' })
    await window.getByTestId('context-checkout-remote').click()
    await expect(window.getByTestId('notice')).toContainText('가져와 이동했어요')
    // E7g: "지금 여기"는 Tooltip(data-tooltip) — 행 텍스트는 아이콘(➤) (E7j 전환)
    await expect(window.getByTestId('branch-row-incoming')).toHaveAttribute('data-tooltip', /지금 여기/)
    const current = await execGitOrThrow(['branch', '--show-current'], { cwd: repo })
    expect(current.stdout.trim()).toBe('incoming')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(remote, { recursive: true, force: true })
  }
})

test('감시 — 밖에서 저장하면 화면이 스스로 갱신된다 (E7b fs watch)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-count')).toHaveText('1')
    // 앱 밖(터미널 상당)에서 커밋 — 클릭 없이 역사·브랜치 화면이 따라와야 한다
    await execGitOrThrow(['commit', '--allow-empty', '-m', '외부 저장'], { cwd: repo })
    await expect(window.getByTestId('history-count')).toHaveText('2', { timeout: 5_000 })
    await expect(window.getByTestId('history-list')).toContainText('외부 저장')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('터미널 — 열고 명령을 치면 결과가 보인다 (E7b)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  // 터미널 토글은 dockOpen을 settings.json에 영속한다(rightWidth 선례) — 격리된 userData가
  // 없으면 이전 터미널 테스트가 남긴 열림 상태를 물려받아 이번 클릭이 반대로 닫아버린다
  // (실측: 기본 워커·순차 실행에서도 재현되는 결정적 실패 — 실측 뒤 추가한 최소 보정)
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('terminal-toggle').click()
    await expect(window.getByTestId('terminal-dock')).toBeVisible()
    await expect(window.locator('.terminal-dock__view .xterm')).toBeVisible()
    // pty가 키 입력을 버퍼링하므로 프롬프트 완성을 기다릴 필요 없다 (실측 2: echo 왕복)
    await window.locator('.terminal-dock__view').first().click()
    await window.keyboard.type('echo e7b-roundtrip-marker')
    await window.keyboard.press('Enter')
    await expect(window.getByTestId('terminal-body')).toContainText('e7b-roundtrip-marker', {
      timeout: 10_000,
    })
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('터미널 — 터미널에서 저장하면 화면이 따라온다 (E7b 감시 연동)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  // dockOpen 영속 격리 — 위 테스트와 동일 사유 (실측 후 최소 보정)
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-count')).toHaveText('1')
    await window.getByTestId('terminal-toggle').click()
    await window.locator('.terminal-dock__view').first().click()
    // 로그인 쉘 rc가 cwd를 바꿀 수 있다 — 테스트는 명시적으로 저장소로 이동해 rc 의존을 없앤다
    await window.keyboard.type(`cd "${repo}" && git commit --allow-empty -m e7b-terminal-commit`)
    await window.keyboard.press('Enter')
    await expect(window.getByTestId('history-count')).toHaveText('2', { timeout: 10_000 })
    await expect(window.getByTestId('history-list')).toContainText('e7b-terminal-commit')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('터미널 — 탭을 추가·전환·닫을 수 있다 (E7b)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  // dockOpen 영속 격리 — 위 테스트와 동일 사유 (실측 후 최소 보정)
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('terminal-toggle').click()
    await expect(window.locator('.terminal-dock__tab')).toHaveCount(1)
    await window.getByTestId('terminal-new-tab').click()
    await expect(window.locator('.terminal-dock__tab')).toHaveCount(2)
    // 첫 탭으로 전환 후 둘째 탭 닫기
    await window.locator('.terminal-dock__tab-name').first().click()
    await window.locator('.terminal-dock__tab-close').nth(1).click()
    await expect(window.locator('.terminal-dock__tab')).toHaveCount(1)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('터미널 — 접었다 펴도 세션이 유지된다 (E7b)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  // dockOpen 영속 격리 — 위 테스트와 동일 사유 (실측 후 최소 보정)
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('terminal-toggle').click()
    await window.locator('.terminal-dock__view').first().click()
    await window.keyboard.type('echo keep-alive-proof')
    await window.keyboard.press('Enter')
    await expect(window.getByTestId('terminal-body')).toContainText('keep-alive-proof', {
      timeout: 10_000,
    })
    // 접기 — 숨김일 뿐 세션은 산다 (스펙)
    await window.getByTestId('terminal-close').click()
    await expect(window.getByTestId('terminal-dock')).toBeHidden()
    await window.getByTestId('terminal-toggle').click()
    await expect(window.getByTestId('terminal-dock')).toBeVisible()
    await expect(window.getByTestId('terminal-body')).toContainText('keep-alive-proof')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('워크트리 탭 — 목록에 본체가 보이고 새로 만든다 (E7c)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'feature/login'], { cwd: repo })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  const repoName = repo.split('/').filter(Boolean).pop()!
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-worktrees').click()
    // E7g: 이모지·칩 대신 글리프(➤)로 "지금 여기"를 단언(같은 상태, 다른 표시 방식)
    // E7j Task 6: 네이티브 title → 리치 카드 Tooltip 전환 — "지금 여기"는 이제 카드 본문에 있고,
    // data-tooltip(summary)은 전체 경로다(macOS는 tmp 경로가 /private/var로 실경로 해석돼 접두가
    // 달라질 수 있어 꼬리로 검증 — 1663행 주석과 동일 사유).
    await expect(window.getByTestId(`worktree-row-${repoName}`)).toContainText('➤')
    await expect(window.getByTestId(`worktree-row-${repoName}`)).toHaveAttribute(
      'data-tooltip',
      new RegExp(`${repoName}$`),
    )
    // 새 워크트리 — feature/login 기본 선택·경로 자동 제안
    await window.getByTestId('worktree-add').click()
    // 앱의 본체 경로는 git 실경로(/private/var/...)라 repo(/var/...)와 접두가 다르다 — 꼬리로 검증
    await expect(window.getByTestId('add-worktree-path')).toHaveValue(
      new RegExp(`${repoName}-feature-login$`),
    )
    await window.getByTestId('add-worktree-submit').click()
    await expect(window.getByTestId(`worktree-row-${repoName}-feature-login`)).toContainText(
      'feature/login',
    )
    const wtList = await execGitOrThrow(['worktree', 'list'], { cwd: repo })
    expect(wtList.stdout).toContain(`${repo}-feature-login`)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(`${repo}-feature-login`, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('워크트리 탭 — 클릭하면 새 터미널이 그 폴더에서 열린다 (E7c 핵심)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'feature/login'], { cwd: repo })
  await execGitOrThrow(['worktree', 'add', `${repo}-feature-login`, 'feature/login'], { cwd: repo })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  const repoName = repo.split('/').filter(Boolean).pop()!
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-worktrees').click()
    // 링크드 워크트리 행 클릭 = 활성 지정 + (기본 설정) 터미널 열림
    await window.getByTestId(`worktree-row-${repoName}-feature-login`).click()
    // E7g: 칩 대신 ❯_ 글리프(제목 툴팁 "터미널 대상")로 단언
    await expect(window.getByTestId(`worktree-row-${repoName}-feature-login`)).toContainText('❯_')
    await expect(window.getByTestId('terminal-dock')).toBeVisible()
    await window.locator('.terminal-dock__view').first().click()
    await window.keyboard.type('pwd')
    await window.keyboard.press('Enter')
    // 새 세션의 cwd가 워크트리 폴더 — 터미널 연동의 핵심 검증
    // (macOS: pwd는 실경로 /private/var/...를 찍지만 repo(/var/...)를 부분 문자열로 포함한다)
    await expect(window.getByTestId('terminal-body')).toContainText(`${repo}-feature-login`, {
      timeout: 10_000,
    })
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(`${repo}-feature-login`, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('설정 — 앱 전체 전환으로 바꾸면 클릭 시 헤더·역사가 그 워크트리로 바뀐다 (E7c)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'feature/login'], { cwd: repo })
  await execGitOrThrow(['worktree', 'add', `${repo}-feature-login`, 'feature/login'], { cwd: repo })
  // 워크트리에서 저장을 하나 더 만들어 역사가 달라지게 한다
  await writeFile(join(`${repo}-feature-login`, 'wt.txt'), 'w\n')
  await execGitOrThrow(['add', '-A'], { cwd: `${repo}-feature-login` })
  await execGitOrThrow(['commit', '-m', '워크트리 전용 저장'], { cwd: `${repo}-feature-login` })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  const repoName = repo.split('/').filter(Boolean).pop()!
  try {
    const window = await app.firstWindow()
    // 설정 → 앱 전체 전환
    await window.getByTestId('settings-open').click()
    await window.getByTestId('settings-worktree-switch').click()
    await window.getByTestId('settings-close').click()
    await window.getByTestId('left-tab-worktrees').click()
    await window.getByTestId(`worktree-row-${repoName}-feature-login`).click()
    // 역사에 워크트리 전용 저장이 보인다 — 앱 전체가 그 워크트리 기준으로 전환됐다
    await expect(window.getByTestId('history-list')).toContainText('워크트리 전용 저장', {
      timeout: 5_000,
    })
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(`${repo}-feature-login`, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('워크트리 탭 — 미저장 변경이 있으면 지우기가 2단 확인이다 (E7c)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'feature/login'], { cwd: repo })
  await execGitOrThrow(['worktree', 'add', `${repo}-feature-login`, 'feature/login'], { cwd: repo })
  await writeFile(join(`${repo}-feature-login`, 'dirty.txt'), 'd\n')
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  const repoName = repo.split('/').filter(Boolean).pop()!
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-worktrees').click()
    await window.getByTestId(`worktree-row-${repoName}-feature-login`).click({ button: 'right' })
    await window.getByTestId('context-remove').click()
    // 1차 확인 → 엔진이 needsForce → 2차(강제) 확인
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByRole('alertdialog')).toContainText('미저장 변경이 있어요')
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId(`worktree-row-${repoName}-feature-login`)).toHaveCount(0)
    const wtList = await execGitOrThrow(['worktree', 'list'], { cwd: repo })
    expect(wtList.stdout).not.toContain(`${repo}-feature-login`)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(`${repo}-feature-login`, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('감시 — 링크드 워크트리를 앱에서 열면 그 안의 외부 저장도 따라온다 (E7c 실버그 수정)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'feature/login'], { cwd: repo })
  await execGitOrThrow(['worktree', 'add', `${repo}-feature-login`, 'feature/login'], { cwd: repo })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  const repoName = repo.split('/').filter(Boolean).pop()!
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-worktrees').click()
    // 링크드 워크트리를 앱에서 연다(전체 전환) — 감시가 common-dir로 교체된다
    await window.getByTestId(`worktree-row-${repoName}-feature-login`).click({ button: 'right' })
    await window.getByTestId('context-open').click()
    await expect(window.getByTestId('history-count')).toHaveText('1', { timeout: 5_000 })
    // 열기(guard) 종료 직후 800ms는 설계된 자기-이벤트 억제 창(WATCH_SUPPRESS_MS=800) —
    // 그 안에 도착한 외부 이벤트는 버려지므로 창이 지난 뒤 커밋한다 (renderer 모듈은 e2e에서
    // import하지 않는 관례라 상수를 리터럴로 둔다)
    await window.waitForTimeout(900)
    // 그 워크트리에서 밖으로 커밋 — 현행 감시(.git 파일)면 이벤트가 안 온다(실측 H1). common-dir 감시면 따라온다
    await execGitOrThrow(['commit', '--allow-empty', '-m', '워크트리 외부 저장'], {
      cwd: `${repo}-feature-login`,
    })
    await expect(window.getByTestId('history-count')).toHaveText('2', { timeout: 5_000 })
    await expect(window.getByTestId('history-list')).toContainText('워크트리 외부 저장')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(`${repo}-feature-login`, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('충돌이 생기면 변경 탭으로 자동 전환된다 (E7d ①)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  // 충돌 픽스처 — 같은 줄을 두 브랜치가 다르게 저장
  await execGitOrThrow(['checkout', '-b', 'clash'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'clash-side\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'clash 저장'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'main-side\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'main 저장'], { cwd: repo })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    // 실험 공간 탭에서 합치기 → 충돌 → 변경 탭으로 자동 이동해 ! 파일이 보인다
    await window.getByTestId('left-tab-branches').click()
    await expect(window.getByTestId('left-tab-branches')).toHaveAttribute('aria-selected', 'true')
    // E7g: 좌클릭은 선택만 — 메뉴는 우클릭 (3단 인터랙션)
    await window.getByTestId('branch-row-clash').click({ button: 'right' })
    await window.getByTestId('context-merge').click()
    await expect(window.getByTestId('left-tab-changes')).toHaveAttribute('aria-selected', 'true', {
      timeout: 5_000,
    })
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('설정에서 테마를 바꾸면 열린 터미널 배경도 바뀐다 (E7d ③)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('terminal-toggle').click()
    await expect(window.locator('.terminal-dock__view .xterm')).toBeVisible()
    // 실측: .xterm 루트 자체엔 backgroundColor가 안 걸린다(투명) — 팔레트 배경은
    // xterm이 그리는 .xterm-scrollable-element에 실제로 반영된다(품질 리뷰 — DOM 실측)
    const readBackground = () =>
      window.evaluate(() => {
        const screen = document.querySelector('.terminal-dock__view .xterm-scrollable-element')
        return screen === null ? null : getComputedStyle(screen).backgroundColor
      })
    const before = await readBackground()
    // 설정 → 테마 카테고리 → 반대 테마
    const initial = await window.evaluate(() => document.documentElement.dataset.theme)
    await window.getByTestId('settings-open').click()
    await window.getByTestId('settings-cat-theme').click()
    await window
      .getByTestId(initial === 'dark' ? 'settings-theme-light' : 'settings-theme-dark')
      .click()
    await expect.poll(readBackground).not.toBe(before)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('워크트리 — 새로 만들면서 펼치기(-b)로 브랜치가 함께 생긴다 (E7d ④)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  const repoName = repo.split('/').filter(Boolean).pop()!
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-worktrees').click()
    await window.getByTestId('worktree-add').click()
    await window.getByTestId('add-worktree-mode-new').click()
    await window.getByTestId('add-worktree-new-name').fill('fresh-space')
    // 경로 제안이 새 이름을 따라간다
    await expect(window.getByTestId('add-worktree-path')).toHaveValue(
      new RegExp(`${repoName}-fresh-space$`),
    )
    await window.getByTestId('add-worktree-submit').click()
    await expect(window.getByTestId(`worktree-row-${repoName}-fresh-space`)).toContainText(
      'fresh-space',
    )
    const branches = (await execGitOrThrow(['branch', '--list', 'fresh-space'], { cwd: repo }))
      .stdout
    expect(branches).toContain('fresh-space')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(`${repo}-fresh-space`, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('터미널(외부) 커밋 후에도 보던 커밋 상세가 유지된다 (E7d ⑤)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    // 커밋 상세 열기 — 첫(유일) 커밋 클릭 (기존 관례: history-item-* 로케이터)
    // createRepoWithChange의 첫 커밋 메시지는 'init'이다 (품질 리뷰: 플랜 원문의 'e2e: 첫 저장'은
    // 다른 테스트(앱 UI 커밋 흐름)의 메시지 — 이 픽스처는 실측대로 'init'을 쓴다)
    await window.locator('[data-testid^="history-item-"]').first().click()
    await expect(window.getByTestId('commit-detail-panel')).toBeVisible()
    await expect(window.getByTestId('commit-detail-subject')).toHaveText('init')
    // 자기-이벤트 억제 창(800ms)이 지난 뒤 외부 커밋 (E7c 관례)
    await window.waitForTimeout(900)
    await execGitOrThrow(['commit', '--allow-empty', '-m', '외부 저장'], { cwd: repo })
    // 자동 갱신으로 역사에 새 커밋이 오르고 —
    await expect(window.getByTestId('history-count')).toHaveText('2', { timeout: 5_000 })
    // 보던 커밋 상세는 닫히지 않는다 (E7d ⑤: 새로고침은 최신화지 닫기가 아니다)
    await expect(window.getByTestId('commit-detail-panel')).toBeVisible()
    await expect(window.getByTestId('commit-detail-subject')).toHaveText('init')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('원격 새로고침 — 원격의 새 실험 공간이 목록에 나타난다 (E7e ①)', async () => {
  const base = await mkdtemp(join(tmpdir(), 'git-gui-e2e-remote-'))
  const remote = join(base, 'remote.git')
  const repo = join(base, 'repo')
  await execGitOrThrow(['init', '--bare', remote], { cwd: base })
  await execGitOrThrow(['clone', remote, repo], { cwd: base })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: repo })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'v1\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'init'], { cwd: repo })
  await execGitOrThrow(['push', 'origin', 'HEAD'], { cwd: repo })
  // 원격에만 있는 새 브랜치 — 이 클론은 fetch 전까지 모른다
  await execGitOrThrow(['--git-dir', remote, 'branch', 'remote-only', 'HEAD'], { cwd: repo })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  // 자동 fetch가 테스트 흐름과 경합하지 않게 끈다 — 이 테스트는 수동 버튼/흐름만 검증 (Task 6 리뷰 advisory)
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ autoFetch: false }))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-branches').click()
    await expect(window.getByTestId('branch-row-origin/remote-only')).toHaveCount(0)
    await window.getByTestId('fetch-remotes').click()
    await expect(window.getByTestId('branch-row-origin/remote-only')).toBeVisible({ timeout: 10_000 })
    await expect(window.getByTestId('fetch-at')).toContainText('방금 전')
  } finally {
    await app.close()
    await rm(base, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('재배치로 받기 — 병합 저장 없이 일직선으로 받아온다 (E7e ②)', async () => {
  const base = await mkdtemp(join(tmpdir(), 'git-gui-e2e-remote-'))
  const remote = join(base, 'remote.git')
  const repo = join(base, 'repo')
  const sibling = join(base, 'sibling')
  await execGitOrThrow(['init', '--bare', remote], { cwd: base })
  await execGitOrThrow(['clone', remote, repo], { cwd: base })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: repo })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'v1\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'init'], { cwd: repo })
  await execGitOrThrow(['push', 'origin', 'HEAD'], { cwd: repo })
  // 원격 쪽 저장(다른 클론 경유) + 로컬 쪽 저장 — 발산
  await execGitOrThrow(['clone', remote, sibling], { cwd: base })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: sibling })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: sibling })
  await writeFile(join(sibling, 'remote.txt'), 'r\n')
  await execGitOrThrow(['add', '-A'], { cwd: sibling })
  await execGitOrThrow(['commit', '-m', '원격 쪽 저장'], { cwd: sibling })
  await execGitOrThrow(['push', 'origin', 'HEAD'], { cwd: sibling })
  await writeFile(join(repo, 'local.txt'), 'l\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '내 쪽 저장'], { cwd: repo })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  // 자동 fetch가 테스트 흐름과 경합하지 않게 끈다 — 이 테스트는 수동 버튼/흐름만 검증 (Task 6 리뷰 advisory)
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ autoFetch: false }))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    // 설정 → 재배치로 받기
    await window.getByTestId('settings-open').click()
    await window.getByTestId('settings-pull-rebase').click()
    await window.getByTestId('settings-close').click()
    await window.getByTestId('pull').click()
    await expect(window.getByTestId('notice')).toContainText('일직선', { timeout: 10_000 })
    // 병합 커밋 없음 — 역사 3개(초기·원격·재배치된 내 저장)
    await expect(window.getByTestId('history-count')).toHaveText('3')
    const merges = await execGitOrThrow(['log', '--merges', '--oneline'], { cwd: repo })
    expect(merges.stdout.trim()).toBe('')
  } finally {
    await app.close()
    await rm(base, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('백업 — 연결 없는 실험 공간은 자동 연결하며 알린다 (E7e ③)', async () => {
  const base = await mkdtemp(join(tmpdir(), 'git-gui-e2e-remote-'))
  const remote = join(base, 'remote.git')
  const repo = join(base, 'repo')
  await execGitOrThrow(['init', '--bare', remote], { cwd: base })
  await execGitOrThrow(['clone', remote, repo], { cwd: base })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: repo })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'v1\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'init'], { cwd: repo })
  await execGitOrThrow(['push', 'origin', 'HEAD'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'fresh-space'], { cwd: repo })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  // 자동 fetch가 테스트 흐름과 경합하지 않게 끈다 — 이 테스트는 수동 버튼/흐름만 검증 (Task 6 리뷰 advisory)
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ autoFetch: false }))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('backup').click()
    await expect(window.getByTestId('notice')).toContainText('연결하며 백업했어요', { timeout: 10_000 })
    await window.getByTestId('left-tab-branches').click()
    // E7g: "동기화됨" 칩 대신 침묵(인라인 ↑↓ 배지가 없음)이 신호
    await expect(
      window.getByTestId('branch-row-fresh-space').locator('.branch-row__ahead, .branch-row__behind'),
    ).toHaveCount(0)
  } finally {
    await app.close()
    await rm(base, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('설정 — 받아오기 방식·자동 새로고침이 재시작 후에도 기억된다 (E7e)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const env = { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData }
  const app = await electron.launch({ args: [APP_ROOT], env })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('settings-open').click()
    await window.getByTestId('settings-pull-rebase').click()
    await window.getByTestId('settings-auto-fetch').click()
    await expect(window.getByTestId('settings-auto-fetch')).not.toBeChecked()
  } finally {
    await app.close()
  }
  const second = await electron.launch({ args: [APP_ROOT], env })
  try {
    const window = await second.firstWindow()
    await window.getByTestId('settings-open').click()
    await expect(window.getByTestId('settings-pull-rebase')).toBeChecked()
    await expect(window.getByTestId('settings-auto-fetch')).not.toBeChecked()
  } finally {
    await second.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('창 제목이 "Git GUI"다 — 한 줄 타이틀바에서도 창 전환 UI에 쓰인다 (E7f)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('refresh')).toBeVisible()
    const title = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.getTitle(),
    )
    expect(title).toBe('Git GUI')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('실험 공간 — 한 번 클릭은 선택만, 역사는 그대로다 (E7g)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'quiet-branch'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-branches').click()
    await window.getByTestId('branch-row-quiet-branch').click()
    // 선택 하이라이트만 — 조회 알약도, 메뉴도, 역사 변화도 없다
    await expect(window.getByTestId('branch-row-quiet-branch')).toHaveClass(/branch-row--selected/)
    await expect(window.getByTestId('history-view-pill')).toHaveCount(0)
    await expect(window.locator('.ui-context-menu')).toHaveCount(0)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('실험 공간 — 더블클릭 조회로 역사가 그 계보로 바뀌고 ✕로 복귀한다 (E7g)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  // 다른 계보 — side에만 있는 저장
  await execGitOrThrow(['checkout', '-b', 'side-line'], { cwd: repo })
  await writeFile(join(repo, 'side.txt'), 's\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '옆줄 저장'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  await writeFile(join(repo, 'main.txt'), 'm\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '본줄 저장'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    // 전체 그래프는 둘 다 보인다
    await expect(window.getByTestId('history-list')).toContainText('옆줄 저장')
    await expect(window.getByTestId('history-list')).toContainText('본줄 저장')
    await window.getByTestId('left-tab-branches').click()
    await window.getByTestId('branch-row-side-line').dblclick()
    // 조회 모드 — side 계보만
    await expect(window.getByTestId('history-view-pill')).toContainText('side-line')
    await expect(window.getByTestId('history-list')).toContainText('옆줄 저장')
    await expect(window.getByTestId('history-list')).not.toContainText('본줄 저장')
    await expect(window.getByTestId('branch-row-side-line')).toHaveClass(/branch-row--viewing/)
    // ✕ 복귀
    await window.getByTestId('history-view-clear').click()
    await expect(window.getByTestId('history-view-pill')).toHaveCount(0)
    await expect(window.getByTestId('history-list')).toContainText('본줄 저장')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('실험 공간 — 폴더를 접으면 하위 브랜치가 숨는다 (E7g)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'feature/login'], { cwd: repo })
  await execGitOrThrow(['branch', 'feature/signup'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-branches').click()
    await expect(window.getByTestId('branch-row-feature/login')).toBeVisible()
    await window.getByTestId('branch-folder-feature').click()
    await expect(window.getByTestId('branch-row-feature/login')).toHaveCount(0)
    await expect(window.getByTestId('branch-row-feature/signup')).toHaveCount(0)
    await window.getByTestId('branch-folder-feature').click()
    await expect(window.getByTestId('branch-row-feature/login')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E7h — 알림 배너가 좌측 탭들을 가리지도, 가려지지도 않는다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    // 알림 유발: 태그 만들기 — 기존 스위트에서 가장 값싼 notice 경로(E7g 태그 테스트 관례 재사용)
    await window.locator('[data-testid^="history-item-"]').first().click({ button: 'right' })
    await window.getByTestId('context-tag-here').click()
    await window.getByTestId('prompt-input').fill('e7h-notice')
    await window.getByTestId('prompt-submit').click()
    const notice = window.getByTestId('notice')
    await expect(notice).toContainText('태그를 만들었어요')
    // 배너 박스가 좌측 탭 구역(변경/실험 공간/워크트리)과 겹치지 않는다 — 탭 3개 모두 온전히 클릭 가능
    const noticeBox = (await notice.boundingBox())!
    const tabBox = (await window.getByTestId('left-tab-worktrees').boundingBox())!
    expect(noticeBox.x).toBeGreaterThanOrEqual(tabBox.x + tabBox.width)
    await window.getByTestId('left-tab-worktrees').click()
    await window.getByTestId('left-tab-changes').click()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E7h — 커밋 상세 파일 목록이 폴더 트리로 접힌다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['add', '.'], { cwd: repo })
  await execGitOrThrow(
    ['-c', 'user.email=e2e@test', '-c', 'user.name=E2E', 'commit', '-m', 'base'],
    { cwd: repo },
  )
  const { mkdir } = await import('node:fs/promises')
  await mkdir(join(repo, 'src/ui'), { recursive: true })
  await writeFile(join(repo, 'src/ui/deep.txt'), 'deep')
  await writeFile(join(repo, 'root.txt'), 'root')
  await execGitOrThrow(['add', '.'], { cwd: repo })
  await execGitOrThrow(
    ['-c', 'user.email=e2e@test', '-c', 'user.name=E2E', 'commit', '-m', 'tree files'],
    { cwd: repo },
  )
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.locator('[data-testid^="history-item-"]').first().click()
    await expect(window.getByTestId('commit-folder-src')).toBeVisible()
    await expect(window.getByTestId('commit-file-src/ui/deep.txt')).toBeVisible()
    await window.getByTestId('commit-folder-src').click()
    await expect(window.getByTestId('commit-file-src/ui/deep.txt')).toHaveCount(0)
    await expect(window.getByTestId('commit-file-root.txt')).toBeVisible()
    await window.getByTestId('commit-folder-src').click()
    await expect(window.getByTestId('commit-file-src/ui/deep.txt')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E7h — 앱 전체 전환 시 터미널 대상이 전환 완료 후 함께 바뀐다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'wt-side'], { cwd: repo })
  const wtPath = `${repo}-side`
  await execGitOrThrow(['worktree', 'add', '--end-of-options', wtPath, 'wt-side'], { cwd: repo })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  const sideName = wtPath.split('/').filter(Boolean).pop()!
  try {
    const window = await app.firstWindow()
    // 설정 → 워크트리 클릭 동작: 앱 전체 전환 (E7c 설정 모달 관례)
    await window.getByTestId('settings-open').click()
    await window.getByTestId('settings-worktree-switch').click()
    await window.getByTestId('settings-close').click()
    await window.getByTestId('left-tab-worktrees').click()
    await window.getByTestId(`worktree-row-${sideName}`).click()
    // 앱 전환 완료(헤더 경로 표기)까지 기다린다 — 전환이 끝난 뒤에만 아래 터미널 대상도 새 워크트리를 가리켜야 한다 (E7h ③)
    await expect(window.getByTestId('repo-path')).toContainText(sideName)
    // 도크가 닫혀 있으니 토글 후 라벨을 본다 — 이 시점의 activeWorktree는 이미 전환 완료 상태(새 세션 생성 시 그 라벨을 쓴다)
    await window.getByTestId('terminal-toggle').click()
    await expect(window.getByTestId('terminal-dock')).toContainText(sideName)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(wtPath, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('E7h — 터미널 탭이 워크트리별 묶음으로 전환·복원된다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'grp-side'], { cwd: repo })
  const wtPath = `${repo}-grp`
  await execGitOrThrow(['worktree', 'add', '--end-of-options', wtPath, 'grp-side'], { cwd: repo })
  // dockOpen 영속 격리 — 이전 터미널 테스트의 열림 상태를 물려받지 않게 (E7b 관례)
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  const sideName = wtPath.split('/').filter(Boolean).pop()!
  const repoName = repo.split('/').filter(Boolean).pop()!
  try {
    const window = await app.firstWindow()
    // 본체 그룹: 도크 열면 자동 1탭, ＋로 2탭
    await window.getByTestId('terminal-toggle').click()
    await expect(window.getByTestId('terminal-dock')).toContainText('1: 쉘')
    await window.getByTestId('terminal-new-tab').click()
    await expect(window.getByTestId('terminal-dock')).toContainText('2: 쉘')
    // 워크트리로 터미널 대상 전환(기본 설정 = 터미널만) → 그 그룹의 새 탭만 보인다
    await window.getByTestId('left-tab-worktrees').click()
    await window.getByTestId(`worktree-row-${sideName}`).click()
    await expect(window.getByTestId('terminal-dock')).toContainText(`3: ${sideName}`)
    await expect(window.getByTestId('terminal-dock')).not.toContainText('1: 쉘')
    // 본체로 복귀 → 본체 탭 2개 복원
    await window.getByTestId(`worktree-row-${repoName}`).click()
    await expect(window.getByTestId('terminal-dock')).toContainText('1: 쉘')
    await expect(window.getByTestId('terminal-dock')).toContainText('2: 쉘')
    await expect(window.getByTestId('terminal-dock')).not.toContainText(`3: ${sideName}`)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(wtPath, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('E7h — 워크트리를 지우면 그 그룹 터미널도 정리된다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'purge-side'], { cwd: repo })
  const wtPath = `${repo}-purge`
  await execGitOrThrow(['worktree', 'add', '--end-of-options', wtPath, 'purge-side'], { cwd: repo })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  const sideName = wtPath.split('/').filter(Boolean).pop()!
  const repoName = repo.split('/').filter(Boolean).pop()!
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-worktrees').click()
    await window.getByTestId(`worktree-row-${sideName}`).click() // 터미널 대상 → 그룹 탭 1개 생성
    await expect(window.getByTestId('terminal-dock')).toContainText(sideName)
    // closeGroup의 "세션 2개 정리" 실측(플랜 명시 요구) — 이 그룹에 탭을 하나 더 만든다
    await window.getByTestId('terminal-new-tab').click()
    await expect(window.locator('.terminal-dock__tab')).toHaveCount(2)
    // 본체로 대상 복귀 → groupKey가 바뀌어 본체 그룹 탭 1개가 자동 생성된다(탭바는 필터되지만
    // .terminal-dock__view는 전체 세션을 유지 — 숨은 사이드 그룹 2개 포함 총 3개가 진짜 개수)
    await window.getByTestId(`worktree-row-${repoName}`).click()
    await expect(window.locator('.terminal-dock__view')).toHaveCount(3)
    // 워크트리 지우기(우클릭 메뉴 — context-remove·confirm-accept 실측 testid)
    await window.getByTestId(`worktree-row-${sideName}`).click({ button: 'right' })
    await window.getByTestId('context-remove').click()
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId(`worktree-row-${sideName}`)).toHaveCount(0)
    // 지워진 그룹의 세션 2개가 실제로 전부 정리됐다 — 숨은 세션까지 포함한 전체 view 개수로 검증
    // (탭바 텍스트만 보면 애초에 필터돼 있어 closeGroup이 실패해도 통과해버리는 약한 단언이 된다)
    await expect(window.locator('.terminal-dock__view')).toHaveCount(1)
    await expect(window.getByTestId('terminal-dock')).not.toContainText(`: ${sideName}`)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(wtPath, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('E7h — 워크트리가 쓰는 실험 공간은 동반 삭제로 지운다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'wt-used'], { cwd: repo })
  const wtPath = `${repo}-used`
  await execGitOrThrow(['worktree', 'add', '--end-of-options', wtPath, 'wt-used'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  const sideName = wtPath.split('/').filter(Boolean).pop()!
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-branches').click()
    await window.getByTestId('branch-row-wt-used').click({ button: 'right' })
    await window.getByTestId('context-remove').click()
    await window.getByTestId('confirm-accept').click() // 1단: 지울까요?
    // 동반 삭제 확인 — 두 확인창이 겹치지 않게 순차로 뜨는 기존 관례(E3b) 전제, title 스코프로 좁혀 클릭
    const withWorktreeDialog = window.getByRole('alertdialog', {
      name: '워크트리가 이 실험 공간을 쓰는 중이에요 — 같이 지울까요?',
    })
    await expect(withWorktreeDialog).toBeVisible()
    await withWorktreeDialog.getByTestId('confirm-accept').click()
    // 워크트리·브랜치 모두 소멸
    await expect(window.getByTestId('branch-row-wt-used')).toHaveCount(0)
    await window.getByTestId('left-tab-worktrees').click()
    await expect(window.getByTestId(`worktree-row-${sideName}`)).toHaveCount(0)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(wtPath, { recursive: true, force: true }).catch(() => {})
  }
})

test('E7h ⌘F — 히스토리에서 커밋을 찾아 점프한다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'v3\n')
  await execGitOrThrow(['commit', '-am', 'second commit'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'v4\n')
  await execGitOrThrow(['commit', '-am', 'third commit'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await hoverAndCmdF(window, '[data-testid="history-panel"]')
    const findBar = window.getByTestId('find-bar')
    await expect(findBar).toBeVisible()
    await window.getByTestId('find-bar-input').fill('second commit')
    await expect(window.getByTestId('find-bar-count')).toHaveText('1/1')
    await expect(window.locator('.history-item--find-hit')).toContainText('second commit')
    await window.keyboard.press('Escape')
    await expect(findBar).toHaveCount(0)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E7h ⌘F — diff에서 단어를 찾아 하이라이트한다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('file-unstaged-app.txt').click()
    await expect(window.getByTestId('diff-panel')).toBeVisible()
    await hoverAndCmdF(window, '[data-testid="diff-panel"]')
    await window.getByTestId('find-bar-input').fill('v2')
    await expect(window.getByTestId('find-bar-count')).toHaveText('1/1')
    await expect(window.locator('.diff-row--find-hit')).toContainText('v2')
    await window.keyboard.press('Escape')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E7h ⌘F — 커밋 상세 파일 목록을 필터한다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const { mkdir } = await import('node:fs/promises')
  await mkdir(join(repo, 'src/ui'), { recursive: true })
  await writeFile(join(repo, 'src/ui/deep.txt'), 'deep')
  await writeFile(join(repo, 'root.txt'), 'root')
  await execGitOrThrow(['add', '.'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'tree files'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.locator('[data-testid^="history-item-"]').first().click()
    await expect(window.getByTestId('commit-folder-src')).toBeVisible()
    await hoverAndCmdF(window, '[data-testid="commit-detail-panel"]')
    await window.getByTestId('find-bar-input').fill('deep')
    await expect(window.getByTestId('commit-file-src/ui/deep.txt')).toBeVisible()
    await expect(window.getByTestId('commit-folder-src')).toHaveCount(0)
    await expect(window.getByTestId('commit-file-root.txt')).toHaveCount(0)
    await window.keyboard.press('Escape')
    await expect(window.getByTestId('commit-folder-src')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E7h ⌘F — 좌측 변경 목록을 필터한다', async () => {
  const repo = await createRepoWithChange()
  await writeFile(join(repo, 'second.txt'), 'x')
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('file-unstaged-app.txt')).toBeVisible()
    await expect(window.getByTestId('file-unstaged-second.txt')).toBeVisible()
    await hoverAndCmdF(window, '.changes-panel')
    await window.getByTestId('find-bar-input').fill('second')
    await expect(window.getByTestId('file-unstaged-second.txt')).toBeVisible()
    await expect(window.getByTestId('file-unstaged-app.txt')).toHaveCount(0)
    await window.keyboard.press('Escape')
    await expect(window.getByTestId('file-unstaged-app.txt')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E7h ⌘F — 마우스 위치의 패널에 열린다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await hoverAndCmdF(window, '[data-testid="history-panel"]')
    await expect(window.getByTestId('find-bar')).toHaveCount(1)
    // 히스토리 패널 안에서만 뜬다 — diff 쪽엔 없다
    await expect(
      window.locator('[data-testid="history-panel"] [data-testid="find-bar"]'),
    ).toHaveCount(1)
    await expect(
      window.locator('[data-testid="diff-panel"] [data-testid="find-bar"]'),
    ).toHaveCount(0)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E7i ⌘F — 아직 안 불러온 커밋도 검색해 점프한다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  // 초기 로드(50개)보다 깊은 곳에 표적을 심는다 — 표적 → 그 위로 60개
  await writeFile(join(repo, 'deep.txt'), 'deep\n')
  await execGitOrThrow(['add', 'deep.txt'], { cwd: repo })
  await execGitOrThrow(
    ['-c', 'user.email=e2e@test', '-c', 'user.name=E2E', 'commit', '-m', 'e7i-needle 깊은 저장'],
    { cwd: repo },
  )
  for (let i = 0; i < 60; i += 1) {
    await writeFile(join(repo, 'filler.txt'), `${i}\n`)
    await execGitOrThrow(['add', 'filler.txt'], { cwd: repo })
    await execGitOrThrow(
      ['-c', 'user.email=e2e@test', '-c', 'user.name=E2E', 'commit', '-m', `filler ${i}`],
      { cwd: repo },
    )
  }
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-panel')).toBeVisible()
    // 초기 로드 범위(50)에는 표적이 없다
    await expect(window.getByText('e7i-needle 깊은 저장')).toHaveCount(0)
    await hoverAndCmdF(window, '[data-testid="history-panel"]')
    await window.getByTestId('find-bar-input').fill('e7i-needle')
    // 전체 검색이 찾아 그 커밋까지 불러오고 점프한다
    await expect(window.getByTestId('find-bar-count')).toHaveText('1/1')
    await expect(window.locator('.history-item--find-hit')).toContainText('e7i-needle 깊은 저장')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E7i ⌘F — 카운터가 로드된 범위가 아니라 저장소 전체 기준이다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  // 같은 낱말을 60개 커밋에 심는다 — 초기 로드(50)보다 많아야 전체 기준임이 드러난다
  for (let i = 0; i < 60; i += 1) {
    await writeFile(join(repo, 'filler.txt'), `${i}\n`)
    await execGitOrThrow(['add', 'filler.txt'], { cwd: repo })
    await execGitOrThrow(
      ['-c', 'user.email=e2e@test', '-c', 'user.name=E2E', 'commit', '-m', `e7i-mark ${i}`],
      { cwd: repo },
    )
  }
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-panel')).toBeVisible()
    await hoverAndCmdF(window, '[data-testid="history-panel"]')
    await window.getByTestId('find-bar-input').fill('e7i-mark')
    // 로드된 목록은 50개지만 총계는 60 — 전체 기준
    await expect(window.getByTestId('find-bar-count')).toHaveText('1/60')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
