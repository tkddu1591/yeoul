import { CloudUpload, RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import { suggestCommitMessage, type RepositoryStateKind } from '@git-gui/domain'
import { ChangesPanel } from './components/ChangesPanel'
import { CommitDetailPanel } from './components/CommitDetailPanel'
import { CommitForm } from './components/CommitForm'
import { DiffPanel } from './components/DiffPanel'
import { HistoryPanel } from './components/HistoryPanel'
import { RepoPicker } from './components/RepoPicker'
import { useRepositoryStore } from './store/repository-store'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Pictogram } from './ui/Pictogram'

/** 일상어 + 원어 병기(스펙 5장 문구 원칙) — 상태를 숨기지 않는다 */
const STATE_LABELS: Record<RepositoryStateKind, string> = {
  normal: '정상',
  merging: '합치는 중',
  rebasing: '다시 쌓는 중',
  'cherry-picking': '가져오는 중',
  reverting: '되돌리는 중',
  bisecting: '원인 찾는 중',
}

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
  const suggestion = suggestCommitMessage(status?.changes ?? [])
  const repoName = store.repoPath.split('/').pop() ?? store.repoPath

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__repo">
          <strong>{repoName}</strong>
          <span className="app__repo-path" title={store.repoPath}>
            {store.repoPath}
          </span>
        </div>
        {status && (
          <div className="app__status">
            <span className="app__branch" data-testid="header-branch">
              <Pictogram kind="branch" size={13} label="실험 공간 (branch)" />
              {status.branch.name ?? '(브랜치 없음 — detached HEAD)'}
            </span>
            {status.state !== 'normal' && (
              <span className="app__state">
                <Pictogram kind="conflict" size={13} label="진행 중 작업" />
                {STATE_LABELS[status.state]}{' '}
                <span className="app__state-raw">{status.state}</span>
              </span>
            )}
            {status.branch.ahead !== null && status.branch.behind !== null && (
              <Badge>
                ↑{status.branch.ahead} ↓{status.branch.behind}
              </Badge>
            )}
          </div>
        )}
        <div className="app__actions">
          <Button
            variant="neutral"
            size="sm"
            isDisabled={store.busy}
            onPress={() => void store.backup()}
            testId="backup"
          >
            <CloudUpload size={14} aria-hidden="true" /> 백업 <Badge tone="git">push</Badge>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            isDisabled={store.busy}
            onPress={() => void store.refresh()}
            testId="refresh"
          >
            <RefreshCw size={13} aria-hidden="true" /> 새로고침
          </Button>
        </div>
      </header>
      {store.error && (
        <p className="app__error" role="alert" data-testid="error">
          {store.error}
        </p>
      )}
      <main className="app__main">
        <ChangesPanel
          changes={status?.changes ?? []}
          selected={store.selected}
          busy={store.busy}
          onStage={(paths) => void store.stage(paths)}
          onUnstage={(paths) => void store.unstage(paths)}
          onDiscard={(trackedPaths, untrackedPaths) =>
            void store.discard(trackedPaths, untrackedPaths)
          }
          onSelect={(selected) => void store.selectFile(selected)}
        />
        <div className="app__center">
          <DiffPanel
            path={
              store.commitFile !== null && store.commitDetail !== null
                ? `${store.commitFile.path} — 저장 ${store.commitDetail.shortHash}`
                : store.selected?.change.path ?? null
            }
            diff={store.diff}
            busy={store.busy}
            onClose={() =>
              store.commitFile !== null ? store.clearCommitFile() : store.clearSelection()
            }
          />
          <CommitForm
            stagedCount={stagedCount}
            busy={store.busy}
            suggestion={suggestion}
            onCommit={(message) => store.commit(message)}
          />
        </div>
        {store.commitDetail !== null ? (
          <CommitDetailPanel
            detail={store.commitDetail}
            selectedFile={store.commitFile}
            busy={store.busy}
            onSelectFile={(file) => void store.selectCommitFile(file)}
            onBack={() => store.clearCommit()}
          />
        ) : (
          <HistoryPanel
            history={store.history}
            historyLimit={store.historyLimit}
            currentBranch={status?.branch.name ?? null}
            selectedHash={null}
            busy={store.busy}
            onSelect={(hash) => void store.selectCommit(hash)}
            onLoadMore={() => void store.loadMoreHistory()}
          />
        )}
      </main>
    </div>
  )
}
