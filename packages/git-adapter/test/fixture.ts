import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execGitOrThrow } from '@git-gui/git-process'

/** 커밋 작성자 설정을 저장소 로컬로 주입해 시스템 설정과 격리한다 */
export const FIXTURE_IDENT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@test.local']

export async function createFixtureRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'git-gui-fixture-'))
  await execGitOrThrow(['init', '--initial-branch=main'], { cwd: dir })
  await writeFile(join(dir, 'README.md'), '# fixture\n')
  await execGitOrThrow(['add', '-A'], { cwd: dir })
  await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'init'], { cwd: dir })
  return dir
}

export async function writeFixtureFile(repo: string, name: string, content: string): Promise<void> {
  await writeFile(join(repo, name), content)
}
