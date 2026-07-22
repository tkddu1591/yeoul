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
    // {recursive: true}는 macOS/Windows 전용 — Linux에선 생성이 throw해 fail-soft(수동 새로고침만)가 된다
    watcher = watch(join(repoPath, '.git'), { recursive: true }, (_type, file) => {
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
