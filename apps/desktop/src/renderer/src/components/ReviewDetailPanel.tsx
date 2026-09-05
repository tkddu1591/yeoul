import { pullReviewService } from '../service/pull-review.service'
import { ArrowLeft, Check, ExternalLink, GitMerge, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PullComment, PullDetailView } from '@git-gui/ipc-contract'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { Tooltip } from '../ui/Tooltip'
import { useNow } from '../ui/use-now'
import { formatRelativeTime } from './relative-time'
import { T } from '../terms'
import './review-detail-panel.css'

interface ReviewDetailPanelProps {
  view: PullDetailView
  busy: boolean
  /** 브라우저에서 열기 — 주소는 main이 보관한 목록에서만 찾는다(기존 pull-open) */
  onOpenBrowser(section?: 'files' | 'checks'): void
  onRefresh(): void
  onBack(): void
  /** 답변 달기 — 성공 여부 반환(성공 시에만 입력을 비운다) */
  onComment(body: string): Promise<boolean>
  onApprove(): void
  /** 병합 — 확인창은 App이 관리한다(실제 병합은 확인 후) */
  onMerge(): void
  /** 이 패널로 떨어질 조회(우측)가 진행 중인가 (E14a) */
  pending: boolean
}

/** `now`를 props로 받는다 — 코멘트 행마다 useNow()를 부르면 코멘트 수만큼 구독자가 생긴다 (E14b) */
function CommentRow({ comment, now }: { comment: PullComment; now: number }) {
  return (
    <li
      className="review-detail__comment"
      data-testid={`review-comment-${comment.kind}-${comment.id}`}
    >
      <p className="review-detail__comment-meta">
        <strong>@{comment.author}</strong>
        <span>{formatRelativeTime(comment.createdAt, now)}</span>
        {comment.state === 'approved' && <Badge>승인</Badge>}
        {comment.state === 'changes-requested' && <Badge>수정 요청</Badge>}
        {comment.state === 'dismissed' && <Badge>리뷰 취소됨</Badge>}
      </p>
      {comment.body !== '' && <p className="review-detail__comment-body">{comment.body}</p>}
    </li>
  )
}

/**
 * 리뷰 상세 (스펙 §9 후반부 E3b) — 우측 열 전환형(CommitDetailPanel 패턴):
 * 상단 제목·상태 배지, 중단 코멘트 타임라인(스크롤 — 가상화 불필요, per_page=100 상한),
 * 하단 답변 입력 + [승인하기]·[병합하기]. 네트워크·판정은 전부 store/main 몫이고 여기는 표시만.
 */
export function ReviewDetailPanel({
  view,
  busy,
  onOpenBrowser,
  onRefresh,
  onBack,
  onComment,
  onApprove,
  onMerge,
  pending,
}: ReviewDetailPanelProps) {
  const [reply, setReply] = useState('')
  // E14b — 코멘트 타임라인 전체가 이 하나를 나눠 쓴다 (CommentRow에 내려 준다)
  const now = useNow()
  const timelineRef = useRef<HTMLDivElement | null>(null)
  // 열 때·답변이 늘었을 때 최신(맨 아래)으로 — "코멘트 확인"의 기본 시선이자,
  // 전송 후 내 답변이 화면 밖에 남아 재전송(중복)을 유도하는 것을 막는다 (품질 리뷰)
  useEffect(() => {
    const el = timelineRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [view.comments.length])
  const summary = pullReviewService.summary.get(view)
  // 병합·닫힘 뒤에는 승인·병합이 의미 없다 — 코멘트는 닫힌 뒤에도 달 수 있다(GitHub 동작 그대로)
  const settled = summary.settled
  const submitReply = () => {
    const body = reply.trim()
    if (body === '') return
    void onComment(body).then((sent) => {
      if (sent) setReply('')
    })
  }
  return (
    <Panel
      title={`#${view.detail.number} ${view.detail.title}`}
      pending={pending}
      accessory={
        <>
          <span
            className="review-detail__status max-w-36 whitespace-normal! text-right"
            data-testid="review-detail-status"
          >
            {summary.status}
          </span>
          <Button
            variant="ghost"
            size="sm"
            isDisabled={busy}
            onPress={onBack}
            testId="review-detail-back"
          >
            <ArrowLeft size={13} aria-hidden="true" /> 목록으로
          </Button>
        </>
      }
      testId="review-detail-panel"
    >
      <div className="review-detail__meta">
        <Tooltip
          content={`${view.detail.headBranch} → ${view.detail.baseBranch}`}
          summary={`${view.detail.headBranch} → ${view.detail.baseBranch}`}
        >
          <span className="review-detail__branches">
            {view.detail.headBranch} → {view.detail.baseBranch}
          </span>
        </Tooltip>
        <Button
          variant="ghost"
          size="sm"
          isDisabled={busy}
          onPress={() => onOpenBrowser()}
          testId="review-detail-browser"
        >
          <ExternalLink size={13} aria-hidden="true" /> 브라우저에서 열기
        </Button>
      </div>
      <div className="max-h-48 shrink-0 overflow-auto border-b border-(--color-border) px-3 py-2 text-xs">
        <p className="my-1 text-(--color-text-muted)">
          HEAD {view.detail.headSha?.slice(0, 8) ?? '확인 필요'} · 파일{' '}
          {view.detail.changedFiles ?? '?'} · +{view.detail.additions ?? 0} / −
          {view.detail.deletions ?? 0}
        </p>
        <p className="whitespace-pre-wrap break-words">{view.detail.body || '본문이 없어요.'}</p>
        <div className="flex flex-wrap gap-1">
          <Button variant="primary" size="sm" onPress={() => onOpenBrowser('files')}>
            GitHub에서 변경 검토
          </Button>
          <Button variant="ghost" size="sm" onPress={() => onOpenBrowser('checks')}>
            검사 결과
          </Button>
          <Button variant="ghost" size="sm" isDisabled={pending || busy} onPress={onRefresh}>
            상태 다시 확인
          </Button>
        </div>
        <p role="status" className="mb-0 text-(--color-text-muted)">
          {summary.merge.reason}
        </p>
      </div>
      <div
        ref={timelineRef}
        className="review-detail__timeline min-h-0!"
        data-testid="review-detail-timeline"
      >
        {view.comments.length === 0 ? (
          <p className="review-detail__empty">아직 코멘트가 없어요.</p>
        ) : (
          <ul className="review-detail__comments">
            {view.comments.map((comment) => (
              <CommentRow key={`${comment.kind}-${comment.id}`} comment={comment} now={now} />
            ))}
          </ul>
        )}
      </div>
      <div className="review-detail__reply">
        <textarea
          data-testid="review-reply-input"
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          placeholder="답변을 입력해 주세요"
          rows={2}
          aria-label="답변"
        />
        <Button
          variant="neutral"
          size="sm"
          isDisabled={busy || reply.trim() === ''}
          onPress={submitReply}
          testId="review-reply-send"
        >
          <Send size={13} aria-hidden="true" /> 보내기
        </Button>
      </div>
      <div className="review-detail__actions">
        <Tooltip content={`${T.approve} (approve)`} summary={T.approve} describedBy={false}>
          <Button
            variant="neutral"
            size="sm"
            isDisabled={busy || settled}
            onPress={onApprove}
            testId="review-approve"
          >
            <Check size={13} aria-hidden="true" /> {T.approve}하기
          </Button>
        </Tooltip>
        <Tooltip content={`${T.merge} (merge)`} summary={T.merge} describedBy={false}>
          <Button
            variant="primary"
            size="sm"
            isDisabled={busy || !summary.merge.allowed}
            onPress={onMerge}
            testId="review-merge"
          >
            <GitMerge size={13} aria-hidden="true" /> {T.merge}하기
          </Button>
        </Tooltip>
      </div>
    </Panel>
  )
}
