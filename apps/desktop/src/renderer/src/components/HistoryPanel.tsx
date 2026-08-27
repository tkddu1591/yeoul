import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef, useState } from 'react'
import type { CommitSummary, HistorySearchResult } from '@git-gui/domain'
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { Pictogram } from '../ui/Pictogram'
import { Tooltip } from '../ui/Tooltip'
import { useNow } from '../ui/use-now'
import { FindBar } from './FindBar'
import { cycleIndex } from './find-matches'
import { buildGraph, type GraphRow } from './history-graph'
import { arrangeRefs, isRemoteRef, refBadgeLabel } from './history-refs'
import { formatAbsoluteTime, formatRelativeTime } from './relative-time'
import { T } from '../terms'
import './history-panel.css'
import './virtual.css'

/** 우클릭 메뉴에서 고른 커밋 작업 — 분기·다이얼로그는 App이 담당한다 (data options 패턴: props 폭발 방지) */
export type HistoryAction =
  | { kind: 'switch'; branch: string }
  | { kind: 'branch-here'; hash: string }
  | { kind: 'cherry-pick'; hash: string }
  | { kind: 'revert'; hash: string }
  | { kind: 'undo'; hash: string }
  | { kind: 'reword'; hash: string; subject: string }
  | { kind: 'tag'; hash: string }

interface HistoryPanelProps {
  history: CommitSummary[]
  /** 현재 조회 상한 — 목록이 상한에 닿으면 "N+"로 표기하고, 스크롤 끝에서 더 불러온다 (⑩) */
  historyLimit: number
  /** 현재 브랜치 — 같은 이름의 ref 배지를 강조한다 */
  currentBranch: string | null
  /** HEAD 커밋 해시 — "지금 여기" 마커가 이 행을 따라간다 (피드백 4). unborn이면 null */
  headHash: string | null
  /** 로컬 실험 공간 이름 전체 — "이동(switch)" 메뉴 대상 판별(원격 배지 휴리스틱과 달리 정확한 목록) */
  localBranches: string[]
  selectedHash: string | null
  busy: boolean
  /**
   * 우측 열로 떨어지는 조회(더 불러오기 등)가 진행 중인가 (E14a).
   * busy와 나눠 받는 이유: 예전엔 busy 하나가 "작업 중 표시"와 "재진입 차단기"를 겸했는데,
   * E14a가 조회를 전역 busy에서 빼면서 차단기 역할만 빈다 — 더 불러오기 이펙트가 그 자리를 밟는다
   */
  pending: boolean
  /** merging 등 진행 중에는 이력 조작(이동·가져오기·되돌리기·실행취소·메시지 고치기)을 비활성 */
  actionsDisabled: boolean
  /** 역사 조회 중인 브랜치 — non-null이면 "조회 중" 알약을 보여준다 (E7g) */
  historyRef: string | null
  /** ⌘F로 이 패널이 검색 대상으로 잡혔는가 (E7h ⑥) */
  findOpen: boolean
  /** 재⌘F마다 증가 — 같은 스코프 재검색 시 입력 재포커스 신호 (E7h ⑥ 보완) */
  findNonce: number
  onFindClose(): void
  onSelect(hash: string): void
  onLoadMore(): void
  /** 저장소 전체 검색 (E7i) — 스코프는 store가 넣는다 */
  onSearch(query: string): Promise<HistorySearchResult>
  /** 검색 점프 — 그 인덱스가 목록에 들어오도록 더 불러온다 (E7i) */
  onEnsureLoaded(index: number): Promise<void>
  /** "지금 여기"가 로드 범위 밖일 때 누른다 — 찾을 때까지 더 읽어 스크롤한다 (품질 리뷰) */
  onLocateHead(): void
  onAction(action: HistoryAction): void
  /** 조회 해제 — 전체 그래프로 복귀 (E7g) */
  onClearView(): void
}

/** 레인 간격·행 높이 — 행 높이는 고정이라 그래프 좌표가 단순해진다 (measureElement 불필요) */
const LANE_WIDTH = 12
const ROW_HEIGHT = 52
const NODE_Y = ROW_HEIGHT / 2
/** 레인 색 — 위치가 1차 신호, 색은 보조(색약 대응: 인접 레인이 형태·위치로 구분된다) */
const LANE_COLORS = [
  'var(--concept-commit)',
  'var(--concept-branch)',
  'var(--concept-mine)',
  'var(--concept-shelf)',
  'var(--concept-backup)',
  'var(--concept-conflict)',
]

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length]!
}

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2
}

/** 한 행의 그래프 거터 — 세로선(pass), 위→점 합류(join), 점→아래 분기(fork), 커밋 점 */
function GraphCell({ row, isHead }: { row: GraphRow; isHead: boolean }) {
  const width = row.laneCount * LANE_WIDTH
  const nodeX = laneX(row.nodeLane)
  return (
    <svg
      className="history-item__graph"
      width={width}
      height={ROW_HEIGHT}
      viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
      aria-hidden="true"
    >
      {row.passLanes.map((lane) => (
        <line
          key={`pass-${lane}`}
          x1={laneX(lane)}
          y1={0}
          x2={laneX(lane)}
          y2={ROW_HEIGHT}
          stroke={laneColor(lane)}
          strokeWidth={2}
        />
      ))}
      {/* 점의 레인이 위에서 내려올 때만 위쪽 선을 그린다 — 첫 행·새 갈래 머리의 stub 방지 */}
      {row.hasIncoming && (
        <line
          x1={nodeX}
          y1={0}
          x2={nodeX}
          y2={NODE_Y}
          stroke={laneColor(row.nodeLane)}
          strokeWidth={2}
        />
      )}
      {row.joinLanes.map((lane) => (
        <path
          key={`join-${lane}`}
          d={`M ${laneX(lane)} 0 C ${laneX(lane)} ${NODE_Y * 0.7}, ${nodeX} ${NODE_Y * 0.5}, ${nodeX} ${NODE_Y}`}
          stroke={laneColor(lane)}
          strokeWidth={2}
          fill="none"
        />
      ))}
      {row.forkLanes.map((lane) => (
        <path
          key={`fork-${lane}`}
          d={
            lane === row.nodeLane
              ? `M ${nodeX} ${NODE_Y} L ${nodeX} ${ROW_HEIGHT}`
              : `M ${nodeX} ${NODE_Y} C ${nodeX} ${NODE_Y * 1.5}, ${laneX(lane)} ${NODE_Y * 1.3}, ${laneX(lane)} ${ROW_HEIGHT}`
          }
          stroke={laneColor(lane)}
          strokeWidth={2}
          fill="none"
        />
      ))}
      <circle
        cx={nodeX}
        cy={NODE_Y}
        r={4.5}
        fill={isHead ? laneColor(row.nodeLane) : 'var(--color-surface)'}
        stroke={laneColor(row.nodeLane)}
        strokeWidth={2}
      />
    </svg>
  )
}

export function HistoryPanel({
  history,
  historyLimit,
  currentBranch,
  headHash,
  localBranches,
  selectedHash,
  busy,
  pending,
  actionsDisabled,
  historyRef,
  findOpen,
  findNonce,
  onFindClose,
  onSelect,
  onLoadMore,
  onSearch,
  onEnsureLoaded,
  onLocateHead,
  onAction,
  onClearView,
}: HistoryPanelProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; commit: CommitSummary } | null>(null)
  // E14b — 커밋 행마다가 아니라 여기서 한 번만 구독한다. 가상화로 보이는 행만 그리지만 목록은
  // 수천 개라 행마다 부르면 구독자가 그만큼 생긴다. 이 파일은 incompatible-library로 규칙이
  // 통째로 건너뛰어져 린트가 렌더 중 Date.now()를 잡지 못했다 — grep 전수로 찾아 고쳤다
  const now = useNow()
  const truncated = history.length >= historyLimit
  // 수천 커밋에서도 DOM은 가시 범위만 유지한다 (#4)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // 레인 그래프 — 목록이 바뀔 때마다 전체를 다시 배정한다 (E5b 실측: --all 5,003커밋 2.8ms — 무해)
  const graph = buildGraph(history)
  const virtualizer = useVirtualizer({
    count: history.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 52,
    overscan: 10,
  })
  const virtualItems = virtualizer.getVirtualItems()
  const lastRendered = virtualItems[virtualItems.length - 1]?.index ?? -1

  // E7i — ⌘F 전체 검색: 매칭은 git이 한다(로컬 배열 매칭 폐기 — 안 불러온 커밋이 안 걸리던 문제).
  // 200ms 디바운스 + 요청 순번(seq)으로 늦게 온 응답을 버려 타이핑 중 카운터 역전을 막는다.
  // 이른 반환이 없는 컴포넌트지만 다른 훅과 나란히 최상단에 둔다(Rules of Hooks 관례 — E7d 교훈)
  const [findQuery, setFindQuery] = useState('')
  const [findPos, setFindPos] = useState(0)
  const [findHits, setFindHits] = useState<number[]>([])
  const [findTruncated, setFindTruncated] = useState(false)
  const findSeqRef = useRef(0)
  /** 마지막으로 점프한 검색(쿼리+스코프) — 스냅샷발 재검색은 재점프하지 않는다 (E7i 보완 I-3) */
  const lastJumpKeyRef = useRef('')
  const currentHit = findHits.length === 0 ? -1 : findHits[Math.min(findPos, findHits.length - 1)]!

  // history는 렌더 시점 prop이라 onEnsureLoaded await 이후엔 최신값이 아닐 수 있다 — 렌더마다
  // 최신 길이를 ref에 반영해 async 연속 실행 시점에도 store가 반영한 값을 읽게 한다 (리뷰 가드 — E7i)
  const historyLenRef = useRef(history.length)
  historyLenRef.current = history.length

  /** 그 인덱스로 이동 — 로드 범위 밖이면 먼저 더 불러온다 (E7i) */
  const jumpTo = async (index: number) => {
    if (index >= historyLenRef.current) {
      await onEnsureLoaded(index)
      // ensureHistoryLoaded는 조회(runRead)라 busy와 무관하게 언제나 실제로 돈다 — 예전엔
      // busy면 조용히 끝났고 그래서 로드 없이 돌아올 수 있었다(E14a가 개선한 지점). 그래도
      // 상한(HISTORY_MAX)이나 늦게 온 응답 폐기로 로드가 안 될 수 있으니, 로드 후에도
      // 범위 밖이면 스크롤을 건너뛴다(안 그러면 가상 목록이 바닥으로 튄다). historyLenRef는
      // 렌더마다 갱신되므로 이 시점에 store가 반영한 최신 길이를 읽는다 (리뷰 가드 — E7i)
      if (index >= historyLenRef.current) return
    }
    virtualizer.scrollToIndex(index, { align: 'center' })
  }

  // E14c — 검색 이펙트가 "값은 읽되 재실행 트리거로는 삼지 않는" 것들은 렌더마다 ref에 반영해
  // 최신 판을 읽는다(historyLenRef와 같은 관용구):
  // · jumpTo — 지역 화살표라 렌더마다 새 참조. deps에 넣으면 매 렌더 재검색이라 E7i 리뷰가
  //   잡았던 "타이핑 중 카운터 역전" 플레이크가 되살아난다(함수 정체성은 재검색 신호가 아니다)
  // · findPos — 이동 핸들러(moveFind)가 이미 직접 점프한다. 트리거로 삼으면 ↑↓ 한 번마다
  //   200ms 디바운스 검색이 git으로 다시 나간다
  // · findHits.length — 닫기 분기의 헛렌더 방지 가드일 뿐. 트리거로 삼으면 결과 도착마다 재검색이다
  const jumpToRef = useRef(jumpTo)
  jumpToRef.current = jumpTo
  const findPosRef = useRef(findPos)
  findPosRef.current = findPos
  const findHitsLenRef = useRef(findHits.length)
  findHitsLenRef.current = findHits.length
  // 복합식(history[0]?.hash)은 deps에서 정적으로 검사할 수 없다 — 지역 변수로 빼서 넣는다 (E14c)
  const firstHash = history[0]?.hash

  // 검색 실행 — 쿼리·스코프(historyRef)·목록 갱신에 반응한다. 닫히면 결과를 비운다.
  // onSearch는 App이 셀렉터로 받은 zustand 액션을 그대로 내려주는 안정 참조라(E14c) deps에
  // 있어도 재검색을 일으키지 않는다
  useEffect(() => {
    if (!findOpen || findQuery === '') {
      // 진행 중 응답을 폐기한다 — 안 그러면 닫은 뒤에 하이라이트·스크롤이 되살아난다 (보완 I-1)
      findSeqRef.current += 1
      lastJumpKeyRef.current = ''
      // 닫힌 상태에서 매 스냅샷마다 새 배열을 넣어 헛렌더하지 않는다
      if (findHitsLenRef.current > 0) {
        setFindHits([])
        setFindTruncated(false)
      }
      return
    }
    const seq = findSeqRef.current + 1
    findSeqRef.current = seq
    const timer = setTimeout(() => {
      void onSearch(findQuery).then((result) => {
        // 늦게 온 응답 폐기 — 마지막 요청만 화면에 반영한다
        if (findSeqRef.current !== seq) return
        setFindHits(result.indices)
        setFindTruncated(result.truncated)
        // 쿼리·스코프가 바뀐 검색에서만 점프한다 — 스냅샷발 재검색은 결과만 갱신(보완 I-3:
        // 안 그러면 사용자가 스크롤할 때마다 화면이 매치로 되감긴다)
        const jumpKey = `${findQuery}\u0000${historyRef ?? ''}`
        if (lastJumpKeyRef.current !== jumpKey && result.indices.length > 0) {
          lastJumpKeyRef.current = jumpKey
          void jumpToRef.current(
            result.indices[Math.min(findPosRef.current, result.indices.length - 1)]!,
          )
        }
      })
    }, 200)
    return () => clearTimeout(timer)
  }, [findOpen, findQuery, historyRef, history.length, firstHash, onSearch])

  const moveFind = (delta: number) => {
    if (findHits.length === 0) return
    const nextPos = cycleIndex(Math.min(findPos, findHits.length - 1), delta, findHits.length)
    setFindPos(nextPos)
    void jumpTo(findHits[nextPos]!)
  }

  // "지금 여기"(HEAD)가 바뀌거나, "지금 여기로"로 로드 범위에 처음 들어온 순간 그 행으로 스크롤한다
  // (품질 리뷰 — 구현 실측 정정: revealHead는 headHash를 바꾸지 않으므로 발견 전이(headFound)도 봐야 한다.
  //  불리언 전이만 보므로 이미 보이는 상태의 단순 더 불러오기로는 튀지 않는다)
  const headIndex = headHash === null ? -1 : history.findIndex((commit) => commit.hash === headHash)
  const headFound = headIndex >= 0
  // E14c — headIndex는 "값은 읽되 재실행 트리거로는 삼지 않는다": 더 불러오기로 목록이 늘 때마다
  // HEAD의 인덱스가 바뀌므로, deps에 넣으면 사용자가 스크롤하는 도중에도 화면이 HEAD 행으로
  // 되감긴다(위 주석의 "불리언 전이만 본다"가 그 방어다). ref로 최신 판만 읽는다
  const headIndexRef = useRef(headIndex)
  headIndexRef.current = headIndex
  useEffect(() => {
    const index = headIndexRef.current
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'center' })
    // virtualizer는 안정 참조라 deps에 있어도 재발화가 없다 — TanStack v3는
    // useState(() => new Virtualizer(...))로 만든 인스턴스를 계속 재사용하고 setOptions로
    // 갱신할 뿐이다(react-virtual dist/esm/index.js:82, 실측). 이 이펙트는 여전히
    // headHash 변경·headFound 전이에만 돈다
  }, [headHash, headFound, virtualizer])

  // 마지막 행이 렌더 범위에 들어오면 다음 페이지를 불러온다 (⑩) — 상한은 store가 이중 방어한다.
  //
  // !pending이 없으면 무한 루프다 (E14a 실측: React error #185로 우측 열이 통째로 언마운트).
  // onLoadMore는 App에서 매 렌더 새로 만들어지는 화살표 함수라 이 이펙트는 렌더마다 재발화하는데,
  // 예전엔 loadMoreHistory가 켠 busy가 그 사슬을 끊고 있었다 — busy는 "작업 중 표시"이자 사실상
  // **재진입 차단기**였다. E14a가 조회를 전역 busy에서 빼자 차단기만 사라져 호출 → reads 변경 →
  // 재렌더 → 새 onLoadMore → 재발화가 끝없이 돌았다. 조회는 조회의 진행 상태(pending)로 막는다
  useEffect(() => {
    if (truncated && !busy && !pending && lastRendered >= history.length - 1) onLoadMore()
  }, [truncated, busy, pending, lastRendered, history.length, onLoadMore])

  // 메뉴 8항목 + 구분선 — HEAD 전용 항목은 숨기지 않고 사유와 함께 비활성 (상태를 숨기지 않는다)
  const buildMenu = (commit: CommitSummary): ContextMenuEntry[] => {
    const isHead = commit.hash === headHash
    // 이 커밋을 끝으로 갖는 첫 로컬 실험 공간 — 현재 공간이면 이동 항목을 만들지 않는다
    const switchTarget =
      commit.refs.find((ref) => ref !== currentBranch && localBranches.includes(ref)) ?? null
    const entries: ContextMenuEntry[] = []
    if (switchTarget !== null) {
      entries.push({
        key: 'switch-here',
        label: `"${switchTarget}" ${T.branch}로 이동`,
        disabled: actionsDisabled,
        onSelect: () => onAction({ kind: 'switch', branch: switchTarget }),
      })
    }
    entries.push(
      {
        key: 'branch-here',
        label: `여기서 ${T.branch} 만들기…`,
        onSelect: () => onAction({ kind: 'branch-here', hash: commit.hash }),
      },
      { key: 'sep-1', separator: true },
      {
        key: 'cherry-pick',
        label: `${T.cherryPick} (cherry-pick)`,
        disabled: actionsDisabled,
        onSelect: () => onAction({ kind: 'cherry-pick', hash: commit.hash }),
      },
      {
        key: 'revert',
        label: `이 ${T.commit} ${T.revert}`,
        disabled: actionsDisabled,
        onSelect: () => onAction({ kind: 'revert', hash: commit.hash }),
      },
      {
        key: 'undo-last',
        label: isHead ? T.undoCommit : `${T.undoCommit} — 가장 최근 ${T.commit}에서만`,
        disabled: actionsDisabled || !isHead,
        onSelect: () => onAction({ kind: 'undo', hash: commit.hash }),
      },
      {
        key: 'reword',
        label: isHead
          ? `${T.commitMessage} 고치기…`
          : `${T.commitMessage} 고치기 — 가장 최근 ${T.commit}에서만`,
        disabled: actionsDisabled || !isHead,
        onSelect: () => onAction({ kind: 'reword', hash: commit.hash, subject: commit.subject }),
      },
      {
        key: 'tag-here',
        label: '태그 만들기…',
        onSelect: () => onAction({ kind: 'tag', hash: commit.hash }),
      },
      { key: 'sep-2', separator: true },
      {
        key: 'copy-hash',
        label: `해시 복사 (${commit.shortHash})`,
        onSelect: () => {
          void navigator.clipboard.writeText(commit.hash)
        },
      },
    )
    return entries
  }

  return (
    <Panel
      title={T.history}
      titleHint="log"
      pending={pending}
      accessory={
        <>
          {historyRef !== null && (
            <span className="history-view-pill" data-testid="history-view-pill">
              <span className="history-view-pill__label">조회 중:</span>
              <span className="history-view-pill__name" title={historyRef}>
                {historyRef}
              </span>
              <button
                type="button"
                className="history-view-pill__clear"
                aria-label="조회 해제 — 전체 그래프로"
                onClick={onClearView}
                data-testid="history-view-clear"
              >
                전체 보기
              </button>
            </span>
          )}
          <Badge tone="count">
            <span data-testid="history-count">
              {truncated ? `${historyLimit}+` : history.length}
            </span>
          </Badge>
          {headHash !== null && headIndex < 0 && historyRef === null && (
            <Button variant="ghost" size="sm" isDisabled={busy} onPress={onLocateHead} testId="history-locate-head">
              {T.head}로
            </Button>
          )}
        </>
      }
      testId="history-panel"
    >
      {findOpen && (
        <FindBar
          query={findQuery}
          position={findHits.length === 0 ? -1 : Math.min(findPos, findHits.length - 1)}
          count={findHits.length}
          countTruncated={findTruncated}
          focusSignal={findNonce}
          placeholder="메시지·해시 찾기 (전체)"
          onQuery={(q) => {
            // 매칭은 이펙트(디바운스 검색)가 한다 — 여기서는 쿼리·위치만 초기화
            setFindQuery(q)
            setFindPos(0)
          }}
          onNext={() => moveFind(1)}
          onPrev={() => moveFind(-1)}
          onClose={() => {
            setFindQuery('')
            setFindHits([])
            setFindTruncated(false)
            onFindClose()
          }}
        />
      )}
      {history.length === 0 ? (
        <div className="history-panel__empty">
          <Pictogram kind="commit" size={20} label={`${T.commit} 시점`} />
          <p>
            아직 {T.commit}이 없어요.
            <br />
            {T.commit}할 때마다 여기에 쌓여요.
          </p>
        </div>
      ) : (
        <div ref={scrollRef} className="virtual-scroll" data-testid="history-scroll">
          <ol
            className="history-panel__list"
            data-testid="history-list"
            style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
          >
            {virtualItems.map((item) => {
              const commit = history[item.index]!
              // "지금 여기"는 index 0 고정이 아니라 HEAD 커밋 행을 따라간다 (피드백 4 — --all에서는 다를 수 있다)
              const isHead = commit.hash === headHash
              return (
                <li
                  key={commit.hash}
                  className="virtual-row"
                  style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
                >
                  <Tooltip
                    content={
                      <>
                        <div className="ui-tooltip__title">{commit.subject}</div>
                        <div className="ui-tooltip__meta">
                          {formatAbsoluteTime(commit.committedAt)} · {commit.authorName}
                        </div>
                      </>
                    }
                    summary={commit.subject}
                  >
                    <button
                      type="button"
                      className={[
                        'history-item',
                        isHead ? 'history-item--head' : '',
                        selectedHash === commit.hash ? 'history-item--selected' : '',
                        item.index === currentHit ? 'history-item--find-hit' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      disabled={busy}
                      onClick={() => onSelect(commit.hash)}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        setMenu({ x: event.clientX, y: event.clientY, commit })
                      }}
                      aria-current={selectedHash === commit.hash ? 'true' : undefined}
                      data-testid={`history-item-${commit.hash}`}
                    >
                      <GraphCell row={graph[item.index]!} isHead={isHead} />
                      <div className="history-item__body">
                        <span className="history-item__title">
                          {isHead && <span className="history-item__here">{T.head}</span>}
                          {(() => {
                            // 배지 폭 경쟁으로 전부 말줄임되는 것을 막는다 — 상위 2개 + "+N" 접기 (피드백)
                            const arranged = arrangeRefs(commit.refs, currentBranch, commit.tags)
                            return (
                              <>
                                {arranged.visible.map((ref) => (
                                  <Tooltip key={ref} content={ref} summary={ref}>
                                    <span
                                      className={[
                                        'history-item__ref',
                                        ref === currentBranch ? 'history-item__ref--head' : '',
                                        // 원격은 ☁ 접두 + 점선, 태그는 🏷 접두(실선 유지) — 3분 구분 (E4·E5b 후속)
                                        !commit.tags.includes(ref) && isRemoteRef(ref)
                                          ? 'history-item__ref--remote'
                                          : '',
                                      ]
                                        .filter(Boolean)
                                        .join(' ')}
                                    >
                                      {refBadgeLabel(ref, commit.tags)}
                                    </span>
                                  </Tooltip>
                                ))}
                                {arranged.hidden.length > 0 && (
                                  <Tooltip
                                    content={arranged.hidden
                                      .map((ref) => refBadgeLabel(ref, commit.tags))
                                      .join('\n')}
                                    summary={refBadgeLabel(arranged.hidden[0]!, commit.tags)}
                                  >
                                    <span
                                      className="history-item__ref history-item__ref--more"
                                      data-testid={`history-refs-more-${commit.hash}`}
                                    >
                                      +{arranged.hidden.length}
                                    </span>
                                  </Tooltip>
                                )}
                              </>
                            )
                          })()}
                          {commit.parents.length >= 2 && (
                            <span className="history-item__mergemark">병합</span>
                          )}
                          <span className="history-item__subject">{commit.subject}</span>
                        </span>
                        <span className="history-item__meta">
                          {formatRelativeTime(commit.committedAt, now)} · {commit.authorName}
                        </span>
                      </div>
                      <span className="history-item__hash">{commit.shortHash}</span>
                    </button>
                  </Tooltip>
                </li>
              )
            })}
          </ol>
          {truncated && (
            <div className="history-panel__more" aria-hidden="true">
              이전 기록 불러오는 중…
            </div>
          )}
        </div>
      )}
      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenu(menu.commit)}
          onClose={() => setMenu(null)}
        />
      )}
    </Panel>
  )
}
