/**
 * 연속 자동 재시동 정책 (E15e 리뷰 I-1) — "로드하면 반드시 죽는" 렌더러의 무한 reload 루프를 끊는다.
 *
 * 스펙 §1(유일 탭 크래시는 자동 reload)과 §3(자동 재시도 루프 없음)은 크래시-온-로드에서
 * 양립이 불가능했다 — reload가 끝나는 순간(did-finish-load) 곧장 다음 크래시가 와서
 * crash → reload → crash가 무한히 돈다(리뷰 실측: 15초에 크래시 152회·reload 151회, 크래시마다
 * setCrashed의 즉시 디스크 쓰기까지 초당 ~20회). 해소는 **자동 재시동에만 연속 상한**을 두는 것:
 * 수동 클릭 복구(`tabs:activate`)는 상한과 무관하게 언제나 reload다 — 스펙 §2의 "클릭이 곧
 * 복구"가 사용자의 의지라면, 자동 재시동은 앱의 추측이라 추측만 유한해야 한다.
 *
 * "연속"의 판정은 타이머 없이 시각 차로 한다 — 직전 로드 완료 시각을 적어 두고, **다음
 * 크래시에서** 경과 시간으로 가른다: 로드 후 충분히 살았으면(가끔 죽는 탭) 새 사건이라 1부터,
 * 곧장 죽었으면(크래시-온-로드) 연속이라 누적. 생존 타이머를 걸어 리셋하는 형태보다 값싸고
 * (탭마다 타이머·해제 배선이 없다) 판정이 순수 함수가 되어 단위 테스트가 된다 — 시계(Date.now)는
 * 호출자(index.ts)가 들고 여기는 산수만 한다.
 */

/** 연속 자동 재시동 상한 — 연속 크래시가 이 수를 넘기면 자동 reload를 멈춘다(크래시 표시만 남는다) */
export const AUTO_RESTART_MAX = 3

/** 이만큼 살았으면 "가끔 죽는" 탭이다 — 연속이 끊겨 다음 크래시는 1부터 센다 */
export const AUTO_RESTART_RESET_MS = 10_000

/**
 * 크래시가 직전 로드 완료 후 `aliveMs` 만에 왔다 — 새 연속 크래시 수를 돌려준다.
 * 리셋 기준 이상 살았으면 이번이 새 사건의 첫 크래시(1), 아니면 연속(prevStreak + 1)
 */
export function nextCrashStreak(prevStreak: number, aliveMs: number): number {
  return aliveMs >= AUTO_RESTART_RESET_MS ? 1 : prevStreak + 1
}

/** 이 연속 크래시 수에서 자동 재시동해도 되는가 — 상한 이하만. 수동 복구는 이 판정을 거치지 않는다 */
export function canAutoRestart(crashStreak: number): boolean {
  return crashStreak <= AUTO_RESTART_MAX
}
