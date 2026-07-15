import { describe, expect, it } from 'vitest'
import { execGit, execGitOrThrow } from '@git-gui/git-process'
import { createGitClient } from '../src/client'
import { createFixtureRepo, FIXTURE_IDENT, writeFixtureFile } from './fixture'

describe('GitClient', () => {
  it('깨끗한 저장소의 status — normal 상태, main 브랜치, 변경 없음', async () => {
    const repo = await createFixtureRepo()
    const status = await createGitClient(repo).repo.status()
    expect(status.state).toBe('normal')
    expect(status.branch.name).toBe('main')
    expect(status.changes).toEqual([])
  })

  it('수정 → untracked/modified 감지 → stage → unstage 왕복', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# changed\n')
    await writeFixtureFile(repo, 'new.txt', 'hello\n')

    let status = await client.repo.status()
    expect(status.changes).toHaveLength(2)
    expect(status.changes.find((c) => c.path === 'README.md')?.unstaged).toBe('modified')
    expect(status.changes.find((c) => c.path === 'new.txt')?.unstaged).toBe('untracked')

    await client.changes.stage(['README.md', 'new.txt'])
    status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'README.md')?.staged).toBe('modified')
    expect(status.changes.find((c) => c.path === 'new.txt')?.staged).toBe('added')

    await client.changes.unstage(['new.txt'])
    status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'new.txt')?.unstaged).toBe('untracked')
  })

  it('diff — unstaged, staged, untracked 각각 patch 텍스트를 반환한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# changed\n')
    await writeFixtureFile(repo, 'new.txt', 'hello\n')

    const unstaged = await client.changes.diff('README.md', { staged: false, untracked: false })
    expect(unstaged).toContain('-# fixture')
    expect(unstaged).toContain('+# changed')

    await client.changes.stage(['README.md'])
    const staged = await client.changes.diff('README.md', { staged: true, untracked: false })
    expect(staged).toContain('+# changed')

    const untracked = await client.changes.diff('new.txt', { staged: false, untracked: true })
    expect(untracked).toContain('+hello')
  })

  it('commit — stage된 변경으로 커밋을 만들고 changes가 비워진다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# changed\n')
    await client.changes.stage(['README.md'])
    await client.commits.create('feat: 첫 줄\n\n본문 "따옴표" 포함')

    const status = await client.repo.status()
    expect(status.changes).toEqual([])
    const log = await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: repo })
    expect(log.stdout.trim()).toBe('feat: 첫 줄')
  })

  it('merge 충돌 상태를 merging으로 감지한다', async () => {
    const repo = await createFixtureRepo()
    await execGitOrThrow(['checkout', '-b', 'feature'], { cwd: repo })
    await writeFixtureFile(repo, 'README.md', '# feature\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'feature'], { cwd: repo })
    await execGitOrThrow(['checkout', 'main'], { cwd: repo })
    await writeFixtureFile(repo, 'README.md', '# main\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'main'], { cwd: repo })
    // 충돌하는 merge — 실패(exit != 0)가 정상이므로 결과를 확인하지 않는다
    await execGit(['merge', 'feature'], { cwd: repo })

    const status = await createGitClient(repo).repo.status()
    expect(status.state).toBe('merging')
    expect(status.changes.find((c) => c.path === 'README.md')?.unstaged).toBe('conflicted')
  })
})
