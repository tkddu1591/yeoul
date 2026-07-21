import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { _electron, test, type ElectronApplication, type TestInfo } from '@playwright/test'

/**
 * 실패 시각 단서 (E6a 후속) — 숨김 창 E2E는 실패해도 화면 단서가 없다(electron.launch에는
 * Playwright 자동 trace 스크린샷이 붙지 않는다). 실측(플랜 실측 4): expect 실패가 테스트
 * 본문 finally를 지나는 시점에는 test.info().status가 아직 'passed'라 "실패일 때만 찍기"가
 * 불가능하다 — close 직전에 항상 마지막 화면을 찍고, 각 스펙의 afterEach(cleanupScreens)가
 * 성공한 테스트의 것만 지운다. 실패 시에만 test-results/<테스트 폴더>/last-screen-N.png가 남는다.
 */
const captured: string[] = []
let captureIndex = 0

export const electron = {
  /** _electron.launch 래퍼 — close를 감싸 닫기 직전 화면을 저장한다. 사용법은 _electron.launch와 동일 */
  async launch(
    options: NonNullable<Parameters<typeof _electron.launch>[0]>,
  ): Promise<ElectronApplication> {
    const app = await _electron.launch(options)
    const close = app.close.bind(app)
    app.close = async () => {
      captureIndex += 1
      const path = test.info().outputPath(`last-screen-${captureIndex}.png`)
      // 창이 이미 죽었어도 닫기는 계속한다 — 진단 보조일 뿐 테스트를 실패시키지 않는다
      await app
        .firstWindow()
        .then((window) => window.screenshot({ path }))
        .catch(() => {})
      captured.push(path)
      return close()
    }
    return app
  },
}

/** 각 스펙의 test.afterEach에서 호출 — 성공(기대 일치) 테스트의 화면 파일을 지운다. timeout 실패도 남는다 */
export async function cleanupScreens(testInfo: TestInfo): Promise<void> {
  if (testInfo.status === testInfo.expectedStatus) {
    for (const path of captured) {
      if (existsSync(path)) await rm(path, { force: true })
    }
  }
  captured.length = 0
}
