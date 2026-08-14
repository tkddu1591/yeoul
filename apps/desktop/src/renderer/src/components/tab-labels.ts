/**
 * 탭 라벨 순수 규칙 (E15c) — null(빈 탭)은 '새 탭', 저장소는 마지막 폴더명,
 * 동명이면 구분에 필요한 만큼만 부모 조각을 붙인다.
 *
 * 동명 구분은 E7j의 `uniqueNames`를 그대로 재사용한다 — 같은 문제(리프 동명을 조상
 * 조각으로 유일해질 때까지 확장)를 이미 풀었고, 워크트리 고유 전제(홈 `~` 축약·경로
 * 생략)는 전부 `shortenParent`/`shortenAbove` 몫이라 `uniqueNames` 자체에는 없다
 * (worktree-label.ts:44-61 실측 — 입력은 경로 배열뿐, 홈·깊이 인자가 아예 없다).
 */
import { uniqueNames } from './worktree-label'

/** 탭 순서 그대로 라벨 배열을 돌려준다 — i번째 라벨이 i번째 탭의 것 */
export function tabLabels(paths: readonly (string | null)[]): string[] {
  // 빈 탭은 동명 판정에서 뺀다 — '새 탭'끼리는 구분할 정보가 없고, 구분할 필요도 없다
  const repoPaths = paths.filter((path): path is string => path !== null)
  const names = uniqueNames(repoPaths)
  return paths.map((path) => (path === null ? '새 탭' : (names.get(path) ?? path)))
}
