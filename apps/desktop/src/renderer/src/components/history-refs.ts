export interface ArrangedRefs {
  /** 보여줄 배지 — 우선순위 상위 (현재 브랜치 > 로컬·태그 > 원격) */
  visible: string[]
  /** "+N"으로 접히는 나머지 — 툴팁으로만 보여준다 */
  hidden: string[]
}

/** 원격 ref 추정 — decorate 출력의 원격은 "<remote>/…" 형태다. origin 우선 규칙(push)과 동일 계열 휴리스틱 */
function refPriority(ref: string, currentBranch: string | null): number {
  if (ref === currentBranch) return 0
  if (!ref.includes('/')) return 1
  if (ref.startsWith('origin/')) return 2
  // 슬래시가 있지만 origin/이 아닌 것 — 로컬 폴더형(feature/a) 또는 다른 원격. 로컬 쪽에 가깝게 둔다
  return 1
}

/**
 * ref 배지를 우선순위로 정렬해 상위 max개만 보이게 나눈다 (피드백: 여러 개·긴 이름이면 전부 죽는다).
 * 같은 우선순위 안에서는 입력 순서를 유지한다(안정 정렬 — 예측 가능성).
 */
export function arrangeRefs(
  refs: string[],
  currentBranch: string | null,
  max = 2,
): ArrangedRefs {
  const sorted = refs
    .map((ref, index) => ({ ref, index, priority: refPriority(ref, currentBranch) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map((entry) => entry.ref)
  // 접힘이 생기는 행은 1개만 보여준다 — 배지끼리 폭을 나눠 갖다 전부 "ma…"로 죽는 것을 막는다 (품질 리뷰 실측)
  const effectiveMax = sorted.length > max ? 1 : max
  return { visible: sorted.slice(0, effectiveMax), hidden: sorted.slice(effectiveMax) }
}

/**
 * 원격 ref 추정 — decorate 출력의 원격은 "origin/…" 형태다(E4 관례 휴리스틱, refPriority와 동일 기준).
 * 폴더형 로컬 이름(feature/a)과의 구분은 origin/ 접두만 신뢰한다
 */
export function isRemoteRef(ref: string): boolean {
  return ref.startsWith('origin/')
}
