import { describe, expect, it, vi } from 'vitest'
import { RepositoryMutationQueue } from '../src/main/repository-mutation-queue'

describe('RepositoryMutationQueue', () => {
  it('같은 공용 저장소의 작업은 시작 순서대로 직렬화한다', async () => {
    const queue = new RepositoryMutationQueue({ get: async () => '/repo/.git' })
    const events: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = queue.run('/repo', async () => {
      events.push('first:start')
      await firstGate
      events.push('first:end')
    })
    const second = queue.run('/repo-worktree', async () => {
      events.push('second:start')
      events.push('second:end')
    })

    await vi.waitFor(() => expect(events).toEqual(['first:start']))
    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
  })

  it('서로 다른 저장소 작업은 병렬로 시작한다', async () => {
    const queue = new RepositoryMutationQueue({ get: async (path) => `${path}/.git` })
    const events: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = queue.run('/a', async () => {
      events.push('a')
      await gate
    })
    const second = queue.run('/b', async () => {
      events.push('b')
    })

    await second
    expect(events).toEqual(['a', 'b'])
    release()
    await first
  })
})
