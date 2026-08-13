import { existsSync, realpathSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cleanupScreens, electron, nextWindow } from './harness'
import { execGitOrThrow } from '@git-gui/git-process'
import { T } from '../src/renderer/src/terms'
import { MAIN_GAP } from '../src/renderer/src/ui/grid-tracks'
import { DOCK_HEIGHT_DEFAULT } from '../src/renderer/src/ui/terminal/dock-height'

// cwd에 의존하지 않도록 앱 루트를 절대 경로로 지정한다
const APP_ROOT = join(__dirname, '..')

// 실패한 테스트만 마지막 화면(last-screen-N.png)이 남는다 — harness가 close 직전마다 찍은 것을 정리
test.afterEach(async ({}, testInfo) => {
  await cleanupScreens(testInfo)
})

/**
 * 저장소 하나 + 변경 파일 하나. 파일 이름을 인자로 받는 이유는 E15a뿐이다 — 저장소 두 개를
 * 띄우고 전환하는 테스트에서 두 저장소의 파일 이름이 같으면 "화면이 정말 바뀌었나"를
 * 경로 텍스트 말고 **내용**으로 확인할 방법이 없다.
 */
async function createRepoWithFile(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'git-gui-e2e-'))
  await execGitOrThrow(['init', '--initial-branch=main'], { cwd: dir })
  // 앱이 수행하는 commit도 저장소 로컬 identity를 쓰도록 설정한다 —
  // 머신 전역 gitconfig에 의존하지 않는 hermetic 픽스처 (클린 CI에서도 동작)
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: dir })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: dir })
  await writeFile(join(dir, name), 'v1\n')
  await execGitOrThrow(['add', '-A'], { cwd: dir })
  await execGitOrThrow(['commit', '-m', 'init'], { cwd: dir })
  await writeFile(join(dir, name), 'v2\n')
  return dir
}

async function createRepoWithChange(): Promise<string> {
  return createRepoWithFile('app.txt')
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

/**
 * 대상 요소 중심에 마우스를 올리고 ⌘F를 눌러 그 스코프의 FindBar를 연다 (E7h ⑥ — hover 라우팅).
 *
 * E12 ⌘F 12% 플레이크 실측(root-cause): 앱의 스코프 판정은 hover 상태를 어딘가에 미리 저장해 두는
 * 게 아니라, keydown 시점에 pointerRef(마지막 pointermove 좌표)로 document.elementFromPoint를
 * 불러 그 자리에서 계산한다(App.tsx의 ⌘F 핸들러) — 그래서 "hover가 아직 등록 안 됐다"는 레이스는
 * 애초에 존재하지 않는다. 진짜 문제는 대상이 막 열리는 애니메이션 도중(app__right-detail의
 * grid-template-rows 240ms 전환, E11)일 때다 — boundingBox()가 프레임마다 다른 값을 주므로, 계산한
 * 좌표로 마우스를 옮기고 곧장 키를 누르면 그 지점이 아직 대상 밖(레이아웃이 덜 자란 자리)일 수
 * 있다. 그러면 App.tsx의 elementFromPoint가 data-find-scope를 못 찾아 'diff'로 폴백하는데, 이
 * testId('commit-detail-panel') 테스트는 diff에 선택된 파일이 없어 FindBar가 어디에도 안 뜬다
 * (실측: 40회 중 3회, 실패마다 scope=diff/scopeElClass=null로 재현 — 통과한 회차들도 y좌표가
 * 730~769 사이를 계속 오갔다(애니메이션 진행 중 샘플링됐다는 증거). 애니메이션이 안 걸리는 나머지
 * hoverAndCmdF 호출부(history/diff/changes 패널)는 이 레이스가 안 걸려 플레이크가 이 테스트에만
 * 몰렸던 것과도 일치한다).
 *
 * 고정 sleep은 레이스를 드물게만 만들 뿐이라(플랜 지시) 쓰지 않는다 — 대신 "그 좌표의 실제 요소가
 * 대상 selector 안에 들어와 있다"는 조건 자체를 만족할 때까지 기다린 뒤에만 키를 누른다.
 */
async function hoverAndCmdF(window: Page, selector: string): Promise<void> {
  const locator = window.locator(selector)
  let point = { x: 0, y: 0 }
  await expect(async () => {
    const box = (await locator.boundingBox())!
    point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await window.mouse.move(point.x, point.y)
    const landedInside = await window.evaluate(
      ({ x, y, sel }) => document.elementFromPoint(x, y)?.closest(sel) != null,
      { x: point.x, y: point.y, sel: selector },
    )
    expect(landedInside).toBe(true)
  }).toPass({ timeout: 2000 })
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
        await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]!.isVisible()),
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
      '비워 두면: app.txt 수정',
    )
    // E9 — commit-hint(왼쪽 슬롯)는 이제 항상 무언가를 말한다. 지금 상태(1개 스테이지·메시지
    // 비움·제안 있음)는 누를 수 있는 상태라 "몇 개 파일"을 커밋하는지를 보여준다.
    await expect(window.getByTestId('commit-hint')).toHaveText('1개 파일')
    await expect(window.getByTestId('commit-button')).toBeEnabled()

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
    await expect(window.getByTestId('diff-panel')).toContainText(T.commit)
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
    await app.evaluate(({ BaseWindow }) => {
      BaseWindow.getAllWindows()[0]!.setSize(960, 800)
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
    await expect(window.getByTestId('notice')).toContainText(T.stash)
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
    await expect(window.getByTestId(`history-item-${rootHash}`)).toContainText(T.head)
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
    await expect(window.getByTestId('commit-detail-panel')).toContainText(`${T.stash} 내용`)
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
    await expect(window.getByTestId('merge-bar')).toContainText(`${T.conflict} 1개 남음`)
    await window.getByTestId('file-unstaged-app.txt').click()
    await expect(window.getByTestId('conflict-view')).toContainText('rival')
    await window.getByTestId('conflict-theirs').click()
    // 해소 — 머지 바 0개, staged로 이동
    await expect(window.getByTestId('merge-bar')).toContainText(`${T.conflict} 0개 남음`)
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
    await expect(window.getByTestId('merge-bar')).toContainText(`${T.conflict} 1개 남음`)
    await window.getByTestId('file-unstaged-app.txt').click()
    await window.getByTestId('conflict-ours').click()
    // 전량 내 것 — 변경 0개지만 병합 커밋으로 마무리할 수 있어야 한다 (데드엔드 방지)
    await expect(window.getByTestId('merge-bar')).toContainText(`${T.conflict} 0개 남음`)
    await expect(window.getByTestId('commit-button')).toContainText(`${T.merge} 마무리`)
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
    await expect(window.getByTestId('notice')).toContainText(T.stash)
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
    await expect(window.getByTestId('notice')).toContainText('가져왔어요')
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
    await expect(window.getByTestId('notice')).toContainText(`되돌리는 새 ${T.commit}`)
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
    await expect(window.getByTestId('merge-bar')).toContainText(`${T.commit} 되돌리는 중`)
    // 전부 내 것을 유지하면 바뀌는 내용이 없다 — 저장하기 대신 취소로 마무리하도록 안내한다
    await window.getByTestId('file-unstaged-app.txt').click()
    await window.getByTestId('conflict-ours').click()
    await expect(window.getByTestId('merge-bar')).toContainText(`${T.revert} 취소를 눌러 마무리해요`)
    // 되돌리는 중에는 우클릭 되돌리기가 비활성 — 이중 실행을 막는다 (통합 리뷰)
    await window.locator('[data-testid^="history-item-"]').first().click({ button: 'right' })
    await expect(window.getByTestId('context-revert')).toBeDisabled()
    await window.keyboard.press('Escape')
    await window.getByTestId('merge-abort').click()
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId('merge-bar')).toHaveCount(0)
    await expect(window.getByTestId('notice')).toContainText(`${T.revert}를 취소`)
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
    await expect(window.getByText(`아직 ${T.merge}되지 않은 ${T.commit}이 있어요`)).toBeVisible()
    // 강제 확인창으로 이름 스코프해 클릭 — 퇴장 즉시화(E3b) 이후에도 견고하다
    await window
      .getByRole('alertdialog', { name: `아직 ${T.merge}되지 않은 ${T.commit}이 있어요` })
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
    await expect(window.getByTestId('merge-bar')).toContainText(`${T.conflict} 1개 남음`)
    await window.getByTestId('file-unstaged-app.txt').click()
    await expect(window.getByTestId('conflict-progress')).toHaveText(`${T.conflict} 2곳 중 1번째`)
    // 1번째 겹침은 내 것 — 반영되면 남은 블록이 파일 기준 다시 0번이 된다
    await window.getByTestId('conflict-block-ours-0').click()
    await expect(window.getByTestId('conflict-progress')).toHaveText(`${T.conflict} 2곳 중 2번째`)
    await window.getByTestId('conflict-block-theirs-0').click()
    await expect(window.getByTestId('conflict-progress')).toHaveText('모두 골랐어요')
    // 확정 전에는 여전히 겹침(unmerged) 파일이다 — add는 확정 버튼에서만
    await expect(window.getByTestId('merge-bar')).toContainText(`${T.conflict} 1개 남음`)
    await window.getByTestId('conflict-confirm').click()
    await expect(window.getByTestId('merge-bar')).toContainText(`${T.conflict} 0개 남음`)
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
    await expect(window.getByTestId('conflict-progress')).toHaveText(`${T.conflict} 2곳 중 2번째`)
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
    await expect(window.getByTestId('conflict-progress')).toHaveText(`${T.conflict} 2곳 중 2번째`)
  } finally {
    await app.close()
  }
  // 재실행 — 선택은 파일에, 합치는 중 상태는 MERGE_HEAD에 있어 그대로 복원된다 (스펙 §7 공통 원칙)
  const second = await electron.launch({ args: [APP_ROOT], env })
  try {
    const window = await second.firstWindow()
    await expect(window.getByTestId('merge-bar')).toContainText(`${T.conflict} 1개 남음`)
    await window.getByTestId('file-unstaged-app.txt').click()
    // 남은 블록 1개부터 이어서 — 앞서 고른 mine-top은 일반 줄로 남아 있다
    await expect(window.getByTestId('conflict-progress')).toHaveText(`${T.conflict} 1곳 중 1번째`)
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
    await expect(window.getByTestId('conflict-progress')).toHaveText(`${T.conflict} 2곳 중 2번째`)
    await window.getByTestId('conflict-reset').click()
    await window.getByTestId('confirm-accept').click()
    // 마커 재생성(실측: 라벨은 ours/theirs) — 카드 2개와 진행 표시가 처음으로 돌아온다
    await expect(window.getByTestId('conflict-progress')).toHaveText(`${T.conflict} 2곳 중 1번째`)
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
    await expect(window.getByRole('alertdialog')).toContainText(`${T.stash}에 넣어 드려요`)
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId('notice')).toContainText(`${T.staged}에 올려뒀어요`)
    await expect(window.getByTestId('notice')).toContainText(T.stash)
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
    await expect(window.getByTestId(`history-item-${mainHash}`)).toContainText(T.head)
    await expect(window.getByTestId(`history-item-${otherHash}`)).not.toContainText(T.head)
    // 전환하면 마커가 따라온다 — 목록은 그대로 전체
    await window.getByTestId('header-branch').click()
    await window.getByTestId('branch-item-other').click()
    await expect(window.getByTestId('header-branch')).toContainText('other')
    await expect(window.getByTestId('history-count')).toHaveText('2')
    await expect(window.getByTestId(`history-item-${otherHash}`)).toContainText(T.head)
    await expect(window.getByTestId(`history-item-${mainHash}`)).not.toContainText(T.head)
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
    await expect(window.getByTestId('notice')).toContainText(`${T.cherryPick}해 새 ${T.commit}을 만들었어요`)
    await expect(window.getByTestId('history-count')).toHaveText('5')
    expect(await readFile(join(repo, 'feature.txt'), 'utf8')).toBe('f\n')
    // (2) 겹치는 가져오기 — cherry-picking 상태 바가 뜨고 취소로 돌아온다
    await window.getByTestId(`history-item-${rivalHash}`).click({ button: 'right' })
    await window.getByTestId('context-cherry-pick').click()
    await expect(window.getByTestId('merge-bar')).toContainText(`${T.cherryPick}하는 중`)
    await expect(window.getByTestId('merge-abort')).toHaveText(`${T.cherryPick} 취소`)
    await window.getByTestId('merge-abort').click()
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId('merge-bar')).toHaveCount(0)
    await expect(window.getByTestId('notice')).toContainText(`${T.cherryPick}을 취소`)
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
    await expect(window.getByTestId('notice')).toContainText(`${T.tag}를 만들었어요`)
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
    await expect(window.getByTestId('notice')).toContainText(`${T.tag}를 만들었어요`)
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
    await expect(window.getByTestId('branch-row-main')).toHaveAttribute('data-tooltip', new RegExp(T.head))
    await expect(
      window.getByTestId('branch-row-main').locator('.branch-row__ahead, .branch-row__behind'),
    ).toHaveCount(0)
    await expect(window.getByTestId('branch-row-feature/login')).toHaveAttribute(
      'data-tooltip',
      new RegExp(`아직 ${T.noUpstream}`),
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
    await expect(window.getByTestId('branch-row-sidework')).toHaveAttribute('data-tooltip', new RegExp(T.head))
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
    await window.getByRole('button', { name: T.rebase }).click()
    // 충돌 — 4겸용 상태 바 + 진행 표시(실측 2: msgnum/end)
    await expect(window.getByTestId('merge-bar')).toContainText(`${T.commit} ${T.rebase} 중 (1개 중 1번째)`)
    // 변경 탭의 ! 파일에서 해결 — rebase 라벨 반전(초록=새 기반, 보라=재배치 중인 내 저장)
    await window.getByTestId('left-tab-changes').click()
    await window.getByTestId('file-unstaged-app.txt').click()
    await expect(window.getByTestId('conflict-panel')).toBeVisible()
    await expect(window.getByTestId('conflict-ours')).toContainText('새 기반 유지')
    await window.getByTestId('conflict-theirs').click()
    await expect(window.getByTestId('merge-bar')).toContainText(`${T.conflict} 0개 남음`)
    await window.getByTestId('rebase-continue').click()
    await expect(window.getByTestId('notice')).toContainText(`${T.rebase}를 마쳤어요`)
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
    await expect(window.getByTestId('branch-row-incoming')).toHaveAttribute('data-tooltip', new RegExp(T.head))
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
    await expect(window.getByRole('alertdialog')).toContainText(`${T.commit} 안 된 변경이 있어요`)
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
    await expect(window.getByTestId('notice')).toContainText(`연결하며 ${T.push}했어요`, { timeout: 10_000 })
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
    const title = await app.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows()[0]?.getTitle(),
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
    await expect(notice).toContainText(`${T.tag}를 만들었어요`)
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
    // 본체 그룹: 도크 열면 자동 1탭, ＋로 2탭 — E12: 탭 번호는 그룹 안에서만 매기고
    // 워크트리 이름은 탭이 아니라 헤더 힌트(.terminal-dock__hint)로 옮겨갔다
    await window.getByTestId('terminal-toggle').click()
    await expect(window.locator('.terminal-dock__tab-name')).toHaveCount(1)
    await expect(window.locator('.terminal-dock__tab-name').first()).toHaveText('1')
    await window.getByTestId('terminal-new-tab').click()
    await expect(window.locator('.terminal-dock__tab-name')).toHaveCount(2)
    await expect(window.locator('.terminal-dock__tab-name').nth(1)).toHaveText('2')
    // 워크트리로 터미널 대상 전환(기본 설정 = 터미널만) → 그 그룹의 새 탭만 보인다 — 번호는
    // 이 그룹 안에서 다시 1부터(전역 카운터였다면 3이 됐을 자리)
    await window.getByTestId('left-tab-worktrees').click()
    await window.getByTestId(`worktree-row-${sideName}`).click()
    await expect(window.locator('.terminal-dock__tab-name')).toHaveCount(1)
    await expect(window.locator('.terminal-dock__tab-name').first()).toHaveText('1')
    await expect(window.locator('.terminal-dock__hint')).toContainText(sideName)
    // 본체로 복귀 → 본체 탭 2개 복원, 번호도 그대로
    await window.getByTestId(`worktree-row-${repoName}`).click()
    await expect(window.locator('.terminal-dock__tab-name')).toHaveCount(2)
    await expect(window.locator('.terminal-dock__tab-name').first()).toHaveText('1')
    await expect(window.locator('.terminal-dock__tab-name').nth(1)).toHaveText('2')
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
      name: `${T.worktree}가 이 ${T.branch}를 쓰는 중이에요 — 같이 지울까요?`,
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

test('E7j — 같은 이름 워크트리가 출처·이름으로 구분된다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'wt-one'], { cwd: repo })
  await execGitOrThrow(['branch', 'wt-two'], { cwd: repo })
  // 같은 리프 이름을 서로 다른 부모 아래에 만든다(codex·claude 구조 재현)
  const base = dirname(repo)
  const leaf = basename(repo)
  const oneParent = join(base, 'holder-one')
  const twoParent = join(base, 'holder-two')
  await execGitOrThrow(['worktree', 'add', '--end-of-options', join(oneParent, leaf), 'wt-one'], { cwd: repo })
  await execGitOrThrow(['worktree', 'add', '--end-of-options', join(twoParent, leaf), 'wt-two'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-worktrees').click()
    // 브랜치가 1줄 주 식별자로 보이고, 2줄 이름이 부모까지 붙어 구분된다
    await expect(window.getByText('wt-one')).toBeVisible()
    await expect(window.getByText('wt-two')).toBeVisible()
    await expect(window.getByText(`holder-one/${leaf}`)).toBeVisible()
    await expect(window.getByText(`holder-two/${leaf}`)).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(oneParent, { recursive: true, force: true })
    await rm(twoParent, { recursive: true, force: true })
  }
})

test('E7j — 워크트리에 호버하면 전체 경로가 잘림 없이 보인다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-worktrees').click()
    const row = window.getByTestId(`worktree-row-${basename(repo)}`)
    // macOS: git이 보고하는 워크트리 경로는 실경로(/private/var/...)다 — repo(/var/...)는 심볼릭 링크를
    // 거친 경로라 그대로 비교하면 접두가 어긋난다(1667행과 동일 사유). realpath로 맞춰 비교한다
    const realRepo = realpathSync(repo)
    await expect(row).toHaveAttribute('data-tooltip', realRepo)
    await row.hover()
    const tip = window.getByTestId('tooltip')
    await expect(tip).toBeVisible()
    await expect(tip).toContainText(realRepo)
    await window.keyboard.press('Escape')
    await expect(tip).toHaveCount(0)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E7k — 좁은 창에서도 앱이 가로로 스크롤되지 않는다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  // 긴 브랜치 이름이 방아쇠였다 — 그 상태로도 넘치지 않아야 한다
  await execGitOrThrow(
    ['checkout', '-q', '-b', 'feature/DW-1051-very-long-branch-name-for-header-overflow'],
    { cwd: repo },
  )
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-panel')).toBeVisible()
    for (const width of [1200, 970]) {
      await window.setViewportSize({ width, height: 800 })
      // `.app { overflow: hidden }` 때문에 documentElement.scrollWidth는 항상 clientWidth와 같다 —
      // 잘려도 통과하는 공허한 단언이 된다(리뷰 실측). 헤더 자체의 넘침과 마지막 버튼의
      // 화면 안 여부로 본다 (E7k 보완)
      const box = await window.evaluate(() => {
        const header = document.querySelector('.app__header') as HTMLElement
        const settings = document.querySelector('[data-testid="settings-open"]') as HTMLElement
        return {
          headerScrollW: header.scrollWidth,
          headerClientW: header.clientWidth,
          settingsRight: Math.round(settings.getBoundingClientRect().right),
          innerW: window.innerWidth,
          repoW: Math.round(
            (document.querySelector('.app__repo') as HTMLElement).getBoundingClientRect().width,
          ),
        }
      })
      expect(box.headerScrollW).toBeLessThanOrEqual(box.headerClientW)
      expect(box.settingsRight).toBeLessThanOrEqual(box.innerW)
      expect(box.repoW).toBeGreaterThan(0)
    }
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E7k — 좁은 창에서는 헤더 라벨이 접히고 버튼은 계속 눌린다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  // 터미널 토글은 dockOpen을 settings.json에 영속한다(1533행 E7b 선례와 동일 사유) — 격리된
  // userData가 없으면 이전 터미널 테스트가 남긴 열림 상태를 물려받아 이번 클릭이 반대로
  // 닫아버린다 (실측: 전체 스위트·단독 재실행 모두에서 재현되는 결정적 실패 — E7k 편차 보정)
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-panel')).toBeVisible()
    await window.setViewportSize({ width: 1400, height: 800 })
    await expect(window.getByTestId('pull').locator('.app__btn-label')).toBeVisible()
    await window.setViewportSize({ width: 970, height: 800 })
    await expect(window.getByTestId('pull').locator('.app__btn-label')).toBeHidden()
    // 접힌 상태에서도 아이콘 버튼은 그대로 동작한다(터미널 도크 토글로 확인)
    await window.getByTestId('terminal-toggle').click()
    await expect(window.getByTestId('terminal-dock')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E7k — 분리됨 워크트리 카드에 제목·시각·포함 브랜치가 뜬다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'holder'], { cwd: repo })
  const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
  const wtPath = `${repo}-detached`
  await execGitOrThrow(['worktree', 'add', '--detach', '--end-of-options', wtPath, head], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-worktrees').click()
    const row = window.getByTestId(`worktree-row-${wtPath.split('/').pop()}`)
    await row.hover()
    const tip = window.getByTestId('tooltip')
    await expect(tip).toBeVisible()
    // 제목(첫 저장 메시지)·포함 브랜치가 카드에 있다
    await expect(tip).toContainText('holder')
    await expect(tip).toContainText(`에 포함된 ${T.commit}`)
    // E7k 보완 — 분리 HEAD 자신이 (no branch) 유령으로 섞이지 않는다(회귀 방지)
    await expect(tip).not.toContainText('(no branch)')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(wtPath, { recursive: true, force: true }).catch(() => {})
  }
})

/** 여러 파일을 만들고 그중 일부만 올린(staged) 저장소 — 목록 길이 비대칭 재현용 (E8) */
async function createRepoWithManyChanges(total: number, stagedCount: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'git-gui-e2e-'))
  await execGitOrThrow(['init', '--initial-branch=main'], { cwd: dir })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: dir })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: dir })
  for (let i = 0; i < total; i += 1) {
    await writeFile(join(dir, `file-${i}.txt`), 'v1\n')
  }
  await execGitOrThrow(['add', '-A'], { cwd: dir })
  await execGitOrThrow(['commit', '-m', 'init'], { cwd: dir })
  for (let i = 0; i < total; i += 1) {
    await writeFile(join(dir, `file-${i}.txt`), 'v2\n')
  }
  const stagedFiles = Array.from({ length: stagedCount }, (_, i) => `file-${i}.txt`)
  if (stagedFiles.length > 0) {
    await execGitOrThrow(['add', '--', ...stagedFiles], { cwd: dir })
  }
  return dir
}

test('E8 — 커밋 버튼은 스테이지가 비면 사유와 함께 비활성이다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: await mkdtemp(join(tmpdir(), 'gg-ud-')) },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('commit-button')).toBeDisabled()
    await expect(window.getByTestId('commit-hint')).toContainText('올린 파일이 없어요')
    await window.getByTestId('check-unstaged-app.txt').click()
    await window.getByTestId('stage-selected').click()
    await expect(window.getByTestId('commit-button')).toBeEnabled()
    // E9 — 버튼에 ⌘↵ 단축키 힌트(kbd)가 라벨 옆에 붙는다
    await expect(window.getByTestId('commit-button')).toHaveText(`${T.commit}⌘↵`)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E8 — 화면에 영문 개념 배지가 남아 있지 않다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-panel')).toBeVisible()
    const words = [
      'unstaged',
      'staged',
      'commit',
      'log',
      'merge',
      'pull',
      'push',
      'stash',
      'branch',
      'worktree',
      'diff',
      'conflict',
      'PR',
    ]
    for (const word of words) {
      await expect(window.locator('.ui-badge', { hasText: new RegExp(`^${word}$`) })).toHaveCount(0)
    }
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E8 — 변경이 없으면 목록이 빈 상자로 자리를 먹지 않는다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-panel')).toBeVisible()
    // E8 — 내용 기반 크기는 .changes-panel 자신(flex:1, 열 전체를 채우는 확정 높이)이 아니라
    // 그 안의 두 카드(.ui-panel)가 flex:0 1 auto로 담당한다 (changes-panel.css 실측)
    const heights = await window.evaluate(() =>
      Array.from(document.querySelectorAll('.app__left-inner > .changes-panel .ui-panel')).map(
        (el) => (el as HTMLElement).getBoundingClientRect().height,
      ),
    )
    expect(heights.length).toBe(2)
    // 두 카드 모두 flex:0 1 auto — 빈 문구 하나만큼만 차지한다(E8 마무리: flex-grow:1 삭제).
    // 예전에는 두 카드 모두 flex:1이라 빈 목록도 컨테이너 절반을 억지로 차지했고,
    // 그 다음엔 마지막 카드만 flex-grow:1로 남는 공간을 흡수해 430px까지 늘어났다 —
    // 둘 다 회귀다(실측 회귀 방지)
    expect(heights[0]).toBeLessThan(200)
    expect(heights[1]).toBeLessThan(200)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E8 — 목록 길이가 크게 다를 때 짧은 쪽 카드가 눌려 사라지지 않는다', async () => {
  const repo = await createRepoWithManyChanges(30, 2)
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: await mkdtemp(join(tmpdir(), 'gg-ud-')) },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-panel')).toBeVisible()
    // 스테이지 패널 제목·개수 배지가 보인다 — 0 높이로 눌리면 h2/배지 자체가 attached여도 안 보인다
    await expect(window.getByRole('heading', { name: T.staged })).toBeVisible()
    await expect(window.getByTestId('staged-count')).toBeVisible()
    await expect(window.getByTestId('staged-count')).toHaveText('2')
    // 짧은 쪽(스테이지) 행이 실제로 그려진다 — 가상 스크롤 clientHeight 0이면 attached라도 행이 없다
    await expect(window.getByTestId('file-staged-file-0.txt')).toBeVisible()
    const box = await window.evaluate(() => {
      const container = document.querySelector('.changes-panel') as HTMLElement
      const panels = Array.from(document.querySelectorAll('.app__left-inner > .changes-panel .ui-panel')) as HTMLElement[]
      return {
        containerHeight: container.getBoundingClientRect().height,
        panelHeights: panels.map((p) => p.getBoundingClientRect().height),
      }
    })
    expect(box.panelHeights.length).toBe(2)
    for (const h of box.panelHeights) {
      expect(h).toBeLessThanOrEqual(box.containerHeight * 0.7 + 1)
    }
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E9 — ⌘↵로 커밋된다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: await mkdtemp(join(tmpdir(), 'gg-ud-')) },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('check-unstaged-app.txt').click()
    await window.getByTestId('stage-selected').click()
    await expect(window.getByTestId('staged-count')).toHaveText('1')
    await window.getByTestId('commit-message').fill('e2e: 단축키 커밋')
    await window.getByTestId('commit-message').press('ControlOrMeta+Enter')
    await expect(window.getByTestId('staged-count')).toHaveText('0')
    const log = await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: repo })
    expect(log.stdout.trim()).toBe('e2e: 단축키 커밋')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E9 — 커밋 불가 상태에서는 ⌘↵가 무시된다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: await mkdtemp(join(tmpdir(), 'gg-ud-')) },
  })
  try {
    const window = await app.firstWindow()
    // 아무것도 스테이지하지 않은 채 메시지만 채운다 — 버튼도 비활성이어야 한다
    await window.getByTestId('commit-message').fill('e2e: 눌리면 안 되는 커밋')
    await expect(window.getByTestId('commit-button')).toBeDisabled()
    await window.getByTestId('commit-message').press('ControlOrMeta+Enter')
    // "아무 일도 안 일어남"을 시간 대기가 아니라 git 상태로 증명한다 —
    // createRepoWithChange()의 최초 커밋 제목('init')이 그대로인지 확인
    const log = await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: repo })
    expect(log.stdout.trim()).toBe('init')
    const count = await execGitOrThrow(['log', '--oneline'], { cwd: repo })
    expect(count.stdout.trim().split('\n')).toHaveLength(1)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E9 — 왼쪽 슬롯이 항상 상태를 말한다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: await mkdtemp(join(tmpdir(), 'gg-ud-')) },
  })
  try {
    const window = await app.firstWindow()
    // ① 아무것도 스테이지하지 않은 상태
    await expect(window.getByTestId('commit-hint')).toContainText('올린 파일이 없어요')
    // ② 1개 스테이지 후 — E8에서는 이 자리가 빈 문자열이라 높이 0이었다.
    // 정확 문구 + 가시성을 함께 걸어 그 회귀를 잡는다
    await window.getByTestId('check-unstaged-app.txt').click()
    await window.getByTestId('stage-selected').click()
    await expect(window.getByTestId('staged-count')).toHaveText('1')
    await expect(window.getByTestId('commit-hint')).toHaveText('1개 파일')
    await expect(window.getByTestId('commit-hint')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E9 — 한글 조합 중 ⌘↵는 커밋하지 않는다 (IME 가드)', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: await mkdtemp(join(tmpdir(), 'gg-ud-')) },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('check-unstaged-app.txt').click()
    await window.getByTestId('stage-selected').click()
    await expect(window.getByTestId('staged-count')).toHaveText('1')

    // CDP Input.imeSetComposition으로 진짜 조합 상태를 만든다 — 이러면 keydown의
    // event.isComposing이 실제 한글 입력과 똑같이 true가 된다(컨트롤러 실측으로 확인).
    // 이 경로가 없다고 판단해 E9는 이 가드를 런타임 미검증으로 남겼었다
    const cdp = await window.context().newCDPSession(window)
    await window.getByTestId('commit-message').click()
    await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 })

    // 키가 정말 도달했는지까지 확인한다 — 이게 없으면 "커밋이 안 됐다"가 가드 덕분인지
    // 키가 안 온 탓인지 구분할 수 없어 단언이 공허해진다 (실측으로 겪은 함정)
    const seen: Array<{ key: string; isComposing: boolean }> = []
    await window.exposeFunction('__recordKey', (entry: { key: string; isComposing: boolean }) => {
      seen.push(entry)
    })
    await window.evaluate(() => {
      const el = document.querySelector<HTMLTextAreaElement>('[data-testid="commit-message"]')
      el?.addEventListener('keydown', (event) => {
        void (window as unknown as { __recordKey(e: unknown): void }).__recordKey({
          key: event.key,
          isComposing: event.isComposing,
        })
      })
    })

    await window.getByTestId('commit-message').press('ControlOrMeta+Enter')
    await expect(window.getByTestId('staged-count')).toHaveText('1')
    expect(seen).toContainEqual({ key: 'Enter', isComposing: true })

    // 조합 중 커밋이 새면 미완성 자모("한")가 커밋 메시지로 박힌다 — 개수로 확인
    const log = await execGitOrThrow(['log', '--oneline'], { cwd: repo })
    expect(log.stdout.trim().split('\n')).toHaveLength(1)

    // 확정 후에는 정상 커밋된다
    await window.getByTestId('commit-message').fill('조합 확정 후 커밋')
    await window.getByTestId('commit-message').press('ControlOrMeta+Enter')
    await expect(window.getByTestId('staged-count')).toHaveText('0')
    const after = await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: repo })
    expect(after.stdout.trim()).toBe('조합 확정 후 커밋')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E10 — 억제 창 안에서 연속된 외부 변경 두 건이 모두 반영된다 (Task 2-보완)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-count')).toHaveText('1')

    // 첫 외부 변경 — 읽기 전용 재조회(externalRefresh)가 반영한다
    await execGitOrThrow(['commit', '--allow-empty', '-m', 'E10 외부 변경 1'], { cwd: repo })
    await expect(window.getByTestId('history-count')).toHaveText('2', { timeout: 5_000 })

    // 첫 재조회가 화면에 반영된 직후 — 억제 창(WATCH_SUPPRESS_MS=800, E7b) 안에 두 번째 외부
    // 변경을 밀어넣는 의도된 타이밍이다. 읽기 전용 재조회가 억제를 걸면(버그) 이 변경은 조용히
    // 삼켜져 화면이 영영 갱신되지 않는다 — 사용자가 에디터로 연달아 저장하는 실제 패턴 (E10 Task 2-보완)
    await execGitOrThrow(['commit', '--allow-empty', '-m', 'E10 외부 변경 2'], { cwd: repo })
    await expect(window.getByTestId('history-count')).toHaveText('3', { timeout: 5_000 })
    await expect(window.getByTestId('history-list')).toContainText('E10 외부 변경 2')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E10 — 앱 밖에서 만든 파일이 새로고침 없이 나타난다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    // 목록이 정착할 때까지 — 이 시점엔 되돌린 app.txt뿐이라 바뀐 파일이 없다
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')

    // 앱 API를 거치지 않고 저장소 밖에서 새 파일을 만든다 — 에디터·다른 프로그램이 만드는 상황
    await writeFile(join(repo, 'external.txt'), '앱 밖에서 생성\n')

    // 새로고침 버튼을 누르지 않는다 — 워킹트리 감시(E10)가 스스로 반영해야 한다
    await expect(window.getByTestId('file-unstaged-external.txt')).toBeVisible({ timeout: 5_000 })
    await expect(window.getByTestId('unstaged-count')).toHaveText('1')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E10 — 앱 밖에서 지운 파일이 새로고침 없이 사라진다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  // 앱이 뜨기 전에 만든 미추적 파일 — 초기 조회가 이미 잡은 상태에서 시작한다
  await writeFile(join(repo, 'external.txt'), '앱 밖에서 생성\n')
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('file-unstaged-external.txt')).toBeVisible()
    await expect(window.getByTestId('unstaged-count')).toHaveText('1')

    // 앱 API를 거치지 않고 저장소 밖에서 지운다 — 한 번도 추적된 적 없어 git엔 흔적이 안 남는다
    await rm(join(repo, 'external.txt'))

    await expect(window.getByTestId('file-unstaged-external.txt')).toHaveCount(0, {
      timeout: 5_000,
    })
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E10 — 앱 밖에서 되돌린 수정이 새로고침 없이 사라진다', async () => {
  // createRepoWithChange가 app.txt를 v1 → v2로 고쳐 두어, 시작부터 추적 파일의 unstaged 수정이 있다
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('file-unstaged-app.txt')).toBeVisible()
    await expect(window.getByTestId('unstaged-count')).toHaveText('1')

    // 앱 API를 거치지 않고 에디터의 '실행 취소'처럼 파일 내용만 원래대로 되돌린다.
    // git checkout --는 .git/index도 함께 갱신해 .git 감시자가 대신 잡아버리므로(실측) 이
    // 테스트의 검출력이 사라진다 — 순수 워킹트리 쓰기(createRepoWithChange의 v1)로 재현한다
    await writeFile(join(repo, 'app.txt'), 'v1\n')

    await expect(window.getByTestId('file-unstaged-app.txt')).toHaveCount(0, { timeout: 5_000 })
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

/**
 * E10 Task 3(창 복귀 재조회)의 검증 공백을 메운다.
 *
 * E12 이전에는 GIT_GUI_E2E_SHOW=1로 실제(비가상) 창을 띄우고 blur()/focus()로 진짜 OS 포커스
 * 전이를 만들어 main/index.ts의 'focus' 리스너를 발화시켰다. 그런데 이 방식은 이 테스트가
 * 검증해야 할 계약(우리 코드: "창이 focus 이벤트를 받으면 렌더러가 재조회한다")과 무관한
 * 전제 — "OS가 실제로 우리 창에 포커스를 준다" — 에 기대고 있었다. 그 전제는 머신에 다른
 * Electron 창(이 저장소의 다른 워커, 또는 사용자의 개발 앱)이 있으면 깨진다: OS 포커스는
 * 창들끼리 경합하는 유한 자원이라, 우리 blur()/focus() 호출이 상대 창에 밀려 씹히면 'focus'
 * 리스너가 아예 발화하지 않는다. E11 병합 직후 실제로 한 번 이렇게 실패했다(2-워커 병렬
 * 실행에서 5초 타임아웃) — E11의 toPass 재시도는 그 증상을 흡수하는 완화였을 뿐, "다른 창이
 * 있으면 흔들린다"는 근본 원인은 그대로 남아 있었다.
 *
 * E12: 자극(stimulus)을 바꿔 이 결함을 근본에서 없앤다. Electron의 BaseWindow는 표준
 * EventEmitter이고, main/index.ts:66의 `window.on('focus', …)`는 그 EventEmitter에 등록된
 * 보통의 JS 리스너다(OS가 네이티브 포커스를 감지했을 때 Electron 바인딩이 내부적으로 같은
 * `emit('focus')`를 호출해 도달하는 지점과 동일한 지점). app.evaluate로 메인 프로세스에서
 * 그 창 인스턴스에 직접 `emit('focus')`를 불러 이 리스너를 발화시키면 — 실제 OS 포커스
 * 전이 없이도, 다른 창과의 경합 없이도 — "focus 이벤트를 받으면 재조회한다"는 우리 계약만
 * 결정적으로 검증한다. 창은 이제 실제로 보일 필요가 없으므로 GIT_GUI_E2E_SHOW를 뺀다.
 * (검증: 이 접근을 쓰기 전 emit이 정말 이 리스너에 닿는지 직접 실행해 확인했다 — 아래 함수 보고 참고)
 *
 * 이 방식이 못 잡는 것 — "OS가 실제로 네이티브 포커스 이벤트를 Electron에 전달하고,
 * Electron이 그걸 JS 'focus' 이벤트로 통역하는" 파이프라인 자체의 회귀. 하지만 그건 우리
 * 코드가 아니라 Electron의 책임이다(플랜 근거). 이 앱에는 창이 하나뿐이라 "리스너가 엉뚱한
 * 창 인스턴스에 걸려 있다"는 종류의 버그도 이 emit이 그대로 잡아낸다(BaseWindow.getAllWindows()[0]
 * 이 바로 그 창이므로).
 *
 * 재조회 호출 자체는 렌더러에서 셀 수 없다 — contextBridge가 노출 객체를 deep-freeze한다
 * (재실측: Object.isFrozen(gitApi.repo) === true · window.gitApi는 writable:false·
 * configurable:false라 통째 교체도 defineProperty도 "Cannot redefine property"로 막힌다).
 * 예전엔 그래서 "새로고침" 버튼(store.busy로 disabled가 묶여 있다)의 disabled 전이를 셌지만,
 * E14a가 조회를 전역 busy에서 빼면서 그 전이가 사라져 계측 도구 자체가 무효가 됐다(회귀가 아니라
 * 프록시의 소멸이다). 대신 main 프로세스에서 repo:status IPC 핸들러를 감싸 호출 수를 센다 —
 * 프록시가 아니라 재조회 그 자체라 더 직접적이고, 프로덕션 코드는 한 줄도 건드리지 않는다.
 * 파일은 끝까지 건드리지 않으니 감시(watcher)는 이 호출을 만들 수 없다.
 *
 * ⚠️ 다음 사람에게: "진짜 포커스가 아니니 불완전하다"며 blur()/focus() + GIT_GUI_E2E_SHOW로
 * 되돌리지 말 것 — 그 버전이 바로 위에서 설명한 경합 플레이크의 원인이었다.
 */
test('E10 — 창이 포커스를 받으면 파일 변화 없이도 재조회가 돈다 (포커스 채널 검증)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')

    // repo:status IPC 핸들러를 감싸 호출 수를 센다 — refresh()의 fetchSnapshot이 반드시 거치는
    // 길목이다. ipcMain의 핸들러 맵은 Electron 내부 필드라 테스트에서만 손대고, 감싼 뒤에도
    // 원래 핸들러를 그대로 호출하므로 앱 동작은 바뀌지 않는다
    const patched = await app.evaluate(({ ipcMain }) => {
      const impl = ipcMain as unknown as {
        _invokeHandlers: Map<string, (...args: unknown[]) => unknown>
      }
      const original = impl._invokeHandlers.get('repo:status')
      if (original === undefined) return false
      const globals = globalThis as unknown as { __refreshCycles: number }
      globals.__refreshCycles = 0
      impl._invokeHandlers.set('repo:status', (...args: unknown[]) => {
        globals.__refreshCycles += 1
        return original(...args)
      })
      return true
    })
    // 계측이 안 걸렸는데 0건을 세고 통과하는 공허한 성공을 막는다
    expect(patched, 'repo:status 핸들러를 감싸지 못했다 — 이 테스트는 아무것도 재지 못한다').toBe(true)

    // 파일은 전혀 건드리지 않는다 — 감시(watcher)가 반응할 소스가 없는 채로 포커스 이벤트만
    // 직접 쏜다. OS 포커스도, 실제 창 표시도, 다른 창과의 경합도 필요 없다 — 결정적이라
    // toPass 재시도도 더 이상 필요 없다(남겨둔 5초는 IPC 왕복 지연만 흡수하는 여유다).
    await app.evaluate(({ BaseWindow }) => {
      BaseWindow.getAllWindows()[0]!.emit('focus')
    })
    await expect
      .poll(
        () => app.evaluate(() => (globalThis as unknown as { __refreshCycles: number }).__refreshCycles),
        { timeout: 5_000 },
      )
      .toBeGreaterThan(0)

    // 재조회는 돌았지만 바뀐 파일은 없다 — 화면도 그대로다
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

/**
 * E10 Important 3 회귀 — 외부 저장 한 번마다 워킹트리 감시(E10)가 externalRefresh를 돌리고,
 * guard()가 무조건 notice/error를 지워 왔다. 그 결과 에디터가 자동 저장할 때마다, 또는 빌드가
 * 파일을 건드릴 때마다(2s 주기) 화면의 안내 배너가 사라졌다 — E6b 스펙상 10초는 살아 있어야 한다.
 * 알림 유발은 E7h 관례(태그 만들기)를 재사용한다 — 이 스위트에서 가장 값싼 notice 경로다.
 */
test('E10 — 외부 파일 저장이 화면의 알림을 지우지 않는다 (Important 3 회귀)', async () => {
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
    await window.getByTestId('prompt-input').fill('e10-notice')
    await window.getByTestId('prompt-submit').click()
    const notice = window.getByTestId('notice')
    await expect(notice).toContainText(`${T.tag}를 만들었어요`)

    // 태그 작업(쓰기) 자신의 억제 창(WATCH_SUPPRESS_MS=800, E7b)이 다 지나가길 기다린다 —
    // 그래야 다음 쓰기가 확실히 "그다음 외부 변경"으로 감시에 잡힌다
    await window.waitForTimeout(900)
    await expect(notice).toBeVisible()

    // 앱 API를 거치지 않고 파일을 저장한다 — 에디터 자동 저장·포맷온세이브와 같은 순수 워킹트리 쓰기
    await writeFile(join(repo, 'external.txt'), '외부 저장\n')

    // 워킹트리 감시(E10)가 반영해 화면은 갱신되지만, 방금 작업의 알림은 그대로 남아 있어야 한다
    await expect(window.getByTestId('file-unstaged-external.txt')).toBeVisible({ timeout: 5_000 })
    await expect(notice).toContainText(`${T.tag}를 만들었어요`)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

/**
 * E11 Task 5 Step 1a — reduced-motion을 강제해도 앱이 그대로 동작하는지 증명한다.
 *
 * 메커니즘 선정(우선순위대로 실측):
 * 1. Playwright의 `reducedMotion` BrowserContext 옵션 — 이 저장소는 `electron.launch`를 쓴다.
 *    playwright-core의 타입 정의(`Electron.launch` 옵션)를 실독하면 `colorScheme`은 있지만
 *    `reducedMotion`은 없다 — Electron 창에는 애초에 컨텍스트 옵션으로 줄 방법이 없다.
 * 2. 그래서 `app.firstWindow()`가 돌려주는 Page에 직접 `emulateMedia({ reducedMotion: 'reduce' })`를
 *    건다 — CDP로 이 창의 media feature 자체를 덮어써 `prefers-reduced-motion: reduce`가 실제로
 *    발화한다. 숨김 창에서도 동작해(OS 가시성과 무관) GIT_GUI_E2E_SHOW 없이 쓸 수 있다.
 *
 * "그냥 잘 동작한다"만으로는 reduced-motion이 실제로 켜졌다는 증거가 안 된다 — 두 가지를
 * 직접 확인한다: (a) matchMedia 자체가 true로 뒤집혔는지, (b) 안전망(base.css)이 미디어 쿼리로
 * 강제하는 transition-duration이 실제로 0.01ms대로 떨어졌는지(평소 100ms 버튼 전환과 자릿수가
 * 셋이나 달라 우연히 통과할 여지가 없다). 그 위에서 이 에픽의 최대 위험 지점(Task 4의
 * grid-template-rows 상세 슬롯 + 가상 스크롤)을 열고 닫아 실제 흐름이 안 깨지는지 확인한다.
 */
test('E11 — reduced-motion을 강제해도 상세 슬롯 열기/닫기 흐름이 그대로 동작한다', async () => {
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

    await window.emulateMedia({ reducedMotion: 'reduce' })

    // 증거 1 — 미디어 쿼리 자체가 뒤집혔다
    expect(
      await window.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
    ).toBe(true)

    // 증거 2 — 안전망(base.css)이 실제 CSS 전환 시간을 0.01ms대로 끌어내렸다. 대상은 항상
    // 존재하는 .ui-button 기본 규칙(호버·눌림과 무관하게 상시 걸려 있는 transition, button.css)
    const forcedDuration = await window.evaluate(() => {
      const button = document.querySelector('[data-testid="commit-button"]') as HTMLElement
      return getComputedStyle(button).transitionDuration
    })
    const forcedSeconds = Number.parseFloat(forcedDuration)
    // 0.01ms = 0.00001s ≪ 평소 --motion-fast(0.1s) — 자릿수가 셋 차이 나 우연히 통과할 수 없다
    expect(forcedSeconds).toBeLessThan(0.001)

    // 흐름 자체 — 상세 슬롯 열기(grid-template-rows 전환 + 가상 스크롤)가 reduced-motion 아래서도
    // 그대로 동작해야 한다
    await window.locator('[data-testid^="history-item-"]').first().click()
    await expect(window.getByTestId('commit-detail-panel')).toBeVisible()
    await expect(window.getByTestId('history-panel')).toBeVisible()
    await expect(window.getByTestId('commit-detail-subject')).toHaveText('두 번째 저장')

    // 닫기도 정상 — 전환이 사실상 즉시 끝나도 DOM 정리(언마운트)는 그대로 일어난다
    await window.getByTestId('commit-detail-back').click()
    await expect(window.getByTestId('commit-detail-panel')).toHaveCount(0)
    await expect(window.getByTestId('history-panel')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

/**
 * E11 Task 5 Step 1b — Task 4가 실측으로 고정한 상세 슬롯 배치 무회귀를 E2E로 못박는다
 * (1280×800에서 닫힘 history-panel 높이 694 → 열림 366/312 → 닫으면 694로 복귀, Task 4 플랜
 * 실측 앵커). 값을 그대로 하드코딩하지 않는다 — 이 환경에서 실측한 닫힘 높이를 기준선으로
 * 잡아두고, 열었다 닫은 뒤 "기준선으로 정확히 돌아오는가"라는 불변식을 검증한다. 폰트
 * 렌더링·OS 차이로 리터럴이 어긋나도 이 불변식은 흔들리지 않는다.
 */
test('E11 — 상세 슬롯을 열었다 닫으면 우측 열 배치가 닫힘 기준선으로 정확히 돌아온다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '두 번째 저장'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.setViewportSize({ width: 1280, height: 800 })
    await expect(window.getByTestId('history-count')).toHaveText('2')

    const historyPanel = window.getByTestId('history-panel')
    await expect(historyPanel).toBeVisible()
    // 전환 트리거 전 — 닫힘 기준선(Task 4 실측 앵커: 694)
    const closedBaseline = (await historyPanel.boundingBox())!.height

    // 상세를 연다 — grid-template-rows가 --motion-slow(240ms)로 움직이니 다 끝날 때까지 기다린다
    await window.locator('[data-testid^="history-item-"]').first().click()
    const detailPanel = window.getByTestId('commit-detail-panel')
    await expect(detailPanel).toBeVisible()
    await window.waitForTimeout(320)
    const openHistoryHeight = (await historyPanel.boundingBox())!.height
    const openDetailHeight = (await detailPanel.boundingBox())!.height
    // 열림 트리(11fr)는 닫힘보다 확연히 작아지고(45%가 상세로 넘어간다), 상세는 실제 높이를 가진다
    expect(openHistoryHeight).toBeLessThan(closedBaseline)
    expect(openDetailHeight).toBeGreaterThan(100)

    // 닫는다 — 다시 전환이 끝날 때까지 기다린 뒤 기준선과 정확히 같아야 한다(불변식)
    await window.getByTestId('commit-detail-back').click()
    await expect(detailPanel).toHaveCount(0)
    await window.waitForTimeout(320)
    const closedAgain = (await historyPanel.boundingBox())!.height
    expect(closedAgain).toBe(closedBaseline)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

/**
 * E12 Task 6 ① — 좌측 접기 버튼으로 좌측 열이 사라지고(폭 0), 펼치면 되돌아온다.
 * E13 — 접힘은 더 이상 언마운트가 아니다(App.tsx). 트랙을 유지한 채 0px로 두어야
 * grid-template-columns가 보간될 시작점이 생긴다(간격을 트랙으로 옮긴 grid-tracks.ts와 짝) —
 * 그래서 `.app__left`는 접힌 동안도 count 1로 남는다. "폭 0"은 실제 boundingBox 폭으로,
 * 그리고 (0-width 박스는 면적이 없어 Playwright가 보이지 않는다고 판단하므로) toBeVisible이
 * 거짓임으로도 함께 확인한다. 전환에 240ms(--motion-slow)가 걸리므로 클릭 뒤 여유를 둔다
 */
test('E12 — 좌측 접기 버튼으로 좌측 폭이 0이 되고 펼치면 복귀한다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.locator('.app__left')).toBeVisible()
    const before = (await window.locator('.app__left').boundingBox())!.width
    expect(before).toBeGreaterThan(0)

    await window.getByTestId('left-collapse-toggle').click()
    await window.waitForTimeout(320)
    await expect(window.locator('.app__left')).toHaveCount(1)
    await expect(window.locator('.app__left')).not.toBeVisible()
    expect((await window.locator('.app__left').boundingBox())!.width).toBe(0)

    await window.getByTestId('left-collapse-toggle').click()
    await expect(window.locator('.app__left')).toBeVisible()
    await expect
      .poll(async () => (await window.locator('.app__left').boundingBox())!.width)
      .toBeGreaterThan(0)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

/**
 * E12 Task 6 ② — ⌘⌥1이 좌측 접기 버튼과 같은 토글을 한다. macOS는 Option을 누른 채면
 * event.key가 '1'이 아닌 특수문자로 바뀌므로(App.tsx 실측 주석), 구현은 event.code(물리 키)를
 * 본다 — Playwright의 'Digit1' 키 이름은 정확히 그 물리 코드를 만든다.
 * E13 — 위 테스트와 같은 이유로 count가 아니라 폭 0·not.toBeVisible로 접힘을 확인한다
 */
test('E12 — ⌘⌥1 단축키로도 좌측 접기·펼치기가 동작한다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.locator('.app__left')).toBeVisible()

    await window.keyboard.press('Meta+Alt+Digit1')
    await window.waitForTimeout(320)
    await expect(window.locator('.app__left')).not.toBeVisible()
    expect((await window.locator('.app__left').boundingBox())!.width).toBe(0)

    await window.keyboard.press('Meta+Alt+Digit1')
    await expect(window.locator('.app__left')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

/**
 * E12 Task 6 ③ — 접힘은 settingsApi로 영속화된다(loadLeftCollapsed/saveLeftCollapsed,
 * dockOpen과 같은 자리). 같은 GIT_GUI_USER_DATA로 재시작하면 접힘이 복원돼야 한다.
 * E13 — 재시작 직후는 부팅 억제(noColumnTransition)가 걸려 있어 전환 없이 즉시 0px로
 * 시작한다(App.tsx bootSuppress) — 그래서 두 번째 실행은 waitForTimeout 없이 바로 확인해도 된다
 */
test('E12 — 좌측을 접은 채 재시작해도 접힘이 유지된다', async () => {
  const repo = await createRepoWithChange()
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const env = { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData }
  const app = await electron.launch({ args: [APP_ROOT], env })
  try {
    const window = await app.firstWindow()
    await expect(window.locator('.app__left')).toBeVisible()
    await window.getByTestId('left-collapse-toggle').click()
    await window.waitForTimeout(320)
    await expect(window.locator('.app__left')).not.toBeVisible()
    expect((await window.locator('.app__left').boundingBox())!.width).toBe(0)
  } finally {
    await app.close()
  }
  // 재시작 — 같은 userData면 접힘 상태가 복원되어야 한다 (파일 영속화)
  const second = await electron.launch({ args: [APP_ROOT], env })
  try {
    const window = await second.firstWindow()
    await expect(window.locator('.app__left')).not.toBeVisible()
    expect((await window.locator('.app__left').boundingBox())!.width).toBe(0)
  } finally {
    await second.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E12 Task 6 ④ — 탭 번호는 그룹(워크트리) 안에서만 매긴다(nextTabNumber). 본체(워크트리 A)에서
 * 탭 2개를 만든 뒤 워크트리 B로 전환하면, B는 아직 세션이 없던 새 그룹이라 첫 탭이 다시 1이어야
 * 한다 — 전역 카운터였다면 3이 됐을 자리다.
 */
test('E12 — 워크트리 A에 탭 2개, B로 전환하면 B의 첫 탭은 1이다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'e12-tabnum-side'], { cwd: repo })
  const wtPath = `${repo}-e12tabnum`
  await execGitOrThrow(['worktree', 'add', '--end-of-options', wtPath, 'e12-tabnum-side'], {
    cwd: repo,
  })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  const sideName = wtPath.split('/').filter(Boolean).pop()!
  try {
    const window = await app.firstWindow()
    // 워크트리 A(본체) — 탭 2개
    await window.getByTestId('terminal-toggle').click()
    await expect(window.locator('.terminal-dock__tab-name')).toHaveCount(1)
    await expect(window.locator('.terminal-dock__tab-name').first()).toHaveText('1')
    await window.getByTestId('terminal-new-tab').click()
    await expect(window.locator('.terminal-dock__tab-name')).toHaveCount(2)
    await expect(window.locator('.terminal-dock__tab-name').nth(1)).toHaveText('2')

    // 워크트리 B로 전환 — 새 그룹이라 자동 1개 생성, 번호는 이 그룹 안에서 다시 1부터
    await window.getByTestId('left-tab-worktrees').click()
    await window.getByTestId(`worktree-row-${sideName}`).click()
    await expect(window.locator('.terminal-dock__hint')).toContainText(sideName)
    await expect(window.locator('.terminal-dock__tab-name')).toHaveCount(1)
    await expect(window.locator('.terminal-dock__tab-name').first()).toHaveText('1')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(wtPath, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E12 Task 6 ⑤ — 탭을 닫아 빈 번호가 생기면, 다음에 만드는 탭이 그 빈 자리를 재사용한다(끝에
 * 이어붙는 새 번호가 아니라). 1번을 닫아 [2]만 남기고 새로 만들면 nextTabNumber가 1을 돌려줘야
 * 한다 — 3이 아니라.
 *
 * GIT_GUI_USER_DATA 격리 필수 — dockOpen은 settings.json에 영속되는데(rightWidth 선례),
 * 격리가 없으면 이전 터미널 테스트가 남긴 열림 상태를 물려받아 이번 terminal-toggle 클릭이
 * 반대로 닫아버릴 수 있다(:1537 기존 주석과 같은 함정 — 실측: dockOpen이 이미 true인 채로
 * 시작하면 클릭이 도크를 닫고, 이미 존재하던 탭 텍스트('1')는 disabled와 달리 숨겨져도
 * DOM에 남아 toHaveText 단언은 그대로 통과해버려 그다음 '+' 클릭에서만 30초 타임아웃으로
 * 드러난다 — 격리 없이 반복 실행해 실제로 재현했다).
 */
test('E12 — 탭을 닫고 새로 만들면 빈 번호를 재사용한다', async () => {
  const repo = await createRepoWithChange()
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('terminal-toggle').click()
    await expect(window.getByTestId('terminal-dock')).toBeVisible()
    await expect(window.locator('.terminal-dock__tab-name')).toHaveCount(1)
    await expect(window.locator('.terminal-dock__tab-name').first()).toHaveText('1')
    await window.getByTestId('terminal-new-tab').click()
    await expect(window.locator('.terminal-dock__tab-name')).toHaveCount(2)
    await expect(window.locator('.terminal-dock__tab-name').nth(1)).toHaveText('2')

    // 1번 탭을 닫는다 — 빈 자리(1)가 생긴다
    await window.locator('.terminal-dock__tab-close').first().click()
    await expect(window.locator('.terminal-dock__tab-name')).toHaveCount(1)
    await expect(window.locator('.terminal-dock__tab-name').first()).toHaveText('2')

    // 새 탭 — 끝에 3을 붙이는 대신 빈 1을 재사용해야 한다
    await window.getByTestId('terminal-new-tab').click()
    await expect(window.locator('.terminal-dock__tab-name')).toHaveCount(2)
    await expect(window.locator('.terminal-dock__tab-name').nth(1)).toHaveText('1')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E13 Task 5 ① — 접기가 끝나면(--motion-slow 240ms) 가운데(fr 트랙)가 정확히 그만큼 넓어져야
 * 회귀가 아니다. 트랙 개수가 고정이라(grid-tracks.ts buildMainColumns) 좌측 폭 + 그 옆 간격
 * 트랙(MAIN_GAP)이 통째로 가운데로 넘어가는 게 이 구현의 불변식 — 애니메이션이 없던 E12와
 * 같은 최종값에 도달해야 한다.
 * ⚠️ 240ms 동안 폭은 중간값이라 즉시 재면 흔들린다 — E12에서 없앤 ⌘F 플레이크가 정확히 이
 * 원인(E11 애니메이션 중 좌표 샘플링, 이 파일 80행 hoverAndCmdF 주석 참고)이었다. 그래서 고정
 * sleep 대신 최종값에 도달할 때까지 자동 재시도(expect.poll)로 기다린다.
 */
test('E13 — 좌측 접기가 끝나면 가운데 폭이 E12와 같은 최종값(좌측 폭+간격만큼 증가)에 도달한다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    const left = window.locator('.app__left')
    const center = window.locator('.app__center')
    await expect(left).toBeVisible()
    const leftWidthBefore = (await left.boundingBox())!.width
    const centerWidthBefore = (await center.boundingBox())!.width
    const expectedCenterWidth = centerWidthBefore + leftWidthBefore + MAIN_GAP

    await window.getByTestId('left-collapse-toggle').click()

    // 전환이 끝날 때까지 자동 재시도 — 중간값에서 우연히 걸리지 않는다
    await expect.poll(async () => (await left.boundingBox())!.width, { timeout: 2000 }).toBe(0)
    await expect
      .poll(async () => (await center.boundingBox())!.width, { timeout: 2000 })
      .toBeCloseTo(expectedCenterWidth, 0)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

/**
 * E13 Task 5 ② — 터미널 도크를 닫으면(행 트랙이 dockHeight+간격에서 0으로) 그 공간이 가운데
 * (콘텐츠 행, minmax(0,1fr))로 돌아온다. "열기 전 기준선으로 정확히 복귀하는가"를 불변식으로
 * 잡는다 — E11 Task 5 Step 1b("상세 슬롯을 열었다 닫으면 닫힘 기준선으로 정확히 돌아온다")와
 * 같은 관례. ⚠️ 같은 이유로 고정 sleep 없이 자동 재시도로 최종값을 기다린다.
 */
test('E13 — 터미널 도크를 닫으면 그 공간이 가운데로 돌아온다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    const center = window.locator('.app__center')
    await expect(center).toBeVisible()
    const closedBaseline = (await center.boundingBox())!.height

    await window.getByTestId('terminal-toggle').click()
    await expect(window.getByTestId('terminal-dock')).toBeVisible()
    // 도크가 열리는 동안 가운데는 줄어든다 — 전환이 끝난 값으로 자동 재시도
    await expect
      .poll(async () => (await center.boundingBox())!.height, { timeout: 2000 })
      .toBeLessThan(closedBaseline)

    await window.getByTestId('terminal-toggle').click()
    await expect(window.getByTestId('terminal-dock')).toBeHidden()
    // 닫힘 기준선으로 정확히 복귀 — 도크+간격 트랙이 통째로 가운데(fr)로 돌아왔다는 증거
    await expect
      .poll(async () => (await center.boundingBox())!.height, { timeout: 2000 })
      .toBe(closedBaseline)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

/**
 * E13 Task 5 ③ — prefers-reduced-motion에서는 접기·도크 전환이 즉시 반영된다. 메커니즘은 E11
 * Task 5 Step 1a(이 파일 3298행)가 확립한 것을 그대로 재사용한다 — `electron.launch`에는
 * reducedMotion 컨텍스트 옵션이 없어 `page.emulateMedia({ reducedMotion: 'reduce' })`로 이 창의
 * media feature를 CDP로 덮어쓴다.
 *
 * 증거는 두 가지:
 * (a) E13이 전환에 새로 얹은 대상(.app__main의 grid-template-columns/rows) 자체의
 *     transition-duration이 안전망(base.css)으로 0.01ms대까지 눌렸는지 — E11 테스트가 확인한
 *     .ui-button과는 다른 대상이라 별도로 확인한다.
 * (b) 클릭 뒤 접기·도크 열기가 **중간값 프레임을 한 개도 지나지 않고** 최종값에 도달하는지 —
 *     아래 「접기가 실제로 240ms 동안 중간값을 지난다」(중간값 ≥3개)의 정확한 대조군이다.
 *
 * E14b 후속 — (b)를 시간 재기에서 프레임 세기로 바꿨다. 이 테스트의 간헐 실패를 root-cause한
 * 결과다. 두 가설을 실측으로 갈랐다:
 * ① "GIT_GUI_USER_DATA를 안 넘겨 사용자의 실제 settings.json을 읽는다(leftCollapsed 누출)" —
 *    **거짓이다.** harness.launch가 env에 그 키가 없으면 매 실행 새 mkdtemp를 주입한다
 *    (harness.ts, 4b041c2). 프로브 실측: 이 테스트와 똑같은 형태로 띄운 앱의
 *    `app.getPath('userData')`는 `/var/folders/.../gg-e2e-userdata-GZe75n`,
 *    `window.settingsApi.initial`은 `{}`였다. 접힘 설정은 애초에 새어 들어오지 않는다.
 * ② "150ms poll에 걸리는 타이밍"이 맞다. 예전 (b)는 `expect.poll(..., { timeout: 150 })`으로
 *    **벽시계**를 쟀는데, 그 150ms 안에는 CSS 전환뿐 아니라 클릭 왕복·React 커밋·병렬 워커
 *    부하가 전부 들어간다. 실측: 30회 반복 3라운드에서 2·0·2회 실패(전부 도크 poll), 도크
 *    첫 열기의 node-pty spawn 비용을 워밍업으로 빼내자 60회 중 3회로 줄었지만 이번엔 좌측
 *    poll에서도 터졌다 — 임계가 부하에 걸려 있는 한 어느 한 곳을 고쳐도 남는다.
 * 프레임 세기는 부하에 면역이다: 전환이 없으면 366→0이 한 번의 스타일 커밋으로 끝나 그 사이
 * 프레임이 **구조적으로 존재하지 않는다**(안전망이 누르는 0.01ms는 한 프레임 16.7ms의 1/1670).
 * 느려질수록 표본이 성길 뿐 중간값이 생기지는 않는다.
 */
test('E13 — reduced-motion에서는 접기·도크 전환이 즉시 반영된다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    // firstWindow는 React 마운트 전에 반환될 수 있다(E7d ⑦ 주석, 426행) — .app__main이 실제로
    // DOM에 붙은 뒤에 매체 쿼리를 확인해야 아래 querySelector가 null을 만나지 않는다
    const left = window.locator('.app__left')
    await expect(left).toBeVisible()

    await window.emulateMedia({ reducedMotion: 'reduce' })
    expect(
      await window.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
    ).toBe(true)

    // 증거 (a) — E13이 새로 전환에 얹은 그리드 트랙 속성 자체가 강제로 즉시 끝나야 한다
    const forcedDuration = await window.evaluate(() => {
      const main = document.querySelector('.app__main') as HTMLElement
      return getComputedStyle(main).transitionDuration
    })
    for (const part of forcedDuration.split(',')) {
      // 0.01ms = 0.00001s ≪ 평소 --motion-slow(0.24s) — 자릿수가 넷 차이 나 우연히 통과할 수 없다
      expect(Number.parseFloat(part)).toBeLessThan(0.001)
    }

    // 증거 (b)-1 — 좌측 접기가 중간 폭을 한 프레임도 지나지 않는다
    const leftFrames = await sampleCollapseFrames(window, '.app__left', '.app__left-inner', () =>
      window.getByTestId('left-collapse-toggle').click(),
    )
    const leftStart = Math.max(...leftFrames.map((sample) => sample.trackW))
    expect(leftStart, '접기 전 좌측 트랙 폭').toBeGreaterThan(200)
    expect(leftFrames.at(-1)!.trackW, '표본 끝에는 접기가 끝나 0이어야 한다').toBe(0)
    const leftMiddles = leftFrames.filter(
      (sample) => sample.trackW > 0.5 && sample.trackW < leftStart - 0.5,
    )
    expect(
      leftMiddles.length,
      `좌측 중간값 프레임 수 (표본 ${leftFrames.length}개, 추이 ` +
        `${leftFrames.map((sample) => Math.round(sample.trackW)).join('→')})`,
    ).toBe(0)

    // 증거 (b)-2 — 도크 열기도 같다. 여는 방향이라 행 트랙이 0에서 펼친 높이로 한 번에 간다
    const dockFrames = await sampleCollapseFrames(window, '.app__dock', '.terminal-dock', () =>
      window.getByTestId('terminal-toggle').click(),
    )
    const dockEnd = dockFrames.at(-1)!.trackH
    expect(dockEnd, '표본 끝에는 도크 행 트랙이 펼친 높이다').toBeCloseTo(DOCK_HEIGHT_DEFAULT, 0)
    const dockMiddles = dockFrames.filter(
      (sample) => sample.trackH > 0.5 && sample.trackH < dockEnd - 0.5,
    )
    expect(
      dockMiddles.length,
      `도크 중간 높이 프레임 수 (표본 ${dockFrames.length}개, 추이 ` +
        `${dockFrames.map((sample) => Math.round(sample.trackH)).join('→')})`,
    ).toBe(0)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

/**
 * E13 후속 (적대적 리뷰 BLOCKING) — **닫힌 도크·접힌 사이드가 Tab 순서에 남아 있으면 안 된다.**
 *
 * E13이 만든 회귀다. E12까지는 접힌 열이 `display: none`이거나 아예 언마운트라 포커스 대상에서
 * 저절로 빠졌는데, E13이 "전환의 시작점을 남기려고" 항상 마운트로 바꾸면서 **박스만 0px일 뿐
 * 포커스는 그대로 들어가는** 상태가 됐다. 마우스는 `overflow: hidden`이 히트 테스트까지 잘라
 * 안전하지만 키보드는 아니다 — 리뷰어 실측: 도크를 닫은 채 body에서 Tab 15번이면 숨은
 * `.xterm-helper-textarea`에 포커스가 앉고, 거기서 친 글자가 **살아 있는 pty에서 실제로
 * 실행됐다**(다시 열었을 때 스크롤백에 출력이 남아 있었다). 접힌 사이드도 같은 부류로 21개씩
 * 포커스 가능했다(변경 탭 버튼·커밋 메시지 입력 등).
 *
 * 고침은 세 클리퍼(.app__dock/.app__left/.app__right)에 `inert`(+`aria-hidden`) — 레이아웃
 * 효과가 없어 240ms 전환을 건드리지 않고, 언마운트도 아니라 E7b의 "접어도 세션이 산다"도 지킨다.
 *
 * 이 테스트가 의미 있으려면 두 가지가 필요하다:
 * ① 도크를 **한 번 열어 실제 pty·xterm을 만든 뒤** 닫아야 한다(열어 본 적 없는 도크는
 *    세션이 없어 회귀 자체가 재현되지 않는다).
 * ② Tab이 실제로 여러 곳을 돌았음을 함께 단언한다 — 전부 body에 머물렀다면 "안 들어갔다"는
 *    공허하게 참이 된다.
 */
test('E13 후속 — 닫힌 도크·접힌 사이드로는 Tab 포커스가 들어가지 않는다 (유령 키 입력 회귀)', async () => {
  const repo = await createRepoWithChange()
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.locator('.app__left')).toBeVisible()

    // ① 진짜 터미널을 만든 뒤 닫는다 — 리뷰어가 유령 입력을 재현한 그 상태
    await window.getByTestId('terminal-toggle').click()
    await expect(window.locator('.terminal-dock__tab-name')).toHaveCount(1)
    await expect(window.locator('.xterm-helper-textarea')).toHaveCount(1)
    await window.getByTestId('terminal-toggle').click()
    await expect(window.getByTestId('terminal-dock')).toBeHidden()

    // 좌·우 사이드도 접는다 — 전환이 끝나 트랙이 실제로 0px가 된 뒤에 Tab을 시작한다
    await window.getByTestId('left-collapse-toggle').click()
    await window.getByTestId('right-collapse-toggle').click()
    await expect
      .poll(async () => (await window.locator('.app__left').boundingBox())!.width, { timeout: 2000 })
      .toBe(0)
    await expect
      .poll(async () => (await window.locator('.app__right').boundingBox())!.width, { timeout: 2000 })
      .toBe(0)

    // ② body에서 출발해 Tab 40번 — 리뷰어는 15번이면 닿았다. 여유 있게 돌린다
    await window.evaluate(() => {
      ;(document.activeElement as HTMLElement | null)?.blur()
    })
    const visited: string[] = []
    for (let index = 1; index <= 40; index += 1) {
      await window.keyboard.press('Tab')
      const where = await window.evaluate(() => {
        const el = document.activeElement
        if (el === null) return null
        const hidden = ['.app__dock', '.app__left', '.app__right'].find(
          (selector) => el.closest(selector) !== null,
        )
        return {
          hidden: hidden ?? null,
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === 'string' ? el.className : '',
          testId: el.getAttribute('data-testid'),
        }
      })
      expect(where, `Tab ${index}회 — activeElement가 없다`).not.toBeNull()
      expect(
        where!.hidden,
        `Tab ${index}회에 접힌 영역(${where!.hidden})으로 포커스가 들어갔다 — ` +
          `<${where!.tag} class="${where!.cls}" data-testid="${where!.testId}">`,
      ).toBeNull()
      visited.push(`${where!.tag}[${where!.testId ?? where!.cls}]`)
    }
    // 공허한 통과 방지 — 접히지 않은 곳(헤더·중앙)에서는 Tab이 실제로 여러 요소를 돌아야 한다
    const distinct = new Set(visited.filter((entry) => !entry.startsWith('body')))
    expect(distinct.size, `Tab이 실제로 돈 곳: ${[...distinct].join(', ')}`).toBeGreaterThanOrEqual(3)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * 접기 애니메이션을 프레임 단위로 표본하는 공용 루틴 (E13 후속 리뷰 IMPORTANT 2·3).
 *
 * 왜 페이지 안에서 재는가: Playwright의 `boundingBox()`는 호출마다 IPC 왕복이라 240ms 안에
 * 몇 번 못 재고 시점도 흔들린다. `requestAnimationFrame`으로 페이지 안에서 재면 프레임마다
 * 한 표본이 확실히 남는다(60Hz면 240ms에 약 14개).
 *
 * 표본은 **클릭 전부터** 시작한다 — 클릭이 페이지에 닿는 시점을 정확히 못 맞추므로, 시작값을
 * 표본의 최댓값으로 되짚는다(클릭 전 프레임이 최소 하나는 들어온다). 고정 sleep은 쓰지 않는다.
 */
async function sampleCollapseFrames(
  window: Page,
  trackSelector: string,
  innerSelector: string,
  click: () => Promise<void>,
): Promise<Array<{ t: number; trackW: number; trackH: number; innerW: number; innerH: number }>> {
  await window.evaluate(
    ({ track, inner }) => {
      const store = window as unknown as { __e13: unknown[]; __e13done: boolean }
      store.__e13 = []
      store.__e13done = false
      const trackEl = document.querySelector(track)!
      const innerEl = document.querySelector(inner)!
      const t0 = performance.now()
      const tick = () => {
        const t = performance.now() - t0
        const a = trackEl.getBoundingClientRect()
        const b = innerEl.getBoundingClientRect()
        store.__e13.push({ t, trackW: a.width, trackH: a.height, innerW: b.width, innerH: b.height })
        // 240ms 전환 + 클릭 왕복 + 여유. 끝나면 플래그로 알린다(고정 sleep 대신 폴링으로 회수)
        if (t < 1500) requestAnimationFrame(tick)
        else store.__e13done = true
      }
      requestAnimationFrame(tick)
    },
    { track: trackSelector, inner: innerSelector },
  )
  await click()
  await expect
    .poll(async () => window.evaluate(() => (window as unknown as { __e13done: boolean }).__e13done), {
      timeout: 5000,
    })
    .toBe(true)
  return window.evaluate(
    () =>
      (window as unknown as {
        __e13: Array<{ t: number; trackW: number; trackH: number; innerW: number; innerH: number }>
      }).__e13,
  )
}

/**
 * E13 후속 (적대적 리뷰 IMPORTANT 2) — **애니메이션 자체에 회귀 테스트를 건다.**
 *
 * 리뷰어 실측: `layout.css`의 `.app__main { transition: ... }` 선언을 통째로 지우고 다시
 * 빌드해도 E13 신규 3건과 E12 접기 5건이 **전부 초록**이었다 — 기존 테스트는 정착한 최종
 * 상태만 본다. reduced-motion 테스트의 증거 (a)(`transitionDuration < 0.001`)조차 전환이
 * 아예 없을 때 통과해 전제가 무너진다.
 *
 * 여기서 두 가지를 못박는다:
 * (a) 평상시 `.app__main`의 `transitionDuration`이 실제로 `0.24s`다(--motion-slow). 선언을
 *     지우면 `0s`가 되어 즉시 빨개진다 — reduced-motion 테스트의 대조군이기도 하다.
 * (b) 접는 동안 `.app__left`의 트랙 폭이 **처음도 0도 아닌 중간값**을 실제로 지난다.
 *
 * 표본 개수 기준(≥3)의 근거 — 리뷰어가 실측한 240ms 곡선은 3ms=366 · 37ms=311 · 70ms=185 ·
 * 103ms=90 · 137ms=39 · 170ms=13 · 204ms=1.9 · 237ms=0으로, 60Hz면 중간값 프레임이 13개쯤
 * 나온다. 3이면 프레임률이 4분의 1(≈15Hz)로 주저앉아도 견딘다. 반대로 전환이 없으면 중간값은
 * **구조적으로 0개**다(스타일 커밋 한 번에 366→0으로 끝나 그 사이 프레임이 존재하지 않는다) —
 * 즉 이 단언은 "느린 머신에서 흔들리는" 종류가 아니라 있고 없고가 갈리는 종류다.
 */
test('E13 후속 — 접기가 실제로 240ms 동안 중간값을 지난다 (애니메이션 회귀)', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.locator('.app__left')).toBeVisible()

    // (a) 전환 선언이 살아 있다 — 열·행 두 대상 모두 --motion-slow(0.24s)
    const durations = await window.evaluate(() => {
      const main = document.querySelector('.app__main') as HTMLElement
      return getComputedStyle(main).transitionDuration
    })
    const parts = durations.split(',').map((part) => Number.parseFloat(part))
    expect(parts.length, `transitionDuration="${durations}" — 열·행 두 대상이어야 한다`).toBe(2)
    for (const seconds of parts) expect(seconds).toBeCloseTo(0.24, 3)

    // (b) 접히는 동안 중간값을 지난다
    const samples = await sampleCollapseFrames(window, '.app__left', '.app__left-inner', () =>
      window.getByTestId('left-collapse-toggle').click(),
    )
    const start = Math.max(...samples.map((s) => s.trackW))
    expect(start, '접기 전 좌측 트랙 폭').toBeGreaterThan(200)
    expect(samples.at(-1)!.trackW, '표본 끝에는 전환이 끝나 0이어야 한다').toBe(0)
    const middles = samples.filter((s) => s.trackW > 0.5 && s.trackW < start - 0.5)
    expect(
      middles.length,
      `중간값 프레임 수 (표본 ${samples.length}개, 시작 ${start}px, ` +
        `추이 ${samples.map((s) => Math.round(s.trackW)).join('→')})`,
    ).toBeGreaterThanOrEqual(3)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

/**
 * E13 후속 (적대적 리뷰 IMPORTANT 3) — **뭉개짐 수정(f523ed0)에 회귀 테스트를 건다.**
 *
 * 사용자 피드백("접힐 때 텍스트가 뭉개진다")의 본체이자 이 브랜치의 가장 큰 구조 변경인데,
 * 리뷰어가 최소 되돌림(안쪽 인라인 폭 → `'100%'`, `.app__right-inner`·`.terminal-dock`의
 * `flex-shrink: 0` 제거, 도크 `height` → `'100%'`)을 해도 관련 12건(E8 4 + E12 5 + E13 3)이
 * **전부 초록**이었다.
 *
 * 불변식: 클리퍼(.app__left / .app__dock)는 트랙을 따라 줄어들지만 그 안의 콘텐츠 상자
 * (.app__left-inner / .terminal-dock)는 **전 프레임 같은 크기를 유지**하고, 넘치는 부분만
 * 잘린다. 되돌리면 안쪽이 트랙을 따라 0까지 줄어 첫 단언이 바로 깨진다.
 *
 * 허용 오차 1px — 서브픽셀 반올림만 흡수하는 값이다. 뭉개짐이 살아나면 차이가 수백 px라
 * 오차 폭과는 자릿수가 다르다.
 */
test('E13 후속 — 접히는 내내 안쪽 콘텐츠 상자는 펼친 크기 그대로다 (뭉개짐 회귀)', async () => {
  const repo = await createRepoWithChange()
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.locator('.app__left')).toBeVisible()

    // ── 좌측 사이드: 가로축 ──────────────────────────────────────────────
    const left = await sampleCollapseFrames(window, '.app__left', '.app__left-inner', () =>
      window.getByTestId('left-collapse-toggle').click(),
    )
    const innerWidths = left.map((s) => s.innerW)
    const expandedWidth = Math.max(...left.map((s) => s.trackW))
    expect(
      Math.max(...innerWidths) - Math.min(...innerWidths),
      `.app__left-inner 폭이 흔들렸다 — 추이 ${innerWidths.map((w) => Math.round(w)).join('→')}`,
    ).toBeLessThan(1)
    expect(Math.min(...innerWidths), '안쪽 상자는 접혀도 펼친 폭 그대로').toBeCloseTo(expandedWidth, 0)
    // 실제로 "잘리는" 상태를 지났다 — 안쪽이 트랙보다 넓은 프레임이 여러 번 있었다
    const clippedFrames = left.filter((s) => s.innerW > s.trackW + 1)
    expect(clippedFrames.length, '안쪽이 트랙보다 넓은(=잘리는) 프레임 수').toBeGreaterThanOrEqual(3)

    // ── 터미널 도크: 세로축 ──────────────────────────────────────────────
    await window.getByTestId('terminal-toggle').click()
    await expect(window.getByTestId('terminal-dock')).toBeVisible()
    await expect(window.locator('.terminal-dock__tab-name')).toHaveCount(1)
    // 열림 전환이 완전히 정착한 뒤에 닫기 표본을 시작한다 — 시작값이 흔들리지 않게
    await expect
      .poll(async () => (await window.getByTestId('terminal-dock').boundingBox())!.height, {
        timeout: 2000,
      })
      .toBe(DOCK_HEIGHT_DEFAULT)

    const dock = await sampleCollapseFrames(window, '.app__dock', '.terminal-dock', () =>
      window.getByTestId('terminal-toggle').click(),
    )
    const innerHeights = dock.map((s) => s.innerH)
    expect(
      Math.max(...innerHeights) - Math.min(...innerHeights),
      `.terminal-dock 높이가 흔들렸다 — 추이 ${innerHeights.map((h) => Math.round(h)).join('→')}`,
    ).toBeLessThan(1)
    expect(Math.min(...innerHeights), '도크 본체는 닫혀도 펼친 높이 그대로').toBeCloseTo(
      DOCK_HEIGHT_DEFAULT,
      0,
    )
    expect(dock.at(-1)!.trackH, '표본 끝에는 도크 행 트랙이 0이어야 한다').toBe(0)
    const clippedDockFrames = dock.filter((s) => s.innerH > s.trackH + 1)
    expect(clippedDockFrames.length, '도크 본체가 행 트랙보다 높은 프레임 수').toBeGreaterThanOrEqual(3)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E14a — 파일을 옮겨 다닐 때 앱 전체가 깜빡이면 안 된다.
 *
 * 사용자 제보: "파일 누르면 왜 헤더부터 사이드바 전체가 다 텍스트가 리렌더링되는것처럼
 * 깜빡이는거야? diff부분만 바뀌면 될 것 같은데.."
 *
 * 원인은 selectFile이 diff만 읽는 조회인데도 전역 busy를 켰다 끈 것이다. busy는 렌더러
 * 118곳에 스레드돼 있다. 수정 전 실측(MutationObserver, 파일 A→B 클릭 1회):
 *   헤더  텍스트 0 · 속성 30 (disabled×10 · tabindex×10 · data-disabled×10)
 *   좌측  텍스트 2 · 속성 78 (그 텍스트가 CommitForm의 '작업 중이에요'다)
 *   헤더 컨트롤이 비활성으로 머문 시간 28.8ms
 *
 * **왜 A→B인가:** "선택 없음 → 첫 파일"은 좌측 행 액션이 정당하게 활성화된다(실측: disabled
 * 대상 20→3). 그 경우엔 좌측 변형 0을 요구할 수 없다. 이미 한 파일을 보고 있는 상태에서
 * 다른 파일로 옮기면 그 정당한 변화가 이미 끝나 있어, 남는 변형은 전부 busy 탓이다.
 */
test('E14a — 파일을 옮겨도 헤더가 잠기지 않는다 (전체 깜빡임 회귀)', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'git-gui-e14a-'))
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  try {
    await execGitOrThrow(['init', '--initial-branch=main'], { cwd: repo })
    await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: repo })
    await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: repo })
    for (const name of ['a.txt', 'b.txt']) {
      await writeFile(join(repo, name), 'base\n'.repeat(50))
    }
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow(['commit', '-m', 'init'], { cwd: repo })
    for (const name of ['a.txt', 'b.txt']) {
      await writeFile(join(repo, name), 'changed\n'.repeat(50))
    }

    const app = await electron.launch({
      args: [APP_ROOT],
      env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
    })
    try {
      const window = await app.firstWindow()
      // 먼저 a.txt를 골라 "이미 보고 있는" 상태를 만든다.
      // 빈 상태 패널도 testId가 diff-panel이라 toBeVisible로는 선택이 끝났는지 알 수 없다 —
      // 제목(=경로)이 a.txt가 될 때까지 기다려야 진짜 A→B 측정이 된다
      await window.getByTestId('file-unstaged-a.txt').click()
      await expect(window.getByTestId('diff-panel')).toContainText('a.txt')

      const counts = await window.evaluate(async () => {
        const log = { header: 0, composerText: [] as string[] }
        const headerObserver = new MutationObserver((records) => {
          log.header += records.length
        })
        headerObserver.observe(document.querySelector('.app__header')!, {
          subtree: true,
          attributes: true,
          attributeFilter: ['disabled', 'data-disabled', 'tabindex'],
        })
        const leftObserver = new MutationObserver((records) => {
          for (const record of records) {
            if (record.type === 'characterData') {
              log.composerText.push(String((record.target as CharacterData).data))
            }
          }
        })
        leftObserver.observe(document.querySelector('.app__left')!, {
          subtree: true,
          characterData: true,
        })

        ;(document.querySelector('[data-testid="file-unstaged-b.txt"]') as HTMLElement).click()
        await new Promise((resolve) => setTimeout(resolve, 800))
        headerObserver.disconnect()
        leftObserver.disconnect()
        return log
      })

      expect(counts.header, '헤더 잠금 변형 — 수정 전 실측 30건').toBe(0)
      expect(
        counts.composerText.filter((text) => text.includes('작업 중이에요')),
        '커밋 컴포저가 "작업 중이에요"로 번쩍이면 안 된다',
      ).toEqual([])
      // 공허한 통과 방지 — 가운데는 실제로 b.txt로 바뀌었어야 한다
      await expect(window.getByTestId('diff-panel')).toContainText('b.txt')
    } finally {
      await app.close()
    }
  } finally {
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E14a — 앱을 만지지 않아도 깜빡이던 경로. externalRefresh(E10 워킹트리 감시)도 조회인데
 * 전역 busy를 켰다. 즉 **에디터에서 파일을 저장하기만 해도** 헤더가 잠겼다 풀렸다.
 * 에디터 자동저장을 켜두면 상시로 돈다. 수정 전 실측: 외부 저장 1회 → 헤더 변형 30건
 * (스펙 §1-2가 적은 20은 disabled·data-disabled 두 속성만 센 값이다 — 아래 관찰자는 tabindex까지
 * 세 개를 세므로 같은 기준으로는 30이다. 단언은 어느 쪽이든 0이라 결과에는 영향이 없다).
 *
 * 여기서는 사용자가 앱을 만지지 않았으므로 좌측 disabled 변형도 0을 요구할 수 있다.
 */
test('E14a — 에디터에서 저장해도 앱이 잠기지 않는다 (외부 변경 깜빡임 회귀)', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'git-gui-e14a-ext-'))
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  try {
    await execGitOrThrow(['init', '--initial-branch=main'], { cwd: repo })
    await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: repo })
    await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: repo })
    await writeFile(join(repo, 'a.txt'), 'base\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow(['commit', '-m', 'init'], { cwd: repo })

    const app = await electron.launch({
      args: [APP_ROOT],
      env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
    })
    try {
      const window = await app.firstWindow()
      await expect(window.locator('.app__header')).toBeVisible()
      await expect(window.getByTestId('history-count')).toHaveText('1')

      await window.evaluate(() => {
        const log = { header: 0, left: 0 }
        ;(window as unknown as { __e14a: typeof log }).__e14a = log
        new MutationObserver((records) => {
          log.header += records.length
        }).observe(document.querySelector('.app__header')!, {
          subtree: true,
          attributes: true,
          attributeFilter: ['disabled', 'data-disabled', 'tabindex'],
        })
        new MutationObserver((records) => {
          log.left += records.length
        }).observe(document.querySelector('.app__left')!, {
          subtree: true,
          attributes: true,
          attributeFilter: ['disabled', 'data-disabled'],
        })
      })

      // 부팅 직후의 초기 작업(init은 쓰기라 전역 busy를 켠다)이 남긴 변형과 섞이면 안 된다.
      // "직전 간격 동안 변형 0"이 될 때까지 기다리며 그때까지의 계수를 버린다 —
      // 이 폴은 매 호출마다 계수기를 0으로 되돌리므로 성공한 순간의 계수기는 0이다.
      // (플랜은 여기서 .ui-pending 개수가 0이 되길 기다리라고 했지만 그 클래스는 Task 4에서야
      //  생긴다 — 지금 쓰면 항상 0이라 아무것도 기다리지 않는 공허한 대기가 된다)
      await expect
        .poll(
          async () =>
            window.evaluate(() => {
              const log = (window as unknown as { __e14a: { header: number; left: number } }).__e14a
              const seen = log.header + log.left
              log.header = 0
              log.left = 0
              return seen
            }),
          { timeout: 5000 },
        )
        .toBe(0)

      // 에디터가 파일을 저장한 상황을 그대로 재현한다 (E10 워킹트리 감시 경로)
      await writeFile(join(repo, 'a.txt'), 'edited by editor\n')
      // 변경이 실제로 화면에 반영될 때까지 기다린다 — 반영도 안 됐는데 0건이면 공허하다
      await expect(window.getByTestId('file-unstaged-a.txt')).toBeVisible()

      const log = await window.evaluate(
        () => (window as unknown as { __e14a: { header: number; left: number } }).__e14a,
      )
      expect(log.header, '헤더 잠금 변형 — 수정 전 실측 30건(세 속성 기준)').toBe(0)
      expect(log.left, '좌측 잠금 변형 — 사용자가 만지지 않았으므로 0이어야 한다').toBe(0)
    } finally {
      await app.close()
    }
  } finally {
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E14a — 파일 사이를 빠르게 옮겨 다녀도 마지막에 고른 파일의 diff가 남는다.
 *
 * 전역 직렬화(busy 재진입 거부)를 빼면서 조회가 겹칠 수 있게 됐다. 그 대가로 새 위험이 열렸다:
 * 늦게 끝난 조회가 먼저 끝난 최신 조회를 덮으면 **누른 것과 다른 파일의 diff가 남는다.**
 * runRead의 isCurrent()가 그걸 막는다(run-guard.ts 주석 참조). 이 테스트는 사용자가 실제로 하는
 * 행동(목록을 훑으며 연달아 클릭)으로 그 경로를 태운다.
 *
 * **검출력(실측):** isCurrent를 `() => true`로 고정하고 재빌드해 돌리면 5/5 빨강이다 — 실제로
 * 순서가 뒤집혀 b.txt의 diff가 마지막에 누른 a.txt를 덮는다. 다만 그건 파일 크기 차가 충분할
 * 때다: 처음에 200·400·600·800줄로 잡았을 땐 3번 중 1번만 빨갰다. 그래서 크기를 세제곱으로
 * 벌려(200·1600·5400·12800줄) 앞선 조회가 확실히 더 오래 걸리게 했다. 이 숫자를 줄이면
 * 테스트가 회귀를 놓치기 시작한다.
 *
 * 그래도 경합의 정밀한 고정은 단위 테스트(test/run-guard.test.ts)의 몫이다 — 거기서는 지연을
 * 수동으로 풀어 완료 순서를 100% 뒤집는다. 여기는 실제 앱에서 그 배선이 이어져 있는지를 본다.
 */
test('E14a — 파일을 연달아 빠르게 눌러도 마지막 파일의 diff가 남는다', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'git-gui-e14a-race-'))
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const names = ['a.txt', 'b.txt', 'c.txt', 'd.txt']
  try {
    await execGitOrThrow(['init', '--initial-branch=main'], { cwd: repo })
    await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: repo })
    await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: repo })
    // 파일마다 크기를 크게 벌린다(200·1600·5400·12800줄) — 조회 시간이 갈려야 순서가 뒤집힌다.
    // 선형 증가(200·400·600·800)로는 반증이 3번 중 1번만 빨갰다 (위 주석의 실측)
    for (const [index, name] of names.entries()) {
      await writeFile(join(repo, name), `base ${name}\n`.repeat(200 * (index + 1) ** 3))
    }
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow(['commit', '-m', 'init'], { cwd: repo })
    for (const [index, name] of names.entries()) {
      await writeFile(join(repo, name), `changed ${name}\n`.repeat(200 * (index + 1) ** 3))
    }

    const app = await electron.launch({
      args: [APP_ROOT],
      env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
    })
    try {
      const window = await app.firstWindow()
      await expect(window.getByTestId('file-unstaged-a.txt')).toBeVisible()

      // 큰 파일 → 작은 파일 순으로 기다리지 않고 연달아 누른다. 앞의 것이 더 오래 걸리므로,
      // isCurrent()가 없으면 마지막(a.txt)을 앞선 조회가 덮을 수 있다
      await window.evaluate((fileNames) => {
        for (const name of [...fileNames].reverse()) {
          ;(document.querySelector(`[data-testid="file-unstaged-${name}"]`) as HTMLElement).click()
        }
      }, names)

      // 겹친 조회 4개가 전부 끝날 때까지 기다린다 — 고정 sleep이 아니라 가운데 패널의 로딩 표시가
      // 사라지는 것으로 잰다(reads.center === 0의 관찰 가능한 대응물). 아직 진행 중인 조회가
      // 남은 채로 단언하면 "아직 덮지 않았을 뿐"인 상태를 통과로 오독한다
      await expect
        .poll(
          async () =>
            window.evaluate(
              () =>
                document.querySelectorAll(
                  '[data-testid="diff-panel"] [data-testid="panel-pending"]',
                ).length,
            ),
          { timeout: 5000 },
        )
        .toBe(0)

      // 마지막으로 누른 것은 a.txt다 — 조회가 전부 끝난 뒤에도 그대로여야 한다.
      // 빈 상태 패널도 testId가 diff-panel이므로 제목(=경로) 내용으로 단언한다
      await expect(window.getByTestId('diff-panel')).toContainText('a.txt')
      for (const other of names.slice(1)) {
        await expect(window.getByTestId('diff-panel')).not.toContainText(other)
      }
    } finally {
      await app.close()
    }
  } finally {
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E14a — 로딩 표시는 느린 조회에만 배어난다.
 * 빠른 조회(실측 29ms)는 --motion-pending-delay(400ms) 안에 끝나 한 프레임도 보이지 않는다.
 *
 * "느림"을 토큰 0으로 흉내내지 않는다 — 그러면 지연 자체를 검증하지 못한다. 대신 (1) 스피너가
 * 조회 중에 DOM에 붙기는 했는지, (2) 그 스피너 **자신의** computed animation-delay가 토큰 값인지를
 * 본다. (1)이 없으면 (2)는 잴 대상이 없고, (2)가 없으면 (1)은 지연에 대해 아무 말도 못 한다.
 *
 * 표본 창 600ms는 지연 400ms + 페이드 150ms보다 길다 — 배어날 것이었다면 이 안에서 보였다.
 * 조건 대기가 아니라 표본 구간이라 고정 시간이 맞다.
 *
 * 짝이 되는 반대 방향(느린 조회에서는 실제로 배어난다)은 바로 아래 테스트가 잰다 — 이 테스트만
 * 있으면 `--motion-pending-delay: 999s`로 스피너를 영영 안 보이게 해도 초록이다 (최종 리뷰 Note 4).
 */
test('E14a — 빠른 조회에서는 로딩 표시가 보이지 않는다', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'git-gui-e14a-pending-'))
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  try {
    await execGitOrThrow(['init', '--initial-branch=main'], { cwd: repo })
    await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: repo })
    await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: repo })
    for (const name of ['a.txt', 'b.txt']) await writeFile(join(repo, name), 'base\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow(['commit', '-m', 'init'], { cwd: repo })
    for (const name of ['a.txt', 'b.txt']) await writeFile(join(repo, name), 'changed\n')

    const app = await electron.launch({
      args: [APP_ROOT],
      env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
    })
    try {
      const window = await app.firstWindow()
      await window.getByTestId('file-unstaged-a.txt').click()
      await expect(window.getByTestId('diff-panel')).toContainText('a.txt')

      // 클릭 직후부터 rAF로 스피너의 실제 불투명도를 표본한다.
      // panel-pending은 패널 7개가 공유하는 testId라 반드시 가운데 패널로 좁힌다 —
      // 좁히지 않으면 우측·좌측 패널의 조회를 대신 재고 있을 수 있다
      const samples = await window.evaluate(async () => {
        const opacities: number[] = []
        const delays: string[] = []
        let running = true
        const tick = () => {
          const spinner = document.querySelector(
            '[data-testid="diff-panel"] [data-testid="panel-pending"]',
          )
          // -1 = 그 프레임엔 스피너가 DOM에 없었다 (있는데 투명한 것과 구분해 남긴다)
          if (spinner === null) opacities.push(-1)
          else {
            const style = getComputedStyle(spinner)
            opacities.push(Number(style.opacity))
            delays.push(style.animationDelay)
          }
          if (running) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
        ;(document.querySelector('[data-testid="file-unstaged-b.txt"]') as HTMLElement).click()
        await new Promise((resolve) => setTimeout(resolve, 600))
        running = false
        return { opacities, delays }
      })

      const trace = `불투명도 표본 ${samples.opacities.join(',')} / 지연 ${samples.delays.join(' ')}`
      // 조회가 실제로 일어났는지는 결과로 확인한다 — 클릭이 먹지 않았다면 아래 단언은 공허하다
      await expect(window.getByTestId('diff-panel')).toContainText('b.txt')

      // 여기 있던 "불투명도 > 0.05인 표본이 0개" 단언은 **구조적으로 실패할 수 없어 삭제했다**
      // (최종 리뷰 Important 3). 빠른 조회에서 스피너는 정확히 한 프레임만 DOM에 살고 rAF
      // 콜백은 페인트 전에 돈다 — `--motion-pending-delay`를 `0ms`로 바꿔 재빌드해도 computed
      // opacity는 여전히 0이라 초록이었다. 검출력은 아래 두 단언에만 있다.
      //
      // 공허 방지 ①: 스피너가 애초에 붙지도 않았다면 아무것도 말하지 않는다.
      // 실측(이 테스트로 표본을 찍어 확인): 빠른 조회에서도 조회 시작 프레임 한 장은 DOM에 붙고
      // 그 프레임의 불투명도가 정확히 0이다 — 표본 36칸 중 첫 칸만 0, 나머지 35칸은 -1(없음)이었다.
      // 프레임이 아니라 IPC 왕복이 경계라 이 한 장은 안정적이다 — 카운터 증가는 클릭 이벤트의
      // 마이크로태스크에서 커밋되고 결과는 그보다 뒤인 매크로태스크로 돌아온다
      expect(samples.delays.length, `스피너가 한 프레임도 붙지 않았다 — ${trace}`).toBeGreaterThan(0)
      // 공허 방지 ②: 그 한 장에 지연이 실제로 걸려 있었는가. 루트 토큰만 보면 스피너가 그 토큰을
      // 안 쓰고 있어도 통과하므로, 스피너 자신의 computed animation-delay를 본다
      // (애니메이션 2개 — 페이드·회전 — 이라 값도 2개다)
      expect(samples.delays[0], `스피너에 지연이 안 걸렸다 — ${trace}`).toBe('0.4s, 0.4s')

      // 토큰 정본도 함께 고정한다 — 위 0.4s가 어디서 왔는지의 근거다
      const delay = await window.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--motion-pending-delay').trim(),
      )
      expect(delay).toBe('400ms')
    } finally {
      await app.close()
    }
  } finally {
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * 픽스처 — "조회가 오래 걸린다"를 소스 변이 없이 진짜로 만든다.
 *
 * 두 번 헛짚고 나서 이 모양에 도달했다(실측):
 * ① **전면 변경된 큰 파일은 못 쓴다.** 40만 줄을 통째로 바꾸면 조회 자체는 1.7초로 충분히 느리지만,
 *    응답이 커서 렌더러가 역직렬화하느라 **주 스레드가 1.2초 멎는다**. 멎은 동안엔 CSS 애니메이션도
 *    안 돈다 — rAF 표본이 t=400ms에서 t=1676ms로 건너뛰고, 깨어났을 땐 조회가 이미 끝나 스피너가
 *    없다. 즉 "느린데 스피너가 안 보이는" 가짜 실패를 만든다.
 * ② 따라서 **주 프로세스만 오래 걸리고 응답은 작아야** 렌더러가 놀며 애니메이션을 돌린다.
 *
 * 줄을 섞은 파일이 그 조건을 만족한다 — git의 diff 계산이 비싸지고, 파일 자체는 18MB뿐이다.
 * 실측: 30만 줄 = 조회 1730ms · 최대 프레임 공백 18ms(=한 번도 안 멎었다). 표시 시작선은
 * 지연 400ms + 페이드 150ms = 550ms라 여유가 3배다. 15만 줄(1000ms)로도 뜨지만 여유가 적어 키웠다.
 */
const PENDING_SLOW_ROWS = 300_000

/** 결정적 셔플 — 시드가 고정이라 실행마다 같은 파일이 나온다(픽스처는 재현 가능해야 한다) */
function shuffledRows(seed: number): string {
  const rows = Array.from({ length: PENDING_SLOW_ROWS }, (_, i) => `row ${i} `.padEnd(60, 'y'))
  let x = seed
  for (let i = rows.length - 1; i > 0; i--) {
    x = (x * 1103515245 + 12345) % 2147483648
    const j = x % (i + 1)
    ;[rows[i], rows[j]] = [rows[j]!, rows[i]!]
  }
  return `${rows.join('\n')}\n`
}

/**
 * E14a — 느린 조회에서는 로딩 표시가 실제로 배어난다 (최종 리뷰 Note 4).
 *
 * 왜 이게 따로 필요한가: 바로 위 테스트는 "빠른 조회에서 안 보인다"만 잰다. 그것만으로는
 * `--motion-pending-delay`를 `999s`로 바꿔 스피너를 **영영 안 보이게** 만들어도 전부 초록이다.
 * 이 테스트가 반대 방향을 잡아 지연이 "안 보이게 하는 장치"가 아니라 "늦추는 장치"임을 고정한다.
 *
 * "느림"을 소스 변이나 가짜 지연으로 만들지 않는다 — 진짜 큰 파일의 진짜 diff 왕복이 느리다.
 * 픽스처 크기는 실측으로 정했다(위 상수 주석). 고정 sleep 대신 `expect.poll`로 재측정하므로,
 * 조회가 예상보다 빨리 끝나면 실패하지 느리게 통과하지 않는다.
 */
test('E14a — 느린 조회에서는 로딩 표시가 배어난다', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'git-gui-e14a-slow-'))
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  try {
    await execGitOrThrow(['init', '--initial-branch=main'], { cwd: repo })
    await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: repo })
    await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: repo })
    await writeFile(join(repo, 'small.txt'), 'base\n')
    await writeFile(join(repo, 'big.txt'), shuffledRows(1))
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow(['commit', '-m', 'init'], { cwd: repo })
    await writeFile(join(repo, 'small.txt'), 'changed\n')
    await writeFile(join(repo, 'big.txt'), shuffledRows(99))

    const app = await electron.launch({
      args: [APP_ROOT],
      env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
    })
    try {
      const window = await app.firstWindow()
      // 빠른 조회 테스트와 같은 전제 — 이미 한 파일을 보고 있는 상태에서 옮긴다
      await window.getByTestId('file-unstaged-small.txt').click()
      await expect(window.getByTestId('diff-panel')).toContainText('small.txt')

      // 표본기를 클릭 **전에** 페이지 안에 심는다 — 밖에서 폴링하면 왕복 간격 사이에 배어났다
      // 사라진 구간을 통째로 놓칠 수 있다. 페이지 안 rAF는 그 틈이 없다
      await window.evaluate(() => {
        const state = { max: -1, trace: [] as string[] }
        ;(globalThis as any).__e14aPending = state
        const t0 = performance.now()
        const tick = () => {
          const spinner = document.querySelector(
            '[data-testid="diff-panel"] [data-testid="panel-pending"]',
          )
          // -1 = DOM에 없다 (있는데 투명한 것과 구분한다)
          const value = spinner === null ? -1 : Number(getComputedStyle(spinner).opacity)
          if (value > state.max) state.max = value
          if (state.trace.length < 150)
            state.trace.push(`${Math.round(performance.now() - t0)}:${value}`)
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })

      await window.getByTestId('file-unstaged-big.txt').click()
      // 밖에서는 "지금까지 본 최대"만 폴링한다 — 고정 sleep이 없고, 배어난 순간을 놓치지 않는다
      await expect
        .poll(
          async () =>
            window.evaluate(() => {
              const state = (globalThis as any).__e14aPending
              return `${state.max} | ${state.trace.join(' ')}`
            }),
          {
            message: '느린 조회인데 스피너가 배어나지 않았다 (지연이 표시를 아예 막고 있는가?)',
            timeout: 20_000,
            intervals: [100, 100, 200, 400, 800, 1600],
          },
        )
        .toMatch(/^(0\.[6-9]|1)/)

      // 공허 방지: 스피너가 뜬 채로 조회가 끝나지 않는 게 아니라, 끝나면 사라지고 결과가 나온다
      await expect(window.getByTestId('diff-panel')).toContainText('big.txt', { timeout: 60_000 })
      await expect(window.getByTestId('diff-panel').getByTestId('panel-pending')).toHaveCount(0)
    } finally {
      await app.close()
    }
  } finally {
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E14b — 이름 짓기가 실패해도 입력한 값이 남아 있다 (E1a 요구사항 고정).
 *
 * PromptDialog는 "열릴 때 initialValue로 채우고 닫힐 때 비운다"를 useEffect + setState로 했는데,
 * react-hooks/set-state-in-effect 위반이라 remount로 바꾼다. remount 조건이 잘못되면 실패로
 * 열려 있는 동안 입력이 날아가는데(E1a가 명시한 요구사항), **그걸 고정하는 테스트가 저장소에
 * 하나도 없었다.** 구현을 바꾸기 전에 현재 동작이 초록임을 확인해 둔다.
 *
 * 실패 유도: 이미 있는 브랜치 이름으로 만들기를 시도한다 (git이 거부한다).
 */
test('E14b — 이름 짓기가 실패해도 입력한 값이 남아 있다 (E1a 요구사항 고정)', async () => {
  const repo = await createRepoWithChange()
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    // 먼저 브랜치 하나를 실제로 만든다 — 그 이름이 다음 시도의 충돌 대상이 된다
    await window.getByTestId('header-branch').click()
    await window.getByTestId('branch-new').click()
    await window.getByTestId('prompt-input').fill('dup-branch')
    await window.getByTestId('prompt-submit').click()
    await expect(window.getByTestId('header-branch')).toContainText('dup-branch')

    // 같은 이름으로 다시 시도 → git이 거부하고 다이얼로그는 열린 채 남는다
    await window.getByTestId('header-branch').click()
    await window.getByTestId('branch-new').click()
    await window.getByTestId('prompt-input').fill('dup-branch')
    await window.getByTestId('prompt-submit').click()

    // 실패가 실제로 일어났는지 먼저 확인한다 — 안 그러면 아래 단언이 공허해진다
    await expect(window.getByTestId('prompt-error')).toBeVisible()
    // 핵심: 다시 칠 필요 없이 방금 친 값이 그대로 있어야 한다 (E1a)
    await expect(window.getByTestId('prompt-input')).toHaveValue('dup-branch')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E14b — 워크트리 만들기 폼은 닫았다 다시 열면 초기화된다.
 * 같은 이유(useEffect + setState → remount)로 바꾸므로 먼저 고정한다.
 * 이쪽은 반대 방향 요구사항이다 — 닫으면 버려야 한다.
 */
test('E14b — 워크트리 만들기를 닫았다 열면 폼이 초기화된다', async () => {
  const repo = await createRepoWithChange()
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-worktrees').click()
    await window.getByTestId('worktree-add').click()
    // 기본값을 벗어난 상태를 만든다 — 모드를 바꾸고 경로를 직접 고친다
    await window.getByTestId('add-worktree-mode-new').click()
    await window.getByTestId('add-worktree-path').fill('/tmp/e14b-should-be-discarded')
    await window.getByTestId('add-worktree-cancel').click()

    // 다시 열면 방금 친 것이 남아 있으면 안 된다
    await window.getByTestId('worktree-add').click()
    await expect(window.getByTestId('add-worktree-path')).not.toHaveValue(
      '/tmp/e14b-should-be-discarded',
    )
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E14b 후속 (적대적 리뷰 IMPORTANT 1) — **`useNow()`가 실제로 시간을 흘려보내는지에 그물을 건다.**
 *
 * 리뷰어 실측: `use-now.ts`의 구독을 통째로 지워도(`useEffect(() => subscribeNow(...), [])`
 * → `useEffect(() => {}, [])`) 단위 6건이 **전부 초록**이었다. 그 6건은 `subscribeNow`와
 * `NOW_TICK_MS`만 import하고 `useNow`는 **아무도 부르지 않는다** — 즉 이 에픽이 고치겠다고
 * 나선 버그(시간이 흘러도 상대 시각이 멈춰 있다)가 그대로 되살아나도 게이트가 초록이다.
 * 유일하게 상대 시각을 스치는 E2E(:2019 `toContainText('방금 전')`)도 시계가 멈춘 채로 통과한다.
 *
 * 시계를 빠르게 만드는 방법 — **프로덕션 코드를 건드리지 않는다.** Playwright의 clock API로
 * 이 창의 `Date`·`setInterval`을 통째로 가짜로 바꾼 뒤 3분을 앞으로 감는다.
 * `clock.install()`은 그 시점 **이후에** 만들어지는 타이머만 가짜로 잡는데, `subscribeNow`의
 * `setInterval`은 이미 마운트 때 진짜로 걸려 있다 — 그래서 install 직후 `reload()`로 앱을 다시
 * 띄워 구독이 가짜 타이머 위에서 다시 걸리게 한다. 대안이었던 "테스트용 훅을 프로덕션에 심어
 * NOW_TICK_MS를 줄인다"는 택하지 않았다: 제품 코드에 테스트 전용 분기가 생기는 데다, 그렇게
 * 하면 정작 검증 대상인 60초 상수 자체가 테스트에서 빠져 그물이 헐거워진다.
 *
 * 이 단언이 그물인 근거 — 화면의 "n분 전"은 `formatRelativeTime(commit.committedAt, now)`이고
 * `now`는 `useNow()`의 **state**다. 리렌더만으로는 절대 안 바뀌고 오직 구독 콜백의
 * `setNow(Date.now())`로만 바뀐다. 구독을 지우면 fastForward로 시간을 감아도 화면은 "방금 전"에
 * 멈춘다(실측: 아래 falsification).
 */
test('E14b — 시간이 흐르면 상대 시각이 스스로 갱신된다 (useNow 구독 회귀)', async () => {
  const repo = await createRepoWithChange()
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    const row = window.locator('[data-testid^="history-item-"]').first()
    // 방금 만든 픽스처 커밋이라 60초 미만 — 여기가 흔들리면 아래 "3분 전"의 전제가 깨지므로
    // 먼저 못박는다(실패해도 원인이 분명하게 보이도록)
    await expect(row).toContainText('방금 전')

    // 가짜 시계를 심고 앱을 다시 띄운다 — 이 reload 뒤의 구독이 가짜 setInterval을 쓴다
    await window.clock.install()
    await window.reload()
    const rowAfterReload = window.locator('[data-testid^="history-item-"]').first()
    await expect(rowAfterReload).toContainText('방금 전')

    // 3분 앞으로. NOW_TICK_MS(60초) 틱이 3번 발화하고 Date.now()도 함께 흐른다
    await window.clock.fastForward(3 * 60_000)
    await expect(rowAfterReload).toContainText('3분 전')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E14b 후속 (적대적 리뷰 IMPORTANT 3) — **`expandRightIfCollapsed()` 호출부에 그물을 건다.**
 *
 * Task 5는 "우측이 접힌 채로 죽은 클릭을 만들지 않는다"를 호출부마다 부르는 방식으로 구현했고
 * (App.tsx:635 보관함 미리보기 · :1152 타임라인 선택), 그때 "새 호출부가 잊을 수 있다"는 위험을
 * 명시적으로 감수했다. 리뷰어 실측: 보관함 쪽 호출을 지워도 기존 「보관함」 E2E 5건이 **전부
 * 초록**이었다 — 감수한 위험에 아무 그물이 없었다.
 *
 * 보관함 버튼은 헤더(우측 열 바깥)에 있어 우측이 접힌 상태에서도 누를 수 있는, 이 규칙의 유일한
 * 실사용 경로다. 여기만 막으면 두 호출부 중 실제로 도달 가능한 쪽이 덮인다
 * (타임라인 쪽은 우측 안이라 접힌 동안 inert라 애초에 닿지 않는다 — App.tsx:1150 주석).
 */
test('E14b — 우측을 접은 채 보관함을 미리 보면 우측이 저절로 펴진다', async () => {
  const repo = await createRepoWithChange()
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    const right = window.locator('.app__right')
    await expect(right).toBeVisible()

    // 우측을 접는다 — 240ms 전환이 끝나 폭 0이 될 때까지 기다린다
    await window.getByTestId('right-collapse-toggle').click()
    await expect.poll(async () => (await right.boundingBox())!.width, { timeout: 2000 }).toBe(0)

    // 헤더의 보관함은 접힌 상태에서도 눌린다 — 여기서 미리 보면 결과는 우측에 뜬다
    await window.getByTestId('shelf-open').click()
    await window.getByTestId('shelf-save').click()
    await expect(window.getByTestId('shelf-count')).toHaveText('1')
    await window.getByTestId('shelf-preview-stash@{0}').click()

    // 죽은 클릭이 아니어야 한다 — 우측이 다시 폭을 갖고, 그 안에 커밋 상세가 보인다
    await expect
      .poll(async () => (await right.boundingBox())!.width, { timeout: 2000 })
      .toBeGreaterThan(0)
    await expect(window.getByTestId('commit-detail-panel')).toBeVisible()
    await expect(window.getByTestId('commit-file-app.txt')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E15a — 저장소를 바꿔도 **옛 저장소의 상태가 화면에 남으면 안 된다.**
 *
 * 전환 기계(openRepository)는 처음부터 있었지만 부를 방법이 없어(E15a 전) 이 경로가 실제로
 * 쓰인 적이 없었다. 스토어 필드를 openRepository가 덮는 것과 전수 대조해 유출 3건을 찾았고,
 * 그중 화면에 드러나는 둘을 여기서 잡는다:
 *
 * - `lastFetchAt` — 브랜치 탭의 "n분 전 가져옴". 옛 저장소에서 가져온 시각이 새 저장소 것처럼 남는다
 * - `activeWorktree` — 스토어 밖(App useState)이라 openRepository가 닿지 않는다. 도크 헤더의
 *   워크트리 이름이 옛 저장소를 가리키고, 같은 값이 터미널 cwd(groupKey)라 셸이 옛 폴더에서 뜬다
 *
 * 세 번째 유출인 `headInfos`(경로::HEAD 캐시)는 스토어에만 남고 화면에 드러나지 않아 여기서
 * 단언하지 않는다 — 스토어를 renderer 밖으로 노출하지 않는다.
 */
test('E15a — 저장소를 바꾸면 옛 저장소의 흔적(가져옴 시각·워크트리 대상)이 남지 않는다', async () => {
  // 저장소 A: 원격이 있어야 「가져오기」가 lastFetchAt을 남긴다 + 워크트리 하나
  const repoA = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repoA })
  const remote = await addBareRemote(repoA)
  await execGitOrThrow(['push', '-u', 'origin', 'main'], { cwd: repoA })
  await execGitOrThrow(['branch', 'switch-side'], { cwd: repoA })
  const wtPath = `${repoA}-side`
  await execGitOrThrow(['worktree', 'add', '--end-of-options', wtPath, 'switch-side'], {
    cwd: repoA,
  })
  // 저장소 B: 전환 대상. 최근 목록에 미리 넣어 두면 다이얼로그 없이 전환기에서 고를 수 있다
  const repoB = await createRepoWithChange()
  const repoBPath = realpathSync(repoB)
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  // 자동 가져오기를 끈다 — 켜져 있으면 전환 뒤 주기 작업이 lastFetchAt을 다시 채워 단언이 흔들린다
  await writeFile(
    join(userData, 'settings.json'),
    JSON.stringify({ autoFetch: false, recentRepos: [repoBPath] }),
  )
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repoA, GIT_GUI_USER_DATA: userData },
  })
  const sideName = basename(wtPath)
  const repoBName = basename(repoBPath)
  try {
    const window = await app.firstWindow()

    // ① 저장소 A에서 흔적을 만든다 — 터미널 대상을 워크트리로, 그리고 한 번 가져오기
    await window.getByTestId('left-tab-worktrees').click()
    await window.getByTestId(`worktree-row-${sideName}`).click()
    await expect(window.locator('.terminal-dock__hint')).toContainText(sideName)
    await window.getByTestId('left-tab-branches').click()
    await window.getByTestId('fetch-remotes').click()
    await expect(window.getByTestId('fetch-at')).toContainText('방금 전')

    // ② 전환기로 저장소 B
    await window.getByTestId('repo-switcher').click()
    await window.getByTestId(`repo-switcher-item-${repoBPath}`).click()
    await expect(window.getByTestId('repo-path')).toContainText(repoBName)

    // ③ 흔적이 없다 — 유출이 서로 독립이라 soft로 둔다. 하나가 걸려도 나머지 결과까지 함께 나온다
    // lastFetchAt — 새 저장소에서는 아직 가져온 적이 없으니 표시 자체가 없어야 한다
    await expect.soft(window.getByTestId('fetch-at')).toHaveCount(0)
    // activeWorktree — 도크 헤더가 옛 워크트리가 아니라 새 저장소를 가리켜야 한다
    await expect.soft(window.locator('.terminal-dock__hint')).not.toContainText(sideName)
    await expect.soft(window.locator('.terminal-dock__hint')).toContainText(repoBName)
  } finally {
    await app.close()
    await rm(repoA, { recursive: true, force: true })
    await rm(wtPath, { recursive: true, force: true })
    await rm(remote, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E15a 전환 픽스처 (Task 4 실측 관용구) — 전환기 목록에 저장소를 넣는 유일한 방법은
 * `userData/settings.json`에 `recentRepos`를 미리 심는 것이다(`repo-switcher-browse`는 네이티브
 * 다이얼로그라 Playwright로 못 연다). `autoFetch: false`도 필수다 — 켜져 있으면 전환 뒤 주기
 * 작업이 상태를 다시 채워 단언이 흔들린다.
 */
async function seedRecentRepos(recentRepos: string[]): Promise<string> {
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ autoFetch: false, recentRepos }))
  return userData
}

/**
 * 팝오버에 그려진 항목의 testid를 위에서 아래 순서대로 — 마지막 하나는 늘 '다른 폴더 열기'.
 *
 * `evaluateAll`엔 auto-wait이 없다 — 팝오버가 아직 안 그려졌으면 조용히 `[]`를 돌려주고,
 * `toEqual([...])`은 그걸 "목록이 다르다"로 실패시키므로 진짜 회귀와 타이밍 흔들림이 구분되지
 * 않는다. 항상 마지막에 있는 '다른 폴더 열기'가 보일 때까지 먼저 기다린다 (E15a 리뷰 후속 노트)
 */
async function switcherItemIds(window: Page): Promise<(string | null)[]> {
  await expect(window.getByTestId('repo-switcher-browse')).toBeVisible()
  return window
    .locator('.repo-switcher__item')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
}

/**
 * E15a ① — 전환기로 다른 저장소를 열면 **화면이 그 저장소의 내용으로** 바뀐다.
 *
 * 경로 텍스트(`repo-path`)만 보면 헤더 한 줄만 갈아끼우고 아래는 옛 저장소를 그리는 회귀를
 * 놓친다 — 그래서 두 저장소의 변경 파일 이름을 다르게 두고 목록까지 확인한다.
 *
 * ⌘F 스코프 단언을 여기 얹은 이유: E14b가 `findScopeRepo !== store.repoPath`일 때
 * `setFindScope(null)`로 옛 스코프를 무효화하도록 고쳤는데(App.tsx:402), 그때는 저장소를 두 번
 * 여는 E2E가 저장소에 **하나도 없어** 코드 리뷰로만 지켜지고 있었다. 이 에픽이 그 시나리오를
 * 처음 만드므로 같은 창에서 함께 문다.
 */
test('E15a — 전환기로 다른 저장소를 열면 화면이 그 저장소의 내용으로 바뀐다', async () => {
  const repoA = await createRepoWithChange()
  const repoB = await createRepoWithFile('beta.txt')
  const repoBPath = realpathSync(repoB)
  const userData = await seedRecentRepos([repoBPath])
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repoA, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    // 저장소 A — 자기 파일이 보이고, 히스토리에 찾기가 열려 있다
    await expect(window.getByTestId('file-unstaged-app.txt')).toBeVisible()
    await hoverAndCmdF(window, '[data-testid="history-panel"]')
    await expect(window.getByTestId('find-bar')).toBeVisible()

    // 전환
    await window.getByTestId('repo-switcher').click()
    await window.getByTestId(`repo-switcher-item-${repoBPath}`).click()

    // 헤더도, 파일 목록도 저장소 B다 — A의 파일은 흔적도 없어야 한다
    await expect(window.getByTestId('repo-path')).toHaveText(repoBPath)
    await expect(window.getByTestId('file-unstaged-beta.txt')).toBeVisible()
    await expect(window.getByTestId('file-unstaged-app.txt')).toHaveCount(0)
    // E14b — 옛 저장소를 겨냥해 열린 찾기는 전환과 함께 닫힌다
    await expect(window.getByTestId('find-bar')).toHaveCount(0)
  } finally {
    await app.close()
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E15a ② — 최근 목록은 재시작을 넘어 남는다. **순서까지** 본다.
 *
 * 단순히 "B가 목록에 있다"로는 아무것도 증명하지 못한다 — B는 이 테스트가 직접 심은 값이라
 * 앱이 한 줄도 저장하지 않아도 통과한다. 그래서 `[C, B]`로 심고 B로 전환한 뒤(최신이 앞이므로
 * `[B, C]`가 되어야 한다) 재시작해 **뒤집힌 순서가 남았는지**를 본다. 저장이 빠지면 파일은
 * 심어둔 `[C, B]` 그대로라 빨개진다.
 *
 * 같은 `GIT_GUI_USER_DATA`로 두 번 launch한다 — 호출자가 직접 넘긴 경우에만 harness가
 * 매번 새 mkdtemp를 주입하지 않고 존중한다(harness.ts:32).
 */
test('E15a — 최근 목록은 재시작 후에도 남는다 (최신이 앞)', async () => {
  const repoA = await createRepoWithChange()
  const repoB = await createRepoWithFile('beta.txt')
  const repoC = await createRepoWithFile('gamma.txt')
  const [pathA, pathB, pathC] = [repoA, repoB, repoC].map((p) => realpathSync(p))
  const userData = await seedRecentRepos([pathC, pathB])
  const env = { ...process.env, GIT_GUI_E2E_REPO: repoA, GIT_GUI_USER_DATA: userData }
  const app = await electron.launch({ args: [APP_ROOT], env })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('repo-switcher').click()
    // 심어둔 순서 그대로 — 지금 저장소(A)만 맨 앞에 얹혀 있다
    expect(await switcherItemIds(window)).toEqual([
      `repo-switcher-item-${pathA}`,
      `repo-switcher-item-${pathC}`,
      `repo-switcher-item-${pathB}`,
      'repo-switcher-browse',
    ])
    await window.getByTestId(`repo-switcher-item-${pathB}`).click()
    await expect(window.getByTestId('repo-path')).toHaveText(pathB)
  } finally {
    await app.close()
  }
  // 재시작 — 방금 연 B가 C보다 앞에 있어야 한다 (심어둔 순서는 그 반대였다)
  const second = await electron.launch({ args: [APP_ROOT], env })
  try {
    const window = await second.firstWindow()
    await window.getByTestId('repo-switcher').click()
    expect(await switcherItemIds(window)).toEqual([
      `repo-switcher-item-${pathA}`,
      `repo-switcher-item-${pathB}`,
      `repo-switcher-item-${pathC}`,
      'repo-switcher-browse',
    ])
  } finally {
    await second.close()
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
    await rm(repoC, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E15a ③ — 없어진 폴더를 누르면 열리지 않고, 그 자리에서 목록에서 빠진다.
 *
 * 최근 목록의 항목은 언제든 지워지거나 옮겨질 수 있다. 검증은 main이 한다.
 *
 * E15a 리뷰 ④로 문구가 갈렸다 — 예전엔 모든 실패가 "이제 Git 저장소가 아니에요"였다.
 * 지워진 폴더에서 `execGit`은 spawn 단계에서 ENOENT로 reject하는데(Task 2 실측:
 * "spawn git ENOENT"), **PATH에 git이 없을 때도 바이트까지 같은 오류가 온다**(리뷰 ④ 실측).
 * 그래서 폴더 존재는 이제 fs.stat에게 묻고, 없어진 폴더는 자기 문구를 받는다.
 *
 * 목록 제거는 스토어의 `try/catch` 안에서 일어난다(호출부가 아니라) — `runWrite`는 재진입
 * 거부(busy)에도 `false`를 주므로 호출부에서 판정하면 멀쩡한 저장소를 목록에서 날린다.
 */
test('E15a — 없어진 저장소를 누르면 열리지 않고 최근 목록에서 빠진다', async () => {
  const repoA = await createRepoWithChange()
  const repoB = await createRepoWithFile('beta.txt')
  const pathA = realpathSync(repoA)
  const pathB = realpathSync(repoB)
  const userData = await seedRecentRepos([pathB])
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repoA, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('file-unstaged-app.txt')).toBeVisible()
    // 목록에 남은 채 폴더만 사라진 상태를 만든다 — 사용자가 Finder에서 지운 그 경우다
    await rm(repoB, { recursive: true, force: true })

    await window.getByTestId('repo-switcher').click()
    await window.getByTestId(`repo-switcher-item-${pathB}`).click()

    // 열리지 않았다 — 화면은 그대로 A이고 이유가 문구로 뜬다 (E15a 리뷰 ④: "저장소가 아니다"가
    // 아니라 "폴더가 없다" — 사인을 단정하지 않는다)
    await expect(window.getByTestId('error')).toContainText('그 폴더가 없어요')
    await expect(window.getByTestId('repo-path')).toHaveText(pathA)
    await expect(window.getByTestId('file-unstaged-app.txt')).toBeVisible()

    // 그리고 목록에서 빠졌다 — 다시 열어 보면 A(지금 저장소)와 '다른 폴더 열기'만 남는다
    await window.getByTestId('repo-switcher').click()
    expect(await switcherItemIds(window)).toEqual([
      `repo-switcher-item-${pathA}`,
      'repo-switcher-browse',
    ])
  } finally {
    await app.close()
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true }).catch(() => {})
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E15a ④ — ⌘O가 폴더 선택을 연다.
 *
 * OS 폴더 선택 다이얼로그는 Playwright로 열 수도 닫을 수도 없다. 대신 main에서 `repo:select`
 * IPC 핸들러를 감싸 호출 수를 센다 — E14b가 `repo:status`에 이미 쓴 기법이다(:3235). 원본을
 * 부르지 않고 `null`(사용자가 취소한 것과 같은 응답)을 돌려주므로 다이얼로그가 실제로 뜨지
 * 않는다. `_invokeHandlers`는 Electron 내부 필드라 업그레이드하면 깨질 수 있지만, 그때
 * `patched` 단언이 조용히 통과하는 대신 명시적으로 실패한다.
 */
test('E15a — ⌘O가 폴더 선택을 연다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('file-unstaged-app.txt')).toBeVisible()

    const patched = await app.evaluate(({ ipcMain }) => {
      const impl = ipcMain as unknown as {
        _invokeHandlers: Map<string, (...args: unknown[]) => unknown>
      }
      const original = impl._invokeHandlers.get('repo:select')
      if (original === undefined) return false
      const globals = globalThis as unknown as { __selectCalls: number }
      globals.__selectCalls = 0
      // 다이얼로그를 실제로 띄우지 않도록 원본을 부르지 않고 null(취소)로 답한다
      impl._invokeHandlers.set('repo:select', () => {
        globals.__selectCalls += 1
        return null
      })
      return true
    })
    // 계측이 안 걸렸는데 0건을 세고 통과하는 공허한 성공을 막는다
    expect(patched, 'repo:select 핸들러를 감싸지 못했다 — 이 테스트는 아무것도 재지 못한다').toBe(
      true,
    )

    await window.keyboard.press('Meta+o')
    await expect
      .poll(
        () =>
          app.evaluate(() => (globalThis as unknown as { __selectCalls: number }).__selectCalls),
        { timeout: 5_000 },
      )
      .toBe(1)
    // 취소로 답했으니 열려 있던 저장소는 그대로다
    await expect(window.getByTestId('repo-path')).toHaveText(realpathSync(repo))
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

/**
 * 위 테스트의 `repo:select` 감싸기를 재사용 가능하게 꺼낸 것 (E15a 리뷰 ②).
 *
 * `picked`가 `null`이면 "사용자가 취소"와 같은 응답이라 다이얼로그도, 전환도 일어나지 않는다.
 * 경로를 주면 **⌘O로 실제 전환**을 일으킬 수 있다 — 네이티브 다이얼로그를 Playwright로 못 여는
 * 이 스위트에서 ⌘O 경로를 끝까지 도는 유일한 방법이다.
 *
 * 경로를 그냥 돌려주면 안 된다(실측): main은 자기가 **직접 검증해 등록한** 경로만 신뢰하므로
 * (`allowedRepoPaths`), 등록을 건너뛴 경로로는 이어지는 `repo:status`가 "열려 있지 않은 저장소
 * 경로예요"로 거부돼 전환이 통째로 실패한다. 그래서 `repo:open` 핸들러에 그대로 위임한다 —
 * 검증·정규화·allowlist 등록이 실제 코드로 일어나고, 이 헬퍼는 다이얼로그만 대신한다.
 *
 * 계측 실패는 조용히 넘어가지 않는다 — false를 돌려주므로 호출부가 명시적으로 단언한다.
 */
async function stubRepoSelect(app: ElectronApplication, picked: string | null): Promise<boolean> {
  return app.evaluate(({ ipcMain }, result) => {
    const impl = ipcMain as unknown as {
      _invokeHandlers: Map<string, (...args: unknown[]) => unknown>
    }
    const open = impl._invokeHandlers.get('repo:open')
    if (impl._invokeHandlers.get('repo:select') === undefined || open === undefined) return false
    const globals = globalThis as unknown as { __selectCalls: number }
    globals.__selectCalls = 0
    impl._invokeHandlers.set('repo:select', async (event, ..._rest) => {
      globals.__selectCalls += 1
      if (result === null) return null
      // 받은 event를 그대로 넘긴다 — 실제 검증·등록 경로를 그대로 탄다.
      // E15b 전에는 `open(null, result)`였다("핸들러는 event를 안 쓴다"). 그 가정은 E15b에서
      // 거짓이 됐다 — repo:open이 event.sender.id로 이 창의 저장소를 창 레지스트리에 반영한다
      const opened = (await open(event, result)) as { ok: boolean; path?: string }
      return opened.ok ? (opened.path ?? null) : null
    })
    return true
  }, picked)
}

const selectCalls = (app: ElectronApplication): Promise<number> =>
  app.evaluate(() => (globalThis as unknown as { __selectCalls: number }).__selectCalls)

/**
 * E15a 리뷰 ② — 도크 터미널이 포커스면 ⌘O를 가로채지 않는다.
 *
 * ⌘O의 조건은 `metaKey || ctrlKey`라 **macOS에서도 Ctrl+O가 잡힌다.** 그건 도크 터미널에서
 * nano의 저장(Ctrl+O)이고 readline의 operate-and-get-next다 — 가드가 없으면 그것들이
 * `preventDefault()`로 삼켜지고 대신 폴더 선택창이 뜬다. 회피 관례는 25줄 위 ⌘F에 이미 있었다.
 *
 * 마지막의 "밖에서 누르면 1건"이 없으면 이 테스트는 공허하다 — 0건은 "가드가 먹었다"로도
 * "키가 애초에 앱까지 안 갔다"로도 통과한다. 대조가 있어야 계측이 살아 있음이 증명된다.
 */
test('E15a — 도크 터미널이 포커스면 ⌘O·Ctrl+O를 가로채지 않는다', async () => {
  const repo = await createRepoWithChange()
  // 터미널 토글은 dockOpen을 영속한다 — 이전 터미널 테스트의 열림 상태를 물려받지 않도록 격리
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('file-unstaged-app.txt')).toBeVisible()
    const patched = await stubRepoSelect(app, null)
    expect(patched, 'repo:select 핸들러를 감싸지 못했다 — 이 테스트는 아무것도 재지 못한다').toBe(
      true,
    )

    await window.getByTestId('terminal-toggle').click()
    await expect(window.getByTestId('terminal-dock')).toBeVisible()
    await expect(window.locator('.terminal-dock__view .xterm')).toBeVisible()
    await window.locator('.terminal-dock__view').first().click()

    // 터미널이 먹어야 할 키들 — 앱은 손대지 않는다
    await window.keyboard.press('Control+o')
    await window.keyboard.press('Meta+o')

    // 대조: 포커스를 터미널 밖으로 옮기면 같은 키가 이번엔 폴더 선택을 연다.
    // 위 두 번이 세어졌다면 여기서 카운트가 3이 되어 이 단언이 절대 통과하지 못한다
    await window.getByTestId('left-tab-changes').click()
    await window.keyboard.press('Meta+o')
    await expect.poll(() => selectCalls(app), { timeout: 5_000 }).toBe(1)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E15a 리뷰 ②-b — ⌘O 전환은 옛 저장소에 매인 확인창을 남기지 않는다.
 *
 * 다이얼로그들은 `isOpen={x !== null}`로만 그려질 뿐 `repoPath`에 안 묶여 있어 전환 뒤에도
 * 살아남는다. 그 안의 이름·해시·경로는 **옛 저장소의 것**인데 확정하면 **새 저장소를 대상으로
 * 실행된다.** 헤더 전환기는 모달 오버레이에 막히므로 이 경로는 ⌘O 전용이다.
 *
 * 태그 입력창을 고른 이유: `tagPrompt`가 우클릭한 저장의 **해시**를 물고 있어 "페이로드가 옛
 * 저장소 것"이 눈에 보이는 가장 값싼 경로다(이 스위트의 태그 관용구 재사용 — :1237).
 * 전환이 실제로 일어났는지를 먼저 단언하므로, ⌘O가 모달 위에서 안 돌아도 조용히 통과하지 않는다.
 */
test('E15a — ⌘O 전환은 옛 저장소에 매인 확인창을 남기지 않는다', async () => {
  const repoA = await createRepoWithChange()
  const repoB = await createRepoWithFile('beta.txt')
  const pathB = realpathSync(repoB)
  const userData = await seedRecentRepos([])
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repoA, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('file-unstaged-app.txt')).toBeVisible()
    // ⌘O가 열 OS 다이얼로그를 대신해 "저장소 B를 골랐다"로 답한다
    const patched = await stubRepoSelect(app, pathB)
    expect(patched, 'repo:select 핸들러를 감싸지 못했다 — 이 테스트는 아무것도 재지 못한다').toBe(
      true,
    )

    // 저장소 A의 저장 하나를 겨냥한 입력창 — 안에 A의 해시가 들어 있다
    await window.locator('[data-testid^="history-item-"]').first().click({ button: 'right' })
    await window.getByTestId('context-tag-here').click()
    await expect(window.getByTestId('prompt-input')).toBeVisible()

    await window.keyboard.press('Meta+o')

    // 전환이 실제로 일어났는가 (공허한 통과 방지 — 모달 위에서 ⌘O가 안 돌면 여기서 걸린다)
    await expect(window.getByTestId('repo-path')).toHaveText(pathB)
    await expect(window.getByTestId('file-unstaged-beta.txt')).toBeVisible()
    // 그리고 A의 해시를 문 입력창은 남지 않았다
    await expect(window.getByTestId('prompt-input')).toHaveCount(0)
  } finally {
    await app.close()
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E15b ① — 창을 새로 띄우고 두 창을 각각 조작할 수 있다.
 *
 * **이 에픽의 관문이다.** E15b 전까지 이 저장소의 E2E 135건은 전부 창 하나(firstWindow)를
 * 전제로 짜여 있었고, E2E는 창을 숨긴 채 띄운다(GIT_GUI_E2E_SHOW가 없으면 show()를 안 부른다 —
 * main/index.ts의 ready-to-show 분기). "숨긴 두 번째 창이 Playwright의 window 이벤트에 잡히고
 * 렌더까지 되는가"가 미지수였고, 나머지 태스크가 전부 이 위에 선다.
 *
 * 경로 텍스트만 보면 헤더 한 줄만 갈아끼우는 회귀를 놓치므로(E15a ①과 같은 이유) 두 저장소의
 * 변경 파일 이름을 다르게 두고 두 번째 창의 **내용**까지 확인한다.
 */
test('E15b — 새 창이 뜨고 두 창을 각각 조작할 수 있다', async () => {
  const repoA = await createRepoWithChange()
  const repoB = await createRepoWithFile('beta.txt')
  // main은 --show-toplevel로 정규화한 경로를 돌려준다 — 심링크(/var → /private/var)를 푼 값이다
  const pathA = realpathSync(repoA)
  const pathB = realpathSync(repoB)
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repoA },
  })
  try {
    const first = await app.firstWindow()
    await expect(first.getByTestId('file-unstaged-app.txt')).toBeVisible()

    // 창을 여는 동작보다 **먼저** 대기를 걸어 둔다 — waitForEvent는 이후에 열리는 창만 준다
    const pending = nextWindow(app)
    // page.evaluate는 인자를 **하나**만 넘긴다(첫 파라미터가 그 값이다) — locator.evaluate의
    // (element, arg) 시그니처와 헷갈리면 undefined가 main으로 가 검증에서 튕긴다
    await first.evaluate((path: string) => window.gitApi.window.open(path), pathB)
    const second = await pending
    await second.locator('.app__header').waitFor()

    // 두 창이 서로 다른 저장소를 보고, 각각 조작이 닿는다
    expect(app.windows()).toHaveLength(2)
    await expect(first.getByTestId('repo-path')).toHaveText(pathA)
    await expect(second.getByTestId('repo-path')).toHaveText(pathB)
    await expect(second.getByTestId('file-unstaged-beta.txt')).toBeVisible()
    await expect(second.getByTestId('file-unstaged-app.txt')).toHaveCount(0)
  } finally {
    await app.close()
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
  }
})

/**
 * E15b ② — 창 B를 열고 닫아도 창 A의 외부 변경 감지(E10)가 산다.
 *
 * 이건 여러 창이 생기면서 나는 결함이 아니라 **이미 있던 결함**이다. stopWatching이 모듈
 * 하나의 `let`이라 (1) 새 창이 watch를 부르는 순간 옛 창의 감시가 꺼지고 (2) 창 B를 닫으면
 * 그 시점 B를 가리키던 `let`이 null이 돼 A는 되살아나지도 않는다. A는 조용히 E10을 잃고
 * 사용자는 "왜 갱신이 안 되지"만 겪는다.
 *
 * **대기가 창 포커스에 기대면 안 된다** — index.ts의 window.on('focus')가 재조회를 쏘므로
 * 감시가 죽어 있어도 통과할 수 있다. E2E는 창을 숨긴 채 띄우고(GIT_GUI_E2E_SHOW 없음) 이
 * 테스트는 창을 클릭·포커스하지 않는다. 실측: 수정 전 이 테스트는 15초 타임아웃으로 빨갛다
 * (B를 닫아도 A에 포커스 재조회가 가지 않는다는 뜻이다).
 */
test('E15b — 창 B를 닫아도 창 A의 외부 변경 감지가 산다', async () => {
  const repoA = await createRepoWithChange()
  const repoB = await createRepoWithFile('beta.txt')
  const pathB = realpathSync(repoB)
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repoA },
  })
  try {
    const first = await app.firstWindow()
    await expect(first.getByTestId('file-unstaged-app.txt')).toBeVisible()

    const pending = nextWindow(app)
    await first.evaluate((path: string) => window.gitApi.window.open(path), pathB)
    const second = await pending
    await expect(second.getByTestId('file-unstaged-beta.txt')).toBeVisible()

    // 창 B를 닫는다 — 수정 전에는 여기서 (이미 꺼져 있던) A의 감시가 되살아날 길도 사라진다
    await second.close()

    // A의 저장소에 앱 밖에서 새 파일을 만든다. A의 감시가 살아 있으면 새로고침 없이 나타난다
    await writeFile(join(repoA, 'watch-alive.txt'), '외부 변경\n')
    await expect(first.getByTestId('file-unstaged-watch-alive.txt')).toBeVisible({
      timeout: 15_000,
    })
  } finally {
    await app.close()
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
  }
})

/**
 * E15b ③ — 사이드 접힘은 창마다 따로 산다.
 *
 * 설정 열한 개 중 레이아웃 다섯(사이드 접힘·우측 폭·터미널 열림/높이)만 창별이고 나머지는 앱
 * 공용이다. 렌더러는 이 구분을 모른다 — main이 settings:get-sync에서 event.sender로 창을 찾아
 * 앱 공용과 그 창의 layout을 합쳐 평평하게 돌려주고, settings:set에서 성격에 따라 갈라 저장한다.
 *
 * **"두 창의 화면이 서로 다르다"만 보면 공허하다** — 렌더러 상태는 원래 창마다 따로다(수정 전
 * 코드도 통과한다). 그래서 이 테스트는 **갈라 저장한 값이 다시 읽히는 길**을 문다:
 * A를 접은 **뒤** A에서 새 창 B를 열면, B는 열어준 창의 layout을 씨앗으로 받으므로 접힌 채
 * 떠야 한다. 그 씨앗은 registry.setLayout(설정 저장)과 get-sync의 layout 병합(설정 읽기)을
 * 둘 다 지나야만 도착한다 — 어느 하나를 빼면 B가 펼쳐진 채 떠서 빨개진다(반증 실측).
 *
 * 접힘 확인은 E12의 관용구를 따른다 — 접힘은 언마운트가 아니라 폭 0이라(E13, 트랙 유지)
 * `.app__left`는 count 1로 남고 not.toBeVisible + boundingBox 폭 0으로 본다. 클릭 뒤에는
 * --motion-slow(240ms) 전환이 있어 여유를 두지만, 새로 뜬 창은 부팅 억제(noColumnTransition)라
 * 전환 없이 즉시 0px로 시작한다.
 */
test('E15b — 사이드 접힘은 창마다 따로 산다', async () => {
  const repoA = await createRepoWithChange()
  const repoB = await createRepoWithFile('beta.txt')
  const pathB = realpathSync(repoB)
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repoA },
  })
  try {
    const first = await app.firstWindow()
    await expect(first.locator('.app__left')).toBeVisible()

    // A만 접는다 — 이 값은 앱 설정 파일이 아니라 A의 레지스트리 항목으로 간다
    await first.getByTestId('left-collapse-toggle').click()
    await first.waitForTimeout(320)
    await expect(first.locator('.app__left')).not.toBeVisible()

    const pending = nextWindow(app)
    await first.evaluate((path: string) => window.gitApi.window.open(path), pathB)
    const second = await pending
    await expect(second.getByTestId('file-unstaged-beta.txt')).toBeVisible()

    // B는 열어준 창(접힌 A)을 닮아 접힌 채 뜬다 — 저장과 읽기가 둘 다 창별로 돌았다는 뜻이다
    await expect(second.locator('.app__left')).toHaveCount(1)
    await expect(second.locator('.app__left')).not.toBeVisible()
    expect((await second.locator('.app__left').boundingBox())!.width).toBe(0)

    // B만 펼친다 — A는 접힌 채 남는다(한쪽의 저장이 다른 쪽을 덮지 않는다)
    await second.getByTestId('left-collapse-toggle').click()
    await expect(second.locator('.app__left')).toBeVisible()
    await expect(first.locator('.app__left')).not.toBeVisible()
    expect((await first.locator('.app__left').boundingBox())!.width).toBe(0)
  } finally {
    await app.close()
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
  }
})

/**
 * E15b ④ — 전환기 항목 ⌥클릭은 **전환이 아니라 새 창**이다.
 *
 * 같은 항목의 평범한 클릭은 이 창을 갈아탄다(E15a ①). ⌥를 얹으면 이 창은 그대로 두고 새 창이
 * 뜬다 — 그래서 "새 창이 B다"만으로는 모자라고 **원래 창이 여전히 A인지**까지 봐야 갈아타기와
 * 구분된다. react-aria의 onAction은 수식 키를 안 주므로 구현은 항목의 onPointerDown에서 altKey를
 * 기억한다 — 이 테스트가 그 경로(Playwright의 modifiers가 pointerdown까지 실리는가)를 문다.
 */
test('E15b — 전환기 ⌥클릭은 전환이 아니라 새 창을 연다', async () => {
  const repoA = await createRepoWithChange()
  const repoB = await createRepoWithFile('beta.txt')
  const pathA = realpathSync(repoA)
  const pathB = realpathSync(repoB)
  const userData = await seedRecentRepos([pathB])
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repoA, GIT_GUI_USER_DATA: userData },
  })
  try {
    const first = await app.firstWindow()
    await expect(first.getByTestId('file-unstaged-app.txt')).toBeVisible()
    await first.getByTestId('repo-switcher').click()
    // 팝오버가 다 그려질 때까지 — 항상 마지막에 있는 '다른 폴더 열기'로 기다린다 (E15a 관례)
    await expect(first.getByTestId('repo-switcher-browse')).toBeVisible()

    // 창을 여는 동작보다 **먼저** 대기를 걸어 둔다 — waitForEvent는 이후에 열리는 창만 준다
    const pending = nextWindow(app)
    await first.getByTestId(`repo-switcher-item-${pathB}`).click({ modifiers: ['Alt'] })
    const second = await pending
    await expect(second.getByTestId('file-unstaged-beta.txt')).toBeVisible()
    await expect(second.getByTestId('repo-path')).toHaveText(pathB)

    // 원래 창은 갈아타지 않았다 — 헤더도, 파일 목록도 여전히 A다
    await expect(first.getByTestId('repo-path')).toHaveText(pathA)
    await expect(first.getByTestId('file-unstaged-app.txt')).toBeVisible()
  } finally {
    await app.close()
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E15b ⑤ — 이미 그 저장소를 연 창이 있으면 새로 만들지 않고 그 창을 앞으로 가져온다 (사용자 결정).
 *
 * **"창이 안 늘었다"만 보면 공허하다** — window:open이 통째로 throw해도, 아무것도 안 해도
 * 통과한다. 그래서 셋을 함께 문다: (1) evaluate가 거부되지 않았다(=핸들러가 에러 없이 끝났다),
 * (2) 창이 하나뿐이다, (3) 그 창이 여전히 멀쩡히 그 저장소를 보고 있다(포커스를 옮기는 과정에서
 * 화면을 잃지 않았다). 창 수 단언 앞의 대기는 Playwright의 창 등록(Target.targetCreated)이
 * invoke 응답보다 늦을 수 있어서다 — 없으면 새 창이 실제로 떠도 통과할 수 있다.
 */
test('E15b — 이미 연 저장소를 새 창으로 열려 하면 창이 안 늘어난다', async () => {
  const repo = await createRepoWithChange()
  const path = realpathSync(repo)
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const first = await app.firstWindow()
    await expect(first.getByTestId('file-unstaged-app.txt')).toBeVisible()

    // page.evaluate(fn, arg)는 인자를 **하나만** 넘긴다 — (_, path) 시그니처로 쓰면 undefined다
    await first.evaluate((target: string) => window.gitApi.window.open(target), path)
    await first.waitForTimeout(1_500)

    expect(app.windows()).toHaveLength(1)
    await expect(first.getByTestId('repo-path')).toHaveText(path)
    await expect(first.getByTestId('file-unstaged-app.txt')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

/**
 * E15b ⑥ — ⌘N이 빈 창을 띄우고, 그 창의 최근 목록에서 저장소를 연다.
 *
 * ⌘N이 선재 결함을 드러낸다: E15b 전 RepoPicker는 "저장소 열기" 버튼 하나뿐이라 빈 창은 늘 OS
 * 다이얼로그부터였고(Playwright로 못 연다) 최근 10개(E15a)가 무의미했다. 그래서 이 테스트는
 * **다이얼로그를 한 번도 거치지 않고** 빈 창에서 저장소에 도달하는 길을 끝까지 돈다.
 */
test('E15b — ⌘N이 연 빈 창의 최근 목록에서 저장소를 연다', async () => {
  const repoA = await createRepoWithChange()
  const repoB = await createRepoWithFile('beta.txt')
  const pathA = realpathSync(repoA)
  const pathB = realpathSync(repoB)
  const userData = await seedRecentRepos([pathA, pathB])
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repoA, GIT_GUI_USER_DATA: userData },
  })
  try {
    const first = await app.firstWindow()
    await expect(first.getByTestId('file-unstaged-app.txt')).toBeVisible()

    const pending = nextWindow(app)
    await first.keyboard.press('Meta+n')
    const second = await pending

    // 빈 창은 RepoPicker다 — 그리고 이 에픽이 붙인 최근 목록이 거기 있다
    await expect(second.getByTestId('open-repo')).toBeVisible()
    await second.getByTestId(`repo-picker-recent-${pathB}`).click()

    await expect(second.getByTestId('repo-path')).toHaveText(pathB)
    await expect(second.getByTestId('file-unstaged-beta.txt')).toBeVisible()
  } finally {
    await app.close()
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E15b ⑦ — 전환기 항목 우클릭 "새 창에서 열기".
 *
 * ⌥클릭의 **발견 가능한 짝**이다. 둘이 같은 `window:open`을 부르므로 위 ⌥클릭 테스트가 이걸
 * 덮는다고 착각하기 쉽지만, **메뉴 항목이 사라지거나 배선이 끊기는 것은 이 껍데기에서만**
 * 일어나고 ⌥클릭 경로는 그걸 못 본다. 우클릭 메뉴는 팝오버 바깥(body 포털)에 뜬다 — 팝오버
 * 안에 두면 RAC Popover의 바깥 클릭 처리와 ariaHideOutside가 그 메뉴를 물어 간다(실측).
 */
test('E15b — 전환기 우클릭 "새 창에서 열기"가 새 창을 연다', async () => {
  const repoA = await createRepoWithChange()
  const repoB = await createRepoWithFile('beta.txt')
  const pathA = realpathSync(repoA)
  const pathB = realpathSync(repoB)
  const userData = await seedRecentRepos([pathB])
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repoA, GIT_GUI_USER_DATA: userData },
  })
  try {
    const first = await app.firstWindow()
    await expect(first.getByTestId('file-unstaged-app.txt')).toBeVisible()
    await first.getByTestId('repo-switcher').click()
    await expect(first.getByTestId('repo-switcher-browse')).toBeVisible()

    await first.getByTestId(`repo-switcher-item-${pathB}`).click({ button: 'right' })
    await expect(first.getByTestId('context-new-window')).toBeVisible()

    const pending = nextWindow(app)
    await first.getByTestId('context-new-window').click()
    const second = await pending
    await expect(second.getByTestId('file-unstaged-beta.txt')).toBeVisible()
    await expect(second.getByTestId('repo-path')).toHaveText(pathB)

    // ⌥클릭과 같다 — 원래 창은 갈아타지 않는다
    await expect(first.getByTestId('repo-path')).toHaveText(pathA)
    await expect(first.getByTestId('file-unstaged-app.txt')).toBeVisible()
  } finally {
    await app.close()
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E15b ⑧ — 워크트리 행 우클릭 "새 창에서 열기" (진입점 넷째).
 *
 * 옆 항목 "앱에서 열기"가 이 창을 통째로 갈아타는 것이라면 이쪽은 이 창을 그대로 둔다.
 *
 * **공허해지기 쉬운 자리 둘을 막는다**: (1) 워크트리를 실제로 만들지 않으면 행이 없어
 * 우클릭이 타임아웃으로 실패하므로 fixture가 살아 있음이 증명된다 — 그래도 눈에 보이게
 * 행 가시성을 먼저 단언한다. (2) 새 창의 repo-path가 **본체가 아니라 그 워크트리**여야
 * 의미가 있다 — 둘이 같으면 아무것도 검증하지 못하므로 두 경로가 다르다는 것부터 못박는다.
 *
 * 링크드 워크트리도 --show-toplevel이 그 워크트리 경로라 window:open이 repo.open과 같은
 * 검증(절대 경로 + rev-parse)을 그대로 통과한다 (E15a 실측 매트릭스).
 */
test('E15b — 워크트리 우클릭 "새 창에서 열기"가 그 워크트리로 새 창을 연다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'wt-side'], { cwd: repo })
  const wtPath = `${repo}-side`
  await execGitOrThrow(['worktree', 'add', '--end-of-options', wtPath, 'wt-side'], { cwd: repo })
  const pathMain = realpathSync(repo)
  const pathWt = realpathSync(wtPath)
  // 두 경로가 같으면 아래 단언이 통째로 공허해진다 — fixture부터 못박는다
  expect(pathWt, '워크트리 경로가 본체와 같다 — 이 테스트는 아무것도 재지 못한다').not.toBe(
    pathMain,
  )
  const sideName = wtPath.split('/').filter(Boolean).pop()!
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const first = await app.firstWindow()
    await expect(first.getByTestId('file-unstaged-app.txt')).toHaveCount(0)
    await first.getByTestId('left-tab-worktrees').click()
    await expect(first.getByTestId(`worktree-row-${sideName}`)).toBeVisible()

    await first.getByTestId(`worktree-row-${sideName}`).click({ button: 'right' })
    await expect(first.getByTestId('context-new-window')).toBeVisible()

    const pending = nextWindow(app)
    await first.getByTestId('context-new-window').click()
    const second = await pending
    // 새 창이 연 것은 본체가 아니라 그 워크트리다
    await expect(second.getByTestId('repo-path')).toHaveText(pathWt)
    // "앱에서 열기"와 다르다 — 원래 창은 여전히 본체를 본다
    await expect(first.getByTestId('repo-path')).toHaveText(pathMain)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(wtPath, { recursive: true, force: true })
  }
})

/**
 * E15b ⑨ — 껐다 켜면 열려 있던 창들이 돌아온다.
 *
 * **2회차는 `GIT_GUI_E2E_REPO` 없이 띄운다.** 그 변수가 있으면 main이 창 목록 복원을 건너뛰기
 * 때문이다(기존 E2E가 전부 "창 하나, 그 저장소"를 전제한다 — index.ts createStartupWindows).
 * 그래서 이 테스트 하나만 복원 경로 전체를 탄다.
 *
 * **공허해지지 않게 셋을 함께 문다** — "저장했다가 읽었다"는 저장·복원이 둘 다 없어도 통과할
 * 길이 많다: (1) 창 **개수**가 2, (2) 각 창의 **저장소**가 저장 순서대로, (3) 각 창의
 * **레이아웃**이 그 창의 것. (3)을 위해 1회차에서 **A만** 좌측을 접는다 — 레이아웃을 창별로
 * 안 실으면(전부 첫 창 것을 쓰거나 전부 빈 값이면) 빨갛다.
 *
 * `app.close()`가 `before-quit`를 실제로 발화시키는지는 실측으로 확인했다 — Playwright의
 * close는 main에서 `app.quit()`을 부른다(playwright-core coreBundle: `app.quit()`), 그래서
 * 그 시점 레지스트리에 창들이 아직 다 있다. 별도 우회가 필요 없었다.
 */
test('E15b — 껐다 켜면 열려 있던 창들이 저장소와 레이아웃 그대로 돌아온다', async () => {
  const repoA = await createRepoWithFile('alpha.txt')
  const repoB = await createRepoWithFile('beta.txt')
  // main은 --show-toplevel로 정규화한 경로를 돌려준다 — 심링크(/var → /private/var)를 푼 값이다
  const pathA = realpathSync(repoA)
  const pathB = realpathSync(repoB)
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  try {
    // ── 1회차: 창 둘을 열고 A만 좌측을 접은 채 종료한다 ──
    const first = await electron.launch({
      args: [APP_ROOT],
      env: { ...process.env, GIT_GUI_E2E_REPO: repoA, GIT_GUI_USER_DATA: userData },
    })
    try {
      const windowA = await first.firstWindow()
      await expect(windowA.getByTestId('file-unstaged-alpha.txt')).toBeVisible()
      // 창을 여는 동작보다 **먼저** 대기를 걸어 둔다 — waitForEvent는 이후에 열리는 창만 준다
      const pending = nextWindow(first)
      // page.evaluate는 인자를 **하나**만 넘긴다(첫 파라미터가 그 값이다)
      await windowA.evaluate((path: string) => window.gitApi.window.open(path), pathB)
      const windowB = await pending
      await expect(windowB.getByTestId('file-unstaged-beta.txt')).toBeVisible()
      // 접기는 **B를 연 뒤에** 한다 — 새 창은 열어준 창의 레이아웃을 씨앗으로 받으므로(E15b
      // seedLayoutFrom), 먼저 접었으면 B도 접힌 채로 열려 (3)이 아무것도 재지 못한다
      await windowA.getByTestId('left-collapse-toggle').click()
      await windowA.waitForTimeout(320)
      await expect(windowA.locator('.app__left')).not.toBeVisible()
      await expect(windowB.locator('.app__left')).toBeVisible()
    } finally {
      await first.close()
    }

    // ── 2회차: GIT_GUI_E2E_REPO 없이 띄운다 — 그래야 복원 경로를 탄다 ──
    const second = await electron.launch({
      args: [APP_ROOT],
      env: { ...process.env, GIT_GUI_USER_DATA: userData },
    })
    try {
      await expect.poll(() => second.windows().length, { timeout: 30_000 }).toBe(2)
      const pages = second.windows()
      await Promise.all(pages.map((page) => page.locator('.app__header').waitFor({ timeout: 30_000 })))
      // (2) 순서는 등록 순서 = 저장 순서다
      const paths = await Promise.all(
        pages.map((page) => page.getByTestId('repo-path').textContent()),
      )
      expect(paths).toEqual([pathA, pathB])
      // (3) 레이아웃은 창마다 제 것이다 — A만 접혀 있다.
      // 재시작 직후는 부팅 억제(App.tsx bootSuppress)라 전환 없이 즉시 0px로 시작한다
      await expect(pages[0]!.locator('.app__left')).not.toBeVisible()
      expect((await pages[0]!.locator('.app__left').boundingBox())!.width).toBe(0)
      await expect(pages[1]!.locator('.app__left')).toBeVisible()
      expect((await pages[1]!.locator('.app__left').boundingBox())!.width).toBeGreaterThan(0)
    } finally {
      await second.close()
    }
  } finally {
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E15b 리뷰 I-1 ① — **창을 닫고 나서 종료해도** 그 창의 저장소와 레이아웃이 돌아온다.
 *
 * 이건 `main` 대비 회귀였다. `main`은 `settings:set`마다 파일에 썼으므로 "레이아웃 변경은 곧
 * 영속"이 불변식이었는데, E15b가 레이아웃을 레지스트리로 옮기면서 영속 지점이 `before-quit`
 * 하나만 남았다 — 그 시점에 창이 없으면 전부 증발한다(리뷰어 실측:
 * `settings-after-close-then-quit={"windows":[]}` · `left-visible-after-restart=true`).
 *
 * **범위가 macOS ⌘W→⌘Q에 그치지 않는다.** Windows/Linux는 `window-all-closed → app.quit()`
 * (index.ts) 때문에 **마지막 창의 X를 누르는 정상 종료가 항상** `closed`(→`registry.remove`) →
 * `before-quit`(→빈 목록) 순서다. 즉 그 플랫폼에서는 복원도 레이아웃 기억도 통째로 죽는다.
 * 여기서 창을 먼저 닫고 `app.quit()`을 직접 부르는 것이 **그 경로를 macOS에서 그대로 흉내 내는
 * 형태**다 — 실제 Windows 없이 같은 순서를 재현한다.
 *
 * 2회차는 `GIT_GUI_E2E_REPO` 없이 띄운다 — 그래야 저장소까지 복원 경로를 탄다(E15b ⑨와 같은 이유).
 */
test('E15b — 창을 닫고 종료해도 그 창의 저장소와 레이아웃이 돌아온다', async () => {
  const repoA = await createRepoWithFile('alpha.txt')
  const pathA = realpathSync(repoA)
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  try {
    // ── 1회차: 좌측을 접고 → 창을 닫고 → 종료한다 ──
    const first = await electron.launch({
      args: [APP_ROOT],
      env: { ...process.env, GIT_GUI_E2E_REPO: repoA, GIT_GUI_USER_DATA: userData },
    })
    const windowA = await first.firstWindow()
    await expect(windowA.getByTestId('file-unstaged-alpha.txt')).toBeVisible()
    await windowA.getByTestId('left-collapse-toggle').click()
    await windowA.waitForTimeout(320)
    await expect(windowA.locator('.app__left')).not.toBeVisible()
    // 레이아웃 영속은 디바운스다(LAYOUT_PERSIST_MS=250) — 창을 닫기 전에 한 번 터지게 둔다
    await windowA.waitForTimeout(600)

    // 여기가 이 테스트의 핵심 — 종료 시점에 창이 하나도 없다.
    // harness의 app.close()를 쓰지 않는다: 그건 닫기 직전 firstWindow()로 화면을 찍는데
    // 창이 이미 없어 30초를 기다린다. 대신 main에서 직접 quit하고 종료를 기다린다
    await windowA.close()
    await first.evaluate(({ app }) => {
      app.quit()
    })
    await first.waitForEvent('close')

    // ── 2회차: GIT_GUI_E2E_REPO 없이 띄운다 — 그래야 복원 경로를 탄다 ──
    const second = await electron.launch({
      args: [APP_ROOT],
      env: { ...process.env, GIT_GUI_USER_DATA: userData },
    })
    try {
      await expect.poll(() => second.windows().length, { timeout: 30_000 }).toBe(1)
      const restored = second.windows()[0]!
      await restored.locator('.app__header').waitFor({ timeout: 30_000 })
      // (1) 저장소가 돌아왔다 — 빈 창(RepoPicker)이 아니다
      await expect(restored.getByTestId('repo-path')).toHaveText(pathA)
      // (2) 접힘도 돌아왔다 — 재시작 직후는 부팅 억제라 전환 없이 즉시 0px다
      await expect(restored.locator('.app__left')).not.toBeVisible()
      expect((await restored.locator('.app__left').boundingBox())!.width).toBe(0)
    } finally {
      await second.close()
    }
  } finally {
    await rm(repoA, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E15b 리뷰 I-1 ② — **여럿 중 하나**를 닫으면 그 창은 다음에 안 뜬다.
 *
 * I-1의 고침("빈 목록으로 덮어쓰지 않는다")이 기존 결정을 삼키지 않는지 못박는다. 둘은 충돌하지
 * 않는다: 창 둘 중 하나를 닫으면 레지스트리가 **안 비므로** 그 창은 그대로 목록에서 빠진다.
 * 충돌은 "전부 닫고 종료"에서만 생기는데 그건 위 ①의 경우다(정상 종료와 구분 불가).
 *
 * 이 테스트를 빨갛게 만드는 것은 "빈 목록 무시"를 "줄어든 목록도 무시"로 넓히는 변이다 —
 * 그렇게 하면 닫은 B가 되살아난다.
 */
test('E15b — 창 둘 중 하나만 닫고 종료하면 남은 창만 복원된다', async () => {
  const repoA = await createRepoWithFile('alpha.txt')
  const repoB = await createRepoWithFile('beta.txt')
  const pathA = realpathSync(repoA)
  const pathB = realpathSync(repoB)
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  try {
    // ── 1회차: 창 둘을 열고 B만 닫은 채 종료한다 ──
    const first = await electron.launch({
      args: [APP_ROOT],
      env: { ...process.env, GIT_GUI_E2E_REPO: repoA, GIT_GUI_USER_DATA: userData },
    })
    try {
      const windowA = await first.firstWindow()
      await expect(windowA.getByTestId('file-unstaged-alpha.txt')).toBeVisible()
      const pending = nextWindow(first)
      await windowA.evaluate((path: string) => window.gitApi.window.open(path), pathB)
      const windowB = await pending
      await expect(windowB.getByTestId('file-unstaged-beta.txt')).toBeVisible()
      await windowB.close()
      // 창 목록 영속은 즉시다(디바운스가 아니다) — 그래도 IPC 왕복 여유를 준다
      await windowA.waitForTimeout(500)
    } finally {
      // A가 아직 열려 있다 — 평범한 ⌘Q 경로다
      await first.close()
    }

    // ── 2회차: A만 돌아온다 ──
    const second = await electron.launch({
      args: [APP_ROOT],
      env: { ...process.env, GIT_GUI_USER_DATA: userData },
    })
    try {
      await expect.poll(() => second.windows().length, { timeout: 30_000 }).toBe(1)
      const restored = second.windows()[0]!
      await restored.locator('.app__header').waitFor({ timeout: 30_000 })
      await expect(restored.getByTestId('repo-path')).toHaveText(pathA)
      // 창이 늦게 더 뜨지 않는지까지 본다 — 복원은 순차라 두 번째가 뒤늦게 올 수 있다
      await restored.waitForTimeout(1_500)
      expect(second.windows()).toHaveLength(1)
    } finally {
      await second.close()
    }
  } finally {
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E15b 리뷰 I-1 ③ — 창을 **둘 다** 닫고 종료해도, 닫은 순서와 무관하게 A만 돌아온다.
 *
 * ②가 못 무는 것을 문다. ②는 ⌘Q 경로라 `before-quit` 시점에 A가 살아 있어, **레지스트리
 * 변경을 즉시 영속하지 않아도** 초록이다. 여기서는 종료 시점에 창이 하나도 없으므로
 * `before-quit`이 아무것도 못 남긴다 — 디스크에 남은 것은 **B를 닫는 순간 쓴 목록**뿐이다.
 * 레이아웃을 한 번도 안 건드리는 것도 의도다: 디바운스 영속이 대신 저장해 주는 길을 막아
 * "창 목록 변경도 곧 영속"만 남긴다.
 *
 * Windows/Linux에서 창 둘을 X로 닫는 정상 종료가 정확히 이 순서다.
 */
test('E15b — 창을 둘 다 닫고 종료해도 닫지 않은 쪽만 돌아온다', async () => {
  const repoA = await createRepoWithFile('alpha.txt')
  const repoB = await createRepoWithFile('beta.txt')
  const pathA = realpathSync(repoA)
  const pathB = realpathSync(repoB)
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  try {
    const first = await electron.launch({
      args: [APP_ROOT],
      env: { ...process.env, GIT_GUI_E2E_REPO: repoA, GIT_GUI_USER_DATA: userData },
    })
    const windowA = await first.firstWindow()
    await expect(windowA.getByTestId('file-unstaged-alpha.txt')).toBeVisible()
    const pending = nextWindow(first)
    await windowA.evaluate((path: string) => window.gitApi.window.open(path), pathB)
    const windowB = await pending
    await expect(windowB.getByTestId('file-unstaged-beta.txt')).toBeVisible()

    // B를 먼저 닫는다 — 이때 남은 목록 [A]가 디스크로 간다. 그 다음 A를 닫으면 목록이 비는데,
    // 빈 목록은 저장하지 않으므로 방금 쓴 [A]가 그대로 남는다
    await windowB.close()
    await windowA.waitForTimeout(500)
    await windowA.close()
    await first.evaluate(({ app }) => {
      app.quit()
    })
    await first.waitForEvent('close')

    const second = await electron.launch({
      args: [APP_ROOT],
      env: { ...process.env, GIT_GUI_USER_DATA: userData },
    })
    try {
      await expect.poll(() => second.windows().length, { timeout: 30_000 }).toBe(1)
      const restored = second.windows()[0]!
      await restored.locator('.app__header').waitFor({ timeout: 30_000 })
      await expect(restored.getByTestId('repo-path')).toHaveText(pathA)
      await restored.waitForTimeout(1_500)
      expect(second.windows()).toHaveLength(1)
    } finally {
      await second.close()
    }
  } finally {
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E15b 리뷰 I-2 — 없어진 저장소를 **⌥클릭**해도 안내가 뜨고 목록에서 빠진다.
 *
 * 같은 항목의 두 조작이 실패 처리에서 갈라져 있었다. 평범한 클릭은 E15a ③처럼 문구가 뜨고
 * 자동으로 목록에서 빠지는데, ⌥클릭은 `void window.gitApi.window.open(path)`로 실패를 버려서
 * **배너도 없고 목록도 그대로이고** 콘솔에 uncaught rejection만 남았다(리뷰어 실측:
 * `bannerText=["main 병합"]` · `switcherVisible=true` · `pageerror:Error invoking remote
 * method 'window:open'`). E15a가 공들여 가른 사인(`missing`/`not-a-repository`/`failed`)이
 * 이 진입점에서만 버려진 것이다.
 *
 * **콘솔 오류까지 함께 문다** — 배너와 목록만 보면 "실패를 잡아 배너만 띄우고 rejection은
 * 그대로 두는" 절반짜리 고침이 통과한다. 계약을 결과 객체로 바꿨다는 것이 여기서 드러난다.
 */
test('E15b — 없어진 저장소를 ⌥클릭해도 안내가 뜨고 최근 목록에서 빠진다', async () => {
  const repoA = await createRepoWithChange()
  const repoB = await createRepoWithFile('beta.txt')
  const pathA = realpathSync(repoA)
  const pathB = realpathSync(repoB)
  const userData = await seedRecentRepos([pathB])
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repoA, GIT_GUI_USER_DATA: userData },
  })
  try {
    const first = await app.firstWindow()
    const pageErrors: string[] = []
    first.on('pageerror', (error) => pageErrors.push(error.message))
    await expect(first.getByTestId('file-unstaged-app.txt')).toBeVisible()
    // 목록에 남은 채 폴더만 사라진 상태 — 사용자가 Finder에서 지운 그 경우다 (E15a ③와 같은 픽스처)
    await rm(repoB, { recursive: true, force: true })

    await first.getByTestId('repo-switcher').click()
    await expect(first.getByTestId('repo-switcher-browse')).toBeVisible()
    await first.getByTestId(`repo-switcher-item-${pathB}`).click({ modifiers: ['Alt'] })

    // (a) 안내가 뜬다 — 평범한 클릭과 **한 글자도 다르지 않은** 문구다(main이 만든 것을 그대로 쓴다)
    await expect(first.getByTestId('error')).toContainText('그 폴더가 없어요')
    // 이 창은 그대로 A다 — ⌥클릭은 전환이 아니다
    await expect(first.getByTestId('repo-path')).toHaveText(pathA)
    // 창도 안 늘었다 — 열리지 않았으니 당연하지만, "열렸는데 배너만 떴다"를 배제한다
    expect(app.windows()).toHaveLength(1)

    // (b) 목록에서 빠졌다 — A(지금 저장소)와 '다른 폴더 열기'만 남는다
    await first.getByTestId('repo-switcher').click()
    expect(await switcherItemIds(first)).toEqual([
      `repo-switcher-item-${pathA}`,
      'repo-switcher-browse',
    ])

    // (c) 콘솔에 uncaught rejection이 없다 — 실패가 예외가 아니라 결과로 온다
    expect(pageErrors).toEqual([])
  } finally {
    await app.close()
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true }).catch(() => {})
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E15b 리뷰 I-3 대조 실험 — 전환기를 **키보드로** 활성화하는 동작 하나.
 *
 * 아래 두 테스트가 **이 함수를 그대로 공유한다**: 키 입력이 "완전히 같다"를 복붙이 아니라
 * 구조로 보장하기 위해서다. 다른 것은 이 앞에 ⌥ 취소가 있었느냐뿐이다.
 *
 * 항목 순서는 `pushRecentRepo(recent, currentPath)`라 [지금 저장소, 최근 …, 다른 폴더 열기]다 —
 * ArrowDown 두 번이면 둘째 항목(최근 목록의 그 저장소)이다.
 */
async function switchToSecondItemByKeyboard(page: Page): Promise<void> {
  await page.getByTestId('repo-switcher').click()
  await expect(page.getByTestId('repo-switcher-browse')).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
}

/**
 * E15b 리뷰 I-3 대조군 — ⌥ 없이 키보드로 고르면 **이 창이 갈아탄다**.
 *
 * 아래 실험군과 짝이다. 이것 없이는 실험군이 "원래 그렇게 동작한다"와 구분되지 않는다.
 */
test('E15b — 전환기를 키보드로 고르면 이 창이 갈아탄다 (대조군)', async () => {
  const repoA = await createRepoWithChange()
  const repoB = await createRepoWithFile('beta.txt')
  const pathB = realpathSync(repoB)
  const userData = await seedRecentRepos([pathB])
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repoA, GIT_GUI_USER_DATA: userData },
  })
  try {
    const first = await app.firstWindow()
    await expect(first.getByTestId('file-unstaged-app.txt')).toBeVisible()

    await switchToSecondItemByKeyboard(first)

    await expect(first.getByTestId('repo-path')).toHaveText(pathB)
    await expect(first.getByTestId('file-unstaged-beta.txt')).toBeVisible()
    expect(app.windows()).toHaveLength(1)
  } finally {
    await app.close()
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E15b 리뷰 I-3 실험군 — **취소된 ⌥ 누름이 다음 활성화까지 따라오지 않는다.**
 *
 * `altRef`는 `onPointerDown`에서만 켜지고 `onAction`에서만 꺼졌다. 그래서 `onAction`이 안
 * 일어나는 취소(항목 밖으로 끌고 나가 떼기)면 `true`가 남고, 다음 활성화에 pointerdown이
 * 없으면(=키보드) 그대로 실렸다. 마우스로 다시 누르면 `onPointerDown`이 덮어써서 안 드러나므로
 * **키보드 사용자에게만** 나타나는 결함이다.
 *
 * 리뷰어 실측(위 대조군과 키 입력 완전히 동일): 대조군 `windows=1 repo=pathB` /
 * ⌥ 취소 후 `windows=2 repo=pathA` — 전환 대신 새 창이 열렸다.
 */
test('E15b — 취소된 ⌥ 누름이 다음 키보드 활성화에 실리지 않는다 (실험군)', async () => {
  const repoA = await createRepoWithChange()
  const repoB = await createRepoWithFile('beta.txt')
  const pathB = realpathSync(repoB)
  const userData = await seedRecentRepos([pathB])
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repoA, GIT_GUI_USER_DATA: userData },
  })
  try {
    const first = await app.firstWindow()
    await expect(first.getByTestId('file-unstaged-app.txt')).toBeVisible()

    // ── 실험군에만 있는 것: ⌥를 누른 채 항목을 눌렀다가 **밖에서** 뗀다(취소) ──
    await first.getByTestId('repo-switcher').click()
    await expect(first.getByTestId('repo-switcher-browse')).toBeVisible()
    const box = (await first.getByTestId(`repo-switcher-item-${pathB}`).boundingBox())!
    await first.keyboard.down('Alt')
    await first.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await first.mouse.down()
    // 항목 밖에서 뗀다 — onAction이 안 일어난다(취소). 실측: 이때 팝오버는 **닫히지 않는다**
    // (RAC의 바깥 클릭 해제는 pointerdown 위치로 판정하는데 그건 팝오버 안이었다) — 그래서
    // ESC로 닫는다. 리뷰가 지적한 두 취소 경로(끌고 나가 떼기·ESC)를 한 번에 지난다
    await first.mouse.move(5, 500)
    await first.mouse.up()
    await first.keyboard.up('Alt')
    await first.keyboard.press('Escape')
    await expect(first.getByTestId('repo-switcher-browse')).toHaveCount(0)
    // 아직 아무 일도 안 일어났다 — 취소니까
    expect(app.windows()).toHaveLength(1)

    // ── 여기부터는 대조군과 한 글자도 다르지 않다 ──
    await switchToSecondItemByKeyboard(first)

    await expect(first.getByTestId('repo-path')).toHaveText(pathB)
    await expect(first.getByTestId('file-unstaged-beta.txt')).toBeVisible()
    // 새 창이 열리지 않았다 — 창 등록이 invoke 응답보다 늦을 수 있어 여유를 준다
    await first.waitForTimeout(1_500)
    expect(app.windows()).toHaveLength(1)
  } finally {
    await app.close()
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E15c Task 3 — 탭 IPC만으로 한 창에 탭 둘이 실존하고 전환·닫기가 된다 (탭바 UI는 Task 5).
 *
 * Playwright 실측이 이 테스트의 절반이다 (Task 5~8의 E2E 전부가 이 위에 선다):
 * - 같은 BaseWindow에 더해진 **두 번째 WebContentsView**도 `waitForEvent('window')`로 잡히고
 *   `app.windows()`에 실린다 — Playwright의 "window"는 창이 아니라 webContents 단위다.
 * - 숨은 뷰(setVisible(false))의 page도 getByTestId·evaluate가 전부 동작한다 — 그래서
 *   **가시성 단언은 렌더러가 아니라 main에서 한다**: 렌더러 쪽 단언은 숨어도 통과하므로
 *   setVisible 전환을 물 수 없고, `contentView.children`의 getVisible()만이 실물이다.
 */
test('E15c — IPC만으로 두 번째 탭이 생기고 전환·닫기가 된다', async () => {
  const repoA = await createRepoWithChange()
  const repoB = await createRepoWithFile('beta.txt')
  // main은 --show-toplevel로 정규화한 경로를 돌려준다 — 심링크(/var → /private/var)를 푼 값이다
  const pathA = realpathSync(repoA)
  const pathB = realpathSync(repoB)
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repoA },
  })
  try {
    const first = await app.firstWindow()
    await expect(first.getByTestId('repo-path')).toHaveText(pathA)

    // 탭을 여는 동작보다 **먼저** 대기를 걸어 둔다 (nextWindow 관례) — 두 번째 "뷰"도 이 이벤트로 온다
    const pending = nextWindow(app)
    await first.evaluate((path: string) => window.gitApi.tabs.open(path), pathB)
    const second = await pending
    await expect(second.getByTestId('repo-path')).toHaveText(pathB)

    // 창은 하나인데 Playwright의 window(webContents)는 둘이다
    expect(app.windows()).toHaveLength(2)
    expect(await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length)).toBe(1)

    // 새 탭 B가 활성 → 첫 탭 A는 숨었다. 숨은 뷰의 page 단언이 그대로 동작한다(실측)
    await expect(first.getByTestId('file-unstaged-app.txt')).toBeVisible()

    // onChanged는 등록 즉시 현재 목록을 준다 — 탭을 하나도 안 건드리고 구독만 해서 받는다
    const tabs = await first.evaluate(
      () =>
        new Promise<{ id: number; repoPath: string | null; active: boolean }[]>((resolve) => {
          const off = window.gitApi.tabs.onChanged((list) => {
            off()
            resolve(list)
          })
        }),
    )
    expect(tabs).toHaveLength(2)
    const tabA = tabs.find((tab) => tab.repoPath === pathA)!
    const tabB = tabs.find((tab) => tab.repoPath === pathB)!
    expect(tabA.active).toBe(false)
    expect(tabB.active).toBe(true)

    // 가시성의 실물 — 보이는 자식 뷰는 활성 탭 B 하나뿐이다
    const visibleAfterOpen = await app.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows()[0]!.contentView.children.map((child) => ({
        id: (child as Electron.WebContentsView).webContents.id,
        visible: child.getVisible(),
      })),
    )
    expect(visibleAfterOpen.filter((v) => v.visible).map((v) => v.id)).toEqual([tabB.id])

    // 전환 — 보이는 뷰(second)에서 탭 A를 활성화한다
    await second.evaluate((tabId: number) => window.gitApi.tabs.activate(tabId), tabA.id)
    const visibleAfterActivate = await app.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows()[0]!.contentView.children.map((child) => ({
        id: (child as Electron.WebContentsView).webContents.id,
        visible: child.getVisible(),
      })),
    )
    expect(visibleAfterActivate.filter((v) => v.visible).map((v) => v.id)).toEqual([tabA.id])

    // 닫기 — 이제 숨은 뷰가 된 B의 탭을 first에서 닫는다. destroy 실측: 탭 하나만 닫는 경로도
    // webContents가 정말 파괴되는지('destroyed' 발화 → git-handlers·terminal-handlers의 감시·pty
    // 정리가 그 훅에 실려 있다) — Task 1은 창 단위로만 실측했다
    const closed = second.waitForEvent('close')
    await first.evaluate((tabId: number) => window.gitApi.tabs.close(tabId), tabB.id)
    await closed

    // 탭 하나가 닫혔다고 창이 닫히면 안 된다 — 창은 그대로, webContents는 정말 하나만 남는다
    expect(app.windows()).toHaveLength(1)
    const after = await app.evaluate(({ BaseWindow, webContents }) => ({
      windows: BaseWindow.getAllWindows().length,
      contents: webContents.getAllWebContents().length,
      visible: BaseWindow.getAllWindows()[0]!.contentView.children.map((child) =>
        child.getVisible(),
      ),
    }))
    expect(after.windows).toBe(1)
    // 1이면 B의 webContents가 파괴됐다는 뜻이다 — 파괴 없이는 감시·pty 정리도 없다
    expect(after.contents).toBe(1)
    expect(after.visible).toEqual([true])

    // 장부도 하나다 — 닫힌 탭이 목록에 안 남고 남은 탭이 활성이다
    const tabsAfterClose = await first.evaluate(
      () =>
        new Promise<{ id: number; active: boolean }[]>((resolve) => {
          const off = window.gitApi.tabs.onChanged((list) => {
            off()
            resolve(list)
          })
        }),
    )
    expect(tabsAfterClose).toHaveLength(1)
    expect(tabsAfterClose[0]!.id).toBe(tabA.id)
    expect(tabsAfterClose[0]!.active).toBe(true)
  } finally {
    await app.close()
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
  }
})

/**
 * E15c Task 5 ① — 탭바 `+` → 빈 탭(RepoPicker) → 최근 목록으로 열기 → 라벨 갱신.
 *
 * 라벨 갱신의 경로가 이 테스트의 실물이다: RepoPicker의 최근 항목 클릭은 repo:open이고,
 * 그 remember(setTabRepoPath)가 레지스트리 onChange('windows') → 모든 뷰 push로 탭바에
 * 닿는다 — 핸들러마다 push를 흩었다면 정확히 이 경로가 빠졌다 (index.ts 주석).
 */
test('E15c — 탭바 +로 빈 탭을 열고 최근 목록으로 저장소를 열면 라벨이 갱신된다', async () => {
  const repoA = await createRepoWithChange()
  const repoB = await createRepoWithFile('beta.txt')
  const pathA = realpathSync(repoA)
  const pathB = realpathSync(repoB)
  const userData = await seedRecentRepos([pathB])
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repoA, GIT_GUI_USER_DATA: userData },
  })
  try {
    const first = await app.firstWindow()
    await expect(first.getByTestId('repo-path')).toHaveText(pathA)
    // 탭 하나일 때도 탭바를 그린다 (사용자 결정 "두 줄" — 숨기면 창 높이가 널뛴다)
    await expect(first.getByTestId('tab-bar')).toBeVisible()
    await expect(first.getByTestId('tab-bar')).toContainText(basename(pathA))

    // 새 뷰 대기를 클릭보다 먼저 걸어 둔다 (nextWindow 관례)
    const pending = nextWindow(app)
    await first.getByTestId('tab-add').click()
    const second = await pending
    // 빈 탭 — RepoPicker가 뜨고 라벨은 '새 탭'
    await expect(second.getByTestId('open-repo')).toBeVisible()
    await expect(second.getByTestId('tab-bar')).toContainText('새 탭')

    // 최근 목록으로 연다 → 이 탭이 갈아탄다(새 탭이 또 생기지 않는다) → 라벨이 저장소 이름으로
    await second.getByTestId(`repo-picker-recent-${pathB}`).click()
    await expect(second.getByTestId('repo-path')).toHaveText(pathB)
    await expect(second.getByTestId('tab-bar')).not.toContainText('새 탭')
    await expect(second.getByTestId('tab-bar')).toContainText(basename(pathB))
    // 탭은 여전히 둘이다 — 갈아타기가 새 탭을 만들지 않았다
    expect(app.windows()).toHaveLength(2)
    // 숨은 첫 탭의 탭바에도 같은 목록이 push됐다 — 켜기 전에 이미 맞다 (스펙 §2)
    await expect(first.getByTestId('tab-bar')).toContainText(basename(pathB))
  } finally {
    await app.close()
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E15c Task 5 ② — 탭 클릭으로 전환된다.
 *
 * 가시성 단언은 main의 getVisible()로만 한다 (Task 3 실측 — 숨은 뷰도 렌더러 단언은 전부
 * 통과하므로 렌더러 쪽 단언은 setVisible 전환을 물지 못한다). 각 뷰의 repo-path는 "그 뷰가
 * 제 저장소를 그대로 들고 있다"는 별개 사실을 문다.
 */
test('E15c — 탭 클릭으로 전환된다 (실제 가시성이 바뀐다)', async () => {
  const repoA = await createRepoWithChange()
  const repoB = await createRepoWithFile('beta.txt')
  const pathA = realpathSync(repoA)
  const pathB = realpathSync(repoB)
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repoA },
  })
  try {
    const first = await app.firstWindow()
    await expect(first.getByTestId('repo-path')).toHaveText(pathA)

    const pending = nextWindow(app)
    await first.evaluate((path: string) => window.gitApi.tabs.open(path), pathB)
    const second = await pending
    await expect(second.getByTestId('repo-path')).toHaveText(pathB)

    // 탭 id는 구독 스냅샷에서 얻는다 (Task 3 관용구 — 등록 즉시 현재 목록 한 번)
    const tabs = await first.evaluate(
      () =>
        new Promise<{ id: number; repoPath: string | null; active: boolean }[]>((resolve) => {
          const off = window.gitApi.tabs.onChanged((list) => {
            off()
            resolve(list)
          })
        }),
    )
    const tabA = tabs.find((tab) => tab.repoPath === pathA)!
    expect(tabA.active).toBe(false)

    // 보이는 뷰(second)의 탭바에서 탭 A를 **클릭**한다 — 탭바 UI가 이 태스크의 실물이다
    await second.getByTestId(`tab-${tabA.id}`).click()

    // 실물 가시성 — 보이는 자식 뷰가 A 하나가 될 때까지 (클릭→IPC→setVisible은 비동기다)
    await expect(async () => {
      const visible = await app.evaluate(({ BaseWindow }) =>
        BaseWindow.getAllWindows()[0]!.contentView.children
          .filter((child) => child.getVisible())
          .map((child) => (child as Electron.WebContentsView).webContents.id),
      )
      expect(visible).toEqual([tabA.id])
    }).toPass({ timeout: 5000 })

    // 각 뷰는 제 저장소를 그대로 들고 있다 — 전환은 가시성이지 내용 교체가 아니다
    await expect(first.getByTestId('repo-path')).toHaveText(pathA)
    await expect(second.getByTestId('repo-path')).toHaveText(pathB)
    // 탭바 강조도 A로 옮겨왔다 (이제 보이는 first의 탭바 기준)
    await expect(first.getByTestId(`tab-${tabA.id}`)).toHaveAttribute('aria-selected', 'true')
  } finally {
    await app.close()
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
  }
})

/**
 * E15c Task 5 ③ — ⌘W가 활성 탭을 닫고 이웃이 활성이 된다.
 *
 * 렌더러는 활성 탭 id로 tabs:close를 부를 뿐, "마지막 탭이면 창 닫기" 판단은 main(closeTab)
 * 몫이다. 닫힘의 실물은 webContents 파괴(감시·pty 정리가 destroyed 훅에 실려 있다)와
 * 이웃 뷰의 가시성 승계다.
 */
test('E15c — ⌘W가 활성 탭을 닫고 이웃 탭이 활성이 된다', async () => {
  const repoA = await createRepoWithChange()
  const repoB = await createRepoWithFile('beta.txt')
  const pathA = realpathSync(repoA)
  const pathB = realpathSync(repoB)
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repoA },
  })
  try {
    const first = await app.firstWindow()
    await expect(first.getByTestId('repo-path')).toHaveText(pathA)

    const pending = nextWindow(app)
    await first.evaluate((path: string) => window.gitApi.tabs.open(path), pathB)
    const second = await pending
    await expect(second.getByTestId('repo-path')).toHaveText(pathB)
    await expect(second.getByTestId('tab-bar')).toContainText(basename(pathB))

    // 활성 탭(B, 보이는 뷰)에서 ⌘W — 그 탭이 닫힌다.
    // press는 keydown+keyup 한 쌍인데 keydown이 탭을 닫아 keyup을 보낼 페이지가 그 자리에서
    // 파괴된다(실측: "Target page has been closed") — 그 실패가 곧 닫힘이 일어났다는 부수
    // 신호일 뿐이라 삼킨다. 실제 검증은 close 이벤트 대기와 아래 단언들이다(⌘W 분기를
    // 무력화하면 press는 멀쩡히 성공하고 close가 영영 안 와 timeout으로 빨개진다 — 반증 유효)
    const closed = second.waitForEvent('close')
    await second.keyboard.press('Meta+w').catch(() => {})
    await closed

    // 탭 하나가 닫혔다고 창이 닫히면 안 된다 — 창은 그대로, webContents는 하나만 남고,
    // 이웃(A)이 실제로 보인다
    const after = await app.evaluate(({ BaseWindow, webContents }) => ({
      windows: BaseWindow.getAllWindows().length,
      contents: webContents.getAllWebContents().length,
      visible: BaseWindow.getAllWindows()[0]!.contentView.children.map((child) =>
        child.getVisible(),
      ),
    }))
    expect(after.windows).toBe(1)
    expect(after.contents).toBe(1)
    expect(after.visible).toEqual([true])
    await expect(first.getByTestId('repo-path')).toHaveText(pathA)
    // 남은 탭바에서 닫힌 탭이 사라졌다
    await expect(first.getByTestId('tab-bar')).not.toContainText(basename(pathB))
    await expect(first.getByTestId('tab-bar')).toContainText(basename(pathA))
  } finally {
    await app.close()
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
  }
})

/**
 * E15c Task 6 ① — 전환기 클릭도 중복 차단을 지난다 (스펙 §3 첫 행 — "규칙 하나").
 *
 * E15a부터 전환기 클릭(openRepository)은 무조건 이 탭을 갈아탔다 — 탭이 생기자 같은 저장소가
 * 두 탭에 생길 수 있는 구멍이 됐다. 이제 렌더러가 main에 "이미 열려 있나"(tabs:show-existing)를
 * 먼저 묻고, 있으면 갈아타지 않는다. 그래서 단언은 둘 다 필요하다: **그 탭이 활성이 됐다**
 * (가시성은 main의 getVisible()로만 — Task 3 실측: 숨은 뷰도 렌더러 단언은 전부 통과한다)와
 * **이 탭이 갈아타지 않았다**(B 탭이 여전히 제 저장소·파일을 들고 있다 — 활성 전환만 봐서는
 * 갈아탄 뒤 A 탭을 활성화한 것과 구분이 안 된다).
 */
test('E15c — 전환기에서 딴 탭에 열린 저장소를 클릭하면 이 탭이 안 갈아타고 그 탭이 활성이 된다', async () => {
  const repoA = await createRepoWithChange()
  const repoB = await createRepoWithFile('beta.txt')
  const pathA = realpathSync(repoA)
  const pathB = realpathSync(repoB)
  // B 탭의 전환기 목록에 A가 있어야 한다 — 최근 목록은 settings.json에서 온다 (E15a)
  const userData = await seedRecentRepos([pathA])
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repoA, GIT_GUI_USER_DATA: userData },
  })
  try {
    const first = await app.firstWindow()
    await expect(first.getByTestId('repo-path')).toHaveText(pathA)

    const pending = nextWindow(app)
    await first.evaluate((path: string) => window.gitApi.tabs.open(path), pathB)
    const second = await pending
    await expect(second.getByTestId('repo-path')).toHaveText(pathB)

    // 탭 id는 구독 스냅샷에서 (Task 3 관용구). A 탭이 비활성이어야 "그 탭이 활성이 된다"가
    // 공허하지 않다 — 사전 조건부터 못박는다
    const tabs = await first.evaluate(
      () =>
        new Promise<{ id: number; repoPath: string | null; active: boolean }[]>((resolve) => {
          const off = window.gitApi.tabs.onChanged((list) => {
            off()
            resolve(list)
          })
        }),
    )
    const tabA = tabs.find((tab) => tab.repoPath === pathA)!
    expect(tabA.active).toBe(false)

    // 활성 탭 B의 전환기에서 A를 **평범히** 클릭한다 (⌥ 없음 — E15a부터 있던 갈아타기 진입점)
    await second.getByTestId('repo-switcher').click()
    await expect(second.getByTestId('repo-switcher-browse')).toBeVisible()
    await second.getByTestId(`repo-switcher-item-${pathA}`).click()

    // 데려간다 — 보이는 뷰가 A 탭 하나가 될 때까지 (클릭→IPC→setVisible은 비동기다)
    await expect(async () => {
      const visible = await app.evaluate(({ BaseWindow }) =>
        BaseWindow.getAllWindows()[0]!.contentView.children
          .filter((child) => child.getVisible())
          .map((child) => (child as Electron.WebContentsView).webContents.id),
      )
      expect(visible).toEqual([tabA.id])
    }).toPass({ timeout: 5000 })

    // 이 탭(B)은 갈아타지 않았다 — 여전히 제 저장소·파일을 들고 있다. 활성 전환만 봐서는
    // "B가 A로 갈아탄 뒤 그 탭을 활성화했다"와 구분이 안 되므로 이 단언이 반쪽을 채운다
    await expect(second.getByTestId('repo-path')).toHaveText(pathB)
    await expect(second.getByTestId('file-unstaged-beta.txt')).toBeVisible()
    // 탭도 안 늘었다 — 갈아타기 대신 새 탭을 만든 것도 아니다
    expect(app.windows()).toHaveLength(2)
    // 탭바 강조도 A로 옮겨왔다
    await expect(first.getByTestId(`tab-${tabA.id}`)).toHaveAttribute('aria-selected', 'true')
  } finally {
    await app.close()
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E15c Task 6 ② — 우클릭 "새 탭에서 열기"도 중복이면 새 탭 대신 그 탭을 활성화한다 (스펙 §3
 * 둘째 행). 메뉴 항목의 배선(전환기 우클릭 → context-new-tab → tabs:open)은 이 껍데기에서만
 * 검증된다 — evaluate로 tabs.open을 직접 부르면 항목이 사라져도 초록이다 (E15b ⑦과 같은 이유).
 *
 * **탭 수 불변만 보면 공허하다** (플랜 명시) — tabs:open이 통째로 죽어도 통과한다. 그래서
 * 함께 문다: (1) 그 탭이 실제로 활성이 됐다(중복 분기가 **돌았고 성공했다**는 양성 신호 —
 * 실패했다면 활성화가 없다), (2) 에러 배너가 없다(결과 ok — 실패면 openInNewTab이 배너를
 * 띄운다), (3) 탭 수 불변, (4) 우클릭한 탭은 갈아타지 않았다.
 */
test('E15c — "새 탭에서 열기" 중복은 탭을 안 만들고 그 탭을 활성화한다', async () => {
  const repoA = await createRepoWithChange()
  const repoB = await createRepoWithFile('beta.txt')
  const pathA = realpathSync(repoA)
  const pathB = realpathSync(repoB)
  // A 탭의 전환기 목록에 B가 있어야 우클릭할 항목이 있다
  const userData = await seedRecentRepos([pathB])
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repoA, GIT_GUI_USER_DATA: userData },
  })
  try {
    const first = await app.firstWindow()
    await expect(first.getByTestId('repo-path')).toHaveText(pathA)

    const pending = nextWindow(app)
    await first.evaluate((path: string) => window.gitApi.tabs.open(path), pathB)
    const second = await pending
    await expect(second.getByTestId('repo-path')).toHaveText(pathB)

    const tabs = await first.evaluate(
      () =>
        new Promise<{ id: number; repoPath: string | null; active: boolean }[]>((resolve) => {
          const off = window.gitApi.tabs.onChanged((list) => {
            off()
            resolve(list)
          })
        }),
    )
    const tabA = tabs.find((tab) => tab.repoPath === pathA)!
    const tabB = tabs.find((tab) => tab.repoPath === pathB)!

    // A 탭으로 돌아온다 — 대상 탭(B)이 비활성이어야 "활성 전환" 단언이 공허하지 않다
    await second.getByTestId(`tab-${tabA.id}`).click()
    await expect(async () => {
      const visible = await app.evaluate(({ BaseWindow }) =>
        BaseWindow.getAllWindows()[0]!.contentView.children
          .filter((child) => child.getVisible())
          .map((child) => (child as Electron.WebContentsView).webContents.id),
      )
      expect(visible).toEqual([tabA.id])
    }).toPass({ timeout: 5000 })

    // A 탭의 전환기에서 B(딴 탭에 이미 열린 저장소)를 우클릭 → "새 탭에서 열기"
    await first.getByTestId('repo-switcher').click()
    await expect(first.getByTestId('repo-switcher-browse')).toBeVisible()
    await first.getByTestId(`repo-switcher-item-${pathB}`).click({ button: 'right' })
    await expect(first.getByTestId('context-new-tab')).toBeVisible()
    await first.getByTestId('context-new-tab').click()

    // (1) 활성 전환 — 중복 분기가 돌았고 성공했다는 양성 신호
    await expect(async () => {
      const visible = await app.evaluate(({ BaseWindow }) =>
        BaseWindow.getAllWindows()[0]!.contentView.children
          .filter((child) => child.getVisible())
          .map((child) => (child as Electron.WebContentsView).webContents.id),
      )
      expect(visible).toEqual([tabB.id])
    }).toPass({ timeout: 5000 })
    // (2) 결과 ok — 실패였다면 openInNewTab이 이 배너를 띄운다 (openInNewWindow와 같은 정책)
    await expect(first.getByTestId('error')).toHaveCount(0)
    // (3) 탭 수 불변 — 새 webContents가 생기지 않았다
    expect(app.windows()).toHaveLength(2)
    // (4) 우클릭한 탭(A)은 갈아타지 않았다 — "새 탭에서 열기"는 이 탭을 그대로 둔다
    await expect(first.getByTestId('repo-path')).toHaveText(pathA)
  } finally {
    await app.close()
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E15c Task 6 ③ — ⌥클릭(새 창에서 열기) 중복은 **그 창을 앞으로 + 그 탭 활성화**까지 한다
 * (스펙 §3 셋째 행). E15b ⑤는 창이 안 느는 것까지만 물었고, Task 2가 판정을 탭 단위로 바꾼
 * 뒤에도 탭 활성화는 없었다(탭이 창마다 하나라 티가 안 났다) — 이 테스트가 그 나머지를 문다.
 *
 * 그래서 대상 저장소(B)는 **두 탭짜리 창(W1)의 비활성 탭**이어야 한다 — 활성 탭이면 활성화
 * 단언이 공허하다. "창을 앞으로"는 E2E 숨김 창에서 show()가 실제로 돌았는지로 잰다 —
 * 사전 조건(숨김)을 먼저 못박아 이 단언도 공허하지 않게 한다.
 */
test('E15c — ⌥클릭 중복은 그 창을 앞으로 가져오고 그 탭을 활성화한다', async () => {
  const repoA = await createRepoWithChange()
  const repoB = await createRepoWithFile('beta.txt')
  const repoC = await createRepoWithFile('gamma.txt')
  const pathA = realpathSync(repoA)
  const pathB = realpathSync(repoB)
  const pathC = realpathSync(repoC)
  // W2의 전환기 목록에 B가 있어야 ⌥클릭할 항목이 있다
  const userData = await seedRecentRepos([pathB])
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repoA, GIT_GUI_USER_DATA: userData },
  })
  try {
    const first = await app.firstWindow()
    await expect(first.getByTestId('repo-path')).toHaveText(pathA)

    // W1에 B 탭을 더한다 → [A, B], B 활성
    const pendingTab = nextWindow(app)
    await first.evaluate((path: string) => window.gitApi.tabs.open(path), pathB)
    const second = await pendingTab
    await expect(second.getByTestId('repo-path')).toHaveText(pathB)

    const tabs = await first.evaluate(
      () =>
        new Promise<{ id: number; repoPath: string | null; active: boolean }[]>((resolve) => {
          const off = window.gitApi.tabs.onChanged((list) => {
            off()
            resolve(list)
          })
        }),
    )
    const tabA = tabs.find((tab) => tab.repoPath === pathA)!
    const tabB = tabs.find((tab) => tab.repoPath === pathB)!

    // A 탭을 도로 활성으로 — 대상 탭(B)이 비활성이어야 활성화 단언이 공허하지 않다.
    // tabs:activate는 show()를 부르지 않으므로 W1의 숨김(아래 사전 조건)도 그대로다
    await second.getByTestId(`tab-${tabA.id}`).click()
    await expect(async () => {
      const visible = await app.evaluate(({ BaseWindow }, wanted: number) => {
        const w1 = BaseWindow.getAllWindows().find((w) =>
          w.contentView.children.some(
            (child) => (child as Electron.WebContentsView).webContents.id === wanted,
          ),
        )!
        return w1.contentView.children
          .filter((child) => child.getVisible())
          .map((child) => (child as Electron.WebContentsView).webContents.id)
      }, tabA.id)
      expect(visible).toEqual([tabA.id])
    }).toPass({ timeout: 5000 })

    // 딴 창 W2 (C) — ⌥클릭은 여기서 한다
    const pendingWindow = nextWindow(app)
    await first.evaluate((path: string) => window.gitApi.window.open(path), pathC)
    const third = await pendingWindow
    await expect(third.getByTestId('repo-path')).toHaveText(pathC)

    // 사전 조건 — E2E 창은 숨어 있다(E6a). 아래 "앞으로 가져온다(show)" 단언의 공허 방지.
    // GIT_GUI_E2E_SHOW=1(로컬 디버깅)은 처음부터 보이므로 이 켤레 단언만 건너뛴다 (기존 관례)
    const w1Hidden = await app.evaluate(({ BaseWindow }, wanted: number) => {
      const w1 = BaseWindow.getAllWindows().find((w) =>
        w.contentView.children.some(
          (child) => (child as Electron.WebContentsView).webContents.id === wanted,
        ),
      )!
      return !w1.isVisible()
    }, tabA.id)
    if (process.env.GIT_GUI_E2E_SHOW !== '1') expect(w1Hidden).toBe(true)

    // W2의 전환기에서 B(W1의 비활성 탭에 열린 저장소)를 ⌥클릭한다
    await third.getByTestId('repo-switcher').click()
    await expect(third.getByTestId('repo-switcher-browse')).toBeVisible()
    await third.getByTestId(`repo-switcher-item-${pathB}`).click({ modifiers: ['Alt'] })

    // 그 탭(B)이 활성이 된다 — W1의 보이는 뷰가 B 하나가 될 때까지
    await expect(async () => {
      const state = await app.evaluate(({ BaseWindow }, wanted: number) => {
        const w1 = BaseWindow.getAllWindows().find((w) =>
          w.contentView.children.some(
            (child) => (child as Electron.WebContentsView).webContents.id === wanted,
          ),
        )!
        return {
          visibleTabs: w1.contentView.children
            .filter((child) => child.getVisible())
            .map((child) => (child as Electron.WebContentsView).webContents.id),
          windowVisible: w1.isVisible(),
        }
      }, tabB.id)
      expect(state.visibleTabs).toEqual([tabB.id])
      // 그 창을 앞으로 — 숨어 있던 W1에 show()가 실제로 돌았다 (위 사전 조건과 켤레)
      if (process.env.GIT_GUI_E2E_SHOW !== '1') expect(state.windowVisible).toBe(true)
    }).toPass({ timeout: 5000 })

    // 창도 탭도 안 늘었다 — 새 창 대신 데려갔다
    expect(await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length)).toBe(2)
    expect(app.windows()).toHaveLength(3)
    // ⌥클릭한 창(W2)은 갈아타지 않았다 — 여전히 C다
    await expect(third.getByTestId('repo-path')).toHaveText(pathC)
  } finally {
    await app.close()
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
    await rm(repoC, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * E15c Task 7 ① — 레이아웃은 창 단위다: 한 탭에서 좌측을 접으면 같은 창의 다른 탭도 접힌다
 * (스펙 §4, 사용자 결정 "창 안에서 같다").
 *
 * **순서가 곧 단언이다** (E15b 실측 — 순서가 단언을 공허하게 만든 사례 둘): 탭 B를 **먼저**
 * 만들어 펼쳐진 채임을 못박은 **뒤** A에서 접는다. 반대로 접고 나서 B를 만들면 B가 씨앗
 * (settings:get-sync의 창 layout 병합)으로 접힘을 받아 push 없이도 통과한다 — 그 씨앗 경로는
 * E15b 「사이드 접힘은 창마다 따로 산다」가 이미 문다. 여기가 무는 것은 **이미 떠 있는** 탭에
 * 닿는 유일한 길인 push(settings:layout-changed)다.
 *
 * A에서의 접기는 A가 **활성일 때** 한다(사용자 흐름 그대로). 그 순간 B는 숨은 뷰다 — 숨은
 * 탭도 push를 받아 둔다(스펙 §4)를 "B로 전환하면 이미 접혀 있다"로 확인한다. 접힘 확인은
 * E12 관용구(count 1 + not.toBeVisible + boundingBox 폭 0 — 접힘은 언마운트가 아니라 폭 0이다)
 */
test('E15c — 한 탭에서 좌측을 접으면 같은 창의 다른 탭도 접힌다', async () => {
  const repoA = await createRepoWithChange()
  const repoB = await createRepoWithFile('beta.txt')
  const pathA = realpathSync(repoA)
  const pathB = realpathSync(repoB)
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repoA },
  })
  try {
    const first = await app.firstWindow()
    await expect(first.getByTestId('repo-path')).toHaveText(pathA)
    await expect(first.locator('.app__left')).toBeVisible()

    // 탭 B를 **먼저** 만든다 — 이 시점 창 layout이 펼침이라 B는 펼쳐진 채 태어난다(사전 조건).
    // 이후의 접힘이 B에 닿는 길은 push뿐이다
    const pending = nextWindow(app)
    await first.evaluate((path: string) => window.gitApi.tabs.open(path), pathB)
    const second = await pending
    await expect(second.getByTestId('repo-path')).toHaveText(pathB)
    await expect(second.locator('.app__left')).toBeVisible()

    // A 탭으로 돌아간다 — 접기는 사용자 흐름대로 활성 탭에서 한다
    const tabs = await first.evaluate(
      () =>
        new Promise<{ id: number; repoPath: string | null; active: boolean }[]>((resolve) => {
          const off = window.gitApi.tabs.onChanged((list) => {
            off()
            resolve(list)
          })
        }),
    )
    const tabA = tabs.find((tab) => tab.repoPath === pathA)!
    const tabB = tabs.find((tab) => tab.repoPath === pathB)!
    await second.getByTestId(`tab-${tabA.id}`).click()
    await expect(async () => {
      const visible = await app.evaluate(({ BaseWindow }) =>
        BaseWindow.getAllWindows()[0]!.contentView.children
          .filter((child) => child.getVisible())
          .map((child) => (child as Electron.WebContentsView).webContents.id),
      )
      expect(visible).toEqual([tabA.id])
    }).toPass({ timeout: 5000 })

    // A(활성)에서 접는다 → A 자신이 접힌다
    await first.getByTestId('left-collapse-toggle').click()
    await expect(first.locator('.app__left')).not.toBeVisible()
    expect((await first.locator('.app__left').boundingBox())!.width).toBe(0)

    // B로 전환한다 — 숨어 있던 B가 push를 받아 둔 덕에 켜지는 순간 이미 접혀 있다
    await first.getByTestId(`tab-${tabB.id}`).click()
    await expect(async () => {
      const visible = await app.evaluate(({ BaseWindow }) =>
        BaseWindow.getAllWindows()[0]!.contentView.children
          .filter((child) => child.getVisible())
          .map((child) => (child as Electron.WebContentsView).webContents.id),
      )
      expect(visible).toEqual([tabB.id])
    }).toPass({ timeout: 5000 })
    await expect(second.locator('.app__left')).toHaveCount(1)
    await expect(second.locator('.app__left')).not.toBeVisible()
    expect((await second.locator('.app__left').boundingBox())!.width).toBe(0)
  } finally {
    await app.close()
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
  }
})

/**
 * E15c Task 7 ② — push의 범위는 "같은 창의 다른 탭"이지 모든 탭이 아니다: 다른 **창**은 안
 * 접힌다 (스펙 §4 성공 기준의 후반부 — E15b 「창마다 따로 산다」의 탭 세계 계승).
 *
 * 구성이 곧 단언이다: 창 둘 + 한 창(W1)에 탭 둘. W1에서 접었을 때 (a) 같은 창 형제 탭이
 * 접힌다(양성 — push가 실제로 돌았다는 동기화 지점. 이것 없이 W2만 보면 push가 통째로
 * 죽어도 통과하는 공허한 테스트다)와 (b) 다른 창 W2는 그대로다(음성)를 **같은 조작**에서 문다.
 */
test('E15c — 한 탭에서 접어도 다른 창은 안 접힌다', async () => {
  const repoA = await createRepoWithChange()
  const repoB = await createRepoWithFile('beta.txt')
  const repoC = await createRepoWithFile('gamma.txt')
  const pathB = realpathSync(repoB)
  const pathC = realpathSync(repoC)
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repoA },
  })
  try {
    const first = await app.firstWindow()
    await expect(first.locator('.app__left')).toBeVisible()

    // W1에 탭 B를 더한다 → [A, B], B 활성. 접기 전에 만들어야 push 검증이다 (①과 같은 이유)
    const pendingTab = nextWindow(app)
    await first.evaluate((path: string) => window.gitApi.tabs.open(path), pathB)
    const second = await pendingTab
    await expect(second.getByTestId('repo-path')).toHaveText(pathB)
    await expect(second.locator('.app__left')).toBeVisible()

    // 딴 창 W2 (C) — 역시 접기 전에. 씨앗(열어준 창의 layout)도 펼침이다
    const pendingWindow = nextWindow(app)
    await first.evaluate((path: string) => window.gitApi.window.open(path), pathC)
    const third = await pendingWindow
    await expect(third.getByTestId('repo-path')).toHaveText(pathC)
    await expect(third.locator('.app__left')).toBeVisible()

    // W1의 활성 탭 B에서 접는다
    await second.getByTestId('left-collapse-toggle').click()
    await expect(second.locator('.app__left')).not.toBeVisible()

    // (a) 양성 — 같은 창의 형제 탭 A가 접혔다. push fan-out이 이미 돌았다는 동기화 지점이기도
    // 하다: 이 단언이 통과한 시점이면 W2로 갈 push도(있었다면) 같은 루프에서 이미 나갔다
    await expect(first.locator('.app__left')).toHaveCount(1)
    await expect(first.locator('.app__left')).not.toBeVisible()
    expect((await first.locator('.app__left').boundingBox())!.width).toBe(0)

    // (b) 음성 — 다른 창 W2는 그대로 펼쳐져 있다. 위 동기화에 늦은 IPC 여유를 조금 더 얹는다
    await third.waitForTimeout(500)
    await expect(third.locator('.app__left')).toBeVisible()
    expect((await third.locator('.app__left').boundingBox())!.width).toBeGreaterThan(0)
  } finally {
    await app.close()
    await rm(repoA, { recursive: true, force: true })
    await rm(repoB, { recursive: true, force: true })
    await rm(repoC, { recursive: true, force: true })
  }
})
