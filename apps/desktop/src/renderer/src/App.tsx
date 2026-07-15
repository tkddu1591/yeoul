import { useEffect } from 'react'
import { ChangesPanel } from './components/ChangesPanel'
import { CommitForm } from './components/CommitForm'
import { DiffPanel } from './components/DiffPanel'
import { RepoPicker } from './components/RepoPicker'
import { useRepositoryStore } from './store/repository-store'

export function App() {
  const store = useRepositoryStore()

  useEffect(() => {
    void store.init()
    // 마운트 시 1회만 실행
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!store.repoPath) {
    return <RepoPicker onOpen={() => void store.openRepository()} error={store.error} />
  }

  const status = store.status
  const stagedCount = status?.changes.filter((c) => c.staged !== null).length ?? 0

  return (
    <div className="app">
      <header>
        <strong>{store.repoPath}</strong>
        <span className="state">
          {status ? `${status.branch.name ?? '(detached)'} · ${status.state}` : '읽는 중…'}
        </span>
        <button type="button" onClick={() => void store.refresh()} disabled={store.busy}>
          새로고침
        </button>
      </header>
      {store.error && <p className="error">{store.error}</p>}
      <main>
        <ChangesPanel
          changes={status?.changes ?? []}
          selected={store.selected}
          onStage={(paths) => void store.stage(paths)}
          onUnstage={(paths) => void store.unstage(paths)}
          onSelect={(selected) => void store.selectFile(selected)}
        />
        <div className="right">
          <DiffPanel path={store.selected?.change.path ?? null} diffText={store.diffText} />
          <CommitForm stagedCount={stagedCount} busy={store.busy} onCommit={(m) => void store.commit(m)} />
        </div>
      </main>
    </div>
  )
}
