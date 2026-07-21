import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef, useState } from 'react'
import type { CommitSummary } from '@git-gui/domain'
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { Pictogram } from '../ui/Pictogram'
import { buildGraph, type GraphRow } from './history-graph'
import { arrangeRefs, isRemoteRef, refBadgeLabel } from './history-refs'
import { formatAbsoluteTime, formatRelativeTime } from './relative-time'
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
  /** merging 등 진행 중에는 이력 조작(이동·가져오기·되돌리기·실행취소·메시지 고치기)을 비활성 */
  actionsDisabled: boolean
  onSelect(hash: string): void
  onLoadMore(): void
  /** "지금 여기"가 로드 범위 밖일 때 누른다 — 찾을 때까지 더 읽어 스크롤한다 (품질 리뷰) */
  onLocateHead(): void
  onAction(action: HistoryAction): void
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
  actionsDisabled,
  onSelect,
  onLoadMore,
  onLocateHead,
  onAction,
}: HistoryPanelProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; commit: CommitSummary } | null>(null)
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

  // "지금 여기"(HEAD)가 바뀌거나, "지금 여기로"로 로드 범위에 처음 들어온 순간 그 행으로 스크롤한다
  // (품질 리뷰 — 구현 실측 정정: revealHead는 headHash를 바꾸지 않으므로 발견 전이(headFound)도 봐야 한다.
  //  불리언 전이만 보므로 이미 보이는 상태의 단순 더 불러오기로는 튀지 않는다)
  const headIndex = headHash === null ? -1 : history.findIndex((commit) => commit.hash === headHash)
  const headFound = headIndex >= 0
  useEffect(() => {
    if (headIndex >= 0) virtualizer.scrollToIndex(headIndex, { align: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headHash, headFound])

  // 마지막 행이 렌더 범위에 들어오면 다음 페이지를 불러온다 (⑩) — busy·상한은 store가 이중 방어한다
  useEffect(() => {
    if (truncated && !busy && lastRendered >= history.length - 1) onLoadMore()
  }, [truncated, busy, lastRendered, history.length, onLoadMore])

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
        label: `"${switchTarget}" 실험 공간으로 이동 (switch)`,
        disabled: actionsDisabled,
        onSelect: () => onAction({ kind: 'switch', branch: switchTarget }),
      })
    }
    entries.push(
      {
        key: 'branch-here',
        label: '여기서 실험 공간 만들기…',
        onSelect: () => onAction({ kind: 'branch-here', hash: commit.hash }),
      },
      { key: 'sep-1', separator: true },
      {
        key: 'cherry-pick',
        label: '이 저장만 가져오기 (cherry-pick)',
        disabled: actionsDisabled,
        onSelect: () => onAction({ kind: 'cherry-pick', hash: commit.hash }),
      },
      {
        key: 'revert',
        label: '이 저장 되돌리기 (revert)',
        disabled: actionsDisabled,
        onSelect: () => onAction({ kind: 'revert', hash: commit.hash }),
      },
      {
        key: 'undo-last',
        label: isHead ? '저장 실행취소 (undo)' : '저장 실행취소 (undo) — 가장 최근 저장에서만',
        disabled: actionsDisabled || !isHead,
        onSelect: () => onAction({ kind: 'undo', hash: commit.hash }),
      },
      {
        key: 'reword',
        label: isHead
          ? '저장 메시지 고치기… (amend)'
          : '저장 메시지 고치기 (amend) — 가장 최근 저장에서만',
        disabled: actionsDisabled || !isHead,
        onSelect: () => onAction({ kind: 'reword', hash: commit.hash, subject: commit.subject }),
      },
      {
        key: 'tag-here',
        label: '태그 만들기… (tag)',
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
      title="저장된 역사"
      accessory={
        <>
          <Badge tone="git">log</Badge>
          <Badge tone="count">
            <span data-testid="history-count">
              {truncated ? `${historyLimit}+` : history.length}
            </span>
          </Badge>
          {headHash !== null && headIndex < 0 && (
            <Button variant="ghost" size="sm" isDisabled={busy} onPress={onLocateHead} testId="history-locate-head">
              지금 여기로
            </Button>
          )}
        </>
      }
      testId="history-panel"
    >
      {history.length === 0 ? (
        <div className="history-panel__empty">
          <Pictogram kind="commit" size={20} label="저장 시점" />
          <p>
            아직 저장된 시점이 없어요.
            <br />
            저장할 때마다 여기에 쌓여요.
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
                  <button
                    type="button"
                    className={[
                      'history-item',
                      isHead ? 'history-item--head' : '',
                      selectedHash === commit.hash ? 'history-item--selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    disabled={busy}
                    onClick={() => onSelect(commit.hash)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setMenu({ x: event.clientX, y: event.clientY, commit })
                    }}
                    title={`${commit.subject}\n${formatAbsoluteTime(commit.committedAt)} · ${commit.authorName}`}
                    aria-current={selectedHash === commit.hash ? 'true' : undefined}
                    data-testid={`history-item-${commit.hash}`}
                  >
                    <GraphCell row={graph[item.index]!} isHead={isHead} />
                    <div className="history-item__body">
                      <span className="history-item__title">
                        {isHead && <span className="history-item__here">지금 여기</span>}
                        {(() => {
                          // 배지 폭 경쟁으로 전부 말줄임되는 것을 막는다 — 상위 2개 + "+N" 접기 (피드백)
                          const arranged = arrangeRefs(commit.refs, currentBranch, commit.tags)
                          return (
                            <>
                              {arranged.visible.map((ref) => (
                                <span
                                  key={ref}
                                  title={ref}
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
                              ))}
                              {arranged.hidden.length > 0 && (
                                <span
                                  className="history-item__ref history-item__ref--more"
                                  title={arranged.hidden
                                    .map((ref) => refBadgeLabel(ref, commit.tags))
                                    .join('\n')}
                                  data-testid={`history-refs-more-${commit.hash}`}
                                >
                                  +{arranged.hidden.length}
                                </span>
                              )}
                            </>
                          )
                        })()}
                        {commit.parents.length >= 2 && (
                          <span className="history-item__mergemark">병합</span>
                        )}
                        <span className="history-item__subject" title={commit.subject}>
                          {commit.subject}
                        </span>
                      </span>
                      <span className="history-item__meta">
                        {formatRelativeTime(commit.committedAt, Date.now())} · {commit.authorName}
                      </span>
                    </div>
                    <span className="history-item__hash">{commit.shortHash}</span>
                  </button>
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
