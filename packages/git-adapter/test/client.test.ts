import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { execGit, execGitOrThrow, GitError } from '@git-gui/git-process'
import { createGitClient } from '../src/client'
import { createFixtureRepo, createFixtureRepoWithRemote, FIXTURE_IDENT, writeFixtureFile } from './fixture'

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

  it('stage/unstage에 빈 배열을 넘기면 전체 작업으로 확대되지 않고 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# changed\n')
    await expect(client.changes.stage([])).rejects.toThrow()
    await expect(client.changes.unstage([])).rejects.toThrow()
    await expect(client.changes.stage([''])).rejects.toThrow()
    await expect(client.changes.diff('', { staged: false, untracked: false })).rejects.toThrow()
    const status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'README.md')?.staged).toBeNull()
  })

  it('pathspec 매직·글롭 파일명을 리터럴로 처리한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'a*.txt', 'glob\n')
    await writeFixtureFile(repo, 'axx.txt', 'other\n')
    await writeFixtureFile(repo, ':(top)', 'magic\n')
    await client.changes.stage(['a*.txt', ':(top)'])
    const status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'a*.txt')?.staged).toBe('added')
    expect(status.changes.find((c) => c.path === ':(top)')?.staged).toBe('added')
    expect(status.changes.find((c) => c.path === 'axx.txt')?.staged).toBeNull()
    expect(status.changes.find((c) => c.path === 'axx.txt')?.unstaged).toBe('untracked')
  })

  it('untracked 디렉터리 diff는 빈 결과로 위장하지 않고 에러를 던진다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await mkdir(join(repo, 'newdir'))
    await writeFixtureFile(repo, 'newdir/inner.txt', 'x\n')
    await expect(
      client.changes.diff('newdir/', { staged: false, untracked: true }),
    ).rejects.toThrow()
  })

  it('저장소 밖 경로의 untracked diff를 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(
      client.changes.diff('/etc/hosts', { staged: false, untracked: true }),
    ).rejects.toThrow()
    await expect(
      client.changes.diff('../outside.txt', { staged: false, untracked: true }),
    ).rejects.toThrow()
  })

  it('저장소 하위 폴더 경로로 열어도 루트 기준으로 동작한다', async () => {
    const repo = await createFixtureRepo()
    await mkdir(join(repo, 'sub'))
    await writeFixtureFile(repo, 'sub/inner.txt', 'v1\n')
    const client = createGitClient(join(repo, 'sub'))
    await client.changes.stage(['sub/inner.txt'])
    const status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'sub/inner.txt')?.staged).toBe('added')
  })

  it('빈 커밋 메시지는 GitError로 거부된다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# changed\n')
    await client.changes.stage(['README.md'])
    await expect(client.commits.create('')).rejects.toBeInstanceOf(GitError)
  })

  it('history — 최신순 목록을 반환하고 limit을 지킨다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'a.txt', '1\n')
    await client.changes.stage(['a.txt'])
    await client.commits.create('두 번째 저장')

    const all = await client.history.list(50)
    expect(all.map((c) => c.subject)).toEqual(['두 번째 저장', 'init'])
    expect(all[0]?.shortHash.length).toBeGreaterThanOrEqual(7)
    expect(all[0]?.committedAt).toBeGreaterThan(0)

    const limited = await client.history.list(1)
    expect(limited.map((c) => c.subject)).toEqual(['두 번째 저장'])

    // NaN 같은 비유한수는 기본값(50)으로 동작해야 한다 — --max-count=NaN 방지
    const withNaN = await client.history.list(Number.NaN)
    expect(withNaN.map((c) => c.subject)).toEqual(['두 번째 저장', 'init'])
  })

  it('history — 커밋이 없는 저장소(unborn)는 빈 목록이다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'git-gui-unborn-'))
    await execGitOrThrow(['init', '--initial-branch=main'], { cwd: dir })
    const commits = await createGitClient(dir).history.list(50)
    expect(commits).toEqual([])
  })

  it('push — 첫 백업은 upstream을 연결하며 올리고, 이후는 그대로 push한다', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)

    await client.sync.push()
    let remoteLog = await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: remote })
    expect(remoteLog.stdout.trim()).toBe('init')

    const status = await client.repo.status()
    expect(status.branch.upstream).toBe('origin/main')
    expect(status.branch.ahead).toBe(0)
    expect(status.branch.behind).toBe(0)

    await writeFixtureFile(repo, 'b.txt', '1\n')
    await client.changes.stage(['b.txt'])
    await client.commits.create('둘째')
    await client.sync.push()
    remoteLog = await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: remote })
    expect(remoteLog.stdout.trim()).toBe('둘째')
  })

  it('push — 원격이 없으면 친절한 에러를 던진다', async () => {
    const repo = await createFixtureRepo()
    await expect(createGitClient(repo).sync.push()).rejects.toThrow('원격 저장소가 없어요')
  })

  it('push — detached HEAD에서는 읽히는 에러를 던진다', async () => {
    const { repo } = await createFixtureRepoWithRemote()
    await execGitOrThrow(['checkout', '--detach'], { cwd: repo })
    await expect(createGitClient(repo).sync.push()).rejects.toThrow('브랜치가 아닌 시점')
  })

  it('push — push.default=matching이어도 현재 브랜치만 올린다', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push() // upstream 연결

    // 다른 브랜치에 원격에 없는 커밋을 만들어 둔다
    await execGitOrThrow(['checkout', '-b', 'side'], { cwd: repo })
    await writeFixtureFile(repo, 'side.txt', '1\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'side-only'], { cwd: repo })
    await execGitOrThrow(['checkout', 'main'], { cwd: repo })
    await writeFixtureFile(repo, 'm.txt', '1\n')
    await client.changes.stage(['m.txt'])
    await client.commits.create('main-two')

    // 전역 push.default=matching 시나리오를 저장소 로컬 설정으로 재현
    await execGitOrThrow(['config', 'push.default', 'matching'], { cwd: repo })
    await client.sync.push()

    const remoteBranches = await execGitOrThrow(['branch', '--format=%(refname:short)'], {
      cwd: remote,
    })
    expect(remoteBranches.stdout).not.toContain('side')
    const remoteLog = await execGitOrThrow(['log', '-1', '--format=%s', 'main'], { cwd: remote })
    expect(remoteLog.stdout.trim()).toBe('main-two')
  })

  it('push — 커밋이 없는 저장소는 읽히는 에러를 던진다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'git-gui-unborn-push-'))
    await execGitOrThrow(['init', '--initial-branch=main'], { cwd: dir })
    const bare = await mkdtemp(join(tmpdir(), 'git-gui-unborn-remote-'))
    await execGitOrThrow(['init', '--bare'], { cwd: bare })
    await execGitOrThrow(['remote', 'add', 'origin', bare], { cwd: dir })
    await expect(createGitClient(dir).sync.push()).rejects.toThrow('아직 저장된 시점이 없어요')
  })
})
