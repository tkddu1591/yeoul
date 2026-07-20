import { CloudUpload, DownloadCloud, GitMerge, Moon, RefreshCw, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { suggestCommitMessage, type RepositoryStateKind } from '@git-gui/domain'
import { BranchSwitcher } from './components/BranchSwitcher'
import { ConflictPanel } from './components/ConflictPanel'
import { ChangesPanel } from './components/ChangesPanel'
import { CommitDetailPanel } from './components/CommitDetailPanel'
import { CommitForm } from './components/CommitForm'
import { DiffPanel } from './components/DiffPanel'
import { HistoryPanel } from './components/HistoryPanel'
import { ManageBranchesDialog } from './components/ManageBranchesDialog'
import { RepoPicker } from './components/RepoPicker'
import { ReviewPopover } from './components/ReviewPopover'
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
import { ConfirmDialog } from './ui/ConfirmDialog'
import { ListDialog } from './ui/ListDialog'

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

  // 합치기 대상 선택·취소 확인
  const [mergePicker, setMergePicker] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [confirmingAbort, setConfirmingAbort] = useState(false)

  // 리뷰(호스팅) 다이얼로그 — 토큰 붙여넣기·리뷰 요청 제목 (팝오버는 닫고 연다)
  const [tokenPrompt, setTokenPrompt] = useState(false)
  const [pullPrompt, setPullPrompt] = useState(false)

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
  // 상세 전환이 열 폭을 강제로 넓히면 중앙이 밀린다(피드백 4: 레이아웃 시프트) —
  // 사용자가 정한 폭을 그대로 유지한다. 좁으면 손잡이로 넓히면 되고, 폭은 기억된다
  const effectiveRight = rightWidth

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
  const conflictCount = status?.changes.filter((c) => c.unstaged === 'conflicted').length ?? 0
  // 전량 ours 병합 마무리 — 변경 0개면 규칙 제안이 비므로 기본 문구를 준다 (품질 리뷰)
  const suggestion =
    status?.state === 'merging' && stagedCount === 0
      ? '실험 공간 합치기'
      : suggestCommitMessage(status?.changes ?? [])
  const repoName = store.repoPath.split('/').pop() ?? store.repoPath
  // 보관함 항목을 미리보기로 연 상태인가 — 상세 패널 문구를 보관함 맥락으로 분기한다 (품질 리뷰)
  const openDetail = store.commitDetail
  const shelfPreview =
    openDetail !== null && store.shelf.some((entry) => entry.hash === openDetail.hash)

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
              onCreate={() => {
                store.clearError()
                setBranchPrompt({ fromHash: null })
              }}
              onManage={() => {
                store.clearError()
                setManageOpen(true)
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              isDisabled={store.busy || status.state !== 'normal'}
              onPress={() => setMergePicker(true)}
              testId="merge-open"
            >
              <GitMerge size={13} aria-hidden="true" /> 합치기 <Badge tone="git">merge</Badge>
            </Button>
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
            isDisabled={store.busy || status?.state !== 'normal'}
            onPress={() => void store.pullLatest()}
            testId="pull"
          >
            <DownloadCloud size={14} aria-hidden="true" /> 받아오기 <Badge tone="git">pull</Badge>
          </Button>
          <ShelfPopover
            shelf={store.shelf}
            busy={store.busy}
            onSave={() => void store.shelfSave()}
            onPreview={(hash) => void store.selectCommit(hash)}
            onRestore={(ref) => void store.shelfRestore(ref)}
            onDrop={(ref) => void store.shelfDrop(ref)}
          />
          <ReviewPopover
            status={store.hostingStatus}
            pulls={store.pulls}
            busy={store.busy}
            currentBranch={status?.branch.name ?? null}
            onOpen={() => void store.refreshPulls()}
            onConnectGh={() => void store.connectGh()}
            onConnectToken={() => {
              store.clearError()
              setTokenPrompt(true)
            }}
            onDisconnect={() => void store.disconnectHosting()}
            onCreate={() => {
              store.clearError()
              setPullPrompt(true)
            }}
            onOpenPull={(number) => void store.openPull(number)}
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
      {(status?.state === 'merging' || status?.state === 'reverting') && (
        <div className="app__merge-bar" data-testid="merge-bar">
          <Pictogram
            kind="conflict"
            size={14}
            label={status.state === 'merging' ? '합치는 중' : '되돌리는 중'}
          />
          <span className="app__merge-text" data-testid="merge-remaining">
            {`${status.state === 'merging' ? '실험 공간 합치는 중' : '저장 되돌리는 중'} — ${
              conflictCount > 0
                ? `겹침 ${conflictCount}개 남음. 붉은 ! 파일에서 한쪽을 고르고, 다 정리되면 저장하기로 마무리해요.`
                : status.state === 'reverting' && stagedCount === 0
                  ? '겹침 0개 남음. 전부 내 것을 유지해서 바뀌는 내용이 없어요 — 되돌리기 취소를 눌러 마무리해요.'
                  : '겹침 0개 남음. 이제 저장하기로 마무리해요.'
            }`}
          </span>
          <Button
            variant="danger"
            size="sm"
            isDisabled={store.busy}
            onPress={() => setConfirmingAbort(true)}
            testId="merge-abort"
          >
            {status.state === 'merging' ? '합치기 취소' : '되돌리기 취소'}
          </Button>
        </div>
      )}
      {/* 배너는 머지 바 '뒤' — 머지 바(상주 상태·취소 버튼)를 가리면 취소가 클릭 불가가 된다 (품질 리뷰 실측) */}
      {(store.error !== null || store.notice !== null) && (
        <div className="app__banner-layer">
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
        </div>
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
          {store.conflictFile !== null ? (
            <ConflictPanel
              key={store.conflictFile.path}
              path={store.conflictFile.path}
              content={store.conflictFile.content}
              busy={store.busy}
              mode={status?.state === 'reverting' ? 'reverting' : 'merging'}
              onResolve={(choice) => void store.resolveConflict(store.conflictFile!.path, choice)}
              onMarkResolved={() => void store.markConflictResolved(store.conflictFile!.path)}
              onReload={() => store.reloadConflict(store.conflictFile!.path)}
              onChooseBlock={(blockIndex, choice) =>
                void store.chooseConflictBlock(blockIndex, choice)
              }
              onSaveText={(content) => store.saveConflictText(content)}
              onReset={() => void store.resetConflict()}
            />
          ) : (
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
          )}
          <CommitForm
            stagedCount={stagedCount}
            busy={store.busy}
            suggestion={suggestion}
            allowEmpty={status?.state === 'merging'}
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
            shelfPreview={shelfPreview}
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
            revertDisabled={status?.state !== 'normal'}
            onCreateBranchAt={(hash) => {
              store.clearError()
              setBranchPrompt({ fromHash: hash })
            }}
            onRevert={(hash) => void store.revertCommit(hash)}
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
        errorText={branchPrompt !== null ? store.error : null}
        onSubmit={(name) => {
          void (async () => {
            const fromHash = branchPrompt?.fromHash ?? null
            // 실패하면 다이얼로그를 유지해 입력을 보존한다 — 에러는 상단 배너로 (리뷰 반영)
            if (await store.createBranch(name, fromHash)) setBranchPrompt(null)
          })()
        }}
        onCancel={() => setBranchPrompt(null)}
      />
      <ListDialog
        isOpen={mergePicker}
        title="어느 실험 공간을 합칠까요?"
        description="고른 공간의 저장 내용을 지금 공간으로 가져와 합쳐요. 저장 안 된 변경이 겹치면 보관함에 넣고 진행해요."
        options={store.branches
          .filter((branch) => !branch.isCurrent)
          .map((branch) => ({ key: branch.name, label: branch.name }))}
        emptyText="합칠 다른 실험 공간이 없어요."
        onSelect={(name) => {
          setMergePicker(false)
          void store.mergeBranch(name)
        }}
        onCancel={() => setMergePicker(false)}
      />
      <ManageBranchesDialog
        isOpen={manageOpen}
        branches={store.branches}
        busy={store.busy}
        errorText={store.error}
        onRename={(oldName, newName) => store.renameBranch(oldName, newName)}
        onRemove={(name, force) => store.removeBranch(name, force)}
        onClearError={() => store.clearError()}
        onCancel={() => setManageOpen(false)}
      />
      <PromptDialog
        isOpen={tokenPrompt}
        title="GitHub 토큰으로 연결"
        description="github.com → Settings → Developer settings → Personal access tokens에서 만들 수 있어요. 만든 토큰을 붙여넣어 주세요."
        label="토큰"
        placeholder="ghp_..."
        submitLabel="연결"
        errorText={tokenPrompt ? store.error : null}
        onSubmit={(token) => {
          void (async () => {
            // 실패하면 다이얼로그를 유지해 입력을 보존한다 — 에러는 인라인으로 (branchPrompt 관례)
            if (await store.connectToken(token)) setTokenPrompt(false)
          })()
        }}
        onCancel={() => setTokenPrompt(false)}
      />
      <PromptDialog
        isOpen={pullPrompt}
        title="리뷰 요청 만들기"
        description="지금 실험 공간의 저장 내용을 검토해 달라고 요청해요. 아직 백업(push) 전이면 백업부터 자동으로 해요."
        label="제목"
        placeholder="예: 로그인 버튼 색 실험"
        submitLabel="요청 만들기"
        initialValue={store.history[0]?.subject ?? ''}
        errorText={pullPrompt ? store.error : null}
        onSubmit={(title) => {
          void (async () => {
            if (await store.createPull(title)) setPullPrompt(false)
          })()
        }}
        onCancel={() => setPullPrompt(false)}
      />
      <ConfirmDialog
        isOpen={confirmingAbort}
        title={status?.state === 'reverting' ? '되돌리기를 취소할까요?' : '합치기를 취소할까요?'}
        confirmLabel={status?.state === 'reverting' ? '되돌리기 취소' : '합치기 취소'}
        onConfirm={() => {
          setConfirmingAbort(false)
          if (status?.state === 'reverting') void store.abortRevert()
          else void store.abortMerge()
        }}
        onCancel={() => setConfirmingAbort(false)}
      >
        지금까지 고른 것을 되돌리고 이전 상태로 돌아가요.
      </ConfirmDialog>
    </div>
  )
}
