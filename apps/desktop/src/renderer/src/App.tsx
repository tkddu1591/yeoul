import { CloudUpload, Moon, RefreshCw, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { suggestCommitMessage, type RepositoryStateKind } from '@git-gui/domain'
import { BranchSwitcher } from './components/BranchSwitcher'
import { ChangesPanel } from './components/ChangesPanel'
import { CommitDetailPanel } from './components/CommitDetailPanel'
import { CommitForm } from './components/CommitForm'
import { DiffPanel } from './components/DiffPanel'
import { HistoryPanel } from './components/HistoryPanel'
import { RepoPicker } from './components/RepoPicker'
import { ShelfPopover } from './components/ShelfPopover'
import {
  clampRightWidth,
  loadRightWidth,
  resetRightWidth,
  RIGHT_COLUMN_DEFAULT,
  saveRightWidth,
} from './ui/column-resize'
import { useRepositoryStore } from './store/repository-store'
import { applyTheme, initTheme, type Theme } from './ui/theme'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Pictogram } from './ui/Pictogram'
import { PromptDialog } from './ui/PromptDialog'

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

  // 첫 렌더에서 문서에 테마를 새긴다 — 저장값 우선, 없으면 시스템 설정 (⑥)
  const [theme, setTheme] = useState<Theme>(() => initTheme())
  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setTheme(next)
  }

  // 새 실험 공간 다이얼로그 — fromHash가 있으면 우클릭한 저장 시점에서 갈라진다
  const [branchPrompt, setBranchPrompt] = useState<{ fromHash: string | null } | null>(null)

  // 우측 열 폭 — 드래그로 조절하고 기억한다 (5차 피드백). 저장값·창 크기 변화 모두
  // 뷰포트 기준으로 재클램프한다 — 큰 모니터에서 넓혀둔 폭이 노트북에서 중앙을 짓누르지 않게
  const [rightWidth, setRightWidth] = useState<number>(() =>
    clampRightWidth(loadRightWidth(), window.innerWidth),
  )
  useEffect(() => {
    const onWindowResize = () => {
      setRightWidth((width) => clampRightWidth(width, window.innerWidth))
    }
    window.addEventListener('resize', onWindowResize)
    return () => window.removeEventListener('resize', onWindowResize)
  }, [])
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const onMove = (move: PointerEvent) => {
      setRightWidth(clampRightWidth(window.innerWidth - move.clientX - 20, window.innerWidth))
    }
    const onUp = (up: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      saveRightWidth(clampRightWidth(window.innerWidth - up.clientX - 20, window.innerWidth))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }
  const resetResize = () => {
    resetRightWidth()
    setRightWidth(RIGHT_COLUMN_DEFAULT)
  }
  // 상세 모드 최소폭도 뷰포트 클램프를 통과시킨다 — 좁은 창에서 중앙 diff가 살아남는다
  const effectiveRight =
    store.commitDetail !== null
      ? clampRightWidth(Math.max(rightWidth, 420), window.innerWidth)
      : rightWidth

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
            <BranchSwitcher
              branches={store.branches}
              currentName={status.branch.name}
              busy={store.busy}
              onSwitch={(name) => void store.switchBranch(name)}
              onCreate={() => setBranchPrompt({ fromHash: null })}
            />
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
          <ShelfPopover
            shelf={store.shelf}
            busy={store.busy}
            onSave={() => void store.shelfSave()}
            onRestore={(ref) => void store.shelfRestore(ref)}
            onDrop={(ref) => void store.shelfDrop(ref)}
          />
          <Button variant="ghost" size="sm" onPress={toggleTheme} testId="theme-toggle">
            {theme === 'dark' ? (
              <Sun size={13} aria-hidden="true" />
            ) : (
              <Moon size={13} aria-hidden="true" />
            )}
            {theme === 'dark' ? '밝게' : '어둡게'}
          </Button>
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
      {store.notice && (
        <p className="app__notice" role="status" data-testid="notice">
          {store.notice}
        </p>
      )}
      <main
        className={`app__main${store.commitDetail !== null ? ' app__main--detail' : ''}`}
        style={{ gridTemplateColumns: `340px minmax(0, 1fr) 6px ${effectiveRight}px` }}
      >
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
        {/* 우측 열 폭 조절 손잡이 — 드래그로 조절, 더블클릭으로 기본값 */}
        <div
          className="app__resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="타임라인 폭 조절"
          onPointerDown={startResize}
          onDoubleClick={resetResize}
          data-testid="column-resizer"
        />
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
            onCreateBranchAt={(hash) => setBranchPrompt({ fromHash: hash })}
          />
        )}
      </main>
      <PromptDialog
        isOpen={branchPrompt !== null}
        title="새 실험 공간 만들기"
        description={
          branchPrompt?.fromHash != null
            ? '우클릭한 저장 시점에서 갈라져 나와요. 만들면 바로 그 공간으로 이동해요.'
            : '지금 위치에서 갈라져 나와요. 만들면 바로 그 공간으로 이동해요.'
        }
        label="이름"
        placeholder="예: try-new-design"
        submitLabel="만들고 이동"
        onSubmit={(name) => {
          void (async () => {
            const fromHash = branchPrompt?.fromHash ?? null
            // 실패하면 다이얼로그를 유지해 입력을 보존한다 — 에러는 상단 배너로 (리뷰 반영)
            if (await store.createBranch(name, fromHash)) setBranchPrompt(null)
          })()
        }}
        onCancel={() => setBranchPrompt(null)}
      />
    </div>
  )
}
