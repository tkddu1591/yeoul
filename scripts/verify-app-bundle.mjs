// E7f 패키징 검증 — 산출 .app의 이름·아이콘·네이티브 모듈을 확인한다 (게이트 스크립트)
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'

const appPath = process.argv[2] ?? 'apps/desktop/dist/mac-arm64/Git GUI.app'
const plist = `${appPath}/Contents/Info.plist`
const read = (key) =>
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist]).toString().trim()

const failures = []
if (read('CFBundleName') !== 'Git GUI') failures.push(`CFBundleName=${read('CFBundleName')}`)
if (read('CFBundleDisplayName') !== 'Git GUI') failures.push(`CFBundleDisplayName=${read('CFBundleDisplayName')}`)
const iconFile = read('CFBundleIconFile')
if (!iconFile.startsWith('icon')) failures.push(`CFBundleIconFile=${iconFile}`)
// node-pty가 asar 밖에 풀렸고 spawn-helper가 실행 가능해야 pty가 산다 (E7b tarball 결손 재확인)
const helperGlob = `${appPath}/Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds`
if (!existsSync(helperGlob)) failures.push('node-pty prebuilds missing (asarUnpack)')
else {
  const helper = execFileSync('bash', ['-lc', `ls "${helperGlob}"/darwin-*/spawn-helper | head -1`]).toString().trim()
  if (helper === '') failures.push('spawn-helper missing')
  else if (!(statSync(helper).mode & 0o111)) failures.push(`spawn-helper not executable: ${helper}`)
}

if (failures.length > 0) {
  console.error('패키징 검증 실패:', failures.join(' / '))
  process.exit(1)
}
console.log('패키징 검증 통과: 이름·아이콘·node-pty(asarUnpack·spawn-helper 실행권한) OK')
