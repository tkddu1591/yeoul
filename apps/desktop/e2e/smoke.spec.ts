import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { execGitOrThrow } from '@git-gui/git-process'

const IDENT = ['-c', 'user.name=E2E', '-c', 'user.email=e2e@test.local']

async function createRepoWithChange(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'git-gui-e2e-'))
  await execGitOrThrow(['init', '--initial-branch=main'], { cwd: dir })
  await writeFile(join(dir, 'app.txt'), 'v1\n')
  await execGitOrThrow(['add', '-A'], { cwd: dir })
  await execGitOrThrow([...IDENT, 'commit', '-m', 'init'], { cwd: dir })
  await writeFile(join(dir, 'app.txt'), 'v2\n')
  return dir
}

test('저장소 열기 → 변경 확인 → stage → commit', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  const window = await app.firstWindow()

  // 변경 파일이 보인다
  await expect(window.getByText('app.txt')).toBeVisible()

  // stage
  await window.getByRole('button', { name: '올리기' }).click()
  await expect(window.getByText('저장 예정 (staged) — 1')).toBeVisible()

  // commit
  await window.getByPlaceholder('저장 메시지를 입력하세요').fill('e2e: 첫 저장')
  await window.getByRole('button', { name: /저장하기/ }).click()
  await expect(window.getByText('저장 예정 (staged) — 0')).toBeVisible()
  await expect(window.getByText('작업 중 (unstaged) — 0')).toBeVisible()

  // 실제 커밋이 생겼는지 검증
  const log = await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: repo })
  expect(log.stdout.trim()).toBe('e2e: 첫 저장')

  await app.close()
})
