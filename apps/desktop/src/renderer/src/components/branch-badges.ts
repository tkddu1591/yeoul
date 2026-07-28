import type { LocalBranchStatus } from '@git-gui/domain'
import { T } from '../terms'

/**
 * 실험 공간 행 우측 상태 배지 문구 (E7a) — 색이 아니라 글자로 전달한다(색약 대응 관례).
 * ahead/behind는 fetch 기준값이다 — "원격 최신으로 업데이트"가 fetch를 겸한다
 */
export function trackBadgeLabel(branch: LocalBranchStatus): string {
  if (branch.upstream === null) return T.noUpstream
  if (branch.upstreamGone) return '업스트림 삭제됨'
  const parts: string[] = []
  if (branch.ahead !== null && branch.ahead > 0) parts.push(`↑${branch.ahead}`)
  if (branch.behind !== null && branch.behind > 0) parts.push(`↓${branch.behind}`)
  return parts.length > 0 ? parts.join(' ') : '동기화됨'
}
