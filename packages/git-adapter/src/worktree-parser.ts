import type { WorktreeInfo } from '@git-gui/domain'

/**
 * `git worktree list --porcelain -z` 출력을 파싱한다 (E7c 실측 A·B).
 * 필드는 NUL 종결, 레코드 구분은 빈 필드(연속 NUL). 첫 레코드가 본체.
 * 필드 변형: worktree·HEAD·branch|detached·prunable[ 사유]·locked[ 사유]·bare.
 * 기형 레코드(worktree 필드 부재)는 추측하지 않고 건너뛴다 (log-parser 관례)
 */
export function parseWorktrees(rawOutput: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = []
  let current: { path?: string; branch: string | null; headHash: string | null; prunable: boolean; locked: boolean } | null =
    null
  const flush = () => {
    if (current !== null && current.path !== undefined) {
      worktrees.push({
        path: current.path,
        isMain: worktrees.length === 0,
        branch: current.branch,
        headHash: current.headHash,
        prunable: current.prunable,
        locked: current.locked,
      })
    }
    current = null
  }
  for (const field of rawOutput.split('\0')) {
    if (field === '') {
      flush()
      continue
    }
    current ??= { branch: null, headHash: null, prunable: false, locked: false }
    if (field.startsWith('worktree ')) current.path = field.slice('worktree '.length)
    else if (field.startsWith('HEAD ')) current.headHash = field.slice('HEAD '.length)
    else if (field.startsWith('branch ')) {
      current.branch = field.slice('branch '.length).replace(/^refs\/heads\//, '')
    }
    // detached·bare는 branch가 null인 초기값 그대로 — prunable·locked만 표시로 바꾼다
    else if (field === 'prunable' || field.startsWith('prunable ')) current.prunable = true
    else if (field === 'locked' || field.startsWith('locked ')) current.locked = true
  }
  flush()
  return worktrees
}
