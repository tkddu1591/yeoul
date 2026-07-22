import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
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

test('테마를 버튼으로 전환하고 재시작해도 기억한다', async () => {
  const repo = await createRepoWithChange()
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const env = { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData }
  const app = await electron.launch({ args: [APP_ROOT], env })
  let flipped: string | undefined
  try {
    const window = await app.firstWindow()
    // firstWindow는 React 마운트 전에 반환될 수 있다 — UI가 뜬 뒤 테마를 읽는다 (실측 레이스)
    await expect(window.getByTestId('theme-toggle')).toBeVisible()
    const initial = await window.evaluate(() => document.documentElement.dataset.theme)
    expect(['light', 'dark']).toContain(initial)
    await window.getByTestId('theme-toggle').click()
    flipped = await window.evaluate(() => document.documentElement.dataset.theme)
    expect(flipped).not.toBe(initial)
  } finally {
    await app.close()
  }
  // 재시작 — 같은 userData면 선택한 테마가 초기값이 된다 (파일 영속화)
  const second = await electron.launch({ args: [APP_ROOT], env })
  try {
    const window = await second.firstWindow()
    await expect(window.getByTestId('theme-toggle')).toBeVisible()
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
    await expect(window.getByTestId('branch-row-main')).toContainText('지금 여기')
    await expect(window.getByTestId('branch-row-main')).toContainText('동기화됨')
    await expect(window.getByTestId('branch-row-feature/login')).toContainText('연결 없음')
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
    await expect(window.getByTestId('branch-row-sidework')).toContainText('지금 여기')
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
