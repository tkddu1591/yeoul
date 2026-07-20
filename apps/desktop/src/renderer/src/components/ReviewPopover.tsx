import { ExternalLink, GitPullRequest, Key, Terminal, Unplug } from 'lucide-react'
import { useState } from 'react'
import { Dialog, DialogTrigger, Popover } from 'react-aria-components'
import type { HostingStatus, PullSummary } from '@git-gui/ipc-contract'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import './review-popover.css'

interface ReviewPopoverProps {
  status: HostingStatus | null
  pulls: PullSummary[]
  busy: boolean
  /** 현재 실험 공간 이름 — 기본 공간(main·master) 추정 비활성에 쓴다. 확정 검사는 main 프로세스 */
  currentBranch: string | null
  /** 팝오버를 열 때 — 목록을 새로 불러온다 */
  onOpen(): void
  onConnectGh(): void
  /** 토큰 붙여넣기 다이얼로그 열기 — 다이얼로그 자체는 App이 관리한다 */
  onConnectToken(): void
  onDisconnect(): void
  /** 리뷰 요청 제목 다이얼로그 열기 — 다이얼로그 자체는 App이 관리한다 */
  onCreate(): void
  /** 리뷰 요청을 브라우저로 — 주소는 main이 보관한 목록에서만 찾는다 */
  onOpenPull(number: number): void
}

/** 리뷰 (스펙 §9 E3a) — GitHub 연결과 리뷰 요청(pull request) 생성·목록. ShelfPopover 패턴 */
export function ReviewPopover({
  status,
  pulls,
  busy,
  currentBranch,
  onOpen,
  onConnectGh,
  onConnectToken,
  onDisconnect,
  onCreate,
  onOpenPull,
}: ReviewPopoverProps) {
  // 다이얼로그를 여는 동작은 팝오버를 닫고 시작한다 — 모달과 팝오버의 포커스 경합을 피한다
  const [open, setOpen] = useState(false)
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
      <Button variant="ghost" size="sm" testId="review-open">
        <GitPullRequest size={13} aria-hidden="true" /> 리뷰 <Badge tone="git">PR</Badge>
      </Button>
      <Popover className="review-popover">
        <Dialog className="review-popover__dialog" aria-label="리뷰 요청">
          {status === null || !status.connected ? (
            <>
              <p className="review-popover__empty">
                GitHub와 연결하면 리뷰 요청 (pull request)을 만들고 볼 수 있어요.
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
                  이 저장소의 원격(origin)이 GitHub가 아니에요. GitHub 저장소를 백업(push) 대상으로
                  연결하면 리뷰 요청을 만들 수 있어요.
                </p>
              ) : (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    isDisabled={busy || isDefaultBranch}
                    onPress={() => openDialog(onCreate)}
                    testId="review-create"
                  >
                    <GitPullRequest size={13} aria-hidden="true" /> 이 실험 공간 리뷰 요청하기
                  </Button>
                  {isDefaultBranch && (
                    <p className="review-popover__reason" data-testid="review-create-reason">
                      "{currentBranch}"는 모두가 함께 쓰는 기본 공간이에요. 실험 공간(branch)을
                      만들어 요청해 주세요.
                    </p>
                  )}
                  {pulls.length === 0 ? (
                    <p className="review-popover__empty">열린 리뷰 요청이 없어요.</p>
                  ) : (
                    <ul className="review-popover__list">
                      {pulls.map((pull) => (
                        <li key={pull.number} className="review-popover__row">
                          <button
                            type="button"
                            className="review-popover__pull"
                            title="브라우저에서 열기"
                            onClick={() => onOpenPull(pull.number)}
                            data-testid={`review-pull-${pull.number}`}
                          >
                            <span className="review-popover__pull-title">
                              #{pull.number} {pull.title}
                              {pull.isDraft && <Badge>초안</Badge>}
                            </span>
                            <span className="review-popover__pull-branch">{pull.headBranch}</span>
                            <ExternalLink size={12} aria-hidden="true" />
                          </button>
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
