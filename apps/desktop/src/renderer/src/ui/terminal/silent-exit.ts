/**
 * 무출력 즉시 종료 판정 (E7d ② — E7b 최우선 후속 '침묵 실패').
 * 정상 쉘은 프롬프트라도 찍는다 — 출력 0바이트로 exit하면 쉘 자체가 깨진 것.
 * exit code는 보지 않는다(깨진 쉘이 0을 반환할 수도 있다 — 실측 2는 code=1이지만 판정에 불필요)
 */
export function silentExitNotice(dataReceived: boolean): string | null {
  if (dataReceived) return null
  return '쉘이 바로 종료됐어요. 로그인 쉘($SHELL) 설정을 확인해 주세요.'
}
