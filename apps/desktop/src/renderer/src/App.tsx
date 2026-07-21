import { CloudUpload, DownloadCloud, GitMerge, Moon, RefreshCw, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { suggestCommitMessage, type RepositoryStateKind } from '@git-gui/domain'
import { isHeadBackedUp } from './components/backup-state'
import { BranchSwitcher } from './components/BranchSwitcher'
import { ConflictPanel } from './components/ConflictPanel'
import { ChangesPanel } from './components/ChangesPanel'
import { CommitDetailPanel } from './components/CommitDetailPanel'
import { CommitForm } from './components/CommitForm'
import { DiffPanel } from './components/DiffPanel'
import { HistoryPanel } from './components/HistoryPanel'
import { ManageBranchesDialog } from './components/ManageBranchesDialog'
import { RepoPicker } from './components/RepoPicker'
import { ReviewDetailPanel } from './components/ReviewDetailPanel'
import { ReviewPopover } from './components/ReviewPopover'
import { ShelfPopover } from './components/ShelfPopover'
import {
  clampRightWidth,
  computeColumns,
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

/** 진행 중 작업 상태 바 문구 — merging/reverting/cherry-picking 3겸용 (E5b) */
const OP_BAR = {
  merging: { doing: '실험 공간 합치는 중', abort: '합치기 취소' },
  reverting: { doing: '저장 되돌리는 중', abort: '되돌리기 취소' },
  'cherry-picking': { doing: '저장 가져오는 중', abort: '가져오기 취소' },
} as const

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

  // E5b 커밋 작업 다이얼로그 — 태그 이름·실행취소 확인·메시지 고치기 (대상 커밋 정보를 함께 보관)
  const [tagPrompt, setTagPrompt] = useState<{ hash: string } | null>(null)
  const [confirmingUndo, setConfirmingUndo] = useState<{ hash: string } | null>(null)
  const [rewordPrompt, setRewordPrompt] = useState<{ hash: string; subject: string } | null>(null)

  // 리뷰(호스팅) 다이얼로그 — 토큰 붙여넣기·리뷰 요청 제목 (팝오버는 닫고 연다)
  const [tokenPrompt, setTokenPrompt] = useState(false)
  const [pullPrompt, setPullPrompt] = useState(false)

  // 리뷰 상세의 병합 확인과 병합 후 "기본 공간 이동+받아오기" 제안(base 이름 보관)
  const [confirmingMerge, setConfirmingMerge] = useState(false)
  const [mergeFollowUp, setMergeFollowUp] = useState<string | null>(null)

  // 우측 열 폭 — 드래그로 조절하고 기억한다 (5차 피드백). 저장값·창 크기 변화 모두
  // 뷰포트 기준으로 재클램프한다 — 큰 모니터에서 넓혀둔 폭이 노트북에서 중앙을 짓누르지 않게
  const [rightWidth, setRightWidth] = useState<number>(() =>
    clampRightWidth(loadRightWidth(), window.innerWidth),
  )
  // 창 폭 — 좌·우 열이 창 폭에 따라 줄어드는 반응형 계산(computeColumns)의 입력 (E6a)
  const [viewportWidth, setViewportWidth] = useState<number>(() => window.innerWidth)
  useEffect(() => {
    const onWindowResize = () => {
      setViewportWidth(window.innerWidth)
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
  // 상세 전환이 열 폭을 강제로 넓히면 중앙이 밀린다(피드백 4: 레이아웃 시프트) — 사용자가 정한
  // 폭은 존중하되, 중앙 diff 최소 폭(380px)이 깨지면 좌측→우측 순으로 함께 줄인다 (E6a 반응형)
  const columns = computeColumns(viewportWidth, rightWidth)

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
  // 마지막 저장(HEAD)이 원격에 이미 백업됐는가 — 실행취소·메시지 고치기 확인창의 경고 병기 (판정 편차는 플랜 표)
  const headBackedUp = status !== null && isHeadBackedUp(status.branch)
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
            stateBlocked={status?.state !== 'normal'}
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
            onSelectPull={(number) => void store.openPullDetail(number)}
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
      {(status?.state === 'merging' ||
        status?.state === 'reverting' ||
        status?.state === 'cherry-picking' ||
        store.error !== null ||
        store.notice !== null) && (
        <div className="app__top-layer">
          <div className="app__top-stack">
            {(status?.state === 'merging' ||
              status?.state === 'reverting' ||
              status?.state === 'cherry-picking') && (
              <div className="app__merge-bar" data-testid="merge-bar">
                <Pictogram kind="conflict" size={14} label={OP_BAR[status.state].doing} />
                <span className="app__merge-text" data-testid="merge-remaining">
                  {`${OP_BAR[status.state].doing} — ${
                    conflictCount > 0
                      ? `겹침 ${conflictCount}개 남음. 붉은 ! 파일에서 한쪽을 고르고, 다 정리되면 저장하기로 마무리해요.`
                      : status.state !== 'merging' && stagedCount === 0
                        ? `겹침 0개 남음. 전부 내 것을 유지해서 바뀌는 내용이 없어요 — ${OP_BAR[status.state].abort}를 눌러 마무리해요.`
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
                  {OP_BAR[status.state].abort}
                </Button>
              </div>
            )}
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
        </div>
      )}
      <main
        className={`app__main${
          store.commitDetail !== null || store.pullDetail !== null ? ' app__main--detail' : ''
        }`}
        style={{ gridTemplateColumns: `${columns.left}px minmax(0, 1fr) 6px ${columns.right}px` }}
      >
        {/* 좌측 열 = 변경 목록(위) + 저장 폼(하단 푸터) — 고르고 저장하기까지 한 열에서 끝난다 (E6a) */}
        <div className="app__left">
          <ChangesPanel
            changes={status?.changes ?? []}
            selected={store.selected}
            busy={store.busy}
            onStage={(paths) => void store.stage(paths)}
            onUnstage={(paths) => void store.unstage(paths)}
            onDiscard={(trackedPaths, untrackedPaths) =>
              void store.discard(trackedPaths, untrackedPaths)
            }
            onRemoveFile={(path) => void store.removeFile(path)}
            onSelect={(selected) => void store.selectFile(selected)}
          />
          <CommitForm
            stagedCount={stagedCount}
            busy={store.busy}
            suggestion={suggestion}
            allowEmpty={status?.state === 'merging'}
            onCommit={(message) => store.commit(message)}
          />
        </div>
        <div className="app__center">
          {store.conflictFile !== null ? (
            <ConflictPanel
              key={store.conflictFile.path}
              path={store.conflictFile.path}
              content={store.conflictFile.content}
              busy={store.busy}
              // cherry-picking은 merging 취급 — 상대 라벨 '가져온 것'이 "이 저장만 가져오기" 어휘와 일치한다 (E5b 설계 판단)
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
                store.diffLabel ??
                (store.commitFile !== null && store.commitDetail !== null
                  ? `${store.commitFile.path} — 저장 ${store.commitDetail.shortHash}`
                  : store.selected?.change.path ?? null)
              }
              diff={store.diff}
              busy={store.busy}
              onClose={() =>
                store.commitFile !== null ? store.clearCommitFile() : store.clearSelection()
              }
            />
          )}
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
        {store.pullDetail !== null ? (
          <ReviewDetailPanel
            key={store.pullDetail.detail.number}
            view={store.pullDetail}
            busy={store.busy}
            onOpenBrowser={() => void store.openPull(store.pullDetail!.detail.number)}
            onBack={() => store.closePullDetail()}
            onComment={(body) => store.addPullComment(body)}
            onApprove={() => void store.approvePull()}
            onMerge={() => setConfirmingMerge(true)}
          />
        ) : store.commitDetail !== null ? (
          <CommitDetailPanel
            detail={store.commitDetail}
            shelfPreview={shelfPreview}
            selectedFile={store.commitFile}
            busy={store.busy}
            onSelectFile={(file) => void store.selectCommitFile(file)}
            onRestoreFile={(file) =>
              void store.restoreFileFromCommit(store.commitDetail!.hash, file.path)
            }
            onCompareFile={(file) =>
              void store.compareFileWithWorktree(store.commitDetail!.hash, file.path, file.origPath)
            }
            onBack={() => store.clearCommit()}
          />
        ) : (
          <HistoryPanel
            history={store.history}
            historyLimit={store.historyLimit}
            currentBranch={status?.branch.name ?? null}
            headHash={status?.headHash ?? null}
            localBranches={store.branches.map((branch) => branch.name)}
            selectedHash={null}
            busy={store.busy}
            actionsDisabled={status?.state !== 'normal'}
            onSelect={(hash) => void store.selectCommit(hash)}
            onLoadMore={() => void store.loadMoreHistory()}
            onLocateHead={() => void store.revealHead()}
            onAction={(action) => {
              switch (action.kind) {
                case 'switch':
                  void store.switchBranch(action.branch)
                  break
                case 'branch-here':
                  store.clearError()
                  setBranchPrompt({ fromHash: action.hash })
                  break
                case 'cherry-pick':
                  void store.cherryPickCommit(action.hash)
                  break
                case 'revert':
                  void store.revertCommit(action.hash)
                  break
                case 'undo':
                  setConfirmingUndo({ hash: action.hash })
                  break
                case 'reword':
                  store.clearError()
                  setRewordPrompt({ hash: action.hash, subject: action.subject })
                  break
                case 'tag':
                  store.clearError()
                  setTagPrompt({ hash: action.hash })
                  break
              }
            }}
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
        masked
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
        title={
          status?.state === 'reverting'
            ? '되돌리기를 취소할까요?'
            : status?.state === 'cherry-picking'
              ? '가져오기를 취소할까요?'
              : '합치기를 취소할까요?'
        }
        confirmLabel={
          status?.state === 'reverting'
            ? '되돌리기 취소'
            : status?.state === 'cherry-picking'
              ? '가져오기 취소'
              : '합치기 취소'
        }
        onConfirm={() => {
          setConfirmingAbort(false)
          if (status?.state === 'reverting') void store.abortRevert()
          else if (status?.state === 'cherry-picking') void store.abortCherryPick()
          else void store.abortMerge()
        }}
        onCancel={() => setConfirmingAbort(false)}
      >
        지금까지 고른 것을 되돌리고 이전 상태로 돌아가요.
      </ConfirmDialog>
      <PromptDialog
        isOpen={tagPrompt !== null}
        title="태그 만들기"
        description="이 저장 시점에 이름표(태그)를 붙여요. 역사 목록에 배지로 함께 보여요."
        label="태그 이름"
        placeholder="예: v1.0"
        submitLabel="만들기"
        errorText={tagPrompt !== null ? store.error : null}
        onSubmit={(name) => {
          void (async () => {
            const prompt = tagPrompt
            if (prompt === null) return
            // 실패하면 다이얼로그를 유지해 입력을 보존한다 — 에러는 인라인으로 (branchPrompt 관례)
            if (await store.createTag(name, prompt.hash)) setTagPrompt(null)
          })()
        }}
        onCancel={() => setTagPrompt(null)}
      />
      <ConfirmDialog
        isOpen={confirmingUndo !== null}
        title="마지막 저장을 실행취소할까요?"
        confirmLabel="실행취소"
        onConfirm={() => {
          const hash = confirmingUndo?.hash ?? null
          setConfirmingUndo(null)
          if (hash !== null) void store.undoLastCommit(hash)
        }}
        onCancel={() => setConfirmingUndo(null)}
      >
        저장만 취소하고 바뀐 내용은 그대로 남아요 — 왼쪽 변경 목록에서 다시 저장할 수 있어요.
        {headBackedUp && ' 이미 백업된 저장이에요 — 취소하면 원격과 어긋나요.'}
      </ConfirmDialog>
      <PromptDialog
        isOpen={rewordPrompt !== null}
        title="저장 메시지 고치기"
        description={`가장 최근 저장의 메시지를 새 한 줄로 바꿔요. 본문이 있었다면 함께 이 한 줄로 바뀌어요.${
          headBackedUp ? ' 이미 백업된 저장이에요 — 고치면 원격과 어긋나요.' : ''
        }`}
        label="메시지"
        placeholder="예: 로그인 버튼 색 수정"
        submitLabel="고치기"
        initialValue={rewordPrompt?.subject ?? ''}
        errorText={rewordPrompt !== null ? store.error : null}
        onSubmit={(message) => {
          void (async () => {
            const prompt = rewordPrompt
            if (prompt === null) return
            if (await store.rewordLastCommit(prompt.hash, message)) setRewordPrompt(null)
          })()
        }}
        onCancel={() => setRewordPrompt(null)}
      />
      <ConfirmDialog
        isOpen={confirmingMerge}
        title="리뷰 요청을 병합할까요?"
        confirmLabel="병합하기"
        onConfirm={() => {
          setConfirmingMerge(false)
          void (async () => {
            // base 이름은 병합 전에 붙잡아 둔다 — 성공 후 제안 다이얼로그가 쓴다
            const base = store.pullDetail?.detail.baseBranch ?? null
            if (await store.mergePull()) setMergeFollowUp(base)
          })()
        }}
        onCancel={() => setConfirmingMerge(false)}
      >
        "{store.pullDetail?.detail.baseBranch}"에 합쳐져요. 이 동작은 GitHub에서 일어나요.
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={mergeFollowUp !== null}
        title="기본 공간으로 이동할까요?"
        confirmLabel="이동하고 받아오기"
        onConfirm={() => {
          const base = mergeFollowUp
          setMergeFollowUp(null)
          // 기존 안전망 그대로 — 전환(자동 보관)·받아오기(충돌 흐름)를 store 합성 액션이 잇는다 (통합 리뷰)
          if (base !== null) void store.syncAfterMerge(base)
        }}
        onCancel={() => setMergeFollowUp(null)}
      >
        병합 완료 — 기본 공간({mergeFollowUp})으로 이동해 최신을 받아올까요? 나중에 해도 돼요.
      </ConfirmDialog>
    </div>
  )
}
