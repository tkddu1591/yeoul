import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, symlink, unlink } from 'node:fs/promises'
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

  it('history — 다른 실험 공간의 커밋도 전부 반환한다 (--all 전체 그래프)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await execGitOrThrow(['checkout', '-b', 'side'], { cwd: repo })
    await writeFixtureFile(repo, 'side.txt', 's\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'side work'], { cwd: repo })
    await execGitOrThrow(['checkout', 'main'], { cwd: repo })

    // 지금 공간(main)에서 도달할 수 없는 side 커밋이 함께 보인다 (피드백 4)
    const history = await client.history.list(10)
    expect(history.map((c) => c.subject).sort()).toEqual(['init', 'side work'])
    expect(history.find((c) => c.subject === 'side work')!.refs).toContain('side')
  })

  it('history — 보관함(refs/stash) 커밋은 역사에 나타나지 않는다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# dirty\n')
    await client.shelf.save('보관 실험')

    // 실측 1: --exclude=refs/stash 없는 --all은 WIP 커밋 3형제를 역사에 노출한다
    const history = await client.history.list(10)
    expect(history.map((c) => c.subject)).toEqual(['init'])
  })

  it('history — 분리된 루트(고아 브랜치)가 있어도 전체가 반환된다', async () => {
    const repo = await createFixtureRepo()
    await execGitOrThrow(['checkout', '--orphan', 'lonely'], { cwd: repo })
    await execGitOrThrow(['rm', '-rf', '--cached', '.'], { cwd: repo })
    await unlink(join(repo, 'README.md'))
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '--allow-empty', '-m', 'orphan root'], {
      cwd: repo,
    })

    const history = await createGitClient(repo).history.list(10)
    expect(history.map((c) => c.subject).sort()).toEqual(['init', 'orphan root'])
    // 고아 루트도 부모 없는 정상 레코드다 — 레인 그래프 전제(실측 2: buildGraph 5,003커밋 2.8ms 무붕괴)
    expect(history.find((c) => c.subject === 'orphan root')!.parents).toEqual([])
  })

  it('status — headHash가 HEAD 커밋을 가리키고, 저장이 없으면 null이다', async () => {
    const repo = await createFixtureRepo()
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    expect((await createGitClient(repo).repo.status()).headHash).toBe(head)

    const unborn = await mkdtemp(join(tmpdir(), 'git-gui-unborn-'))
    await execGitOrThrow(['init', '--initial-branch=main'], { cwd: unborn })
    expect((await createGitClient(unborn).repo.status()).headHash).toBeNull()
  })

  it('branches — 목록(현재 표시·최신순)과 만들기, 특정 시점에서 만들기', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('exp-1', null)
    const root = (await client.history.list(1))[0]!
    await writeFixtureFile(repo, 'more.txt', 'm\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'second'], { cwd: repo })
    await client.branches.create('exp-old', root.hash)

    const branches = await client.branches.list()
    expect(branches.map((b) => b.name).sort()).toEqual(['exp-1', 'exp-old', 'main'])
    expect(branches.find((b) => b.name === 'main')?.isCurrent).toBe(true)
    expect(branches.find((b) => b.name === 'exp-1')?.isCurrent).toBe(false)
  })

  it('branches — 잘못된 이름·중복 이름을 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.branches.create('bad name', null)).rejects.toThrow(/이름으로는 만들 수 없어요/)
    await expect(client.branches.create('-dash', null)).rejects.toThrow(/이름으로는 만들 수 없어요/)
    await client.branches.create('dup', null)
    await expect(client.branches.create('dup', null)).rejects.toThrow(/이미 있는 이름/)
  })

  it('switch — 겹치지 않는 변경은 그대로 들고 전환한다 (자동 보관 없음)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('exp', null)
    await writeFixtureFile(repo, 'free.txt', 'f\n')
    const result = await client.branches.switch('exp')
    expect(result).toEqual({ autoShelved: false })
    const status = await client.repo.status()
    expect(status.branch.name).toBe('exp')
    expect(status.changes.find((c) => c.path === 'free.txt')?.unstaged).toBe('untracked')
    expect(await client.shelf.list()).toEqual([])
  })

  it('switch — 겹치는 변경으로 막히면 보관함에 자동 저장하고 전환한다 (복원은 하지 않는다)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    // 대상 브랜치의 README가 다르도록 만든다 — 전환이 "would be overwritten"으로 막히는 조건
    await execGitOrThrow(['checkout', '-b', 'other'], { cwd: repo })
    await writeFixtureFile(repo, 'README.md', '# other\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'other change'], { cwd: repo })
    await execGitOrThrow(['checkout', 'main'], { cwd: repo })
    await writeFixtureFile(repo, 'README.md', '# my work\n')

    const result = await client.branches.switch('other')
    expect(result).toEqual({ autoShelved: true })
    const status = await client.repo.status()
    expect(status.branch.name).toBe('other')
    // 작업 트리는 깨끗하고(변경은 보관함으로), 항목이 하나 생겼다
    expect(status.changes).toEqual([])
    const shelf = await client.shelf.list()
    expect(shelf).toHaveLength(1)
    expect(shelf[0]!.message).toContain('실험 공간 전환 자동 보관')
  })

  it('switch — 없는 실험 공간은 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.branches.switch('no-such')).rejects.toThrow(/실험 공간이 없어요/)
  })

  it('shelf — 항목 해시로 커밋 상세(미리보기)를 열 수 있다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# changed\n')
    await client.shelf.save('미리보기 대상')

    const shelf = await client.shelf.list()
    expect(shelf[0]!.hash).toMatch(/^[0-9a-f]{40}$/)
    // stash 항목은 실제 커밋 — 기존 커밋 상세 흐름을 그대로 재사용한다
    const detail = await client.commits.show(shelf[0]!.hash)
    expect(detail.files.map((f) => f.path)).toContain('README.md')
  })

  it('shelf — 보관·목록·꺼내기·버리기 왕복 (untracked 포함)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# changed\n')
    await writeFixtureFile(repo, 'new.txt', 'n\n')
    await client.shelf.save('직접 보관')

    let status = await client.repo.status()
    expect(status.changes).toEqual([])
    const shelf = await client.shelf.list()
    expect(shelf).toHaveLength(1)
    expect(shelf[0]!.message).toContain('직접 보관')

    await client.shelf.restore(shelf[0]!.ref)
    status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'README.md')?.unstaged).toBe('modified')
    expect(status.changes.find((c) => c.path === 'new.txt')?.unstaged).toBe('untracked')
    expect(await client.shelf.list()).toEqual([])

    await client.shelf.save('버릴 항목')
    const again = await client.shelf.list()
    await client.shelf.drop(again[0]!.ref)
    expect(await client.shelf.list()).toEqual([])
  })

  it('shelf — 깨끗한 트리 보관과 잘못된 ref를 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.shelf.save('없는 변경')).rejects.toThrow(/보관할 변경이 없어요/)
    // 패턴 필수 — 무패턴 toThrow는 가드를 제거해도 git 원시 에러로 통과해 버린다(변이 실증).
    // 가드가 없으면 '--quiet' 같은 입력이 플래그로 해석돼 엉뚱한 최신 항목이 pop된다.
    await expect(client.shelf.restore('HEAD')).rejects.toThrow(/올바른 보관함 항목이 아니에요/)
    await expect(client.shelf.drop('stash@{x}')).rejects.toThrow(/올바른 보관함 항목이 아니에요/)
  })

  it('switch — 충돌 정리 중에는 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('elsewhere', null)
    // 꺼내기 겹침으로 충돌(unmerged index) 상태를 만든다
    await writeFixtureFile(repo, 'README.md', '# shelved\n')
    await client.shelf.save('겹침 준비')
    await writeFixtureFile(repo, 'README.md', '# moved on\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'move on'], { cwd: repo })
    const shelf = await client.shelf.list()
    await expect(client.shelf.restore(shelf[0]!.ref)).rejects.toThrow(/겹치는 부분/)

    await expect(client.branches.switch('elsewhere')).rejects.toThrow(/충돌 정리/)
  })

  it('merge — 빨리 감기(fast-forward)와 병합 커밋을 구분해 알려준다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    // ff: main이 뒤처진 상태에서 exp를 합친다
    await client.branches.create('exp', null)
    await client.branches.switch('exp')
    await writeFixtureFile(repo, 'exp.txt', 'e\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'exp work'], { cwd: repo })
    await client.branches.switch('main')
    const ff = await client.branches.merge('exp')
    expect(ff).toEqual({ outcome: 'fast-forward', autoShelved: false })

    // merged: 서로 다른 파일을 바꾼 두 갈래
    await client.branches.create('exp2', null)
    await client.branches.switch('exp2')
    await writeFixtureFile(repo, 'exp2.txt', 'e2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'exp2 work'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'main.txt', 'm\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'main work'], { cwd: repo })
    const merged = await client.branches.merge('exp2')
    expect(merged).toEqual({ outcome: 'merged', autoShelved: false })
    const head = (await client.history.list(1))[0]!
    expect(head.parents).toHaveLength(2)
  })

  it('merge — 이미 반영된 공간은 up-to-date를 알려준다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('same', null)
    const result = await client.branches.merge('same')
    expect(result).toEqual({ outcome: 'up-to-date', autoShelved: false })
  })

  it('merge — 같은 줄을 바꾼 두 갈래는 conflict 상태로 남는다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival change'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'my change'], { cwd: repo })

    const result = await client.branches.merge('rival')
    expect(result).toEqual({ outcome: 'conflict', autoShelved: false })
    const status = await client.repo.status()
    expect(status.state).toBe('merging')
    expect(status.changes.find((c) => c.path === 'README.md')?.unstaged).toBe('conflicted')
  })

  it('merge — 막힌 변경은 보관함에 자동 저장하고 진행한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    // exp가 README를 바꿨고, main 워크트리에도 커밋 안 된 README 변경이 있다(덮어쓰기 차단 조건)
    await client.branches.create('exp', null)
    await client.branches.switch('exp')
    await writeFixtureFile(repo, 'README.md', '# from exp\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'exp readme'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# uncommitted\n')

    const result = await client.branches.merge('exp')
    expect(result).toEqual({ outcome: 'fast-forward', autoShelved: true })
    const shelf = await client.shelf.list()
    expect(shelf).toHaveLength(1)
    expect(shelf[0]!.message).toContain('실험 공간 합치기 자동 보관')
    const status = await client.repo.status()
    expect(status.changes).toEqual([])
  })

  it('merge — 없는 실험 공간은 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.branches.merge('no-such')).rejects.toThrow(/실험 공간이 없어요/)
  })

  it('merge.abort — 충돌 상태를 버리고 합치기 전으로 돌아간다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')

    await client.merge.abort()
    const status = await client.repo.status()
    expect(status.state).toBe('normal')
    expect(status.changes).toEqual([])
  })

  it('merge.abort — 합치는 중이 아니면 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.merge.abort()).rejects.toThrow(/합치는 중이 아니에요/)
  })

  it('conflicts — ours/theirs 확정과 직접 수정 표시가 해소(staged)로 이어진다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await writeFixtureFile(repo, 'second.md', 'r\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await writeFixtureFile(repo, 'second.md', 'm\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')

    await client.conflicts.resolve('README.md', 'theirs')
    let status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'README.md')?.unstaged).not.toBe('conflicted')
    expect(await client.files.readText('README.md')).toBe('# rival\n')

    // 직접 수정 후 해결 표시
    await writeFixtureFile(repo, 'second.md', 'hand-fixed\n')
    await client.conflicts.markResolved('second.md')
    status = await client.repo.status()
    expect(status.changes.some((c) => c.unstaged === 'conflicted')).toBe(false)

    // 저장하기(commit)가 병합을 마무리한다
    await client.commits.create('합치기 마무리')
    const head = (await client.history.list(1))[0]!
    expect(head.parents).toHaveLength(2)
  })

  it('restoreFile — 깨끗한 파일에 그 시점 내용을 적용한다 (적용 결과는 staged로 보인다)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# v2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v2'], { cwd: repo })
    const initHash = (
      await execGitOrThrow(['rev-list', '--max-parents=0', 'HEAD'], { cwd: repo })
    ).stdout.trim()

    const result = await client.commits.restoreFile(initHash, 'README.md')
    expect(result).toEqual({ autoShelved: false })
    // 디스크 실측 — 그 시점(init) 내용으로 바뀌었다
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('# fixture\n')
    // checkout은 index도 함께 갱신한다(실측) — 적용 결과가 staged로 보인다
    const status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'README.md')?.staged).toBe('modified')
    expect(await client.shelf.list()).toEqual([])
  })

  it('restoreFile — 미저장(unstaged) 변경이 있으면 보관함에 자동 보관 후 적용한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# v2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v2'], { cwd: repo })
    const initHash = (
      await execGitOrThrow(['rev-list', '--max-parents=0', 'HEAD'], { cwd: repo })
    ).stdout.trim()
    await writeFixtureFile(repo, 'README.md', '# 작업 중\n')

    const result = await client.commits.restoreFile(initHash, 'README.md')
    expect(result).toEqual({ autoShelved: true })
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('# fixture\n')
    const shelf = await client.shelf.list()
    expect(shelf).toHaveLength(1)
    expect(shelf[0]!.message).toContain('파일 적용 자동 보관')
    // 사라질 뻔한 내용이 보관 항목에 실제로 담겨 있다 (커밋 상세 재사용으로 검증)
    const detail = await client.commits.show(shelf[0]!.hash)
    expect(detail.files.map((f) => f.path)).toContain('README.md')
  })

  it('restoreFile — staged-only 변경도 파일 단위 자동 보관에 담긴다 (실측 근거 고정)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# v2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v2'], { cwd: repo })
    const initHash = (
      await execGitOrThrow(['rev-list', '--max-parents=0', 'HEAD'], { cwd: repo })
    ).stdout.trim()
    // staged-only 상태(1 M.) — 워크트리·index 모두 새 내용, 커밋만 안 됨
    await writeFixtureFile(repo, 'README.md', '# staged 작업\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })

    const result = await client.commits.restoreFile(initHash, 'README.md')
    expect(result).toEqual({ autoShelved: true })
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('# fixture\n')
    // 파일 단위 stash push가 staged 내용을 담았다(실측: 사전 프로브와 동일)
    const shown = await execGitOrThrow(['stash', 'show', '-p', 'stash@{0}'], { cwd: repo })
    expect(shown.stdout).toContain('+# staged 작업')
  })

  it('restoreFile — 그 시점에 없는 파일은 친절 에러, dirty 변경이 보관함으로 사라지지 않는다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    const initHash = (
      await execGitOrThrow(['rev-list', '--max-parents=0', 'HEAD'], { cwd: repo })
    ).stdout.trim()
    await writeFixtureFile(repo, 'new.txt', 'work\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'add new'], { cwd: repo })
    await writeFixtureFile(repo, 'new.txt', 'dirty\n')

    await expect(client.commits.restoreFile(initHash, 'new.txt')).rejects.toThrow(
      /그 시점에는 이 파일이 없어요/,
    )
    // 사전 검사 순서 보장 — 실패했는데 변경만 보관함으로 사라지면 안 된다
    expect(await client.shelf.list()).toEqual([])
    expect(await readFile(join(repo, 'new.txt'), 'utf8')).toBe('dirty\n')
  })

  it('restoreFile — 사라진 커밋·잘못된 해시·저장소 밖 경로를 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(
      client.commits.restoreFile('0123456789012345678901234567890123456789', 'README.md'),
    ).rejects.toThrow(/그 저장 시점을 찾을 수 없어요/)
    // 패턴 필수 — 가드가 없으면 'HEAD~' 같은 ref 표현식이 checkout 인자로 흘러간다
    await expect(client.commits.restoreFile('HEAD', 'README.md')).rejects.toThrow(
      /올바른 커밋 해시가 아니에요/,
    )
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await expect(client.commits.restoreFile(head, '../outside.txt')).rejects.toThrow(
      /저장소 밖 경로/,
    )
  })

  it('restoreFile — 충돌 중인 파일은 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()

    // checkout이 index를 덮어 충돌이 "해소된 것처럼" 위장되는 것을 막는다 (discard 가드와 동일 계열)
    await expect(client.commits.restoreFile(head, 'README.md')).rejects.toThrow(/충돌 화면에서/)
  })

  it('restoreFile — 보관함 항목 해시로 그 파일만 꺼내 적용한다 (항목은 보관함에 남는다)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# shelved\n')
    await client.shelf.save('부분 꺼내기 대상')
    const shelf = await client.shelf.list()

    const result = await client.commits.restoreFile(shelf[0]!.hash, 'README.md')
    expect(result).toEqual({ autoShelved: false })
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('# shelved\n')
    // pop이 아니라 파일 단위 적용 — 항목은 그대로 남는다
    expect(await client.shelf.list()).toHaveLength(1)
  })

  it('restoreFile — 합치는 중(merging)에는 읽히는 메시지로 거부한다 (변경·보관함 무손상)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')

    await writeFixtureFile(repo, 'other.txt', 'precious\n')
    const head = (await client.history.list(1))[0]!
    await expect(client.commits.restoreFile(head.hash, 'other.txt')).rejects.toThrow(
      /먼저 마무리하거나 취소/,
    )
    // 변경은 그대로, 보관함도 생기지 않았다 — stash 선실행 유실 경로 차단 확인
    expect(await client.files.readText('other.txt')).toBe('precious\n')
    expect(await client.shelf.list()).toHaveLength(0)
  })

  it('diffAgainstWorktree — 그 시점과 지금 코드(미저장 포함)의 차이를 반환한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    const initHash = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    // 커밋하지 않은 워크트리 편집 그대로 비교된다 — "커밋 안 된 로컬이랑 비교" (피드백 6)
    await writeFixtureFile(repo, 'README.md', '# 지금 작업\n')

    const diff = await client.commits.diffAgainstWorktree(initHash, 'README.md', null)
    const lines = diff.hunks.flatMap((hunk) => hunk.lines)
    expect(lines).toContainEqual({ kind: 'del', oldLine: 1, newLine: null, text: '# fixture' })
    expect(lines).toContainEqual({ kind: 'add', oldLine: null, newLine: 1, text: '# 지금 작업' })
  })

  it('diffAgainstWorktree — 그 시점에 없던(이후 추가된) 파일은 새 파일로 보인다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    const initHash = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await writeFixtureFile(repo, 'new.txt', 'hello\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'add new'], { cwd: repo })

    const diff = await client.commits.diffAgainstWorktree(initHash, 'new.txt', null)
    expect(diff.hunks.flatMap((h) => h.lines).some((l) => l.kind === 'add' && l.text === 'hello')).toBe(
      true,
    )
  })

  it('diffAgainstWorktree — 사라진 커밋·잘못된 해시·저장소 밖 경로를 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(
      client.commits.diffAgainstWorktree(
        '0123456789012345678901234567890123456789',
        'README.md',
        null,
      ),
    ).rejects.toThrow(/그 저장 시점을 찾을 수 없어요/)
    await expect(client.commits.diffAgainstWorktree('HEAD', 'README.md', null)).rejects.toThrow(
      /올바른 커밋 해시가 아니에요/,
    )
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await expect(client.commits.diffAgainstWorktree(head, '../x', null)).rejects.toThrow(
      /저장소 밖 경로/,
    )
  })

  it('removeFile — tracked 파일을 디스크에서 지우고 삭제 변경으로 잡힌다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.changes.removeFile('README.md')
    expect(existsSync(join(repo, 'README.md'))).toBe(false)
    const status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'README.md')?.unstaged).toBe('deleted')
  })

  it('removeFile — untracked 파일은 지우면 목록에서 사라진다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'junk.txt', 'j\n')
    await client.changes.removeFile('junk.txt')
    expect(existsSync(join(repo, 'junk.txt'))).toBe(false)
    expect((await client.repo.status()).changes).toEqual([])
  })

  it('removeFile — 없는 파일·디렉터리·심볼릭 링크·밖 경로를 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.changes.removeFile('ghost.txt')).rejects.toThrow(/이미 없는 파일이에요/)
    await mkdir(join(repo, 'sub'))
    await expect(client.changes.removeFile('sub')).rejects.toThrow(/폴더는/)
    // 저장소 밖을 가리키는(끊어진 것 포함) 링크 — readText와 동일 계열로 거부한다
    await symlink(join(tmpdir(), 'no-such-target'), join(repo, 'link'))
    await expect(client.changes.removeFile('link')).rejects.toThrow(/링크 파일/)
    await expect(client.changes.removeFile('../outside')).rejects.toThrow(/저장소 밖 경로/)
    await expect(client.changes.removeFile('')).rejects.toThrow(/저장소 밖 경로/)
  })

  it('removeFile — 충돌 중인 파일은 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')

    await expect(client.changes.removeFile('README.md')).rejects.toThrow(/충돌 화면에서/)
  })

  it('discard — 충돌 중인 파일은 읽히는 메시지로 거부한다 (이관)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')

    await expect(client.changes.discard(['README.md'], [])).rejects.toThrow(/충돌 화면에서/)
  })

  it('files.readText — 저장소 상대 텍스트만, 상한 초과·바이너리·밖 경로 거부', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    expect(await client.files.readText('README.md')).toBe('# fixture\n')
    await writeFixtureFile(repo, 'big.txt', 'x'.repeat(1_000_001))
    await expect(client.files.readText('big.txt')).rejects.toThrow(/너무 커요/)
    await writeFixtureFile(repo, 'bin.dat', 'a\0b')
    await expect(client.files.readText('bin.dat')).rejects.toThrow(/텍스트가 아닌/)
    await expect(client.files.readText('../outside.txt')).rejects.toThrow()
    await expect(client.files.readText('/etc/hosts')).rejects.toThrow()
  })

  it('conflicts.resolve — 충돌이 아닌 파일은 거부한다 (미저장 편집 덮어쓰기 차단)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# precious edit\n')
    await expect(client.conflicts.resolve('README.md', 'ours')).rejects.toThrow(/충돌\) 상태가 아닌/)
    // 미저장 편집이 살아 있어야 한다
    expect(await client.files.readText('README.md')).toBe('# precious edit\n')
  })

  it('conflicts.saveText — 겹침 파일에 add 없이 내용을 쓴다 (블록 선택 반영)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')

    await client.conflicts.saveText('README.md', '# mine\n')
    expect(await client.files.readText('README.md')).toBe('# mine\n')
    // add하지 않았다 — 여전히 충돌(unmerged)이어야 확정 전 전환 유지·복원이 성립한다
    const status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'README.md')?.unstaged).toBe('conflicted')
  })

  it('conflicts.saveText — 충돌이 아닌 파일은 거부한다 (조용한 유실 차단)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# precious edit\n')
    await expect(client.conflicts.saveText('README.md', '덮어쓰기')).rejects.toThrow(
      /충돌\) 상태가 아닌/,
    )
    expect(await client.files.readText('README.md')).toBe('# precious edit\n')
  })

  it('conflicts.saveText — 1MB 초과와 심볼릭 링크를 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')

    await expect(
      client.conflicts.saveText('README.md', 'x'.repeat(1_000_001)),
    ).rejects.toThrow(/너무 커요/)
    // 워크트리 파일을 링크로 바꿔치기해도(index는 여전히 UU) 링크 너머로 쓰지 않는다
    await unlink(join(repo, 'README.md'))
    await symlink('/etc/hosts', join(repo, 'README.md'))
    await expect(client.conflicts.saveText('README.md', '덮어쓰기')).rejects.toThrow(/링크 파일/)
  })

  it('conflicts.reset — 부분 해소를 버리고 겹침 표시를 되살린다 (index는 UU 유지)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')
    // 블록 선택을 흉내 — 마커 없이 한쪽으로 고쳐 쓴다 (add는 하지 않는다)
    await client.conflicts.saveText('README.md', '# mine\n')
    expect(await client.files.readText('README.md')).not.toContain('<<<<<<<')

    await client.conflicts.reset('README.md')
    // 실측: 라벨은 ours/theirs로 재생성된다 — 접두사(<<<<<<<) 기준으로 확인한다
    expect(await client.files.readText('README.md')).toContain('<<<<<<<')
    const status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'README.md')?.unstaged).toBe('conflicted')
  })

  it('conflicts.reset — 충돌이 아닌 파일은 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# precious edit\n')
    await expect(client.conflicts.reset('README.md')).rejects.toThrow(/충돌\) 상태가 아닌/)
    expect(await client.files.readText('README.md')).toBe('# precious edit\n')
  })

  it('files.readText — 저장소 밖을 가리키는 심볼릭 링크를 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await symlink('/etc/hosts', join(repo, 'link-out'))
    await expect(client.files.readText('link-out')).rejects.toThrow(/링크 파일/)
  })

  it('conflicts — 전량 ours 해소(변경 0)여도 commit이 병합을 마무리한다 (부모 2개)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')

    await client.conflicts.resolve('README.md', 'ours')
    // index == HEAD — porcelain 변경 0이지만, 병합 커밋 자체가 의미 있는 저장이다
    const status = await client.repo.status()
    expect(status.state).toBe('merging')
    expect(status.changes).toEqual([])
    await client.commits.create('합치기 마무리 — 내 것 유지')
    const head = (await client.history.list(1))[0]!
    expect(head.parents).toHaveLength(2)
    expect((await client.repo.status()).state).toBe('normal')
  })

  it('commit — 겹침이 남아 있으면 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')

    await expect(client.commits.create('아직 안 끝났는데')).rejects.toThrow(/정리해야 저장/)
  })

  it('switch — 합치는 중(merging)에도 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')

    await expect(client.branches.switch('rival')).rejects.toThrow(/충돌 정리/)
    await expect(client.shelf.save('합치는 중 보관')).rejects.toThrow(/정리해야 보관/)
  })

  it('shelf — 꺼내기가 겹치면 충돌 표시로 남기고 항목을 보관함에 보존한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# shelved\n')
    await client.shelf.save('겹침 테스트')
    await writeFixtureFile(repo, 'README.md', '# moved on\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'move on'], { cwd: repo })

    const shelf = await client.shelf.list()
    await expect(client.shelf.restore(shelf[0]!.ref)).rejects.toThrow(/겹치는 부분/)
    // 항목은 남아 있다 — 데이터 유실 없음
    expect(await client.shelf.list()).toHaveLength(1)
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

  it('push — 원격이 앞서 있으면 받아오기 안내로 거부한다 (실측 ①: fetch first)', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    // 다른 클론이 원격에 새 저장을 올린다 — 로컬은 fetch 없이 뒤처진 상태
    const other = await mkdtemp(join(tmpdir(), 'git-gui-other-'))
    await execGitOrThrow(['clone', remote, other], { cwd: tmpdir() })
    await writeFixtureFile(other, 'b.txt', 'o\n')
    await execGitOrThrow(['add', '-A'], { cwd: other })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'other work'], { cwd: other })
    await execGitOrThrow(['push'], { cwd: other })
    await writeFixtureFile(repo, 'c.txt', 'l\n')
    await client.changes.stage(['c.txt'])
    await client.commits.create('로컬 저장')
    await expect(client.sync.push()).rejects.toThrow(
      '원격에 새 저장이 있어요. 먼저 받아오기(pull)로 합친 뒤 백업해 주세요.',
    )
  })

  it('push — 실행취소(undo)로 로컬이 뒤로 가도 같은 안내로 거부한다 (실측 ③: non-fast-forward)', async () => {
    const { repo } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'b.txt', '1\n')
    await client.changes.stage(['b.txt'])
    await client.commits.create('둘째')
    await client.sync.push()
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await client.commits.undoLast(head)
    await expect(client.sync.push()).rejects.toThrow(
      '원격에 새 저장이 있어요. 먼저 받아오기(pull)로 합친 뒤 백업해 주세요.',
    )
  })

  it('push — 첫 연결(-u) 경로에서도 원격이 앞서면 같은 안내로 거부한다 (실측 ④)', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    // upstream을 만들기 전에 다른 클론이 원격을 먼저 채운다 — 로컬과 갈라진 역사
    const other = await mkdtemp(join(tmpdir(), 'git-gui-other-'))
    await execGitOrThrow(['clone', remote, other], { cwd: tmpdir() })
    await writeFixtureFile(other, 'b.txt', 'o\n')
    await execGitOrThrow(['add', '-A'], { cwd: other })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'other first'], { cwd: other })
    await execGitOrThrow(['push', '-u', 'origin', 'main'], { cwd: other })
    await expect(client.sync.push()).rejects.toThrow(
      '원격에 새 저장이 있어요. 먼저 받아오기(pull)로 합친 뒤 백업해 주세요.',
    )
  })

  it('pull — 원격의 새 저장을 받아온다(ff)와 이미 최신을 구분한다', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    expect(await client.sync.pull()).toEqual({ outcome: 'up-to-date', autoShelved: false })

    // 다른 클론이 원격에 새 저장을 올린다
    const other = await mkdtemp(join(tmpdir(), 'git-gui-other-'))
    await execGitOrThrow(['clone', remote, other], { cwd: tmpdir() })
    await writeFixtureFile(other, 'from-other.txt', 'o\n')
    await execGitOrThrow(['add', '-A'], { cwd: other })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'other work'], { cwd: other })
    await execGitOrThrow(['push'], { cwd: other })

    expect(await client.sync.pull()).toEqual({ outcome: 'fast-forward', autoShelved: false })
    const history = await client.history.list(10)
    expect(history[0]!.subject).toBe('other work')
  })

  it('pull — 서로 갈라진 같은 줄 변경은 conflict 상태(merging)로 남는다', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    const other = await mkdtemp(join(tmpdir(), 'git-gui-other-'))
    await execGitOrThrow(['clone', remote, other], { cwd: tmpdir() })
    await writeFixtureFile(other, 'README.md', '# remote\n')
    await execGitOrThrow(['add', '-A'], { cwd: other })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'remote change'], { cwd: other })
    await execGitOrThrow(['push'], { cwd: other })
    await writeFixtureFile(repo, 'README.md', '# local\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'local change'], { cwd: repo })

    expect(await client.sync.pull()).toEqual({ outcome: 'conflict', autoShelved: false })
    const status = await client.repo.status()
    expect(status.state).toBe('merging')
    expect(status.changes.find((c) => c.path === 'README.md')?.unstaged).toBe('conflicted')
  })

  it('pull — 막힌 변경은 보관함에 자동 저장하고 받아온다', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    const other = await mkdtemp(join(tmpdir(), 'git-gui-other-'))
    await execGitOrThrow(['clone', remote, other], { cwd: tmpdir() })
    await writeFixtureFile(other, 'README.md', '# remote\n')
    await execGitOrThrow(['add', '-A'], { cwd: other })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'remote change'], { cwd: other })
    await execGitOrThrow(['push'], { cwd: other })
    await writeFixtureFile(repo, 'README.md', '# uncommitted\n')

    const result = await client.sync.pull()
    expect(result).toEqual({ outcome: 'fast-forward', autoShelved: true })
    const shelf = await client.shelf.list()
    expect(shelf[0]!.message).toContain('받아오기 자동 보관')
  })

  it('pull — 원격/upstream이 없으면 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.sync.pull()).rejects.toThrow(/원격 저장소가 없어요/)

    const withRemote = await createFixtureRepoWithRemote()
    const client2 = createGitClient(withRemote.repo)
    // push(업스트림 연결) 없이 pull — tracking 정보 없음
    await expect(client2.sync.pull()).rejects.toThrow(/백업.*연결/)
  })

  it('revert — 저장을 반대로 적용하는 새 저장을 만들고, merge commit은 첫 부모 기준으로 되돌린다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# changed\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'change'], { cwd: repo })
    const head = (await client.history.list(1))[0]!
    expect(await client.commits.revert(head.hash)).toEqual({ outcome: 'reverted', autoShelved: false })
    expect(await client.files.readText('README.md')).toBe('# fixture\n')
    expect((await client.history.list(1))[0]!.subject).toContain('Revert')

    // merge commit — -m 1 재시도로 성공해야 한다
    await client.branches.create('side', null)
    await client.branches.switch('side')
    await writeFixtureFile(repo, 'side.txt', 's\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'side'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'main.txt', 'm\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'main'], { cwd: repo })
    await client.branches.merge('side')
    const mergeHead = (await client.history.list(1))[0]!
    expect(mergeHead.parents).toHaveLength(2)
    expect(await client.commits.revert(mergeHead.hash)).toEqual({ outcome: 'reverted', autoShelved: false })
    const status = await client.repo.status()
    expect(status.changes).toEqual([])
  })

  it('revert — 이후 저장과 겹치면 conflict 상태(reverting)로 남고, 취소로 돌아온다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# v2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v2'], { cwd: repo })
    const target = (await client.history.list(1))[0]!
    await writeFixtureFile(repo, 'README.md', '# v3\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v3'], { cwd: repo })

    expect(await client.commits.revert(target.hash)).toEqual({ outcome: 'conflict', autoShelved: false })
    let status = await client.repo.status()
    expect(status.state).toBe('reverting')
    expect(status.changes.some((c) => c.unstaged === 'conflicted')).toBe(true)

    await client.commits.revertAbort()
    status = await client.repo.status()
    expect(status.state).toBe('normal')
    expect(status.changes).toEqual([])
  })

  it('revert — 합치는 중(merging)에는 읽히는 메시지로 거부한다 (거짓 병합 완결 차단)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')

    const head = (await client.history.list(1))[0]!
    await expect(client.commits.revert(head.hash)).rejects.toThrow(/먼저 마무리하거나 취소/)
    // 병합 상태가 소비되지 않고 그대로 남아 있어야 한다
    expect((await client.repo.status()).state).toBe('merging')
  })

  it('revert — 되돌리는 중(reverting)에도 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', 'v2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v2'], { cwd: repo })
    await writeFixtureFile(repo, 'README.md', 'v3\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v3'], { cwd: repo })
    const middle = (await client.history.list(2))[1]!
    expect((await client.commits.revert(middle.hash)).outcome).toBe('conflict')
    const head = (await client.history.list(1))[0]!
    await expect(client.commits.revert(head.hash)).rejects.toThrow(/먼저 마무리하거나 취소/)
  })

  it('revert — 저장 안 된 변경이 겹치면 보관함에 넣고 되돌린다 (스마트 되돌리기)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', 'v2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v2'], { cwd: repo })
    await writeFixtureFile(repo, 'README.md', 'editing\n')

    const head = (await client.history.list(1))[0]!
    const result = await client.commits.revert(head.hash)
    expect(result).toEqual({ outcome: 'reverted', autoShelved: true })
    const shelf = await client.shelf.list()
    expect(shelf[0]?.message).toContain('저장 되돌리기 자동 보관')
    // 되돌린 결과가 워킹 트리에 반영됐다
    expect(await client.files.readText('README.md')).toBe('# fixture\n')
  })

  it('revert — 되돌려도 바뀌는 내용이 없으면 읽히는 메시지로 알린다 (비조상·이미 반영)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    // 같은 내용을 되돌린 뒤 또 되돌리면 변경이 없다 — "이미 반영"의 최소 재현
    await writeFixtureFile(repo, 'README.md', 'v2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v2'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'revert', '--no-edit', 'HEAD'], { cwd: repo })
    const middle = (await client.history.list(2))[1]!
    await expect(client.commits.revert(middle.hash)).rejects.toThrow(/바뀌는 내용이 없어요/)
    // 상태가 오염되지 않았다
    expect((await client.repo.status()).state).toBe('normal')
  })

  it('revertAbort — 되돌리는 중이 아니면 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.commits.revertAbort()).rejects.toThrow(/되돌리는 중이 아니에요/)
  })

  it('cherryPick — 다른 공간의 저장 하나를 가져와 새 저장을 만든다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('side', null)
    await client.branches.switch('side')
    await writeFixtureFile(repo, 'side.txt', 's\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'side work'], { cwd: repo })
    const target = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await client.branches.switch('main')

    expect(await client.commits.cherryPick(target)).toEqual({
      outcome: 'picked',
      autoShelved: false,
    })
    expect(existsSync(join(repo, 'side.txt'))).toBe(true)
    // 새 저장이 main 끝에 생겼다 — side 커밋과 다른 해시의 복제다
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    expect(head).not.toBe(target)
    expect(
      (await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: repo })).stdout.trim(),
    ).toBe('side work')
  })

  it('cherryPick — 겹치면 conflict 상태(cherry-picking)로 남고, 취소로 돌아온다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('side', null)
    await client.branches.switch('side')
    await writeFixtureFile(repo, 'README.md', '# side\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'side edit'], { cwd: repo })
    const target = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })

    expect(await client.commits.cherryPick(target)).toEqual({
      outcome: 'conflict',
      autoShelved: false,
    })
    let status = await client.repo.status()
    expect(status.state).toBe('cherry-picking')
    expect(status.changes.some((c) => c.unstaged === 'conflicted')).toBe(true)

    await client.commits.cherryPickAbort()
    status = await client.repo.status()
    expect(status.state).toBe('normal')
    expect(await client.files.readText('README.md')).toBe('# mine\n')
  })

  it('cherryPick — 이미 반영된 저장은 empty로 알리고 진행 흔적을 남기지 않는다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'a.txt', '1\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'work'], { cwd: repo })
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()

    // HEAD 자신을 가져오기 — 바뀔 것이 없다(실측 5-ⓓ: CHERRY_PICK_HEAD가 남는 exit 1 → 엔진이 정리)
    expect(await client.commits.cherryPick(head)).toEqual({ outcome: 'empty', autoShelved: false })
    expect((await client.repo.status()).state).toBe('normal')
    expect((await client.history.list(10)).map((c) => c.subject)).toEqual(['work', 'init'])
  })

  it('cherryPick — 병합 커밋은 읽히는 메시지로 거부한다 (-m 재시도 없음)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('side', null)
    await client.branches.switch('side')
    await writeFixtureFile(repo, 'side.txt', 's\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'side'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'main.txt', 'm\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'main work'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'merge', '--no-edit', 'side'], { cwd: repo })
    const mergeHash = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    const root = (
      await execGitOrThrow(['rev-list', '--max-parents=0', 'HEAD'], { cwd: repo })
    ).stdout.trim()
    await client.branches.create('from-root', root)
    await client.branches.switch('from-root')

    await expect(client.commits.cherryPick(mergeHash)).rejects.toThrow(/통째로 가져올 수 없어요/)
    // 진행 흔적 없음 — 상태는 정상 그대로다
    expect((await client.repo.status()).state).toBe('normal')
  })

  it('cherryPick — 저장 안 된 변경이 겹치면 보관함에 넣고 가져온다 (스마트 가져오기)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('side', null)
    await client.branches.switch('side')
    await writeFixtureFile(repo, 'README.md', '# side\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'side edit'], { cwd: repo })
    const target = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# dirty\n')

    expect(await client.commits.cherryPick(target)).toEqual({
      outcome: 'picked',
      autoShelved: true,
    })
    expect(await client.files.readText('README.md')).toBe('# side\n')
    const shelf = await client.shelf.list()
    expect(shelf).toHaveLength(1)
    expect(shelf[0]!.message).toContain('저장 가져오기 자동 보관')
  })

  it('cherryPick — 합치는 중(merging)에는 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    const target = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')

    await expect(client.commits.cherryPick(target)).rejects.toThrow(/먼저 마무리하거나 취소/)
  })

  it('cherryPick — 사라진 커밋·ref 표현식을 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(
      client.commits.cherryPick('0123456789012345678901234567890123456789'),
    ).rejects.toThrow(/그 저장 시점을 찾을 수 없어요/)
    await expect(client.commits.cherryPick('HEAD')).rejects.toThrow(/올바른 커밋 해시가 아니에요/)
  })

  it('cherryPickAbort — 가져오는 중이 아니면 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    await expect(createGitClient(repo).commits.cherryPickAbort()).rejects.toThrow(
      /지금은 가져오는 중이 아니에요/,
    )
  })

  it('createTag — 태그를 만들면 역사 refs 배지에 나타난다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()

    await client.commits.createTag('v1.0', head)
    // decorate가 "tag: v1.0"을 주고 기존 log-parser가 접두를 벗긴다 (실측 9)
    expect((await client.history.list(1))[0]!.refs).toContain('v1.0')
  })

  it('createTag — 잘못된 이름·중복 이름을 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await expect(client.commits.createTag('bad name', head)).rejects.toThrow(/이름으로는 만들 수 없어요/)
    await client.commits.createTag('v1.0', head)
    await expect(client.commits.createTag('v1.0', head)).rejects.toThrow(/이미 있는 태그예요/)
  })

  it('createTag — 사라진 커밋·ref 표현식을 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(
      client.commits.createTag('v9', '0123456789012345678901234567890123456789'),
    ).rejects.toThrow(/그 저장 시점을 찾을 수 없어요/)
    await expect(client.commits.createTag('v9', 'HEAD')).rejects.toThrow(/올바른 커밋 해시가 아니에요/)
  })

  it('undoLast — 마지막 저장만 취소하고 내용은 작업 폴더에 남는다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# v2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v2'], { cwd: repo })
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()

    await client.commits.undoLast(head)
    expect((await client.history.list(10)).map((c) => c.subject)).toEqual(['init'])
    // 내용은 그대로 — 미저장 변경으로 돌아온다 (reset --mixed 실측 8, 유실 없음)
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('# v2\n')
    const status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'README.md')?.unstaged).toBe('modified')
  })

  it('undoLast — 맨 처음 저장(루트)은 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await expect(client.commits.undoLast(head)).rejects.toThrow(/맨 처음 저장은 실행취소할 수 없어요/)
  })

  it('undoLast — 화면 목록이 낡았으면(HEAD 불일치) 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    const stale = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await writeFixtureFile(repo, 'README.md', '# v2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v2'], { cwd: repo })

    // CLI 경합으로 HEAD가 이미 바뀐 상황 — 엉뚱한 저장이 물리면 안 된다
    await expect(client.commits.undoLast(stale)).rejects.toThrow(/가장 최근 저장이 바뀌었어요/)
    expect((await client.history.list(10))).toHaveLength(2)
  })

  it('undoLast — 합치는 중(merging)에는 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()

    await expect(client.commits.undoLast(head)).rejects.toThrow(/먼저 마무리하거나 취소/)
  })

  it('reword — 메시지만 바꾸고 내용(tree)·미저장 변경은 그대로다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# 작업 중\n')
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    const beforeTree = (await execGitOrThrow(['rev-parse', 'HEAD^{tree}'], { cwd: repo })).stdout.trim()

    await client.commits.reword(head, '고친 제목')
    // 실측 7: staged 없는 amend -F -는 tree 불변 — 메시지만 바뀐다
    const afterTree = (await execGitOrThrow(['rev-parse', 'HEAD^{tree}'], { cwd: repo })).stdout.trim()
    expect(afterTree).toBe(beforeTree)
    expect(
      (await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: repo })).stdout.trim(),
    ).toBe('고친 제목')
    // 미저장 변경은 건드리지 않는다
    expect(await client.files.readText('README.md')).toBe('# 작업 중\n')
  })

  it('reword — 저장 예정(staged)이 있으면 흡수 함정을 막기 위해 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await writeFixtureFile(repo, 'README.md', '# staged\n')
    await client.changes.stage(['README.md'])

    await expect(client.commits.reword(head, '고친 제목')).rejects.toThrow(/저장 예정에 올린 파일이 있어요/)
    // 메시지도 staged도 그대로다
    expect(
      (await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: repo })).stdout.trim(),
    ).toBe('init')
    expect((await client.repo.status()).changes.find((c) => c.path === 'README.md')?.staged).toBe(
      'modified',
    )
  })

  it('reword — 화면 목록이 낡았으면(HEAD 불일치) 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    const stale = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await writeFixtureFile(repo, 'README.md', '# v2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v2'], { cwd: repo })

    await expect(client.commits.reword(stale, '고친 제목')).rejects.toThrow(/가장 최근 저장이 바뀌었어요/)
  })

  it('reword — 합치는 중(merging)에는 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()

    await expect(client.commits.reword(head, '고친 제목')).rejects.toThrow(/먼저 마무리하거나 취소/)
  })

  it('reword — 빈 커밋(변경 없는 저장)의 메시지도 고칠 수 있다 (원어 에러 없음)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '--allow-empty', '-m', '빈 저장'], { cwd: repo })
    const head = (await client.history.list(1))[0]!
    await client.commits.reword(head.hash, '고친 제목')
    expect((await client.history.list(1))[0]!.subject).toBe('고친 제목')
  })

  it('reverting 중에는 전환·받아오기도 읽히는 메시지로 거부한다', async () => {
    const { repo } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    await client.branches.create('elsewhere', null)
    await writeFixtureFile(repo, 'README.md', '# v2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v2'], { cwd: repo })
    const target = (await client.history.list(1))[0]!
    await writeFixtureFile(repo, 'README.md', '# v3\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v3'], { cwd: repo })
    await client.commits.revert(target.hash)

    await expect(client.branches.switch('elsewhere')).rejects.toThrow(/충돌 정리/)
    await expect(client.sync.pull()).rejects.toThrow(/정리해야 받아올/)
    await client.commits.revertAbort()
  })

  it('branches.remove — 합쳐진 공간은 지우고, 안 합쳐진 공간은 needsForce로 알리고, force로 지운다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('merged-one', null)
    expect(await client.branches.remove('merged-one', false)).toEqual({
      removed: true,
      needsForce: false,
    })

    await client.branches.create('doomed', null)
    await client.branches.switch('doomed')
    await writeFixtureFile(repo, 'd.txt', 'd\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'doomed work'], { cwd: repo })
    await client.branches.switch('main')
    expect(await client.branches.remove('doomed', false)).toEqual({
      removed: false,
      needsForce: true,
    })
    expect(await client.branches.remove('doomed', true)).toEqual({
      removed: true,
      needsForce: false,
    })
    expect((await client.branches.list()).map((b) => b.name)).toEqual(['main'])
  })

  it('branches.remove — 지금 있는 공간은 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.branches.remove('main', false)).rejects.toThrow(/다른 공간으로 이동/)
  })

  it('branches.rename — 이름을 바꾸고, 중복·잘못된 이름은 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('before', null)
    await client.branches.rename('before', 'after')
    expect((await client.branches.list()).map((b) => b.name).sort()).toEqual(['after', 'main'])
    await expect(client.branches.rename('after', 'main')).rejects.toThrow(/이미 있는 이름/)
    await expect(client.branches.rename('after', 'bad name')).rejects.toThrow(/만들 수 없어요/)
    await expect(client.branches.rename('no-such', 'x')).rejects.toThrow()
  })

  it('branches.overview — 로컬 ahead·연결 없음·원격을 한 번에 담고 현재를 표시한다 (E7a)', async () => {
    const { repo } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push() // main upstream 연결(동기화 0/0)
    await writeFixtureFile(repo, 'a.txt', 'a\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', '앞선 저장'], { cwd: repo })
    await client.branches.create('nolink', null)
    const overview = await client.branches.overview()
    const main = overview.locals.find((b) => b.name === 'main')
    expect(main).toMatchObject({ isCurrent: true, upstream: 'origin/main', ahead: 1, behind: 0 })
    expect(main!.hash).toMatch(/^[0-9a-f]{40}$/)
    const nolink = overview.locals.find((b) => b.name === 'nolink')
    expect(nolink).toMatchObject({ isCurrent: false, upstream: null, ahead: null, behind: null })
    expect(overview.remotes).toEqual([{ remote: 'origin', name: 'origin/main' }])
  })

  it('branches.update — 비현재 공간을 원격 최신으로 ff 업데이트한다 (실측 3)', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    await client.branches.create('old', null)
    await execGitOrThrow(['push', '-u', 'origin', 'old:old'], { cwd: repo })
    await execGitOrThrow(['config', 'branch.old.remote', 'origin'], { cwd: repo })
    await execGitOrThrow(['config', 'branch.old.merge', 'refs/heads/old'], { cwd: repo })
    // 다른 클론이 old를 앞세운다 — 로컬 old는 behind만 있는 상태
    const other = await mkdtemp(join(tmpdir(), 'git-gui-other-'))
    await execGitOrThrow(['clone', remote, other], { cwd: tmpdir() })
    await execGitOrThrow(['checkout', 'old'], { cwd: other })
    await writeFixtureFile(other, 'o.txt', 'o\n')
    await execGitOrThrow(['add', '-A'], { cwd: other })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'other old'], { cwd: other })
    await execGitOrThrow(['push'], { cwd: other })
    await client.branches.update('old')
    const localOld = (await execGitOrThrow(['rev-parse', 'old'], { cwd: repo })).stdout.trim()
    const remoteOld = (await execGitOrThrow(['rev-parse', 'origin/old'], { cwd: repo })).stdout.trim()
    expect(localOld).toBe(remoteOld)
  })

  it('branches.update — 갈라진 공간은 받아오기 안내로 거부한다 (non-fast-forward)', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    await client.branches.create('old', null)
    await execGitOrThrow(['push', '-u', 'origin', 'old:old'], { cwd: repo })
    await execGitOrThrow(['config', 'branch.old.remote', 'origin'], { cwd: repo })
    await execGitOrThrow(['config', 'branch.old.merge', 'refs/heads/old'], { cwd: repo })
    const other = await mkdtemp(join(tmpdir(), 'git-gui-other-'))
    await execGitOrThrow(['clone', remote, other], { cwd: tmpdir() })
    await execGitOrThrow(['checkout', 'old'], { cwd: other })
    await writeFixtureFile(other, 'o.txt', 'o\n')
    await execGitOrThrow(['add', '-A'], { cwd: other })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'other old'], { cwd: other })
    await execGitOrThrow(['push'], { cwd: other })
    // 로컬 old도 따로 전진 — 갈라짐(ahead+behind)
    await client.branches.switch('old')
    await writeFixtureFile(repo, 'l.txt', 'l\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'local old'], { cwd: repo })
    await client.branches.switch('main')
    await expect(client.branches.update('old')).rejects.toThrow(/갈라져 있어요/)
  })

  it('branches.update — upstream이 없으면 읽히는 메시지로 거부한다', async () => {
    const { repo } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.branches.create('nolink', null)
    await expect(client.branches.update('nolink')).rejects.toThrow(/연결된 적이 없는/)
  })

  it('branches.update — 체크아웃된 공간은 pull 안내로 거부한다 (실측 3)', async () => {
    const { repo } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    await expect(client.branches.update('main')).rejects.toThrow(/받아오기\(pull\)로 업데이트/)
  })

  it('branches.backup — 비현재 공간을 checkout 없이 push한다 (upstream 없으면 -u 연결)', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    await client.branches.create('side', null)
    // 첫 백업 — upstream 없음 → -u 연결 경로
    await client.branches.backup('side')
    const upstream = await execGitOrThrow(['config', '--get', 'branch.side.remote'], { cwd: repo })
    expect(upstream.stdout.trim()).toBe('origin')
    // 연결된 뒤 두 번째 백업 — refspec 경로. side를 전진시키고 원격 해시 일치를 확인
    await client.branches.switch('side')
    await writeFixtureFile(repo, 's.txt', 's\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'side work'], { cwd: repo })
    await client.branches.switch('main')
    await client.branches.backup('side')
    const localSide = (await execGitOrThrow(['rev-parse', 'side'], { cwd: repo })).stdout.trim()
    const remoteSide = (
      await execGitOrThrow(['rev-parse', 'side'], { cwd: remote })
    ).stdout.trim()
    expect(remoteSide).toBe(localSide)
    // 반쪽 연결(merge 없음)은 -u 경로로 수리한다 (품질 리뷰 보완)
    await client.branches.create('half', null)
    await execGitOrThrow(['config', 'branch.half.remote', 'origin'], { cwd: repo })
    await client.branches.backup('half')
    const halfMerge = await execGitOrThrow(['config', '--get', 'branch.half.merge'], { cwd: repo })
    expect(halfMerge.stdout.trim()).toBe('refs/heads/half')
  })

  it('branches.backup — 원격이 앞서 있으면 받아오기 안내로 거부한다 (E6b 매핑 공유)', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    await client.branches.create('side', null)
    await client.branches.backup('side')
    // 다른 클론이 side를 앞세운다 — 로컬 side의 push는 fetch first 거부
    const other = await mkdtemp(join(tmpdir(), 'git-gui-other-'))
    await execGitOrThrow(['clone', remote, other], { cwd: tmpdir() })
    await execGitOrThrow(['checkout', 'side'], { cwd: other })
    await writeFixtureFile(other, 'o.txt', 'o\n')
    await execGitOrThrow(['add', '-A'], { cwd: other })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'other side'], { cwd: other })
    await execGitOrThrow(['push'], { cwd: other })
    await client.branches.switch('side')
    await writeFixtureFile(repo, 'l.txt', 'l\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'local side'], { cwd: repo })
    await client.branches.switch('main')
    await expect(client.branches.backup('side')).rejects.toThrow(
      '원격에 새 저장이 있어요. 먼저 받아오기(pull)로 합친 뒤 백업해 주세요.',
    )
  })

  it('branches.checkoutRemote — 원격 공간을 추적 브랜치로 가져와 이동한다', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    const other = await mkdtemp(join(tmpdir(), 'git-gui-other-'))
    await execGitOrThrow(['clone', remote, other], { cwd: tmpdir() })
    await execGitOrThrow(['checkout', '-b', 'feature/pay'], { cwd: other })
    await writeFixtureFile(other, 'p.txt', 'p\n')
    await execGitOrThrow(['add', '-A'], { cwd: other })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'pay'], { cwd: other })
    await execGitOrThrow(['push', '-u', 'origin', 'feature/pay'], { cwd: other })
    await execGitOrThrow(['fetch', 'origin'], { cwd: repo })
    const result = await client.branches.checkoutRemote('origin/feature/pay')
    expect(result).toEqual({ autoShelved: false })
    const current = (
      await execGitOrThrow(['symbolic-ref', '--short', 'HEAD'], { cwd: repo })
    ).stdout.trim()
    expect(current).toBe('feature/pay')
    const upstream = await execGitOrThrow(['config', '--get', 'branch.feature/pay.remote'], {
      cwd: repo,
    })
    expect(upstream.stdout.trim()).toBe('origin')
  })

  it('branches.checkoutRemote — 동명 로컬이 있으면 읽히는 메시지로 거부한다 (실측 4)', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    await execGitOrThrow(['fetch', 'origin'], { cwd: repo })
    await expect(client.branches.checkoutRemote('origin/main')).rejects.toThrow(
      /이미 "main" 공간이 있어요/,
    )
  })

  it('branches.checkoutRemote — 겹치는 변경은 자동 보관 후 이동한다 (switch 관례)', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    const other = await mkdtemp(join(tmpdir(), 'git-gui-other-'))
    await execGitOrThrow(['clone', remote, other], { cwd: tmpdir() })
    await execGitOrThrow(['checkout', '-b', 'rival'], { cwd: other })
    await writeFixtureFile(other, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: other })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: other })
    await execGitOrThrow(['push', '-u', 'origin', 'rival'], { cwd: other })
    await execGitOrThrow(['fetch', 'origin'], { cwd: repo })
    // 같은 파일을 로컬에서 수정해 둔다 — 그대로 이동하면 would be overwritten
    await writeFixtureFile(repo, 'README.md', '# local edit\n')
    const result = await client.branches.checkoutRemote('origin/rival')
    expect(result).toEqual({ autoShelved: true })
    expect((await client.shelf.list()).length).toBe(1)
  })

  it('branches.removeRemote — 원격에서 지운다 (bare 저장소에서 소멸 확인)', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    await client.branches.create('doomed', null)
    await client.branches.backup('doomed')
    expect(
      (await execGitOrThrow(['branch', '--list', 'doomed'], { cwd: remote })).stdout,
    ).toContain('doomed')
    await client.branches.removeRemote('origin/doomed')
    expect(
      (await execGitOrThrow(['branch', '--list', 'doomed'], { cwd: remote })).stdout.trim(),
    ).toBe('')
  })

  it('branches.removeRemote — 원격에 이미 없으면 읽히는 메시지로 거부한다', async () => {
    const { repo } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    await expect(client.branches.removeRemote('origin/no-such')).rejects.toThrow(/이미 없어요/)
  })

  it('branches.compare — 양방향 전용 저장을 나눠 담는다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await writeFixtureFile(repo, 'mine.txt', 'm\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', '내 전용 저장'], { cwd: repo })
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'rival.txt', 'r\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', '상대 전용 저장'], { cwd: repo })
    await client.branches.switch('main')
    const compare = await client.branches.compare('rival')
    expect(compare.onlyInSelected.map((c) => c.subject)).toEqual(['상대 전용 저장'])
    expect(compare.onlyInCurrent.map((c) => c.subject)).toEqual(['내 전용 저장'])
    expect(compare.selectedOverflow).toBe(false)
    expect(compare.currentOverflow).toBe(false)
  })

  it('branches.compare — 100개 상한을 넘으면 overflow로 알린다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('base-mark', null)
    for (let i = 0; i < 101; i += 1) {
      await execGitOrThrow(
        [...FIXTURE_IDENT, 'commit', '--allow-empty', '-m', `bulk ${i}`],
        { cwd: repo },
      )
    }
    const compare = await client.branches.compare('base-mark')
    expect(compare.onlyInCurrent.length).toBe(100)
    expect(compare.currentOverflow).toBe(true)
    expect(compare.onlyInSelected).toEqual([])
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

  it('sync.branchStatus — 현재 브랜치와 upstream 유무를 알려준다', async () => {
    const { repo } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    expect(await client.sync.branchStatus()).toEqual({ branch: 'main', hasUpstream: false, upstream: null })
    // 첫 백업(push -u) 뒤에는 upstream이 생긴다 — 로컬 bare remote로 실왕복
    await client.sync.push()
    expect(await client.sync.branchStatus()).toEqual({ branch: 'main', hasUpstream: true, upstream: 'origin/main' })
  })

  it('sync.branchStatus — detached HEAD면 branch null이다', async () => {
    const repo = await createFixtureRepo()
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await execGitOrThrow(['checkout', '--detach', head], { cwd: repo })
    expect(await createGitClient(repo).sync.branchStatus()).toEqual({
      branch: null,
      hasUpstream: false,
      upstream: null,
    })
  })

  it('branchStatus — 이름 바꾼 브랜치는 옛 upstream 이름이 그대로 남는다 (잔존 감지용)', async () => {
    const { repo } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.branches.create('feature', null)
    await client.branches.switch('feature')
    await client.sync.push()
    await client.branches.rename('feature', 'feature-2')
    // git branch -m은 merge ref(옛 이름)를 유지한다 — upstream이 여전히 옛 이름으로 해석된다 (통합 리뷰 실측)
    expect(await client.sync.branchStatus()).toEqual({
      branch: 'feature-2',
      hasUpstream: true,
      upstream: 'origin/feature',
    })
  })

  it('push — 이름 바꾼 브랜치는 옛 upstream을 무시하고 새 이름으로 다시 연결하며 올린다', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.branches.create('feature', null)
    await client.branches.switch('feature')
    await client.sync.push()
    await client.branches.rename('feature', 'feature-2')

    await client.sync.push()
    const upstream = await execGitOrThrow(
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
      { cwd: repo },
    )
    expect(upstream.stdout.trim()).toBe('origin/feature-2')
    const remoteBranches = await execGitOrThrow(['branch', '--format=%(refname:short)'], {
      cwd: remote,
    })
    expect(remoteBranches.stdout).toContain('feature-2')
  })

  it('sync.remoteUrl — 백업 대상 remote(origin 우선)의 URL을 돌려준다', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    expect(await createGitClient(repo).sync.remoteUrl()).toBe(remote)
  })

  it('sync.remoteUrl — remote가 없으면 null이다', async () => {
    const repo = await createFixtureRepo()
    expect(await createGitClient(repo).sync.remoteUrl()).toBeNull()
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
