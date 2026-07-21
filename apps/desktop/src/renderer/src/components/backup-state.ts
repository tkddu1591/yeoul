import type { BranchInfo } from '@git-gui/domain'

/**
 * 마지막 저장(HEAD)이 원격에 이미 백업됐는가 — 실행취소(undo)·메시지 고치기(amend) 확인창의
 * 경고 병기 판정 (E5b). ahead === 0이면 HEAD ⊆ upstream(백업됨), ahead > 0이면 HEAD 자신이
 * 아직 안 올라갔다. ahead === null(upstream ref 소실 등 판정 불가)은 보수적으로 "백업됐을 수
 * 있음"으로 본다 — 경고를 놓치는 쪽이 원격 어긋남보다 위험하다 (판정 편차 표는 플랜 참조)
 */
export function isHeadBackedUp(branch: BranchInfo): boolean {
  if (branch.upstream === null) return false
  return branch.ahead === 0 || branch.ahead === null
}
