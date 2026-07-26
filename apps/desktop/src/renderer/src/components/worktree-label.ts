/**
 * 워크트리 행 표시 규칙 (E7j) — 같은 이름 워크트리가 여럿일 때 어느 것인지, 어디에 있는지
 * 한눈에 보이게 하는 순수 함수들. codex·claude 계열 도구가 만드는
 * `~/.codex/worktree/<세션>/<저장소>` 구조에서 구분 정보가 경로 **가운데**에 있는 것이 설계 전제다.
 */

/** 경로를 세그먼트로 쪼갠다 — 빈 조각 제거 */
function segments(path: string): string[] {
  return path.split('/').filter((part) => part !== '')
}

/**
 * 행 2줄에 쓰는 부모 폴더 표기 — 홈은 `~`, 너무 길면 **앞을 버리고 뒤 조각을 살린다**
 * (가운데 생략은 구분 정보인 세션 폴더를 지운다). 항상 `/`로 끝난다.
 */
export function shortenParent(path: string, home: string, keep = 2): string {
  const parts = segments(path)
  const parentParts = parts.slice(0, -1)
  if (parentParts.length === 0) return '/'
  const homeParts = segments(home)
  const underHome =
    homeParts.length > 0 && homeParts.every((part, index) => parentParts[index] === part)
  const rest = underHome ? parentParts.slice(homeParts.length) : parentParts
  if (underHome && rest.length === 0) return '~/'
  if (rest.length <= keep) return `${underHome ? '~/' : '/'}${rest.join('/')}/`
  return `…/${rest.slice(-keep).join('/')}/`
}

/** 어느 도구·폴더가 만든 워크트리인지 — 홈 아래 dot 폴더면 그 이름, 홈 직속이면 "내 폴더" */
export function sourceChip(path: string, home: string): string {
  const parts = segments(path)
  const homeParts = segments(home)
  const underHome = homeParts.length > 0 && homeParts.every((part, index) => parts[index] === part)
  if (!underHome) return parts[0] ?? '/'
  const rest = parts.slice(homeParts.length)
  if (rest.length <= 1) return '내 폴더'
  return rest[0]!.startsWith('.') ? rest[0]! : '내 폴더'
}

/**
 * 행 이름 — 리프가 겹치면 구분되는 조상 폴더를 하나씩 붙여 유일해질 때까지 확장한다.
 * 겹치지 않는 워크트리는 짧은 이름을 유지한다(정보 소음 최소화)
 */
export function uniqueNames(paths: string[]): Map<string, string> {
  const names = new Map<string, string>()
  const partsOf = new Map(paths.map((path) => [path, segments(path)]))
  for (const path of paths) {
    const parts = partsOf.get(path)!
    let depth = 1
    let label = parts.slice(-depth).join('/')
    while (
      depth < parts.length &&
      paths.some((other) => other !== path && partsOf.get(other)!.slice(-depth).join('/') === label)
    ) {
      depth += 1
      label = parts.slice(-depth).join('/')
    }
    names.set(path, label)
  }
  return names
}

/**
 * 브랜치 이름 — 길면 **앞의 네임스페이스**(`claude/`·`feature/` 등)를 생략한다.
 * 구분 정보(티켓 번호 등)는 네임스페이스 바로 뒤에 오므로 남은 부분의 앞쪽을 유지한다.
 */
export function shortenBranch(branch: string, max: number): string {
  if (branch.length <= max) return branch
  const rest = branch.slice(branch.indexOf('/') + 1)
  return `…${rest.length <= max - 1 ? rest : rest.slice(0, max - 1)}`
}
