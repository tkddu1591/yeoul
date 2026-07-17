/** IME 조합 중의 Enter는 글자 확정이지 제출이 아니다 — 한글 입력 조기 제출 방지 (리뷰 실측) */
export function isSubmitEnter(key: string, isComposing: boolean): boolean {
  return key === 'Enter' && !isComposing
}
