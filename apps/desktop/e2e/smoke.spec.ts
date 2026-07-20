import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { execGitOrThrow } from '@git-gui/git-process'

// cwd에 의존하지 않도록 앱 루트를 절대 경로로 지정한다
const APP_ROOT = join(__dirname, '..')

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

test('열기 → stage → commit → 역사 반영 → 백업', async () => {
  const repo = await createRepoWithChange()
  const remote = await addBareRemote(repo)
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()

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

test('커밋을 누르면 우측이 상세로 바뀌고 파일 diff는 가운데에 뜬다', async () => {
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
    // 최신 커밋 클릭 → 우측 열이 타임라인에서 상세로 전환
    await window.locator('[data-testid^="history-item-"]').first().click()
    await expect(window.getByTestId('commit-detail-panel')).toBeVisible()
    // 상세 모드에서 우측 열이 확장된다 (4차 피드백)
    await expect(window.locator('.app__main')).toHaveClass(/app__main--detail/)
    await expect(window.getByTestId('history-panel')).toHaveCount(0)
    await expect(window.getByTestId('commit-detail-subject')).toHaveText('두 번째 저장')
    await expect(window.getByTestId('commit-detail-body')).toHaveText('자세한 설명 줄')
    await expect(window.getByTestId('commit-detail-file-count')).toHaveText('1')
    // 파일 클릭 → 좌측 흐름과 동일하게 중앙 diff에 뜬다 (v1 → v2 수정)
    await window.getByTestId('commit-file-app.txt').click()
    await expect(window.getByTestId('diff-view-unified')).toContainText('v2')
    await expect(window.getByTestId('diff-panel')).toContainText('저장')
    // 목록으로 → 타임라인 복귀
    await window.getByTestId('commit-detail-back').click()
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
    // root 시점으로 이동했으므로 역사는 1개
    await expect(window.getByTestId('history-count')).toHaveText('1')
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
    await expect(window.getByTestId('history-count')).toHaveText('1')
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
    // 합쳐지지 않은 저장 — 강제 확인창이 이어진다
    await expect(window.getByTestId('confirm-accept')).toBeVisible()
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId('manage-remove-doomed')).toHaveCount(0)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
