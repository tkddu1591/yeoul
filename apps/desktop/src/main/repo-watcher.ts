import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { createTrailingDebounce, isRelevantGitEvent } from './watch-filter'

/** 이벤트 폭주 묶음 창 (실측 1: 커밋 1회 = 18이벤트) */
const DEBOUNCE_MS = 300

/**
 * 저장소 하나의 .git을 감시한다 (E7b) — 관련 이벤트가 잦아들면 onChanged를 1회 부른다.
 * 반환값은 정리 함수. 감시 실패는 기능 저하로만(수동 새로고침은 그대로 동작) — 던지지 않는다
 */
export function watchRepository(repoPath: string, onChanged: () => void): () => void {
  const debounce = createTrailingDebounce(DEBOUNCE_MS, onChanged)
  let watcher: FSWatcher | null = null
  try {
    watcher = watch(join(repoPath, '.git'), { recursive: true }, (_type, file) => {
      if (file !== null && isRelevantGitEvent(file.toString())) debounce.hit()
    })
  } catch {
    return () => {}
  }
  return () => {
    debounce.dispose()
    watcher?.close()
  }
}
