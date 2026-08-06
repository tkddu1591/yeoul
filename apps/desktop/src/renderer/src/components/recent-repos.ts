/**
 * 최근 연 저장소 목록 규칙 (E15a).
 * 헤더 전환기가 보여 주고 설정(userData/settings.json)에 영속된다 — 순수 규칙만 여기에 둔다.
 */

/** 헤더 팝오버가 스크롤 없이 담기는 길이 */
export const RECENT_REPOS_MAX = 10

/** 연 저장소를 맨 앞으로 — 이미 있으면 중복을 만들지 않고 옮긴다 */
export function pushRecentRepo(recent: readonly string[], path: string): string[] {
  return [path, ...recent.filter((entry) => entry !== path)].slice(0, RECENT_REPOS_MAX)
}

/** 없어진 저장소를 목록에서 뺀다 (전환기가 열기 실패 시 부른다) */
export function removeRecentRepo(recent: readonly string[], path: string): string[] {
  return recent.filter((entry) => entry !== path)
}
