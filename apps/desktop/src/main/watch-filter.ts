/**
 * .git 감시 이벤트 필터 (E7b 실측 1):
 * - *.lock 제외 — git status(읽기)조차 index.lock을 만든다: 스냅샷 조회가 자기 이벤트를
 *   낳아 무한 새로고침 루프가 되는 함정
 * - objects/·logs/ 제외 — 커밋 내용물·reflog는 HEAD·refs 이벤트가 이미 대변한다
 * - 수용: HEAD·index·packed-refs·refs/**·대문자 상태 마커(MERGE_HEAD 등)·rebase 디렉터리
 */
export function isRelevantGitEvent(relativePath: string): boolean {
  // 링크드 워크트리의 per-worktree 파일은 common dir 아래 worktrees/<이름>/에 있다 (E7c 실측 H2)
  // — 접두를 벗기고 같은 규칙을 적용한다. 접두만 있는 경로(등록 디렉터리 자체)는 빈 문자열이 되어 거부된다
  const normalized = relativePath.replace(/^worktrees\/[^/]+\//, '')
  if (normalized.endsWith('.lock')) return false
  if (normalized.startsWith('objects/') || normalized.startsWith('logs/')) return false
  if (normalized === 'HEAD' || normalized === 'index' || normalized === 'packed-refs') {
    return true
  }
  if (normalized.startsWith('refs/')) return true
  if (normalized.startsWith('rebase-merge/') || normalized.startsWith('rebase-apply/')) {
    return true
  }
  // fetch는 변화가 없어도 FETCH_HEAD를 매번 touch한다(E7e 실측 1) — 자동 fetch가 10분마다
  // 헛갱신을 만들지 않게 제외한다. 실제 변화는 refs/remotes/가 위의 refs/ 수용으로 잡힌다
  if (normalized === 'FETCH_HEAD') return false
  // MERGE_HEAD·CHERRY_PICK_HEAD·REVERT_HEAD·ORIG_HEAD 등 top-level 상태 마커
  return /^[A-Z_]+$/.test(normalized)
}

export interface TrailingDebounce {
  hit(): void
  dispose(): void
}

/**
 * 마지막 hit 후 delayMs가 지나면 fire를 1회 부른다 — git 한 명령의 이벤트 폭주를 묶는다.
 * maxWaitMs를 주면 **첫 hit로부터** 그만큼 지났을 때 조용해지길 기다리지 않고 발화한다:
 * 트레일링만 있으면 개발 서버처럼 계속 쓰는 프로세스 앞에서 영원히 굶는다(E10).
 */
export function createTrailingDebounce(
  delayMs: number,
  fire: () => void,
  maxWaitMs?: number,
): TrailingDebounce {
  let timer: ReturnType<typeof setTimeout> | null = null
  let cycleStartedAt: number | null = null
  const clear = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    cycleStartedAt = null
  }
  return {
    hit() {
      if (cycleStartedAt === null) cycleStartedAt = Date.now()
      const remaining =
        maxWaitMs === undefined ? delayMs : Math.min(delayMs, cycleStartedAt + maxWaitMs - Date.now())
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(
        () => {
          clear()
          fire()
        },
        Math.max(0, remaining),
      )
    },
    dispose: clear,
  }
}

/**
 * 워킹트리 감시 필터 (E10) — `.git` 아래는 전용 감시(isRelevantGitEvent)가 이미 본다.
 * **무시 목록을 두지 않는다**: 실측상 빌드 1회(2.48초)가 207 이벤트지만 디바운스가 재조회
 * 2회로 합친다(2초 max-wait이 빌드가 아직 도는 중에 한 번 발화하고, 조용해진 뒤 트레일링이
 * 한 번 더 발화) — git status는 20~100ms다. .gitignore 의미론을 반쯤 흉내 내다 틀리는 쪽이 더 위험하다
 */
export function isWorkingTreeEvent(relativePath: string): boolean {
  return relativePath !== '.git' && !relativePath.startsWith('.git/')
}
