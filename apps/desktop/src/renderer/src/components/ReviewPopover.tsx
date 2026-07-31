import { ExternalLink, GitPullRequest, Key, Terminal, Unplug } from 'lucide-react'
import { useState } from 'react'
import { useEscapeFallback } from '../ui/use-escape-fallback'
import { Dialog, DialogTrigger, Popover } from 'react-aria-components'
import type { HostingStatus, PullSummary } from '@git-gui/ipc-contract'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Tooltip } from '../ui/Tooltip'
import { T } from '../terms'
import './review-popover.css'

interface ReviewPopoverProps {
  status: HostingStatus | null
  /** 열린 리뷰 요청 — null이면 마지막 조회 실패(빈 목록으로 위장하지 않는다 — 품질 리뷰) */
  pulls: PullSummary[] | null
  busy: boolean
  /** 현재 실험 공간 이름 — 기본 공간(main·master) 추정 비활성에 쓴다. 확정 검사는 main 프로세스 */
  currentBranch: string | null
  /** 진행 중 작업(merging·reverting) — 요청 버튼을 비활성하고 사유를 보여준다 (품질 리뷰) */
  stateBlocked: boolean
  /** 팝오버를 열 때 — 목록을 새로 불러온다 */
  onOpen(): void
  onConnectGh(): void
  /** 토큰 붙여넣기 다이얼로그 열기 — 다이얼로그 자체는 App이 관리한다 */
  onConnectToken(): void
  onDisconnect(): void
  /** 리뷰 요청 제목 다이얼로그 열기 — 다이얼로그 자체는 App이 관리한다 */
  onCreate(): void
  /** 목록 항목 클릭 — 팝오버를 닫고 우측 열을 리뷰 상세로 전환한다 */
  onSelectPull(number: number): void
  /** 리뷰 요청을 브라우저로 — 주소는 main이 보관한 목록에서만 찾는다. 항목의 바깥 링크 아이콘 전용 */
  onOpenPull(number: number): void
  /** 목록 조회가 진행 중인가 — Panel을 쓰지 않으므로 헤더에 직접 단다 (E14a) */
  pending: boolean
}

/** 리뷰 (스펙 §9 E3a·E3b) — GitHub 연결·리뷰 요청 생성·목록·상세 진입. ShelfPopover 패턴 */
export function ReviewPopover({
  status,
  pulls,
  busy,
  currentBranch,
  stateBlocked,
  onOpen,
  onConnectGh,
  onConnectToken,
  onDisconnect,
  onCreate,
  onSelectPull,
  onOpenPull,
  pending,
}: ReviewPopoverProps) {
  // 다이얼로그를 여는 동작은 팝오버를 닫고 시작한다 — 모달과 팝오버의 포커스 경합을 피한다
  const [open, setOpen] = useState(false)
  // busy 비활성화로 포커스가 body에 떨어진 뒤에도 ESC로 닫힌다 (E6b 실측 2)
  useEscapeFallback(open, () => setOpen(false))
  const openDialog = (action: () => void) => {
    setOpen(false)
    action()
  }
  // 기본 공간 추정(main·master) — UI는 빠른 안내만, 확정 거부는 main이 default_branch를 실제 조회해 한다
  const isDefaultBranch = currentBranch === 'main' || currentBranch === 'master'
  return (
    <DialogTrigger
      isOpen={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) onOpen()
      }}
    >
      <Tooltip content={`${T.pullRequest} (pull request)`} summary={T.pullRequest} describedBy={false}>
        <Button
          variant="ghost"
          size="sm"
          className="review-popover__trigger"
          testId="review-open"
          aria-label={T.pullRequest}
        >
          <GitPullRequest size={13} aria-hidden="true" />{' '}
          <span className="app__btn-label">{T.pullRequest}</span>
        </Button>
      </Tooltip>
      <Popover className="review-popover">
        <Dialog className="review-popover__dialog" aria-label={T.pullRequest}>
          {status === null || !status.connected ? (
            <>
              <p className="review-popover__empty">
                GitHub와 연결하면 {T.pullRequest}를 만들고 볼 수 있어요.
              </p>
              <div className="review-popover__buttons">
                {status?.ghAvailable === true && (
                  <Button
                    variant="neutral"
                    size="sm"
                    isDisabled={busy}
                    onPress={() => openDialog(onConnectGh)}
                    testId="review-connect-gh"
                  >
                    <Terminal size={13} aria-hidden="true" /> gh로 연결
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  isDisabled={busy}
                  onPress={() => openDialog(onConnectToken)}
                  testId="review-connect-token"
                >
                  <Key size={13} aria-hidden="true" /> 토큰으로 연결
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="review-popover__head">
                <span data-testid="review-login">@{status.login}</span>
                {/* 목록을 다시 불러오는 동안에도 이전 목록은 그대로 둔다 — 비우면 그게 깜빡임이다
                    (E14a 스펙 §2-3). Panel을 쓰지 않는 화면이라 스피너를 여기 직접 단다 */}
                {/* role="status" — 없으면 role=generic이라 Chromium이 aria-label을 버린다 (Panel 관례, E14a) */}
                {pending ? (
                  <span
                    className="ui-pending"
                    data-testid="review-pending"
                    role="status"
                    aria-label="불러오는 중"
                  />
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  isDisabled={busy}
                  onPress={onDisconnect}
                  testId="review-disconnect"
                >
                  <Unplug size={13} aria-hidden="true" /> 연결 해제
                </Button>
              </div>
              {status.repo === null ? (
                <p className="review-popover__empty">
                  이 저장소의 원격(origin)이 GitHub가 아니에요. GitHub 저장소를 {T.push} 대상으로
                  연결하면 {T.pullRequest}를 만들 수 있어요.
                </p>
              ) : (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    isDisabled={busy || isDefaultBranch || stateBlocked}
                    onPress={() => openDialog(onCreate)}
                    testId="review-create"
                  >
                    <GitPullRequest size={13} aria-hidden="true" /> 이 {T.branch}로 {T.pullRequest} 만들기
                  </Button>
                  {isDefaultBranch && (
                    <p className="review-popover__reason" data-testid="review-create-reason">
                      "{currentBranch}"는 모두가 함께 쓰는 기본 브랜치예요. {T.branch}를
                      만들어 요청해 주세요.
                    </p>
                  )}
                  {stateBlocked && (
                    <p className="review-popover__reason" data-testid="review-create-blocked">
                      지금 진행 중인 작업({T.merge}·{T.revert})을 먼저 마무리한 뒤 요청할 수 있어요.
                    </p>
                  )}
                  {pulls === null ? (
                    <p className="review-popover__empty">
                      {T.pullRequest} 목록을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 열어 주세요.
                    </p>
                  ) : pulls.length === 0 ? (
                    <p className="review-popover__empty">열린 {T.pullRequest}가 없어요.</p>
                  ) : (
                    <ul className="review-popover__list">
                      {pulls.map((pull) => (
                        <li key={pull.number} className="review-popover__row">
                          <Tooltip
                            content={`코멘트·${T.approve}·${T.merge} 보기`}
                            summary={`코멘트·${T.approve}·${T.merge} 보기`}
                          >
                            <button
                              type="button"
                              className="review-popover__pull"
                              onClick={() => openDialog(() => onSelectPull(pull.number))}
                              data-testid={`review-pull-${pull.number}`}
                            >
                              <span className="review-popover__pull-title">
                                #{pull.number} {pull.title}
                                {pull.isDraft && <Badge>초안</Badge>}
                              </span>
                              <span className="review-popover__pull-branch">{pull.headBranch}</span>
                            </button>
                          </Tooltip>
                          <Tooltip content="브라우저에서 열기" summary="브라우저에서 열기">
                            <button
                              type="button"
                              className="review-popover__pull-external"
                              aria-label={`#${pull.number} 브라우저에서 열기`}
                              onClick={() => onOpenPull(pull.number)}
                              data-testid={`review-pull-open-${pull.number}`}
                            >
                              <ExternalLink size={12} aria-hidden="true" />
                            </button>
                          </Tooltip>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  )
}
