/**
 * .git 감시 이벤트 필터 (E7b 실측 1):
 * - *.lock 제외 — git status(읽기)조차 index.lock을 만든다: 스냅샷 조회가 자기 이벤트를
 *   낳아 무한 새로고침 루프가 되는 함정
 * - objects/·logs/ 제외 — 커밋 내용물·reflog는 HEAD·refs 이벤트가 이미 대변한다
 * - 수용: HEAD·index·packed-refs·refs/**·대문자 상태 마커(MERGE_HEAD 등)·rebase 디렉터리
 */
export function isRelevantGitEvent(relativePath: string): boolean {
  if (relativePath.endsWith('.lock')) return false
  if (relativePath.startsWith('objects/') || relativePath.startsWith('logs/')) return false
  if (relativePath === 'HEAD' || relativePath === 'index' || relativePath === 'packed-refs') {
    return true
  }
  if (relativePath.startsWith('refs/')) return true
  if (relativePath.startsWith('rebase-merge/') || relativePath.startsWith('rebase-apply/')) {
    return true
  }
  // MERGE_HEAD·CHERRY_PICK_HEAD·REVERT_HEAD·FETCH_HEAD·ORIG_HEAD 등 top-level 상태 마커
  return /^[A-Z_]+$/.test(relativePath)
}

export interface TrailingDebounce {
  hit(): void
  dispose(): void
}

/** 마지막 hit 후 delayMs가 지나면 fire를 1회 부른다 — git 한 명령의 이벤트 폭주를 묶는다 */
export function createTrailingDebounce(delayMs: number, fire: () => void): TrailingDebounce {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    hit() {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        fire()
      }, delayMs)
    },
    dispose() {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}
