// E7f 패키징 검증 — 산출 .app의 이름·아이콘·네이티브 모듈·서명을 확인하고, **실제로 띄워 본다**.
//
// 실행 스모크를 넣은 이유(E14b 후속): 예전 이 스크립트는 "아이콘 파일이 있는가"처럼 정적인 것만
// 봤고, 그래서 E7f 이후 **패키징 앱이 한 번도 뜨지 않는 상태로 계속 통과했다.** 두 결함이 있었다 —
//   ① main이 dev용 dock.setIcon을 패키징에서도 불러 asar에 없는 png를 찾다 즉사
//   ② 서명을 건너뛰어 Electron 원본 서명이 무효인 채 남아 macOS가 Finder·open 경로에서 거부
// 둘 다 "파일이 있는가"로는 절대 안 잡히고, 띄워 봐야만 잡힌다.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const appPath = process.argv[2] ?? 'apps/desktop/dist/mac-universal/Yeoul.app'
const plist = `${appPath}/Contents/Info.plist`
const read = (key) =>
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist]).toString().trim()

const failures = []
const releaseVerification = process.env.GIT_GUI_VERIFY_RELEASE === '1'

// ── 정적 검사 ─────────────────────────────────────────────────────────────
if (read('CFBundleName') !== 'Yeoul') failures.push(`CFBundleName=${read('CFBundleName')}`)
if (read('CFBundleDisplayName') !== 'Yeoul')
  failures.push(`CFBundleDisplayName=${read('CFBundleDisplayName')}`)
const iconFile = read('CFBundleIconFile')
if (!iconFile.startsWith('icon')) failures.push(`CFBundleIconFile=${iconFile}`)
const executable = `${appPath}/Contents/MacOS/Yeoul`
const executableArchs = execFileSync('lipo', ['-archs', executable]).toString().trim().split(/\s+/)
if (!executableArchs.includes('arm64') || !executableArchs.includes('x86_64')) {
  failures.push(`Universal 실행 파일 아키텍처 부족: ${executableArchs.join(', ')}`)
}
// node-pty가 asar 밖에 풀렸고 spawn-helper가 실행 가능해야 pty가 산다 (E7b tarball 결손 재확인)
const helperGlob = `${appPath}/Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds`
if (!existsSync(helperGlob)) failures.push('node-pty prebuilds missing (asarUnpack)')
else {
  const helper = execFileSync('bash', [
    '-lc',
    `ls "${helperGlob}"/darwin-*/spawn-helper | head -1`,
  ])
    .toString()
    .trim()
  if (helper === '') failures.push('spawn-helper missing')
  else if (!(statSync(helper).mode & 0o111)) failures.push(`spawn-helper not executable: ${helper}`)

  for (const [directory, expected] of [
    ['darwin-arm64', 'arm64'],
    ['darwin-x64', 'x86_64'],
  ]) {
    const binary = `${helperGlob}/${directory}/pty.node`
    if (!existsSync(binary)) {
      failures.push(`${directory}/pty.node missing`)
      continue
    }
    const archs = execFileSync('lipo', ['-archs', binary]).toString().trim().split(/\s+/)
    if (!archs.includes(expected)) failures.push(`${directory}/pty.node 아키텍처=${archs.join(',')}`)
  }
}

// ── 서명 ──────────────────────────────────────────────────────────────────
// electron-builder가 서명을 건너뛰면 Electron 바이너리의 원본 linker-signed 서명이 남는데,
// 번들 내용은 바뀌었으니 무효가 된다. 그 상태에서도 터미널로 바이너리를 직접 때리면 뜨기 때문에
// "빌드는 됐는데 Finder에서 안 열린다"가 된다 — codesign --verify만이 이걸 구분한다 (E14b 실측)
try {
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'pipe' })
} catch (error) {
  const detail = String(error.stderr ?? error.message).trim().split('\n')[0]
  failures.push(`서명 무효 (Finder·open에서 실행 거부됨): ${detail}`)
}
const signature = spawnSync('codesign', ['-d', '--verbose=4', appPath], { encoding: 'utf8' })
const signatureInfo = signature.stderr
const identifier = /Identifier=(\S+)/.exec(signatureInfo)?.[1]
if (identifier !== 'io.github.tkddu1591.yeoul') {
  failures.push(
    `서명 Identifier=${identifier ?? '없음'} (io.github.tkddu1591.yeoul이어야 한다)`,
  )
}
if (releaseVerification) {
  if (!signatureInfo.includes('Authority=Developer ID Application:')) {
    failures.push('Developer ID Application 서명이 아니다')
  }
  try {
    execFileSync('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath], { stdio: 'pipe' })
  } catch (error) {
    failures.push(`Gatekeeper 평가 실패: ${String(error.stderr ?? error.message).trim().split('\n')[0]}`)
  }
  try {
    execFileSync('xcrun', ['stapler', 'validate', appPath], { stdio: 'pipe' })
  } catch (error) {
    failures.push(`공증 티켓 검증 실패: ${String(error.stderr ?? error.message).trim().split('\n')[0]}`)
  }
}

// 정적·서명 단계에서 이미 깨졌으면 띄워 볼 필요가 없다
if (failures.length > 0) {
  console.error('패키징 검증 실패:', failures.join(' / '))
  process.exit(1)
}

// ── 실행 스모크 ───────────────────────────────────────────────────────────
// Playwright는 apps/desktop의 devDependency라 그쪽 기준으로 해석한다
const require_ = createRequire(join(process.cwd(), 'apps/desktop/package.json'))
const { _electron: electron } = require_('@playwright/test')

const repo = await mkdtemp(join(tmpdir(), 'verify-app-repo-'))
const userData = await mkdtemp(join(tmpdir(), 'verify-app-userdata-'))
let app
try {
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' })
  execFileSync('git', ['init', '--initial-branch=main', repo], { stdio: 'pipe' })
  git('config', 'user.email', 'verify@example.com')
  git('config', 'user.name', 'Verify')
  await writeFile(join(repo, 'smoke.txt'), 'base\n')
  git('add', '-A')
  git('commit', '-m', 'init')
  await writeFile(join(repo, 'smoke.txt'), 'changed\n')

  app = await electron.launch({
    executablePath: `${appPath}/Contents/MacOS/Yeoul`,
    timeout: 60_000,
    // GIT_GUI_E2E_SHOW=1 — 숨김 창이면 렌더가 정말 됐는지 확인이 약해진다.
    // GIT_GUI_USER_DATA — 사용자의 실제 설정을 건드리지 않는다
    env: {
      ...process.env,
      GIT_GUI_E2E_REPO: repo,
      GIT_GUI_USER_DATA: userData,
      GIT_GUI_E2E_SHOW: '1',
      GIT_GUI_DISABLE_AUTO_UPDATE: '1',
    },
  })
  const window = await app.firstWindow({ timeout: 60_000 })
  // main이 죽으면(①의 아이콘 예외 등) 여기서 창이 안 잡히거나 렌더가 비어 실패한다
  await window.locator('.app__header').waitFor({ timeout: 30_000 })
  await window.getByTestId('file-unstaged-smoke.txt').waitFor({ timeout: 30_000 })
  if (!existsSync(join(userData, 'diagnostics', 'crashes'))) {
    failures.push('Crashpad 로컬 수집 폴더가 만들어지지 않았다')
  }

  // pty — 정적 검사(spawn-helper 실행권한)는 "있다"만 보지 "돈다"는 못 본다.
  // packed 경로 require가 실제로 동작하는지는 여기서만 드러난다 (E7f Task 4 실측 참조)
  await window.getByTestId('terminal-toggle').click()
  await window.locator('.xterm-helper-textarea').click({ timeout: 30_000 })
  await window.keyboard.type('echo PACKAGED_PTY_OK')
  await window.keyboard.press('Enter')
  await window
    .locator('.terminal-dock')
    .filter({ hasText: 'PACKAGED_PTY_OK' })
    .waitFor({ timeout: 15_000 })
} catch (error) {
  failures.push(`실행 스모크 실패: ${String(error).split('\n')[0]}`)
} finally {
  await app?.close().catch(() => {})
  await rm(repo, { recursive: true, force: true })
  await rm(userData, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error('패키징 검증 실패:', failures.join(' / '))
  process.exit(1)
}
console.log(
  `패키징 검증 통과: Universal(arm64+x86_64)·이름·아이콘·node-pty·서명${
    releaseVerification ? '·Developer ID·Gatekeeper·공증 티켓' : ''
  } · 실행 스모크(부팅·변경목록·pty) OK`,
)
