/**
 * 이 그룹(워크트리)에서 다음 탭 번호 — 닫아서 빈 자리가 있으면 **그 자리를 재사용**한다 (E12).
 * 전역 단조 증가 카운터였을 때는 3번을 닫고 새로 만들면 4번이 되고, 워크트리 A에서 둘을
 * 만들면 B의 첫 탭이 3번이었다 — 번호가 "남의 것이 어딘가 있다"고 거짓말을 했다
 */
export function nextTabNumber(used: readonly number[]): number {
  const taken = new Set(used)
  let candidate = 1
  while (taken.has(candidate)) candidate += 1
  return candidate
}
