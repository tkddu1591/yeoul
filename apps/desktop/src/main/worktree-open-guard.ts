import type { WorktreeInfo } from '@git-gui/domain'
// 화면 어휘 사전(E8) — main도 이 사전을 따른다. terms.ts는 React·DOM 의존이 없는 순수 상수라
// 프로세스 경계를 넘어써도 electron 무의존 조건은 그대로 유지된다
import { T } from '../renderer/src/terms'

/**
 * "앱에서 열기" 대상 검증의 순수부 (E7c 목록 대조 + E7d ⑥ prunable 친절화).
 * electron 무의존 — 단위 테스트 가능. 실패 메시지는 사용자에게 그대로 보인다.
 * prunable을 열면 이후 rev-parse가 원어 ENOENT를 뱉는다 — 여기서 먼저 친절 거부한다
 */
export function assertOpenableWorktree(list: WorktreeInfo[], path: string): WorktreeInfo {
  const found = list.find((worktree) => worktree.path === path)
  if (found === undefined) {
    throw new Error(`이 저장소의 ${T.worktree}가 아니에요. 새로고침해 주세요.`)
  }
  if (found.prunable) {
    throw new Error(`폴더가 사라진 ${T.worktree}예요. 지우기로 정리해 주세요.`)
  }
  return found
}
