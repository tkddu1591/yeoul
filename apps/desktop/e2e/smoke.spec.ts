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
