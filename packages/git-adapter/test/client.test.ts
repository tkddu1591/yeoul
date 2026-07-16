import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
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

  it('diff — unstaged, staged, untracked 각각 구조화된 diff를 반환한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# changed\n')
    await writeFixtureFile(repo, 'new.txt', 'hello\n')

    const unstaged = await client.changes.diff('README.md', { staged: false, untracked: false })
    const unstagedLines = unstaged.hunks.flatMap((hunk) => hunk.lines)
    expect(unstagedLines).toContainEqual({ kind: 'del', oldLine: 1, newLine: null, text: '# fixture' })
    expect(unstagedLines).toContainEqual({ kind: 'add', oldLine: null, newLine: 1, text: '# changed' })

    await client.changes.stage(['README.md'])
    const staged = await client.changes.diff('README.md', { staged: true, untracked: false })
    expect(staged.hunks.flatMap((h) => h.lines).some((l) => l.kind === 'add' && l.text === '# changed')).toBe(true)

    const untracked = await client.changes.diff('new.txt', { staged: false, untracked: true })
    expect(untracked.hunks.flatMap((h) => h.lines).some((l) => l.kind === 'add' && l.text === 'hello')).toBe(true)
  })

  it('diff — staged rename은 origPath를 함께 주면 rename으로 표시된다 (전체 내용 추가로 위장하지 않는다)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await execGitOrThrow(['mv', 'README.md', 'DOCS.md'], { cwd: repo })

    const diff = await client.changes.diff('DOCS.md', {
      staged: true,
      untracked: false,
      origPath: 'README.md',
    })
    expect(diff.meta.some((line) => line.startsWith('rename from README.md'))).toBe(true)
    // R100(내용 동일)은 hunks가 없다 — 전체 내용이 add로 나오면 회귀
    expect(diff.hunks).toEqual([])
  })

  it('diffFile — 커밋의 단일 파일 diff를 반환한다 (root·rename·병합 첫 부모)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)

    // root 커밋의 파일
    const history1 = await client.history.list(10)
    const root = history1[history1.length - 1]!
    const rootDiff = await client.commits.diffFile(root.hash, 'README.md', null)
    expect(
      rootDiff.hunks.flatMap((h) => h.lines).some((l) => l.kind === 'add' && l.text === '# fixture'),
    ).toBe(true)

    // rename 커밋 — origPath 동봉 시 rename meta
    await execGitOrThrow(['mv', 'README.md', 'DOCS.md'], { cwd: repo })
    await client.commits.create('rename')
    const renameHead = (await client.history.list(1))[0]!
    const renameDiff = await client.commits.diffFile(renameHead.hash, 'DOCS.md', 'README.md')
    expect(renameDiff.meta.some((line) => line.startsWith('rename from README.md'))).toBe(true)

    // 병합 커밋 — 첫 부모 기준
    await execGitOrThrow(['checkout', '-b', 'side'], { cwd: repo })
    await writeFixtureFile(repo, 'side.txt', 's\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'side'], { cwd: repo })
    await execGitOrThrow(['checkout', 'main'], { cwd: repo })
    await writeFixtureFile(repo, 'main.txt', 'm\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'main-side'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'merge', '--no-edit', 'side'], { cwd: repo })
    const merge = (await client.history.list(1))[0]!
    const mergeDiff = await client.commits.diffFile(merge.hash, 'side.txt', null)
    expect(
      mergeDiff.hunks.flatMap((h) => h.lines).some((l) => l.kind === 'add' && l.text === 's'),
    ).toBe(true)
  })

  it('diffFile — 잘못된 해시·저장소 밖 경로를 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    const head = (await client.history.list(1))[0]!
    await expect(client.commits.diffFile('HEAD', 'README.md', null)).rejects.toThrow()
    await expect(client.commits.diffFile(head.hash, '../out.txt', null)).rejects.toThrow()
    await expect(client.commits.diffFile(head.hash, 'README.md', '../out.txt')).rejects.toThrow()
  })

  it('diffFile — 사라진(존재하지 않는) 커밋은 원시 git 에러 대신 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(
      client.commits.diffFile('deadbeef'.repeat(5), 'README.md', null),
    ).rejects.toThrow(/저장 시점을 찾을 수 없어요/)
  })

  it('diff — 사용자 전역 diff.renames=false여도 staged rename은 rename으로 표시된다 (-M 고정)', async () => {
    const repo = await createFixtureRepo()
    await execGitOrThrow(['config', 'diff.renames', 'false'], { cwd: repo })
    const client = createGitClient(repo)
    await execGitOrThrow(['mv', 'README.md', 'DOCS.md'], { cwd: repo })
    const diff = await client.changes.diff('DOCS.md', {
      staged: true,
      untracked: false,
      origPath: 'README.md',
    })
    expect(diff.meta.some((line) => line.startsWith('rename from README.md'))).toBe(true)
    expect(diff.hunks).toEqual([])
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

  it('discard — tracked 수정은 마지막 저장 상태로 되돌리고, untracked는 삭제한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# changed\n')
    await writeFixtureFile(repo, 'new.txt', 'n\n')

    await client.changes.discard(['README.md'], ['new.txt'])
    const status = await client.repo.status()
    expect(status.changes).toEqual([])
    expect(existsSync(join(repo, 'new.txt'))).toBe(false)
    // tracked 파일은 삭제가 아니라 복원이다
    expect(existsSync(join(repo, 'README.md'))).toBe(true)
  })

  it('discard — staged 내용은 건드리지 않는다 (worktree만 되돌린다)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# staged\n')
    await client.changes.stage(['README.md'])
    await writeFixtureFile(repo, 'README.md', '# worktree\n')

    await client.changes.discard(['README.md'], [])
    const status = await client.repo.status()
    // staged 변경은 그대로, unstaged 변경만 사라진다 (worktree = index)
    expect(status.changes.find((c) => c.path === 'README.md')?.staged).toBe('modified')
    expect(status.changes.find((c) => c.path === 'README.md')?.unstaged).toBeNull()
  })

  it('discard — 글롭·매직 파일명을 리터럴로 처리해 다른 파일을 지우지 않는다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, '*.txt', 'glob\n')
    await writeFixtureFile(repo, 'victim.txt', 'v\n')
    await client.changes.discard([], ['*.txt'])
    expect(existsSync(join(repo, '*.txt'))).toBe(false)
    expect(existsSync(join(repo, 'victim.txt'))).toBe(true)
  })

  it('discard — 둘 다 빈 배열이면 거부한다 (전체 확대 방지)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.changes.discard([], [])).rejects.toThrow()
  })

  it('discard — 빈 문자열 경로를 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.changes.discard([''], [])).rejects.toThrow()
    await expect(client.changes.discard([], [''])).rejects.toThrow()
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

  it('status — 미추적 디렉터리는 접히지 않고 개별 파일로 나열된다 (-uall)', async () => {
    const repo = await createFixtureRepo()
    await mkdir(join(repo, 'newdir'))
    await writeFixtureFile(repo, 'newdir/inner.txt', 'x\n')
    const status = await createGitClient(repo).repo.status()
    expect(status.changes.map((c) => c.path)).toContain('newdir/inner.txt')
    // 디렉터리 행(trailing slash)이 오면 이름 없는 행·diff 에러로 이어진다
    expect(status.changes.some((c) => c.path.endsWith('/'))).toBe(false)
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

  it('show — 전체 메시지(제목·본문)와 변경 파일 목록을 반환한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# changed\n')
    await writeFixtureFile(repo, 'new.txt', 'n\n')
    await client.changes.stage(['README.md', 'new.txt'])
    await client.commits.create('제목 한 줄\n\n본문 첫 줄\n본문 둘째 줄')

    const head = (await client.history.list(1))[0]!
    const detail = await client.commits.show(head.hash)
    expect(detail.subject).toBe('제목 한 줄')
    expect(detail.body).toBe('본문 첫 줄\n본문 둘째 줄')
    expect(detail.parents).toHaveLength(1)
    expect(detail.files).toEqual([
      { path: 'README.md', origPath: null, kind: 'modified' },
      { path: 'new.txt', origPath: null, kind: 'added' },
    ])
  })

  it('show — rename 커밋은 origPath를 담는다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await execGitOrThrow(['mv', 'README.md', 'DOCS.md'], { cwd: repo })
    await client.commits.create('rename')

    const head = (await client.history.list(1))[0]!
    const detail = await client.commits.show(head.hash)
    expect(detail.files).toEqual([{ path: 'DOCS.md', origPath: 'README.md', kind: 'renamed' }])
  })

  it('show — 병합 커밋은 첫 부모 기준의 파일만 나열한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await execGitOrThrow(['checkout', '-b', 'side'], { cwd: repo })
    await writeFixtureFile(repo, 'side.txt', 's\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'side'], { cwd: repo })
    await execGitOrThrow(['checkout', 'main'], { cwd: repo })
    await writeFixtureFile(repo, 'main.txt', 'm\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'main-side'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'merge', '--no-edit', 'side'], { cwd: repo })

    const merge = (await client.history.list(1))[0]!
    const detail = await client.commits.show(merge.hash)
    // 첫 부모(main-side) 기준: side에서 온 파일만 새로 추가로 보인다
    expect(detail.parents).toHaveLength(2)
    expect(detail.files).toEqual([{ path: 'side.txt', origPath: null, kind: 'added' }])
  })

  it('show — root 커밋(부모 없음)도 파일 목록을 반환한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    const history = await client.history.list(10)
    const root = history[history.length - 1]!
    const detail = await client.commits.show(root.hash)
    expect(detail.parents).toEqual([])
    expect(detail.files).toEqual([{ path: 'README.md', origPath: null, kind: 'added' }])
  })

  it('show — 40자 hex가 아닌 해시를 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.commits.show('HEAD')).rejects.toThrow()
    await expect(client.commits.show('--help')).rejects.toThrow()
    await expect(client.commits.show('a'.repeat(39))).rejects.toThrow()
  })

  it('show — 사라진(존재하지 않는) 커밋은 원시 git 에러 대신 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.commits.show('deadbeef'.repeat(5))).rejects.toThrow(
      /저장 시점을 찾을 수 없어요/,
    )
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

  it('history — refs와 parents를 반환하고 병합 커밋을 식별한다', async () => {
    const repo = await createFixtureRepo()
    await execGitOrThrow(['checkout', '-b', 'side'], { cwd: repo })
    await writeFixtureFile(repo, 'side.txt', 's\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'side'], { cwd: repo })
    await execGitOrThrow(['checkout', 'main'], { cwd: repo })
    await writeFixtureFile(repo, 'main.txt', 'm\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'main-side'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'merge', '--no-edit', 'side'], { cwd: repo })

    const history = await createGitClient(repo).history.list(10)
    const merge = history[0]!
    expect(merge.parents).toHaveLength(2)
    expect(merge.refs).toContain('main')
    // 일반 커밋은 부모 1개, 배지 없음
    const plain = history.find((c) => c.subject === 'main-side')!
    expect(plain.parents).toHaveLength(1)
    expect(plain.refs).toEqual([])
    // root 커밋은 부모 없음
    expect(history[history.length - 1]!.parents).toEqual([])
  })

  it('history — 타임스탬프가 같아도 부모가 자식보다 항상 아래에 온다 (--date-order, 레인 그래프 전제)', async () => {
    const repo = await createFixtureRepo()
    const at = '2026-07-16T12:00:00+09:00'
    const env = {
      ...process.env,
      GIT_AUTHOR_DATE: at,
      GIT_COMMITTER_DATE: at,
      GIT_AUTHOR_NAME: 'Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@test.local',
      GIT_COMMITTER_NAME: 'Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@test.local',
    }
    const run = (args: string[]) => execFileSync('git', args, { cwd: repo, env })
    run(['checkout', '-b', 'side'])
    for (let i = 0; i < 3; i += 1) run(['commit', '--allow-empty', '-m', `side ${i}`])
    run(['checkout', 'main'])
    for (let i = 0; i < 3; i += 1) run(['commit', '--allow-empty', '-m', `main ${i}`])
    run(['merge', '--no-edit', '--no-ff', 'side'])

    const history = await createGitClient(repo).history.list(50)
    const position = new Map(history.map((c, index) => [c.hash, index]))
    for (const commit of history) {
      for (const parent of commit.parents) {
        // 이 fixture는 전부 화면 안 — 부모는 반드시 자식보다 뒤(아래)여야 한다
        expect(position.get(parent)!).toBeGreaterThan(position.get(commit.hash)!)
      }
    }
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

    // matching은 "양쪽에 같은 이름이 있는 브랜치"를 전부 올린다 —
    // 위험을 재현하려면 side가 원격에도 존재해야 한다
    await execGitOrThrow(['checkout', '-b', 'side'], { cwd: repo })
    await execGitOrThrow(['push', 'origin', 'side'], { cwd: repo })
    // 원격에 없는 새 커밋을 side에 만들어 둔다
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

    // side의 새 커밋은 올라가면 안 된다 — 백업 범위는 현재 브랜치뿐
    const remoteSideLog = await execGitOrThrow(['log', '-1', '--format=%s', 'side'], {
      cwd: remote,
    })
    expect(remoteSideLog.stdout.trim()).toBe('init')
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
