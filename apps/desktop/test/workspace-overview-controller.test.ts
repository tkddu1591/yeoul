import { describe, it, expect, vi } from 'vitest'
import type { WorkspaceInfo, WorkspaceOverview } from '@git-gui/ipc-contract'
import { workspaceOverviewController } from '../src/renderer/src/store/workspace-overview-controller'
const workspace: WorkspaceInfo = { path: '/work', name: 'work', repositories: [] }
const first: WorkspaceOverview = { workspace, repositories: [] }
function deferred<T>() {
  let complete!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    complete = resolve
  })
  return { promise, complete }
}
describe('workspaceOverviewController', () => {
  it('외부 이벤트 폭주를 하나의 후속 조회로 모으고 완료된 결과는 표시한다', async () => {
    const pending = deferred<WorkspaceOverview>()
    const read = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(first)
    const publish = vi.fn()
    const query = workspaceOverviewController.instance.create(publish, read)
    const opening = query.refresh(workspace)
    await Promise.resolve()
    for (let index = 0; index < 30; index++) void query.reload()
    expect(read).toHaveBeenCalledTimes(1)
    pending.complete(first)
    await opening
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    expect(publish.mock.calls.some(([state]) => state.overview === first && !state.loading)).toBe(
      true,
    )
  })
  it('진행 중인 조회 뒤에는 가장 최근 검색만 실행한다', async () => {
    const pending = deferred<WorkspaceOverview>()
    const read = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(first)
    const publish = vi.fn()
    const query = workspaceOverviewController.instance.create(publish, read)
    const opening = query.refresh(workspace)
    await Promise.resolve()
    const old = query.search('old'),
      latest = query.search('latest')
    pending.complete(first)
    await Promise.all([opening, old, latest])
    expect(read).toHaveBeenCalledTimes(2)
    expect(read.mock.calls[1]?.[0].query).toBe('latest')
    expect(publish.mock.lastCall?.[0]).toMatchObject({ query: 'latest', loading: false })
  })
  it('작업 공간을 닫으면 뒤늦은 응답을 다시 표시하지 않는다', async () => {
    const pending = deferred<WorkspaceOverview>()
    const publish = vi.fn()
    const query = workspaceOverviewController.instance.create(publish, () => pending.promise)
    const opening = query.refresh(workspace)
    await Promise.resolve()
    await query.refresh(null)
    pending.complete(first)
    await opening
    expect(publish.mock.lastCall?.[0]).toMatchObject({
      workspacePath: null,
      overview: null,
      loading: false,
    })
  })
})
