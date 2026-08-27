import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { app, dialog, net, shell } from 'electron'
import { applicationUpdateRelease } from './application-update-release'
import { diagnostics } from './diagnostics'

const INITIAL_CHECK_DELAY_MS = 15_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const RELEASE_API_URL = 'https://api.github.com/repos/tkddu1591/yeoul-releases/releases/latest'

interface ApplicationUpdateOptions {
  disabled?: boolean
}

interface ReleaseAsset {
  name: string
  browser_download_url: string
}

interface PublicRelease {
  tag_name: string
  html_url: string
  assets: ReleaseAsset[]
}

interface UpdateFiles {
  version: string
  releaseUrl: string
  dmg: ReleaseAsset
  checksum: ReleaseAsset
}

function isReleaseAsset(value: unknown): value is ReleaseAsset {
  if (typeof value !== 'object' || value === null) return false
  const asset = value as Record<string, unknown>
  return typeof asset.name === 'string' && typeof asset.browser_download_url === 'string'
}

function parseRelease(value: unknown): PublicRelease | null {
  if (typeof value !== 'object' || value === null) return null
  const release = value as Record<string, unknown>
  if (
    typeof release.tag_name !== 'string' ||
    typeof release.html_url !== 'string' ||
    !Array.isArray(release.assets) ||
    !release.assets.every(isReleaseAsset)
  ) {
    return null
  }
  return {
    tag_name: release.tag_name,
    html_url: release.html_url,
    assets: release.assets,
  }
}

async function fetchResponse(url: string): Promise<Response> {
  const response = await net.fetch(url, {
    redirect: 'follow',
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `Yeoul/${app.getVersion()}`,
    },
  })
  if (!response.ok) throw new Error(`업데이트 서버 응답 ${response.status}: ${url}`)
  return response
}

async function getUpdateFiles(): Promise<UpdateFiles | null> {
  const release = parseRelease(await (await fetchResponse(RELEASE_API_URL)).json())
  if (release === null) throw new Error('공개 릴리스 정보의 형식이 올바르지 않습니다.')

  const version = release.tag_name.startsWith('v') ? release.tag_name.slice(1) : release.tag_name
  if (!applicationUpdateRelease.version.isNewer(version, app.getVersion())) return null

  const dmgName = `Yeoul-${version}-universal.dmg`
  const dmg = release.assets.find((asset) => asset.name === dmgName)
  const checksum = release.assets.find((asset) => asset.name === `${dmgName}.sha512`)
  if (dmg === undefined || checksum === undefined) {
    throw new Error(`${release.tag_name} 릴리스에 Universal DMG 또는 SHA-512 파일이 없습니다.`)
  }
  return { version, releaseUrl: release.html_url, dmg, checksum }
}

async function downloadVerifiedDmg(files: UpdateFiles): Promise<string> {
  const checksumText = await (await fetchResponse(files.checksum.browser_download_url)).text()
  const expectedChecksum = applicationUpdateRelease.checksum.getSha512(checksumText)
  if (expectedChecksum === null) throw new Error('업데이트 체크섬 파일이 올바르지 않습니다.')

  const response = await fetchResponse(files.dmg.browser_download_url)
  if (response.body === null) throw new Error('업데이트 파일 본문이 비어 있습니다.')

  const directory = await mkdtemp(join(tmpdir(), 'yeoul-update-'))
  const filePath = join(directory, files.dmg.name)
  const hash = createHash('sha512')
  try {
    const source = Readable.fromWeb(response.body as unknown as NodeReadableStream)
    source.on('data', (chunk: Buffer) => hash.update(chunk))
    await pipeline(source, createWriteStream(filePath, { flags: 'wx' }))
    if (hash.digest('hex') !== expectedChecksum) {
      throw new Error('다운로드한 DMG의 SHA-512 검증에 실패했습니다.')
    }
    return filePath
  } catch (cause) {
    await rm(directory, { recursive: true, force: true })
    throw cause
  }
}

function writeFailure(message: string, cause: unknown): void {
  diagnostics.entry.write({
    area: 'update',
    message,
    detail: cause instanceof Error ? cause.stack : String(cause),
  })
}

function start(options: ApplicationUpdateOptions = {}): void {
  if (!app.isPackaged || options.disabled === true) return

  let promptedVersion: string | null = null
  let checking = false
  const check = (): void => {
    if (checking) return
    checking = true
    void getUpdateFiles()
      .then(async (files) => {
        if (files === null || promptedVersion === files.version) return
        promptedVersion = files.version
        const { response } = await dialog.showMessageBox({
          type: 'info',
          title: '여울 업데이트',
          message: `여울 ${files.version} 버전이 나왔어요.`,
          detail:
            `현재 버전은 ${app.getVersion()}이에요. 검증된 Universal DMG를 내려받아 열 수 있어요.\n` +
            '무료 ad-hoc 배포라 앱을 종료한 뒤 새 여울을 응용 프로그램 폴더에 덮어써야 해요.',
          buttons: ['DMG 다운로드', '릴리스 페이지', '나중에'],
          defaultId: 0,
          cancelId: 2,
        })
        if (response === 1) {
          await shell.openExternal(files.releaseUrl)
          return
        }
        if (response !== 0) return

        try {
          const filePath = await downloadVerifiedDmg(files)
          const openError = await shell.openPath(filePath)
          if (openError !== '') throw new Error(openError)
          await dialog.showMessageBox({
            type: 'info',
            title: '여울 업데이트 DMG 열림',
            message: '다운로드와 SHA-512 검증을 마쳤어요.',
            detail: '여울을 종료한 뒤 DMG의 여울을 응용 프로그램 폴더로 드래그해 교체해 주세요.',
            buttons: ['확인'],
          })
        } catch (cause) {
          writeFailure('업데이트 다운로드 또는 검증 실패', cause)
          await dialog.showMessageBox({
            type: 'error',
            title: '여울 업데이트 실패',
            message: '업데이트 DMG를 안전하게 준비하지 못했어요.',
            detail: cause instanceof Error ? cause.message : String(cause),
            buttons: ['확인'],
          })
        }
      })
      .catch((cause: unknown) => writeFailure('공개 릴리스 확인 실패', cause))
      .finally(() => {
        checking = false
      })
  }

  const firstCheck = setTimeout(check, INITIAL_CHECK_DELAY_MS)
  const repeatedCheck = setInterval(check, CHECK_INTERVAL_MS)
  firstCheck.unref()
  repeatedCheck.unref()
  app.once('before-quit', () => {
    clearTimeout(firstCheck)
    clearInterval(repeatedCheck)
  })
}

export const applicationUpdate = { start }
