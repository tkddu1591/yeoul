import { realpath } from 'node:fs/promises'
import { execGitOrThrow } from '@git-gui/git-process'

interface RepositoryIdentity {
  get(repoPath: string): Promise<string>
}

const gitCommonDirectory: RepositoryIdentity = {
  async get(repoPath) {
    const raw = (
      await execGitOrThrow(['rev-parse', '--path-format=absolute', '--git-common-dir'], {
        cwd: repoPath,
      })
    ).stdout.trim()
    return realpath(raw)
  },
}

/**
 * 같은 저장소의 ref/index를 바꾸는 작업을 main 프로세스에서 직렬화한다.
 * linked worktree도 공용 git directory를 키로 쓰므로 서로 다른 창·탭에서 시작한 쓰기가 겹치지 않는다.
 */
export class RepositoryMutationQueue {
  private readonly tails = new Map<string, Promise<void>>()

  constructor(private readonly identity: RepositoryIdentity = gitCommonDirectory) {}

  async run<T>(repoPath: string, mutation: () => Promise<T>): Promise<T> {
    const key = await this.identity.get(repoPath)
    const previous = this.tails.get(key) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.catch(() => undefined).then(() => gate)
    this.tails.set(key, tail)

    await previous.catch(() => undefined)
    try {
      return await mutation()
    } finally {
      release()
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }
}
