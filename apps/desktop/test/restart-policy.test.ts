import { describe, expect, it } from 'vitest'
import {
  AUTO_RESTART_MAX,
  AUTO_RESTART_RESET_MS,
  canAutoRestart,
  nextCrashStreak,
} from '../src/main/restart-policy'

/**
 * E15e 리뷰 I-1 — 크래시-온-로드 무한 reload 루프를 끊는 연속 자동 재시동 정책.
 * 실물 배선(index.ts의 크래시 장부·showActiveTab의 자동/수동 분기)은 E2E가 물고,
 * 여기는 판정 산수(연속의 정의·상한 경계)를 못박는다.
 */
describe('연속 자동 재시동 정책 (E15e 리뷰 I-1)', () => {
  it('로드 직후의 크래시는 연속이다 — 카운트가 쌓인다', () => {
    expect(nextCrashStreak(0, 0)).toBe(1)
    expect(nextCrashStreak(1, 500)).toBe(2)
    // 리셋 기준 바로 아래까지는 전부 연속이다
    expect(nextCrashStreak(2, AUTO_RESTART_RESET_MS - 1)).toBe(3)
  })

  it('충분히 살고 난 크래시는 새 사건이다 — 1로 리셋 (경계 포함)', () => {
    // 경계 자체(정확히 리셋 기준만큼 생존)도 리셋이다 — >로 구현하면 여기서 빨갛다
    expect(nextCrashStreak(5, AUTO_RESTART_RESET_MS)).toBe(1)
    expect(nextCrashStreak(AUTO_RESTART_MAX + 10, 60_000)).toBe(1)
  })

  it('상한 이하만 자동 재시동한다 — 넘기면 정지', () => {
    expect(canAutoRestart(0)).toBe(true)
    expect(canAutoRestart(AUTO_RESTART_MAX)).toBe(true)
    expect(canAutoRestart(AUTO_RESTART_MAX + 1)).toBe(false)
  })

  it('크래시-온-로드 시나리오 — 정확히 상한만큼 재시동하고 영영 멈춘다', () => {
    // index.ts의 실제 순서(크래시마다 streak 갱신 → 자동 재시동 판정)를 그대로 돌린다.
    // 로드가 끝나자마자(50ms) 또 죽는 탭: 상한(3)까지 true, 그 뒤로 전부 false여야
    // 무한 루프가 아니다 — 상한 판정을 지우면(항상 true) 여기서 빨갛다
    let streak = 0
    const restarts: boolean[] = []
    for (let i = 0; i < AUTO_RESTART_MAX + 3; i++) {
      streak = nextCrashStreak(streak, 50)
      restarts.push(canAutoRestart(streak))
    }
    expect(restarts).toEqual([true, true, true, false, false, false])
  })

  it('가끔 죽는 탭은 몇 번을 죽어도 재시동된다 — 살 만큼 살면 매번 첫 크래시다', () => {
    // 리셋이 없으면(항상 누적) 네 번째 크래시부터 자동 복구를 잃는다 — 스펙 §1의 유일 탭
    // 자동 재시동이 "가끔 죽는" 정상 탭에서 계속 살아 있음을 못박는다
    let streak = 0
    for (let i = 0; i < 10; i++) {
      streak = nextCrashStreak(streak, 60_000)
      expect(canAutoRestart(streak)).toBe(true)
    }
  })
})
