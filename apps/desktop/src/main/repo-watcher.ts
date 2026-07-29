import { watch, type FSWatcher } from 'node:fs'
import { createTrailingDebounce, isRelevantGitEvent, isWorkingTreeEvent } from './watch-filter'

/** 이벤트 폭주 묶음 창 (실측 1: 커밋 1회 = 18이벤트) */
const DEBOUNCE_MS = 300

/**
 * 해석된 git dir(공용)을 감시한다 (E7b·E7c) — 관련 이벤트가 잦아들면 onChanged를 1회 부른다.
 * 호출자(repoWatch 핸들러)가 --git-common-dir로 해석해 넘긴다: 링크드 워크트리의 .git은
 * 파일(gitdir 포인터)이라 그대로 감시하면 이벤트가 오지 않는다(E7c 실측 H1). 공용 dir을
 * 감시하면 본체·모든 워크트리의 변경(worktrees/<이름>/*)이 다 잡힌다(실측 H2).
 * 반환값은 정리 함수. 감시 실패는 기능 저하로만(수동 새로고침은 그대로 동작) — 던지지 않는다
 */
export function watchRepository(gitDir: string, onChanged: () => void): () => void {
  const debounce = createTrailingDebounce(DEBOUNCE_MS, onChanged)
  let watcher: FSWatcher | null = null
  try {
    // {recursive: true}는 macOS/Windows 전용 — Linux에선 생성이 throw해 fail-soft(수동 새로고침만)가 된다
    watcher = watch(gitDir, { recursive: true }, (_type, file) => {
      if (file !== null && isRelevantGitEvent(file.toString())) debounce.hit()
    })
    // fs.watch는 생성 후에도 비동기 'error'를 낼 수 있다(.git 소멸·이름 변경 등) —
    // 리스너가 없으면 main 프로세스가 죽는다. 감시만 조용히 내려놓는다 (품질 리뷰)
    watcher.on('error', () => {
      watcher?.close()
      watcher = null
      debounce.dispose()
    })
  } catch {
    return () => {}
  }
  return () => {
    debounce.dispose()
    watcher?.close()
  }
}

/** 워킹트리 이벤트는 파일 저장 한 번이 여러 건이라 묶고, 계속 쓰는 프로세스에 굶지 않게 상한을 둔다 */
const WORKTREE_MAX_WAIT_MS = 2000

/**
 * 저장소 루트(워킹트리)를 감시한다 (E10) — 파일 내용만 바뀌는 변화는 .git에 흔적이 없어
 * 기존 watchRepository로는 영원히 잡히지 않았다(실측: 추적 안 된 파일 생성·삭제·추적 파일
 * 수정 모두 .git 이벤트 0건). 실패는 기능 저하로만 — 던지지 않는다(watchRepository 관례)
 */
export function watchWorkingTree(rootPath: string, onChanged: () => void): () => void {
  const debounce = createTrailingDebounce(DEBOUNCE_MS, onChanged, WORKTREE_MAX_WAIT_MS)
  let watcher: FSWatcher | null = null
  try {
    watcher = watch(rootPath, { recursive: true }, (_type, file) => {
      if (file !== null && isWorkingTreeEvent(file.toString())) debounce.hit()
    })
    watcher.on('error', () => {
      watcher?.close()
      watcher = null
      debounce.dispose()
    })
  } catch {
    return () => {}
  }
  return () => {
    debounce.dispose()
    watcher?.close()
  }
}
