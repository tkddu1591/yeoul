import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  /**
   * _electron.launch 래퍼 — close를 감싸 닫기 직전 화면을 저장한다. 사용법은 _electron.launch와 동일.
   *
   * 격리 기본값(E12 사전 병합 수정): 호출자가 env에 GIT_GUI_USER_DATA를 넣지 않았다면 매 실행마다
   * 새 임시 userData 디렉터리를 만들어 주입한다. 그렇지 않으면 대부분의 테스트가 기본 userData의
   * 같은 settings.json을 공유해, 한 테스트가 남긴 설정(leftCollapsed, dockOpen 등)이 나중 테스트를
   * 깨뜨린다 — smoke.spec.ts:1537의 dockOpen 트랩과 동일한 부류. 재시작 지속성 테스트처럼 두 번의
   * launch가 상태를 공유해야 하는 경우는 호출자가 이미 GIT_GUI_USER_DATA를 직접 넘기므로 그대로 존중한다.
   */
  async launch(
    options: NonNullable<Parameters<typeof _electron.launch>[0]>,
  ): Promise<ElectronApplication> {
    let env = options.env
    let injectedUserData: string | undefined
    if (!env || !('GIT_GUI_USER_DATA' in env)) {
      // env가 없으면 Playwright 기본값(process.env 전체)을 그대로 보존한 채 한 키만 얹는다
      injectedUserData = await mkdtemp(join(tmpdir(), 'gg-e2e-userdata-'))
      env = { ...(env ?? process.env), GIT_GUI_USER_DATA: injectedUserData }
    }
    const app = await _electron.launch({ ...options, env })
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
      try {
        return await close()
      } finally {
        // 이 harness가 만든 임시 userData만 정리한다 — 호출자가 직접 넘긴 것(재시작 테스트 등)은
        // 그 테스트가 이미 자기 finally에서 rm하므로 손대지 않는다
        if (injectedUserData) await rm(injectedUserData, { recursive: true, force: true }).catch(() => {})
      }
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
