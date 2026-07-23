/**
 * 새 워크트리 경로 제안 (E7c) — 본체 폴더 옆에 "<저장소 이름>-<브랜치 슬러그>".
 * 슬러그: 슬래시·공백을 하이픈으로. 사용자가 다이얼로그에서 수정할 수 있다
 */
export function suggestWorktreePath(mainPath: string, branch: string): string {
  const trimmed = mainPath.replace(/\/+$/, '')
  const slug = branch.replace(/[/\s]+/g, '-')
  return `${trimmed}-${slug}`
}
